"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, getAddress, type Address } from "viem";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { TextButton } from "@/components/TextButton";
import { CHAT_OPEN, ENGINE_URL, OPENSEA_URL, ROUTES } from "@/lib/constants";
import { cachedOwned, ownedTrenchers, trencherBalance, walletProvider } from "@/lib/chain";
import { chain } from "@/lib/constants";
import { short, useWallet } from "@/lib/wallet";

/**
 * Holders' chat. Reading and posting need a Trencher in the connected wallet; signing in is one free signature.
 * Moderators (the Deployer by default, set on the engine) can remove messages.
 * Stays greyed out until NEXT_PUBLIC_CHAT_OPEN=1 (site) and CHAT_OPEN=1 (engine); moderators can use it before that.
 */
type Msg = { id: number; addr: string; avatar: number; text: string; t: number };
const loginText = (addr: string, time: string) => `Sign in to the Trenchers holders' chat\n\nWallet: ${addr}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;
const tokenKey = (a: string) => `trenchers:chat:${a.toLowerCase()}`;
const readToken = (a: string) => { try { const v = localStorage.getItem(tokenKey(a)); if (!v) return null; const exp = Number(v.split(".")[1]); return exp > Date.now() + 60_000 ? v : null; } catch { return null; } };
const when = (t: number) => { const d = new Date(t); return new Date().toDateString() === d.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

export function HoldersChat() {
  const w = useWallet();
  const me = w.address as Address | null;
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [serverOpen, setServerOpen] = useState<boolean | null>(null);
  const [admins, setAdmins] = useState<string[]>([]);
  const [owned, setOwned] = useState<number[] | null>(null);
  const [avatar, setAvatar] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const latest = useRef(0);
  const isAdmin = !!me && admins.includes(me.toLowerCase());
  const open = CHAT_OPEN || isAdmin;

  // messages: poll every 3 seconds
  const pull = useCallback(async () => {
    try {
      const j = (await fetch(`${ENGINE_URL}/chat?after=${latest.current}`, { cache: "no-store" }).then((r) => r.json())) as { open: boolean; messages: Msg[]; ids: number[]; admins: string[] };
      setServerOpen(j.open); setAdmins(j.admins ?? []);
      setMsgs((prev) => {
        const keep = new Set(j.ids ?? []);
        const merged = [...prev.filter((m) => keep.has(m.id)), ...j.messages.filter((m) => !prev.some((p) => p.id === m.id))];
        latest.current = merged.reduce((a, m) => Math.max(a, m.id), latest.current);
        return merged;
      });
    } catch { /* try again next round */ }
  }, []);
  useEffect(() => { pull(); const iv = setInterval(pull, 3000); return () => clearInterval(iv); }, [pull]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [msgs.length]);

  // which Trenchers this wallet holds: the saved list and a one-call balance check open the gate at once;
  // the full list (for the avatar picker) follows in the background
  const [bal, setBal] = useState<number | null>(null);
  useEffect(() => {
    setOwned(null); setToken(null); setAvatar(null); setBal(null);
    if (!me) return;
    setToken(readToken(me));
    const cached = cachedOwned(me);
    if (cached?.length) { setOwned(cached); setAvatar(cached[0]); }
    let live = true;
    trencherBalance(me).then((n) => live && setBal(n)).catch(() => {});
    ownedTrenchers(me).then((ids) => { if (!live) return; setOwned(ids); setAvatar((a) => (a && ids.includes(a) ? a : ids[0] ?? null)); }).catch(() => live && setOwned((o) => o ?? []));
    return () => { live = false; };
  }, [me]);

  const signIn = async () => {
    if (!me) return;
    setBusy(true); setNote(null);
    try {
      const p = await walletProvider();
      const addr = getAddress(me), time = new Date().toISOString();
      // make sure the wallet has this site connected (some wallets otherwise ignore the request silently)
      const accts = ((await p.request({ method: "eth_requestAccounts" } as never)) as string[]).map((a) => a.toLowerCase());
      if (!accts.includes(addr.toLowerCase())) throw new Error(`Your wallet is on a different account. Switch it to ${short(addr)} and try again.`);
      const sign = createWalletClient({ chain, transport: custom(p) }).signMessage({ account: addr, message: loginText(addr, time) });
      const timeout = new Promise<never>((_, no) => setTimeout(() => no(new Error("No signature came back. Open your wallet (click its icon in the browser bar), approve the sign-in request there, or try again.")), 90_000));
      const signature = await Promise.race([sign, timeout]);
      const r = await fetch(`${ENGINE_URL}/chat/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addr, time, signature }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Sign-in failed.");
      try { localStorage.setItem(tokenKey(me), j.token); } catch { /* private mode */ }
      setToken(j.token);
    } catch (e) { const m = String((e as Error).message ?? e); setNote(/reject|denied/i.test(m) ? "Cancelled in your wallet." : m.split("\n")[0]); }
    setBusy(false);
  };
  const post = async () => {
    const t = text.trim(); if (!t || !token) return;
    setBusy(true); setNote(null);
    try {
      const r = await fetch(`${ENGINE_URL}/chat/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, text: t, avatar }) });
      const j = await r.json();
      if (r.status === 401) { setToken(null); try { localStorage.removeItem(tokenKey(me!)); } catch { /* */ } }
      if (!r.ok) throw new Error(j.error ?? "Couldn't send that.");
      setText(""); await pull();
    } catch (e) { setNote((e as Error).message); }
    setBusy(false);
  };
  const remove = async (id: number) => {
    if (!token) return;
    const r = await fetch(`${ENGINE_URL}/chat/delete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, id }) });
    if (r.ok) setMsgs((m) => m.filter((x) => x.id !== id)); else setNote((await r.json()).error ?? "Couldn't remove it.");
  };

  const holder = (!!owned && owned.length > 0) || (bal ?? 0) > 0;
  const gate = useMemo(() => {
    if (!open) return "closed";
    if (!me) return "connect";
    if (owned === null && bal === null) return "checking";
    if (!holder && !isAdmin) return "no-nft";
    if (!token) return "sign-in";
    return "ok";
  }, [open, me, owned, bal, holder, isAdmin, token]);

  return (
    <div className="hc">
      <header className="hc-head">
        <div>
          <p className="eyebrow">Community</p>
          <h1>Holders&apos; chat</h1>
          <p className="coll-lede">A chat for everyone holding a Trencher. Connect your wallet and sign in once; it&apos;s free and sends no transaction.</p>
        </div>
        {!CHAT_OPEN && <span className="hc-soon mono">{isAdmin ? "Moderator preview · closed to the public" : "Opens after the $TRENCHERS launch"}</span>}
      </header>

      <section className={`hc-box${gate === "closed" ? " is-closed" : ""}`} aria-label="Chat">
        <div className="hc-list" ref={list} aria-live="polite">
          {gate === "ok" ? (
            msgs.length ? msgs.map((m) => {
              const mod = admins.includes(m.addr.toLowerCase()), mine = !!me && m.addr.toLowerCase() === me.toLowerCase();
              return (
                <div key={m.id} className={`hc-msg${mine ? " mine" : ""}`}>
                  <span className="hc-av">{m.avatar ? <ArtCanvas id={m.avatar} size={40} /> : <span className="hc-av-empty" />}</span>
                  <div className="hc-body">
                    <div className="hc-meta mono">
                      <b>{m.avatar ? `Trencher #${m.avatar}` : "Team"}</b>
                      <span>{short(m.addr)}</span>
                      {mod && <span className="hc-mod">mod</span>}
                      <span className="hc-time">{when(m.t)}</span>
                      {isAdmin && <button type="button" className="hc-del" onClick={() => remove(m.id)}>Remove</button>}
                    </div>
                    <p>{m.text}</p>
                  </div>
                </div>
              );
            }) : <p className="hc-empty mono">No messages yet. Say gm.</p>
          ) : (
            <div className="hc-gate">
              {gate === "closed" && <><b>Opens after the $TRENCHERS launch</b><p>Holders will be able to chat here. Come back after launch.</p></>}
              {gate === "connect" && <><b>Connect your wallet</b><p>The chat is for Trenchers holders. Connect the wallet that holds yours.</p><TextButton onClick={w.openModal}>Connect wallet</TextButton></>}
              {gate === "checking" && <p className="mono">Checking your wallet for Trenchers…</p>}
              {gate === "no-nft" && <><b>You need a Trencher to chat</b><p>This wallet holds no Trenchers. Mint one, or buy one on OpenSea, and you&apos;re in.</p><div className="hc-row"><TextButton href={ROUTES.mint}>Mint a Trencher</TextButton>{OPENSEA_URL && <TextButton href={OPENSEA_URL} external>OpenSea</TextButton>}</div></>}
              {gate === "sign-in" && <><b>Sign in to chat</b><p>One signature in your wallet proves you hold {owned?.length ? `Trencher${owned!.length > 1 ? "s" : ""} ${owned!.slice(0, 3).map((i) => `#${i}`).join(", ")}${owned!.length > 3 ? "…" : ""}` : "this wallet"}. No transaction, no gas.</p><TextButton onClick={signIn} disabled={busy}>{busy ? "Waiting for your wallet…" : "Sign in"}</TextButton>{busy && <p className="mono">Check your wallet: a free sign-in request should be open there. Nothing is sent and it costs nothing.</p>}</>}
            </div>
          )}
        </div>

        {gate === "ok" && (
          <form className="hc-form" onSubmit={(e) => { e.preventDefault(); post(); }}>
            {!!owned && owned.length > 1 && (
              <select className="hc-as mono" value={avatar ?? ""} onChange={(e) => setAvatar(Number(e.target.value))} aria-label="Post as">
                {owned!.map((i) => <option key={i} value={i}>#{i}</option>)}
              </select>
            )}
            <textarea value={text} maxLength={500} rows={1} placeholder={avatar ? `Message as Trencher #${avatar}` : holder ? "Message" : "Message as the team"}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); post(); } }} />
            <button type="submit" className="hc-send" disabled={busy || !text.trim() || (holder && !avatar && !isAdmin)}>Send</button>
          </form>
        )}
        {note && <p className="hc-note">{note}</p>}
      </section>
      {serverOpen === false && CHAT_OPEN && <p className="muted-note">The chat server isn&apos;t open yet: set CHAT_OPEN=1 on the engine.</p>}
    </div>
  );
}
