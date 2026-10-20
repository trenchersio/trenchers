import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAddress, isAddress, verifyMessage, type Address } from "viem";

/**
 * Private Telegram alerts: a holder gets a direct message from the bot whenever one of their own agents trades.
 *
 * Linking: on trenchers.io the holder signs one free message with their wallet; the engine checks the signature
 * and hands back a one-time t.me link. Pressing Start in the bot links that Telegram chat to the wallet.
 * Alerts follow the NFT: they go to whoever holds the Trencher right now, so a sold agent stops alerting.
 * /stop in the bot turns them off. Uses the channel bot (TELEGRAM_BOT_TOKEN); TELEGRAM_ALERTS=off switches it off.
 * No chain reads: ownership comes from the engine's own agent list.
 */
export const alertsText = (addr: string, time: string) => `Get Telegram alerts for my Trenchers agents\n\nWallet: ${addr}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;

type Sub = { chat: number; addr: string; t: number };
type Trade = { agent: number; token: string; symbol?: string; side: "buy" | "sell"; eth: string; pnlPct?: number; tx: string };
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const FILE = clean(process.env.ALERTS_FILE) || `${dirname(clean(process.env.CHAT_FILE) || "./chat.json")}/alerts.json`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (v: number) => (v >= 1 ? v.toFixed(3) : v >= 0.01 ? v.toFixed(4) : v.toPrecision(3)).replace(/\.?0+$/, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class Alerts {
  private subs: Sub[] = [];
  private codes = new Map<string, { addr: string; exp: number }>();
  private offset = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private waiting = 0;
  username: string | null = null;
  status = "starting";
  sent = 0;

  constructor(private cfg: { api?: string; token: string; site: string; explorer: string; imageBase: string },
    /** Awakened agents this wallet holds right now. */
    private owned: (addr: string) => number[],
    private log: (m: string) => void) {
    try { if (existsSync(FILE)) this.subs = (JSON.parse(readFileSync(FILE, "utf8")) as { subs: Sub[] }).subs ?? []; } catch { /* start empty */ }
  }
  private save() {
    try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(`${FILE}.tmp`, JSON.stringify({ subs: this.subs })); renameSync(`${FILE}.tmp`, FILE); } catch { /* keep in memory */ }
  }
  private call(method: string, body: unknown, ms = 15_000) {
    return fetch(`${this.cfg.api ?? "https://api.telegram.org"}/bot${this.cfg.token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
    }).then((r) => r.json() as Promise<{ ok: boolean; description?: string; error_code?: number; result?: unknown }>);
  }
  view() { return { status: this.status, bot: this.username ? `@${this.username}` : null, linkedChats: new Set(this.subs.map((s) => s.chat)).size, sent: this.sent }; }

  /** Finds the bot's name, then listens for /start and /stop (long polling, so no webhook is needed). */
  async start() {
    for (;;) {
      try {
        const me = await this.call("getMe", {});
        if (me.ok) { this.username = (me.result as { username: string }).username; break; }
        this.status = `bot token rejected: ${me.description}`;
      } catch (e) { this.status = `couldn't reach Telegram: ${(e as Error).message}`; }
      await new Promise((r) => setTimeout(r, 60_000));
    }
    this.status = "listening";
    for (;;) {
      try {
        const r = await this.call("getUpdates", { offset: this.offset, timeout: 50, allowed_updates: ["message"] }, 65_000);
        if (!r.ok) {
          // 409: another copy of the engine is polling (a deploy overlapping) or a webhook is set on the bot.
          this.status = r.error_code === 409 ? `waiting: ${r.description}` : `getUpdates failed: ${r.description}`;
          await new Promise((res) => setTimeout(res, r.error_code === 409 ? 20_000 : 10_000)); continue;
        }
        this.status = "listening";
        for (const u of r.result as { update_id: number; message?: { chat: { id: number; type: string }; text?: string } }[]) {
          this.offset = u.update_id + 1;
          if (u.message?.chat.type === "private" && u.message.text) await this.onMessage(u.message.chat.id, u.message.text.trim()).catch(() => {});
        }
      } catch { await new Promise((res) => setTimeout(res, 5_000)); }
    }
  }

  private say(chat: number, text: string) { return this.call("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }); }

  private async onMessage(chat: number, text: string) {
    const [cmd, arg] = text.split(/\s+/, 2);
    if (/^\/stop(@\w+)?$/i.test(cmd)) {
      const had = this.subs.some((s) => s.chat === chat);
      this.subs = this.subs.filter((s) => s.chat !== chat); this.save();
      await this.say(chat, had ? "Alerts are off. You won't get messages about your agents here anymore. Link again any time on trenchers.io." : "No alerts were on for this chat.");
      return;
    }
    if (/^\/start(@\w+)?$/i.test(cmd)) {
      const c = arg ? this.codes.get(arg) : undefined;
      if (!c || c.exp < Date.now()) {
        await this.say(chat, `To get a message whenever your agent trades, open <a href="${this.cfg.site}/agents">trenchers.io/agents</a>, connect your wallet and tap <b>Get Telegram alerts</b>.${arg ? "\n\nThat link has expired. Make a new one there." : ""}`);
        return;
      }
      this.codes.delete(arg!);
      if (!this.subs.some((s) => s.chat === chat && s.addr === c.addr)) this.subs.push({ chat, addr: c.addr, t: Date.now() });
      this.save();
      const ids = this.owned(c.addr);
      await this.say(chat, `✅ <b>Alerts are on</b> for wallet <code>${short(c.addr)}</code>.\n\nYou'll get a message here whenever ${ids.length === 1 ? `Trencher #${ids[0]}` : ids.length ? `one of your agents (#${ids.join(", #")})` : "one of your agents"} buys or sells. Alerts follow the NFT, so they stop if you sell it.\n\nSend /stop to turn them off.`);
      this.log(`alerts: a chat linked ${short(c.addr)}`);
      return;
    }
    await this.say(chat, "Send /stop to turn your agent alerts off. To link a wallet, use the Get Telegram alerts button on trenchers.io/agents.");
  }

  /** A trade by one of `owner`'s agents: tell every chat linked to that wallet. */
  onTrade(t: Trade, owner: string | undefined) {
    if (!owner || !this.username) return;
    const chats = [...new Set(this.subs.filter((s) => s.addr === owner.toLowerCase()).map((s) => s.chat))];
    if (!chats.length) return;
    const sym = esc(t.symbol || short(t.token));
    const pnl = t.side === "sell" && t.pnlPct !== undefined && Number.isFinite(t.pnlPct) ? ` (${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%)` : "";
    const caption = [
      t.side === "buy" ? `🛒 <b>Your Trencher #${t.agent} bought $${sym}</b>` : `${t.pnlPct !== undefined && t.pnlPct < 0 ? "🔻" : "✅"} <b>Your Trencher #${t.agent} sold $${sym}</b>`,
      t.side === "buy" ? `${fmt(Number(t.eth))} ETH in` : `${fmt(Number(t.eth))} ETH out${pnl}`,
      `<a href="${this.cfg.site}/agent/${t.agent}">Agent</a> · <a href="${this.cfg.explorer}/token/${t.token}">coin</a> · <a href="${this.cfg.explorer}/tx/${t.tx}">tx</a>`,
    ].join("\n");
    for (const chat of chats) {
      if (this.waiting > 300) return;
      this.waiting++;
      this.queue = this.queue.then(async () => {
        let r = await this.call("sendPhoto", { chat_id: chat, photo: `${this.cfg.imageBase}awake/${t.agent}.png`, caption, parse_mode: "HTML" }).catch(() => ({ ok: false } as { ok: boolean; error_code?: number }));
        if (!r.ok && r.error_code !== 403) r = await this.say(chat, caption).catch(() => ({ ok: false }));
        if (r.ok) this.sent++;
        // 403: the person blocked the bot; stop messaging that chat.
        else if (r.error_code === 403) { this.subs = this.subs.filter((s) => s.chat !== chat); this.save(); }
        await new Promise((res) => setTimeout(res, 1100));
      }).catch(() => {}).finally(() => { this.waiting--; });
    }
  }

  /** Monday's report: one message per linked chat about that wallet's agents (rank, return, trades, best trade). */
  weekly(lines: (addr: string) => string | null) {
    if (!this.username) return;
    const byChat = new Map<number, string[]>();
    for (const s of this.subs) { const l = lines(s.addr); if (l) byChat.set(s.chat, [...(byChat.get(s.chat) ?? []), l]); }
    for (const [chat, parts] of byChat) {
      this.queue = this.queue.then(async () => { await this.say(chat, parts.join("\n\n")).catch(() => {}); this.sent++; await new Promise((r) => setTimeout(r, 1100)); }).catch(() => {});
    }
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path !== "/alerts/link" && path !== "/alerts/status") return false;
    res.setHeader("cache-control", "no-store");
    const send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "content-type"); res.statusCode = 204; res.end(); return true; }
    if (path === "/alerts/status") {
      const a = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("address") ?? "";
      send(200, { ready: !!this.username, bot: this.username, linked: isAddress(a) && this.subs.some((s) => s.addr === a.toLowerCase()) });
      return true;
    }
    if (req.method !== "POST") { send(405, { error: "use POST" }); return true; }
    if (!this.username) { send(503, { error: "Telegram alerts aren't available right now. Try again in a minute." }); return true; }
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 4_000) { send(413, { error: "too long" }); return true; } }
    let b: { address?: string; time?: string; signature?: string };
    try { b = JSON.parse(raw || "{}"); } catch { send(400, { error: "bad request" }); return true; }
    if (!b.address || !isAddress(b.address) || !b.time || !b.signature) { send(400, { error: "bad request" }); return true; }
    const age = Date.now() - Date.parse(b.time);
    if (!(age > -120_000 && age < 600_000)) { send(400, { error: "That signature is too old. Try again." }); return true; }
    const addr = getAddress(b.address);
    const ok = await verifyMessage({ address: addr, message: alertsText(addr, b.time), signature: b.signature as `0x${string}` }).catch(() => false);
    if (!ok) { send(401, { error: "The signature doesn't match this wallet." }); return true; }
    const ids = this.owned(addr.toLowerCase() as Address);
    if (!ids.length) { send(403, { error: "This wallet doesn't hold an awakened Trencher yet. Awaken one first, then turn alerts on." }); return true; }
    for (const [k, v] of this.codes) if (v.exp < Date.now()) this.codes.delete(k);
    if (this.codes.size > 5_000) this.codes.clear();
    const code = randomBytes(12).toString("base64url");
    this.codes.set(code, { addr: addr.toLowerCase(), exp: Date.now() + 15 * 60_000 });
    send(200, { url: `https://t.me/${this.username}?start=${code}`, agents: ids });
    return true;
  }
}
