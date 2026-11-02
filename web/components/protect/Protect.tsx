"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, getAddress, parseAbi, type Address } from "viem";
import { walletProvider, sendCall, reason } from "@/lib/chain";
import { ENGINE_URL, EXPLORER, chain } from "@/lib/constants";
import { useWallet } from "@/lib/wallet";
import { scan, type Finding, type Level } from "@/lib/guard-scan";

/** Same text the engine checks (engine/src/guard.ts). */
const guardText = (addr: string, time: string) => `Sign in to Trenchers Guard\n\nWallet: ${addr}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;
const TOKEN_KEY = "trenchers:guard:token";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const ago = (t: number) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`; };

type Alert = { id: string; t: number; wallet: string; level: Level; kind: string; title: string; body: string; tx?: string; token?: string; spender?: string; fix?: "approve" | "approveAll" };
type State = { address: string; wallets: { addr: string; label?: string; since: number }[]; limit: number; alerts: Alert[]; lastScan: number };
const REVOKE = parseAbi(["function approve(address spender, uint256 amount) returns (bool)", "function setApprovalForAll(address operator, bool approved)"]);

/** Examples for the checker (all made up). */
const pad = (a: string) => a.slice(2).padStart(64, "0");
const EX_TOKEN = "0x3333333333333333333333333333333333333333", EX_SPENDER = "0x9a0c00000000000000000000000000000000d1e5";
const EXAMPLES: { label: string; req: { method: string; params: unknown[]; origin?: string } }[] = [
  { label: "Unlimited approval", req: { method: "eth_sendTransaction", params: [{ to: EX_TOKEN, data: `0x095ea7b3${pad(EX_SPENDER)}${"f".repeat(64)}` }] } },
  { label: "Permit signature", req: { method: "eth_signTypedData_v4", params: ["0x1111111111111111111111111111111111111111", JSON.stringify({ primaryType: "Permit", domain: { name: "USD Coin", verifyingContract: EX_TOKEN }, message: { spender: EX_SPENDER, value: (2n ** 256n - 1n).toString(), deadline: "9999999999" } })] } },
  { label: "Every NFT in a collection", req: { method: "eth_sendTransaction", params: [{ to: EX_TOKEN, data: `0xa22cb465${pad(EX_SPENDER)}${"0".repeat(63)}1` }] } },
  { label: "Look-alike site", req: { method: "personal_sign", params: [`0x${Array.from(new TextEncoder().encode("Claim your airdrop")).map((b) => b.toString(16).padStart(2, "0")).join("")}`, "0x1111111111111111111111111111111111111111"], origin: "https://unlswap.org" } },
  { label: "Plain sign-in", req: { method: "personal_sign", params: [`0x${Array.from(new TextEncoder().encode("Sign in to Example\nNonce: 42")).map((b) => b.toString(16).padStart(2, "0")).join("")}`, "0x1111111111111111111111111111111111111111"], origin: "https://example.com" } },
];
const LEVEL: Record<Level, string> = { ok: "Looks fine", info: "Check the details", warn: "Be careful", danger: "Could drain your wallet" };

function Checker() {
  const [text, setText] = useState(JSON.stringify(EXAMPLES[0].req, null, 2));
  const [pick, setPick] = useState(0);
  const out = useMemo(() => {
    try { const r = JSON.parse(text) as { method?: string; params?: unknown[]; origin?: string }; if (!r.method) return { error: "Add a \"method\", e.g. eth_sendTransaction." }; return scan({ method: r.method, params: r.params ?? [], origin: r.origin }); }
    catch { return { error: "That isn't valid JSON yet." }; }
  }, [text]);
  return (
    <section className="pg-card" aria-labelledby="pg-check">
      <div className="pg-k mono">01 · Before you sign</div>
      <h2 id="pg-check">What would this let happen?</h2>
      <p className="pg-p">Pick an example or paste a wallet request (the JSON a site sends your wallet). It's read right here in your browser; nothing is sent anywhere.</p>
      <div className="pg-chips" role="tablist">
        {EXAMPLES.map((e, i) => <button key={e.label} type="button" className={`pg-chip${pick === i ? " on" : ""}`} onClick={() => { setPick(i); setText(JSON.stringify(e.req, null, 2)); }}>{e.label}</button>)}
      </div>
      <div className="pg-split">
        <textarea className="pg-code mono" value={text} onChange={(e) => { setText(e.target.value); setPick(-1); }} spellCheck={false} aria-label="Wallet request JSON" />
        <div className="pg-result">
          {"error" in out ? <p className="pg-quiet">{out.error}</p> : (
            <>
              <div className={`pg-level lv-${out.level}`}>{LEVEL[out.level]}</div>
              {out.findings.map((f: Finding, i: number) => (
                <div key={i} className={`pg-find lv-${f.level}`}><b>{f.title}</b>{f.lines.map((l, j) => <p key={j}>{l}</p>)}</div>
              ))}
              {!out.findings.length && <p className="pg-quiet">Nothing to check: this request doesn&apos;t sign or send anything.</p>}
            </>
          )}
          <p className="pg-ex mono">EXAMPLE DATA</p>
        </div>
      </div>
    </section>
  );
}

