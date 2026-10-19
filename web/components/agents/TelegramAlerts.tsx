"use client";
import { useEffect, useState } from "react";
import { createWalletClient, custom, getAddress, type Address } from "viem";
import { walletProvider } from "@/lib/chain";
import { ENGINE_URL, chain } from "@/lib/constants";

/** Same text the engine checks (engine/src/alerts.ts). */
const alertsText = (addr: string, time: string) => `Get Telegram alerts for my Trenchers agents\n\nWallet: ${addr}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;

/**
 * "Get Telegram alerts": one free signature proves the wallet, then the Trenchers bot opens in Telegram;
 * pressing Start there links it. From then on the bot messages you whenever one of your agents buys or sells.
 */
export function TelegramAlerts({ me }: { me: Address }) {
  const [state, setState] = useState<{ ready: boolean; linked: boolean; bot: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${ENGINE_URL}/alerts/status?address=${me}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j) setState(j); }).catch(() => {});
    load();
    // After they press Start in Telegram, show "on" without a reload.
    const iv = setInterval(() => { if (link) load(); }, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [me, link]);

  if (!state?.ready) return null;

  const start = async () => {
    setBusy(true); setNote(null);
    try {
      const p = await walletProvider();
      const addr = getAddress(me), time = new Date().toISOString();
      const accts = ((await p.request({ method: "eth_requestAccounts" } as never)) as string[]).map((a) => a.toLowerCase());
      if (!accts.includes(addr.toLowerCase())) throw new Error("Your wallet is on a different account. Switch it back and try again.");
      const sign = createWalletClient({ chain, transport: custom(p) }).signMessage({ account: addr, message: alertsText(addr, time) });
      const timeout = new Promise<never>((_, no) => setTimeout(() => no(new Error("No signature came back. Open your wallet, approve the request there, or try again.")), 90_000));
      const signature = await Promise.race([sign, timeout]);
      const r = await fetch(`${ENGINE_URL}/alerts/link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addr, time, signature }) });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error ?? "Couldn't make the link. Try again.");
      setLink(j.url);
      window.open(j.url, "_blank", "noopener");
    } catch (e) { const m = String((e as Error).message ?? e); setNote(/reject|denied/i.test(m) ? "Cancelled in your wallet." : m.split("\n")[0]); }
    setBusy(false);
  };

  return (
    <section className={`tga${state.linked ? " tga-on" : ""}`} aria-label="Telegram alerts">
      <span className="tga-ico" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M21.4 4.1 2.9 11.2c-1.3.5-1.3 1.2-.2 1.6l4.7 1.5 1.8 5.6c.2.6.1.9.8.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.7c.3-1.3-.5-1.9-1.5-1.5ZM8.5 13.9l9.9-6.2c.5-.3.9-.1.5.2l-8.5 7.6-.3 3.5-1.6-5.1Z" /></svg>
      </span>
      <div className="tga-txt">
        <b>{state.linked ? "Telegram alerts are on" : "Get Telegram alerts"}</b>
        <span>{state.linked
          ? <>The {state.bot ? <a href={`https://t.me/${state.bot}`} target="_blank" rel="noreferrer">@{state.bot}</a> : "Trenchers"} bot messages you whenever one of your agents buys or sells. Send it /stop to turn them off.</>
          : link ? <>Press <b>Start</b> in Telegram to finish. <a href={link} target="_blank" rel="noreferrer">Open the bot again</a></>
          : "A private message from our bot whenever one of your agents buys or sells, with the coin, the ETH and the profit or loss. One free signature, no transaction."}</span>
        {note && <span className="tga-note mono">{note}</span>}
      </div>
      {!state.linked && <button type="button" className="gf-btn" onClick={start} disabled={busy}>{busy ? "Check your wallet…" : link ? "New link" : "Turn on"}</button>}
    </section>
  );
}
