"use client";
import { useEffect, useState } from "react";
import { createWalletClient, custom, getAddress, type Address } from "viem";
import { walletProvider } from "@/lib/chain";
import { ENGINE_URL, chain } from "@/lib/constants";

/** Same text the engine checks (engine/src/push.ts). */
const pushText = (addr: string, time: string) => `Turn on Trenchers notifications on this device\n\nWallet: ${addr}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;
const b64 = (s: string) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };

/**
 * Phone notifications from the Trenchers app: a message on this device whenever one of your agents trades.
 * On iPhone this works once trenchers.io is added to the home screen (Share → Add to Home Screen).
 */
export function PushToggle({ me }: { me: Address }) {
  const [key, setKey] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [support, setSupport] = useState<"ok" | "ios-install" | "no">("no");

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent), standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    const can = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupport(can ? "ok" : ios && !standalone ? "ios-install" : "no");
    fetch(`${ENGINE_URL}/push/key`).then((r) => (r.ok ? r.json() : null)).then((j: { ready?: boolean; key?: string } | null) => { if (j?.ready && j.key) setKey(j.key); }).catch(() => {});
    if (can) navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => {
      if (!sub) return;
      fetch(`${ENGINE_URL}/push/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).then((r) => r.json()).then((j: { on?: boolean }) => setOn(!!j.on)).catch(() => {});
    }).catch(() => {});
  }, []);

  if (!key || support === "no") return null;

  const turnOn = async () => {
    setBusy(true); setNote(null);
    try {
      if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked for trenchers.io in this browser's settings.");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }));
      const p = await walletProvider();
      const addr = getAddress(me), time = new Date().toISOString();
      const signature = await createWalletClient({ chain, transport: custom(p) }).signMessage({ account: addr, message: pushText(addr, time) });
      const r = await fetch(`${ENGINE_URL}/push/subscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: addr, time, signature, subscription: sub.toJSON() }) });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? "Couldn't turn them on. Try again.");
      setOn(true);
    } catch (e) { const m = String((e as Error).message ?? e); setNote(/reject|denied/i.test(m) ? "Cancelled in your wallet." : m.split("\n")[0]); }
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
      if (sub) { await fetch(`${ENGINE_URL}/push/unsubscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      setOn(false);
    } catch { /* try again */ }
    setBusy(false);
  };

  return (
    <section className={`tga tga-push${on ? " tga-on" : ""}`} aria-label="Phone notifications">
      <span className="tga-ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3a1.5 1.5 0 0 0-3 0v1.16A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" /></svg></span>
      <div className="tga-txt">
        <b>{on ? "Notifications are on" : "Notifications on this device"}</b>
        <span>{support === "ios-install"
          ? <>On iPhone: tap <b>Share</b>, then <b>Add to Home Screen</b>, open Trenchers from there and turn them on.</>
          : on ? "This device gets a notification whenever one of your agents trades, and your weekly report."
          : "Get a notification on this phone or computer whenever one of your agents trades. One free signature."}</span>
        {note && <span className="tga-note mono">{note}</span>}
      </div>
      {support === "ok" && <button type="button" className="gf-btn" onClick={on ? turnOff : turnOn} disabled={busy}>{busy ? "…" : on ? "Turn off" : "Turn on"}</button>}
    </section>
  );
}