function Watch() {
  const { address, kind, openModal } = useWallet();
  const [token, setToken] = useState<string | null>(null);
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [add, setAdd] = useState("");
  const [tg, setTg] = useState<string | null>(null);

  useEffect(() => { try { setToken(localStorage.getItem(TOKEN_KEY)); } catch { /* private mode */ } }, []);
  const api = useCallback(async (path: string, body?: unknown, tok = token) => {
    const r = await fetch(`${ENGINE_URL}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { setToken(null); setSt(null); try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ } }
    if (!r.ok) throw new Error((j as { error?: string }).error ?? "Something went wrong. Try again.");
    return j;
  }, [token]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = () => api("/guard/state").then((j) => { if (alive) setSt(j as State); }).catch(() => {});
    load(); const iv = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, [token, api]);

  const signIn = async () => {
    if (!address || kind !== "wallet") { openModal(); return; }
    setBusy("signin"); setNote(null);
    try {
      const p = await walletProvider();
      const addr = getAddress(address), time = new Date().toISOString();
      const signature = await createWalletClient({ chain, transport: custom(p) }).signMessage({ account: addr, message: guardText(addr, time) });
      const j = await api("/guard/login", { address: addr, time, signature }, null) as { token: string; state: State };
      setToken(j.token); setSt(j.state);
      try { localStorage.setItem(TOKEN_KEY, j.token); } catch { /* */ }
    } catch (e) { const m = String((e as Error).message ?? e); setNote(/reject|denied/i.test(m) ? "Cancelled in your wallet." : m.split("\n")[0]); }
    setBusy(null);
  };
  const act = async (what: string, path: string, body: unknown) => {
    setBusy(what); setNote(null);
    try { setSt(await api(path, body) as State); if (path === "/guard/watch") setAdd(""); } catch (e) { setNote((e as Error).message); }
    setBusy(null);
  };
  const revoke = async (a: Alert) => {
    if (!address || address.toLowerCase() !== a.wallet) { setNote(`Connect ${short(a.wallet)} to revoke this approval.`); return; }
    setBusy(a.id); setNote(null);
    try {
      await sendCall(getAddress(address) as Address, a.fix === "approveAll"
        ? { address: getAddress(a.token!) as Address, abi: REVOKE, functionName: "setApprovalForAll", args: [getAddress(a.spender!), false] }
        : { address: getAddress(a.token!) as Address, abi: REVOKE, functionName: "approve", args: [getAddress(a.spender!), 0n] });
      setNote("Revoked. That contract can no longer spend it.");
      await act(a.id, "/guard/dismiss", { id: a.id });
    } catch (e) { setNote(reason(e)); }
    setBusy(null);
  };
  const telegram = async () => {
    setBusy("tg");
    try { const j = await api("/guard/telegram", {}) as { url: string }; setTg(j.url); window.open(j.url, "_blank", "noopener"); } catch (e) { setNote((e as Error).message); }
    setBusy(null);
  };

  return (
    <section className="pg-card" aria-labelledby="pg-watch">
      <div className="pg-k mono">02 · Around the clock</div>
      <h2 id="pg-watch">Your guard agent</h2>
      <p className="pg-p">It reads Robinhood Chain every couple of minutes for the wallets you add, and tells you when something looks wrong: an unlimited approval to a contract we don&apos;t know, every NFT in a collection handed over, several tokens leaving in one transaction, or your wallet being delegated to a contract (EIP-7702).</p>
      {!st ? (
        <div className="pg-signin">
          <button type="button" className="pg-btn" onClick={signIn} disabled={busy === "signin"}>{busy === "signin" ? "Check your wallet…" : address && kind === "wallet" ? "Sign in with your wallet" : "Connect wallet"}</button>
          <span className="pg-quiet">One free signature, no transaction. Your own wallet is watched from the start.</span>
        </div>
      ) : (
        <>
          <div className="pg-wallets">
            {st.wallets.map((w) => (
              <div key={w.addr} className="pg-wallet">
                <span className="pg-dot" aria-hidden="true" /><span className="mono">{short(w.addr)}</span>{w.label && <span className="pg-quiet">{w.label}</span>}
                <button type="button" className="tbtn" onClick={() => act(`un${w.addr}`, "/guard/unwatch", { address: w.addr })} disabled={!!busy}>remove</button>
              </div>
            ))}
            {st.wallets.length < st.limit && (
              <form className="pg-add" onSubmit={(e) => { e.preventDefault(); void act("add", "/guard/watch", { address: add.trim() }); }}>
                <input className="mono" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="0x… another wallet to watch" aria-label="Wallet address to watch" />
                <button type="submit" className="pg-btn pg-btn-s" disabled={!/^0x[0-9a-fA-F]{40}$/.test(add.trim()) || !!busy}>Watch</button>
              </form>
            )}
            <span className="pg-quiet mono">{st.wallets.length} of {st.limit} wallets · last check {st.lastScan ? ago(st.lastScan) : "starting"}</span>
          </div>
          <div className="pg-feed" aria-live="polite">
            <h3>Alerts</h3>
            {!st.alerts.length && <p className="pg-quiet">All quiet. You&apos;ll see anything unusual here, and on your phone or Telegram if you turn those on.</p>}
            {st.alerts.map((a) => (
              <div key={a.id} className={`pg-alert lv-${a.level}`}>
                <div className="pg-alert-top"><b>{a.title}</b><span className="pg-quiet mono">{short(a.wallet.replace(/^acct:/, ""))} · {ago(a.t)}</span></div>
                <p>{a.body}</p>
                <div className="pg-alert-act">
                  {a.fix && a.token && a.spender && <button type="button" className="pg-btn pg-btn-s" onClick={() => revoke(a)} disabled={!!busy}>{busy === a.id ? "Check your wallet…" : "Revoke"}</button>}
                  {a.tx && <a className="tbtn" href={`${EXPLORER}/tx/${a.tx}`} target="_blank" rel="noreferrer">tx</a>}
                  <button type="button" className="tbtn" onClick={() => act(a.id, "/guard/dismiss", { id: a.id })} disabled={!!busy}>dismiss</button>
                </div>
              </div>
            ))}
          </div>
          <div className="pg-signin">
            <button type="button" className="pg-btn pg-btn-ghost" onClick={telegram} disabled={busy === "tg"}>{tg ? "New Telegram link" : "Get alerts on Telegram"}</button>
            <span className="pg-quiet">{tg ? <>Press <b>Start</b> in Telegram to finish.</> : "Phone notifications you turned on for your agents get Guard alerts too."}</span>
          </div>
        </>
      )}
      {note && <p className="pg-note mono">{note}</p>}
    </section>
  );
}

export function Protect() {
  return (
    <div className="pg">
      <header className="pg-hero">
        <div className="pg-k mono">Protocol 06 · Trenchers Cybersecurity · Beta</div>
        <h1>Trenchers <span>Guard</span></h1>
        <p>Most wallet thefts start with one signature. Guard reads every request in plain English before you sign, and an agent watches your wallets after.</p>
      </header>
      <Checker />
      <Watch />
      <section className="pg-card" aria-labelledby="pg-ext">
        <div className="pg-k mono">03 · In your browser</div>
        <h2 id="pg-ext">The Chrome extension (beta)</h2>
        <p className="pg-p">It sits between websites and your wallet (MetaMask, Rabby, Coinbase Wallet and others). Risky requests pause behind a warning, and known phishing sites are blocked before they load. Everything is checked on your computer.</p>
        <ol className="pg-steps">
          <li><a className="pg-btn pg-btn-s" href="/guard/trenchers-guard-extension.zip" download>Download the extension</a> and unzip it.</li>
          <li>Open <span className="mono">chrome://extensions</span> and switch on <b>Developer mode</b> (top right).</li>
          <li>Click <b>Load unpacked</b> and choose the unzipped folder. Pin the shield to your toolbar.</li>
        </ol>
        <p className="pg-quiet">Chrome Web Store listing is coming. Until then this is the same build, straight from us.</p>
      </section>
      <section className="pg-card pg-honest" aria-labelledby="pg-limits">
        <div className="pg-k mono">04 · Straight answers</div>
        <h2 id="pg-limits">What it can and can&apos;t do</h2>
        <div className="pg-two">
          <div><h3>Can</h3><ul>
            <li>Explain approvals, permits, NFT approvals, batches and delegations before you sign</li>
            <li>Warn about look-alike and known phishing sites</li>
            <li>Alert you when a watched wallet approves an unknown contract, hands over a collection, or several tokens leave at once</li>
            <li>Flag a Trenchers Inference key used from a new network</li>
          </ul></div>
          <div><h3>Can&apos;t</h3><ul>
            <li>See a seed phrase or private key being copied: that happens off-chain</li>
            <li>Stop a transaction someone signs with a stolen key</li>
            <li>Undo a theft. If you get a sweep alert, move what&apos;s left to a new wallet</li>
            <li>Guarantee a contract is safe. Unknown means unknown, not bad</li>
          </ul></div>
        </div>
      </section>
    </div>
  );
}
