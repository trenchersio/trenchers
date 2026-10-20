import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import webpush from "web-push";
import { getAddress, isAddress, verifyMessage, type Address } from "viem";

/**
 * Phone notifications (the Trenchers web app, installed to the home screen): a message whenever one of your own
 * agents trades, and the weekly report. Same sign-in as Telegram alerts: one free wallet signature.
 *
 * Needs a VAPID key pair that only you hold (Railway variables, made once with: npx web-push generate-vapid-keys):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and optionally VAPID_SUBJECT (default mailto:team@trenchers.io).
 * Without them this is switched off and the site hides the button. Subscriptions are kept next to the chat (push.json).
 */
export const pushText = (addr: string, time: string) => `Turn on Trenchers notifications on this device\n\nWallet: ${addr}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;

type Sub = { endpoint: string; keys: { p256dh: string; auth: string }; addr: string; t: number };
type Trade = { agent: number; symbol?: string; token: string; side: "buy" | "sell"; eth: string; pnlPct?: number; tx: string };
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const FILE = clean(process.env.PUSH_FILE) || `${dirname(clean(process.env.CHAT_FILE) || "./chat.json")}/push.json`;
const fmt = (v: number) => (v >= 1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(4) : v.toPrecision(3)).replace(/\.?0+$/, "");

export class Push {
  private subs: Sub[] = [];
  readonly ready: boolean;
  private pub = clean(process.env.VAPID_PUBLIC_KEY);
  sent = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  constructor(private site: string, private owned: (addr: string) => number[], private log: (m: string) => void) {
    const priv = clean(process.env.VAPID_PRIVATE_KEY);
    let ok = false;
    if (this.pub && priv) {
      try { webpush.setVapidDetails(clean(process.env.VAPID_SUBJECT) || "mailto:team@trenchers.io", this.pub, priv); ok = true; }
      catch (e) { this.log(`push: the VAPID keys were refused (${(e as Error).message}); notifications are off`); }
    }
    this.ready = ok;
    try { if (existsSync(FILE)) this.subs = (JSON.parse(readFileSync(FILE, "utf8")) as { subs: Sub[] }).subs ?? []; } catch { /* start empty */ }
  }
  private save() {
    try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(`${FILE}.tmp`, JSON.stringify({ subs: this.subs })); renameSync(`${FILE}.tmp`, FILE); } catch { /* keep in memory */ }
  }
  view() { return this.ready ? { status: "on", devices: this.subs.length, sent: this.sent } : "off (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)"; }

  /** Sends one notification to every device linked to `addr`. */
  notify(addr: string, msg: { title: string; body: string; url: string; tag?: string; agent?: number }) {
    if (!this.ready) return;
    const subs = this.subs.filter((s) => s.addr === addr.toLowerCase());
    for (const s of subs) {
      if (this.waiting > 500) return;
      this.waiting++;
      this.queue = this.queue.then(async () => {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(msg), { TTL: 3600 }); this.sent++; }
        catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          // 404 / 410: the device unsubscribed or the browser dropped it.
          if (code === 404 || code === 410) { this.subs = this.subs.filter((x) => x.endpoint !== s.endpoint); this.save(); }
        }
      }).catch(() => {}).finally(() => { this.waiting--; });
    }
  }

  onTrade(t: Trade, owner: string | undefined) {
    if (!owner || !this.ready) return;
    const sym = t.symbol ? `$${t.symbol}` : "a coin";
    const pnl = t.side === "sell" && t.pnlPct !== undefined && Number.isFinite(t.pnlPct) ? ` (${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%)` : "";
    this.notify(owner, {
      title: `Trencher #${t.agent} ${t.side === "buy" ? "bought" : "sold"} ${sym}`,
      body: t.side === "buy" ? `${fmt(Number(t.eth))} ETH in` : `${fmt(Number(t.eth))} ETH out${pnl}`,
      url: `${this.site}/agent/${t.agent}`, tag: `trade-${t.agent}`, agent: t.agent,
    });
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith("/push/")) return false;
    res.setHeader("cache-control", "no-store");
    const send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "content-type"); res.statusCode = 204; res.end(); return true; }
    if (path === "/push/key") { send(200, { ready: this.ready, key: this.ready ? this.pub : null }); return true; }
    let raw = "";
    if (req.method === "POST") for await (const chunk of req) { raw += chunk; if (raw.length > 6_000) { send(413, { error: "too long" }); return true; } }
    let b: { address?: string; time?: string; signature?: string; subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; endpoint?: string };
    try { b = JSON.parse(raw || "{}"); } catch { send(400, { error: "bad request" }); return true; }
    if (path === "/push/status" && req.method === "POST") { send(200, { on: !!b.endpoint && this.subs.some((s) => s.endpoint === b.endpoint) }); return true; }
    if (path === "/push/unsubscribe" && req.method === "POST") {
      this.subs = this.subs.filter((s) => s.endpoint !== b.endpoint); this.save(); send(200, { ok: true }); return true;
    }
    if (path !== "/push/subscribe" || req.method !== "POST") { send(404, { error: "not found" }); return true; }
    if (!this.ready) { send(503, { error: "Notifications aren't switched on yet." }); return true; }
    const sub = b.subscription;
    if (!b.address || !isAddress(b.address) || !b.time || !b.signature || !sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) { send(400, { error: "bad request" }); return true; }
    const age = Date.now() - Date.parse(b.time);
    if (!(age > -120_000 && age < 600_000)) { send(400, { error: "That signature is too old. Try again." }); return true; }
    const addr = getAddress(b.address);
    const ok = await verifyMessage({ address: addr, message: pushText(addr, b.time), signature: b.signature as `0x${string}` }).catch(() => false);
    if (!ok) { send(401, { error: "The signature doesn't match this wallet." }); return true; }
    const ids = this.owned(addr.toLowerCase() as Address);
    if (!ids.length) { send(403, { error: "This wallet doesn't hold an awakened Trencher yet. Awaken one first." }); return true; }
    this.subs = this.subs.filter((s) => s.endpoint !== sub.endpoint);
    this.subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, addr: addr.toLowerCase(), t: Date.now() });
    if (this.subs.length > 50_000) this.subs.shift();
    this.save();
    this.notify(addr, { title: "Notifications are on", body: `You'll get a message here whenever ${ids.length === 1 ? `Trencher #${ids[0]}` : "one of your agents"} trades.`, url: `${this.site}/agents`, tag: "welcome" });
    send(200, { ok: true, agents: ids });
    return true;
  }
}
