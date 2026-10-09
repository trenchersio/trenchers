import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPublicClient, defineChain, getAddress, isAddress, parseAbi, verifyMessage, type Address, type PublicClient } from "viem";
import { ENV } from "./env";
import { transport, urls } from "./rpc";

/**
 * Holders' chat: anyone holding a Trencher can post; moderators (the Deployer by default) can remove messages.
 * Sign-in is one wallet signature (no transaction, no gas), which gives a token for 24 hours.
 *
 * Settings (Railway variables):
 *   CHAT_OPEN=1        lets holders post (until then only moderators can, to test)
 *   CHAT_ADMINS        moderator wallets, comma separated (default: the Deployer)
 *   CHAT_FILE          where messages are kept, e.g. /data/chat.json on a Railway volume (default ./chat.json)
 *   CHAT_SECRET        signs sign-in tokens (default: random per restart, which signs everyone out on a restart)
 */
type Msg = { id: number; addr: Address; avatar: number; text: string; t: number };
const NFT_ABI = parseAbi(["function ownerOf(uint256) view returns (address)"]);
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const OPEN = () => clean(process.env.CHAT_OPEN) === "1";
const ADMINS = new Set((clean(process.env.CHAT_ADMINS) || "0x447D8F97c39df3d6FCAB8a02A54986283e818210").split(/[\s,]+/).filter((a) => isAddress(a)).map((a) => a.toLowerCase()));
const FILE = clean(process.env.CHAT_FILE) || "./chat.json";
const SECRET = clean(process.env.CHAT_SECRET) || randomBytes(32).toString("hex");
const MAX = 500, KEEP = 1000, GAP_MS = 3000, TOKEN_MS = 24 * 3600_000;

export const loginText = (addr: string, time: string) => `Sign in to the Trenchers holders' chat\n\nWallet: ${addr}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;

export class Chat {
  private msgs: Msg[] = [];
  private next = 1;
  private last = new Map<string, number>();
  private owners = new Map<string, { owner: string; at: number }>();
  private pub: PublicClient;

  constructor() {
    const chain = defineChain({ id: ENV.CHAIN_ID, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [urls(ENV.RPC_URL)[0] ?? ENV.RPC_URL] } } });
    this.pub = createPublicClient({ chain, transport: transport(urls(ENV.RPC_URL)) }) as PublicClient;
    try {
      if (existsSync(FILE)) { const j = JSON.parse(readFileSync(FILE, "utf8")) as { next: number; msgs: Msg[] }; this.msgs = j.msgs ?? []; this.next = j.next ?? this.msgs.length + 1; }
    } catch { /* start empty */ }
  }

  private save() {
    try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify({ next: this.next, msgs: this.msgs })); } catch { /* keep in memory */ }
  }
  private sign(addr: string, exp: number) { return createHmac("sha256", SECRET).update(`${addr.toLowerCase()}.${exp}`).digest("hex").slice(0, 40); }
  private token(addr: string) { const exp = Date.now() + TOKEN_MS; return `${addr.toLowerCase()}.${exp}.${this.sign(addr, exp)}`; }
  private who(token: unknown): Address | null {
    if (typeof token !== "string") return null;
    const [addr, exp, sig] = token.split(".");
    if (!addr || !exp || !sig || !isAddress(addr) || Number(exp) < Date.now() || this.sign(addr, Number(exp)) !== sig) return null;
    return getAddress(addr);
  }
  private async holds(addr: Address, id: number) {
    if (!Number.isInteger(id) || id < 1 || id > 2000) return false;
    const k = `${id}`, c = this.owners.get(k);
    let owner = c && Date.now() - c.at < 120_000 ? c.owner : null;
    if (!owner) { owner = String(await this.pub.readContract({ address: ENV.NFT, abi: NFT_ABI, functionName: "ownerOf", args: [BigInt(id)] }).catch(() => "")).toLowerCase(); this.owners.set(k, { owner, at: Date.now() }); }
    return owner === addr.toLowerCase();
  }
  isAdmin(addr: string | null) { return !!addr && ADMINS.has(addr.toLowerCase()); }

  /** Handles /chat routes; returns false for any other path. */
  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith("/chat")) return false;
    res.setHeader("cache-control", "no-store");
    if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "content-type"); res.statusCode = 204; res.end(); return true; }
    const send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    if (req.method === "GET" && path === "/chat") {
      const after = Number(new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("after") ?? 0) || 0;
      send(200, { open: OPEN(), messages: this.msgs.filter((m) => m.id > after).slice(-200), latest: this.next - 1, ids: this.ids(), admins: [...ADMINS] });
      return true;
    }
    if (req.method !== "POST") { send(405, { error: "use POST" }); return true; }
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 8_000) { send(413, { error: "too long" }); return true; } }
    let b: Record<string, unknown>;
    try { b = JSON.parse(raw || "{}"); } catch { send(400, { error: "bad request" }); return true; }

    if (path === "/chat/login") {
      const addr = String(b.address ?? ""), time = String(b.time ?? ""), sig = String(b.signature ?? "");
      if (!isAddress(addr) || !/^0x[0-9a-fA-F]+$/.test(sig)) { send(400, { error: "bad sign-in" }); return true; }
      const age = Date.now() - Date.parse(time);
      if (!(age > -120_000 && age < 600_000)) { send(400, { error: "That sign-in is too old. Try again." }); return true; }
      const ok = await verifyMessage({ address: getAddress(addr), message: loginText(getAddress(addr), time), signature: sig as `0x${string}` }).catch(() => false);
      if (!ok) { send(401, { error: "The signature doesn't match this wallet." }); return true; }
      send(200, { token: this.token(addr), admin: this.isAdmin(addr) });
      return true;
    }
    const me = this.who(b.token);
    if (!me) { send(401, { error: "Sign in again." }); return true; }

    if (path === "/chat/send") {
      const admin = this.isAdmin(me);
      if (!OPEN() && !admin) { send(403, { error: "The chat opens after the $TRENCHERS launch." }); return true; }
      const text = String(b.text ?? "").replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "").trim().slice(0, MAX);
      if (!text) { send(400, { error: "Write a message first." }); return true; }
      const avatar = Number(b.avatar);
      if (!admin && !(await this.holds(me, avatar))) { send(403, { error: "You need to hold a Trencher to chat." }); return true; }
      const lastAt = this.last.get(me) ?? 0;
      if (!admin && Date.now() - lastAt < GAP_MS) { send(429, { error: "Slow down a little." }); return true; }
      this.last.set(me, Date.now());
      const m: Msg = { id: this.next++, addr: me, avatar: Number.isInteger(avatar) ? avatar : 0, text, t: Date.now() };
      this.msgs.push(m); if (this.msgs.length > KEEP) this.msgs.splice(0, this.msgs.length - KEEP);
      this.save(); send(200, { message: m });
      return true;
    }
    if (path === "/chat/delete") {
      if (!this.isAdmin(me)) { send(403, { error: "Only moderators can remove messages." }); return true; }
      const id = Number(b.id), before = this.msgs.length;
      this.msgs = this.msgs.filter((m) => m.id !== id);
      if (this.msgs.length !== before) this.save();
      send(200, { removed: before - this.msgs.length });
      return true;
    }
    send(404, { error: "not found" });
    return true;
  }

  /** Ids of removed messages are simply missing; clients reconcile with this list of ids still present. */
  ids() { return this.msgs.map((m) => m.id); }
}
