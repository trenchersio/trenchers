"use client";
// Make it think: send inference to a Trencher, and let its holder call it as its own AI model (trencher-<id>).
import { useEffect, useState } from "react";
import { parseEther, type Address } from "viem";
import { useWallet } from "@/lib/wallet";
import { deskApi, signText, usd, type Rate } from "@/lib/inference";
import { ROUTER_ABI } from "@/lib/inference-contracts";

type TView = { id: number; wallet: string; holder: string | null; model: string; balanceMicroUsd: string; spentMicroUsd: string; receivedMicroUsd: string };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const clean = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

export function TrencherMind({ rate, mock }: { rate: Rate | null; mock: boolean }) {
  const w = useWallet();
  const [idText, setIdText] = useState("");
  const [mine, setMine] = useState<number[] | null>(null);
  const [t, setT] = useState<TView | null>(null);
  const [tErr, setTErr] = useState<string | null>(null);
  const [how, setHow] = useState<"credit" | "eth">("credit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const id = Number(idText);
  const valid = Number.isInteger(id) && id >= 1 && id <= 2000;
  const isHolder = !!t && !!w.address && t.holder?.toLowerCase() === w.address.toLowerCase();
  const router = (rate?.router ?? null) as Address | null;
  const endpoint = rate?.endpoint ?? "https://inference.trenchers.io/v1";

  // Your own Trenchers, one tap away.
  useEffect(() => {
    setMine(null);
    if (!w.address || w.kind !== "wallet") return;
    import("@/lib/chain").then(({ ownedTrenchers }) => ownedTrenchers(w.address as Address)).then((ids) => { setMine(ids); if (ids.length && !idText) setIdText(String(ids[0])); }).catch(() => setMine([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.address, w.kind]);

  const load = () => {
    if (!valid) { setT(null); setTErr(null); return; }
    deskApi<TView>(`/trencher/${id}`).then((v) => { setT(v); setTErr(null); }).catch((e: Error) => { setT(null); setTErr(e.message); });
  };
  useEffect(() => { setSecret(null); setMsg(null); const x = setTimeout(load, 250); return () => clearTimeout(x); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [idText]);

  const prove = async (extra: Record<string, unknown>) => {
    if (!w.address) { w.openModal(); throw new Error("Connect a wallet first."); }
    if (w.kind === "demo") throw new Error("The demo wallet can't sign. Connect a browser wallet.");
    const { message } = await deskApi<{ message: string }>("/nonce", { method: "POST", body: { address: w.address } });
    setBusy("wallet");
    const signature = await signText(w.address, message);
    setBusy("server");
    return { address: w.address, signature, ...extra };
  };
  const run = async (fn: () => Promise<string>) => {
    setMsg(null); setBusy("server");
    try { setMsg({ ok: true, text: await fn() }); load(); }
    catch (e) { const m = (e as Error).message; setMsg({ ok: false, text: /denied|rejected/i.test(m) ? "Cancelled in your wallet, so nothing happened." : m }); }
    finally { setBusy(null); }
  };

  const send = () => run(async () => {
    if (!t) throw new Error("Pick an awake Trencher first.");
    if (how === "credit") {
      await deskApi("/gift", { method: "POST", body: await prove({ trencher: t.id, amountUsd: clean(amount) }) });
      return `Sent $${Number(amount).toFixed(2)} of inference to Trencher #${t.id}.`;
    }
    if (!w.address) { w.openModal(); throw new Error("Connect a wallet first."); }
    if (!router && !mock) throw new Error("The ETH route isn't live yet. Use your credit instead.");
    if (mock) return `Sent ${amount} ETH of inference to Trencher #${t.id} (sample data).`;
    const { sendCall } = await import("@/lib/chain");
    setBusy("wallet");
    // The router buys $TRENCHERS, the desk burns it, and the credit lands on the Trencher's wallet, not yours.
    await sendCall(w.address as Address, { address: router!, abi: ROUTER_ABI, functionName: "buyCredit", args: [0n, t.wallet as Address], value: parseEther(clean(amount)) });
    return `Paid. Trencher #${t.id}'s credit appears within a minute.`;
  });

  const makeKey = () => run(async () => {
    if (!t) throw new Error("Pick your Trencher first.");
    const out = await deskApi<{ secret: string }>("/keys", { method: "POST", body: await prove({ trencher: t.id }) });
    setSecret(out.secret);
    return `Key made for Trencher #${t.id}. Copy it now: it is shown once.`;
  });

  const label = busy === "wallet" ? "Check your wallet…" : busy === "server" ? "Working…" : null;

  return (
    <div className="itm">
      <div className="itm-pick">
        <div className="itm-who">
          <span className="itm-art">{valid ? <img src={`nft/${id}.webp`} alt="" width={96} height={96} onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} /> : <i>?</i>}</span>
          <div>
            <label className="itm-id mono">Trencher #<input value={idText} onChange={(e) => setIdText(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="1234" inputMode="numeric" aria-label="Trencher number" /></label>
            {mine && mine.length > 0 && (
              <div className="itm-mine">{mine.slice(0, 8).map((n) => <button key={n} type="button" className={n === id ? "on" : ""} onClick={() => setIdText(String(n))}>#{n}</button>)}<span className="mono">yours</span></div>
            )}
            {t ? (
              <dl className="itm-stats mono">
                <div><dt>its inference</dt><dd>{usd(t.balanceMicroUsd)}</dd></div>
                <div><dt>received</dt><dd>{usd(t.receivedMicroUsd)}</dd></div>
                <div><dt>model name</dt><dd>{t.model}</dd></div>
              </dl>
            ) : <p className="inf-muted">{valid ? (tErr ?? "Looking it up…") : "Pick a Trencher by its number."}</p>}
          </div>
        </div>

        <div className="itm-send">
          <div className="ibuy-tabs" role="tablist" aria-label="Send with">
            {([["credit", "My credit"], ["eth", "ETH"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={how === k} className={how === k ? "on" : ""} onClick={() => { setHow(k); setAmount(""); setMsg(null); }}>{l}</button>
            ))}
          </div>
          <label className="ibuy-field">
            <span className="ibuy-label">Send</span>
            <span className="ibuy-row">
              <input value={amount} onChange={(e) => setAmount(clean(e.target.value))} placeholder="0" inputMode="decimal" aria-label={how === "credit" ? "Dollars of credit" : "ETH"} />
              <span className={`ibuy-unit${how === "eth" ? " eth" : ""}`}>{how === "credit" ? "USD" : "ETH"}</span>
            </span>
          </label>
          <button type="button" className="ibtn ibtn-wide" disabled={!!busy || !t || !(Number(amount) > 0)} onClick={send}>
            {label ?? (t ? `Send to Trencher #${t.id}` : "Pick a Trencher")}
          </button>
          <p className="inf-fine">{how === "credit" ? "Moves part of your dollar balance to the Trencher. Anyone can send to any awake Trencher." : "Buys $TRENCHERS, burns it, and credits the Trencher directly, in one transaction."} It stays with the Trencher when it is sold.</p>
        </div>
      </div>

      <div className="itm-talk">
        <div className="ipanel-head"><span className="ipanel-dot" /><span>Talk to it as itself</span></div>
        <div className="itm-talk-body">
          <p>Each Trencher can be called as its own AI model, <code>{t?.model ?? "trencher-<id>"}</code>. It knows its number, its wallet and the rule you trained it with, and answers in the first person, paid from its own inference.</p>
          {isHolder || mock ? (
            <button type="button" className="ibtn" disabled={!!busy || !t} onClick={makeKey}>{label ?? `Make a key for Trencher #${t?.id ?? ""}`}</button>
          ) : (
            <p className="inf-muted">{t ? `Only the wallet holding Trencher #${t.id}${t.holder ? ` (${short(t.holder)})` : ""} can make its keys.` : "Pick your Trencher to make its key."}</p>
          )}
          {secret && <p className="itm-secret mono">{secret}</p>}
          <pre className="itm-code mono">{`curl ${endpoint}/chat/completions \\
  -H "Authorization: Bearer ${secret ? secret.slice(0, 18) + "…" : "<its key>"}" \\
  -d '{"model": "${t?.model ?? "trencher-1234"}",
       "messages": [{"role": "user", "content": "gm, what are you trading?"}]}'`}</pre>
          <p className="inf-fine">Keys for a Trencher belong to its holder. When it changes hands, old keys stop and the new holder makes their own; the balance stays with the Trencher.</p>
        </div>
      </div>
      {msg && <p className={msg.ok ? "itm-ok" : "inf-warn"}>{msg.text}</p>}
    </div>
  );
}
