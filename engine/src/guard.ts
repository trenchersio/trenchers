import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAddress, isAddress, verifyMessage } from "viem";
import { scan, BRANDS, type Ctx, type Level } from "./guard-scan";

/**
 * Trenchers Guard (Protocol 06, Trenchers Cybersecurity): agents that watch people's wallets and warn them.
 *
 * 1. Before you sign: /guard/scan reads a wallet request and says what it would let happen (the browser extension
 *    runs the same code locally; this endpoint is for apps and wallets that want it as an API).
 * 2. After the fact, on-chain: every couple of minutes the watcher reads new approvals and outgoing transfers for
 *    the wallets people asked us to watch, and alerts them (phone, Telegram, the feed on trenchers.io/protect) when
 *    one looks wrong: an unlimited approval to a contract we don't know, a collection-wide NFT approval, several
 *    tokens leaving in one go (how a drain looks), or the wallet being delegated to a contract (EIP-7702).
 * 3. Access we can see: our own services. A Trenchers Inference key used from a network it has never been used from
 *    is flagged to its owner.
 *
 * What it can't do (and the site says so): see a seed phrase being copied, or stop a transaction someone else signs
 * with a stolen key. Self-custody wallets have no logins or IP addresses for us to watch.
 *
 * RPC use is small on purpose: nothing at all while no one is watching, then 1 log query every GUARD_EVERY_MS
 * (default 2 min) for up to 100 wallets per query, and one getCode per wallet every GUARD_CODE_EVERY_MS (default 6 h).
 */
export const guardText = (addr: string, time: string) => `Sign in to Trenchers Guard\n\nWallet: ${addr}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const num = (v: string | undefined, d: number) => { const n = Number(clean(v)); return Number.isFinite(n) && n > 0 ? n : d; };
const lc = (s: string) => s.toLowerCase();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const FILE = clean(process.env.GUARD_FILE) || `${dirname(clean(process.env.CHAT_FILE) || "./chat.json")}/guard.json`;

/** keccak256 of the event signatures (precomputed so this file needs no hashing at start). */
export const TOPIC = {
  Approval: "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
  ApprovalForAll: "0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31",
  Transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
};
const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";
const HUGE = 2n ** 128n;
const RANK: Record<Level, number> = { ok: 0, info: 1, warn: 2, danger: 3 };

export type GuardAlert = { id: string; t: number; wallet: string; level: Level; kind: string; title: string; body: string; tx?: string; token?: string; spender?: string; fix?: "approve" | "approveAll" };
type Account = { addr: string; watch: { addr: string; label?: string; since: number }[]; t: number };
type Log = { address: string; topics: string[]; data: string; transactionHash: string; blockNumber: string };
type Pub = { getBlockNumber(): Promise<bigint>; getCode(a: { address: `0x${string}` }): Promise<string | undefined>; request(a: { method: string; params: unknown[] }): Promise<unknown> };

export type GuardDeps = {
  pub: Pub | null;
  site: string;
  explorer: string;
  log: (m: string) => void;
  /** Awakened Trenchers this wallet holds (holders may watch more wallets). */
  owned: (addr: string) => number[];
  /** Contracts that are fine to approve (our adapter, factory, NFT, token), lowercase. */
  trusted: Record<string, string>;
  notify?: (addr: string, msg: { title: string; body: string; url: string; tag?: string }) => void;
  telegram?: (addr: string, html: string) => void;
  telegramLink?: (addr: string) => string | null;
  secret: string;
  now?: () => number;
};

export class Guard {
  private accounts = new Map<string, Account>();
  private feed = new Map<string, GuardAlert[]>();
  private from = 0n;
  private lastCode = 0;
  private codeSeen = new Map<string, string>();
  private keyNets = new Map<string, { nets: string[]; t: number }>();
  private flagged = new Set<string>();
  private phishing = new Set<string>();
  private phishingAt = 0;
  private hits = new Map<string, number[]>();
  private busy = false;
  private seq = 0;
  status = "idle: no wallets watched yet";
  lastScan = 0;
  sent = 0;
  scans = 0;
  readonly free = num(process.env.GUARD_FREE_WALLETS, 3);
  readonly holderMax = num(process.env.GUARD_HOLDER_WALLETS, 20);
  private readonly every = num(process.env.GUARD_EVERY_MS, 120_000);
  private readonly codeEvery = num(process.env.GUARD_CODE_EVERY_MS, 6 * 3_600_000);
  private readonly maxSpan = BigInt(num(process.env.GUARD_MAX_BLOCKS, 30_000));

  constructor(private d: GuardDeps) {
    for (const a of clean(process.env.GUARD_FLAGGED).split(/[\s,]+/)) if (/^0x[0-9a-fA-F]{40}$/.test(a)) this.flagged.add(lc(a));
    try {
      if (existsSync(FILE)) {
        const j = JSON.parse(readFileSync(FILE, "utf8")) as { accounts?: Account[]; feed?: [string, GuardAlert[]][]; from?: string; flagged?: string[]; keyNets?: [string, { nets: string[]; t: number }][] };
        for (const a of j.accounts ?? []) this.accounts.set(a.addr, a);
        for (const [k, v] of j.feed ?? []) this.feed.set(k, v);
        for (const f of j.flagged ?? []) this.flagged.add(f);
        for (const [k, v] of j.keyNets ?? []) this.keyNets.set(k, v);
        if (j.from) this.from = BigInt(j.from);
      }
    } catch { /* start empty */ }
  }
  private now() { return this.d.now?.() ?? Date.now(); }
  private save() {
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(`${FILE}.tmp`, JSON.stringify({ accounts: [...this.accounts.values()], feed: [...this.feed], from: this.from.toString(), flagged: [...this.flagged], keyNets: [...this.keyNets] }));
      renameSync(`${FILE}.tmp`, FILE);
    } catch { /* keep in memory */ }
  }

  /** Every wallet someone asked us to watch, lowercase. */
  watched(): string[] { const s = new Set<string>(); for (const a of this.accounts.values()) for (const w of a.watch) s.add(w.addr); return [...s]; }
  /** Accounts that watch `wallet` (they get its alerts). */
  private watchersOf(wallet: string) { return [...this.accounts.values()].filter((a) => a.watch.some((w) => w.addr === wallet)); }
  limitFor(addr: string) { return this.d.owned(addr).length ? this.holderMax : this.free; }
  ctx(): Ctx {
    const names: Record<string, string> = { [PERMIT2]: "Permit2" };
    for (const [k, v] of Object.entries(this.d.trusted)) names[lc(k)] = v;
    return { trusted: new Set([...Object.keys(this.d.trusted).map(lc), PERMIT2]), flagged: this.flagged, phishing: this.phishing, brands: BRANDS, names };
  }

  // ------------------------------------------------------------------ sessions (one signature, then a token)
  token(addr: string, days = 30) {
    const body = `${lc(addr)}.${this.now() + days * 86_400_000}`;
    return `${Buffer.from(body).toString("base64url")}.${createHmac("sha256", this.d.secret).update(body).digest("base64url")}`;
  }
  who(token: string | undefined): string | null {
    if (!token) return null;
    const [b, sig] = token.split(".");
    if (!b || !sig) return null;
    const body = Buffer.from(b, "base64url").toString();
    const want = createHmac("sha256", this.d.secret).update(body).digest();
    let got: Buffer; try { got = Buffer.from(sig, "base64url"); } catch { return null; }
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    const [addr, exp] = body.split(".");
    return Number(exp) > this.now() && /^0x[0-9a-f]{40}$/.test(addr) ? addr : null;
  }

  // ------------------------------------------------------------------ watch list
  watch(owner: string, wallet: string, label?: string): { ok: true } | { ok: false; error: string } {
    owner = lc(owner); wallet = lc(wallet);
    if (!/^0x[0-9a-f]{40}$/.test(wallet)) return { ok: false, error: "That isn't a wallet address." };
    const a = this.accounts.get(owner) ?? { addr: owner, watch: [], t: this.now() };
    if (a.watch.some((w) => w.addr === wallet)) return { ok: true };
    const limit = this.limitFor(owner);
    if (a.watch.length >= limit) return { ok: false, error: limit === this.free ? `Free accounts can watch ${this.free} wallets. Holding a Trencher raises that to ${this.holderMax}.` : `You can watch up to ${limit} wallets.` };
    if (this.accounts.size >= 20_000 && !this.accounts.has(owner)) return { ok: false, error: "Guard is full right now. Try again later." };
    a.watch.push({ addr: wallet, label: label ? String(label).slice(0, 40) : undefined, since: this.now() });
    this.accounts.set(owner, a); this.save();
    this.status = "watching";
    return { ok: true };
  }
  unwatch(owner: string, wallet: string) {
    const a = this.accounts.get(lc(owner)); if (!a) return;
    a.watch = a.watch.filter((w) => w.addr !== lc(wallet));
    if (!a.watch.length) this.accounts.delete(a.addr);
    this.save();
  }
  state(owner: string) {
    owner = lc(owner);
    const a = this.accounts.get(owner);
    const wallets = a?.watch ?? [];
    const alerts = wallets.flatMap((w) => this.feed.get(w.addr) ?? []).concat(this.feed.get(`acct:${owner}`) ?? []).sort((x, y) => y.t - x.t).slice(0, 100);
    return { address: owner, wallets, limit: this.limitFor(owner), alerts, lastScan: this.lastScan };
  }

  // ------------------------------------------------------------------ alerts
  /** Records an alert for `wallet` (and tells everyone watching it, when it matters). Same alert twice is ignored. */
  raise(wallet: string, a: Omit<GuardAlert, "id" | "t" | "wallet">, key?: string) {
    wallet = lc(wallet);
    const list = this.feed.get(wallet) ?? [];
    const id = key ?? `${a.kind}:${a.tx ?? ""}:${a.token ?? ""}:${a.spender ?? ""}`;
    if (list.some((x) => x.id === id)) return null;
    const alert: GuardAlert = { id, t: this.now(), wallet, ...a };
    list.unshift(alert); if (list.length > 100) list.length = 100;
    this.feed.set(wallet, list);
    if (RANK[a.level] >= RANK.warn) {
      const owners = wallet.startsWith("acct:") ? [wallet.slice(5)] : this.watchersOf(wallet).map((x) => x.addr);
      const label = wallet.startsWith("acct:") ? "" : ` · ${short(wallet)}`;
      for (const o of owners) {
        this.d.notify?.(o, { title: `${a.level === "danger" ? "⚠️ " : ""}Trenchers Guard${label}`, body: `${a.title}. ${a.body}`.slice(0, 240), url: `${this.d.site}/protect`, tag: `guard-${id}`.slice(0, 60) });
        const tx = a.tx ? ` · <a href="${this.d.explorer}/tx/${a.tx}">tx</a>` : "";
        this.d.telegram?.(o, `${a.level === "danger" ? "🚨" : "⚠️"} <b>Trenchers Guard${label.replace(/</g, "")}</b>\n${esc(a.title)}\n${esc(a.body)}\n\n<a href="${this.d.site}/protect">Review it</a>${tx}`);
        this.sent++;
      }
    }
    this.save();
    return alert;
  }

  /** Reads a batch of logs for watched wallets and turns them into alerts. Exposed for tests. */
  digest(logs: Log[]) {
    const watched = new Set(this.watched());
    const ctx = this.ctx();
    const outByTx = new Map<string, { wallet: string; tokens: Set<string>; to: Set<string> }>();
    for (const l of logs) {
      const t0 = l.topics[0], owner = l.topics[1] ? lc(`0x${l.topics[1].slice(26)}`) : "";
      if (!watched.has(owner)) continue;
      const token = lc(l.address);
      if (t0 === TOPIC.Approval) {
        const spender = lc(`0x${(l.topics[2] ?? "").slice(26)}`);
        if (l.topics.length === 4) { // ERC-721: one NFT
          if (/^0x0{40}$/.test(spender) || ctx.trusted!.has(spender)) continue;
          this.raise(owner, { level: this.flagged.has(spender) ? "danger" : "info", kind: "nft-approve", title: `An NFT in ${short(token)} was approved for ${short(spender)}`, body: "That address can now move this one NFT.", tx: l.transactionHash, token, spender });
          continue;
        }
        const v = l.data && l.data !== "0x" ? BigInt(l.data.slice(0, 66)) : 0n;
        if (v === 0n) continue;
        const known = ctx.trusted!.has(spender), bad = this.flagged.has(spender), unlimited = v >= HUGE;
        if (known && !bad) continue;
        const level: Level = bad || unlimited ? "danger" : "warn";
        this.raise(owner, { level, kind: "approve", fix: "approve", tx: l.transactionHash, token, spender,
          title: bad ? `Your tokens were approved to a known drainer` : unlimited ? `Unlimited approval to an unknown contract` : `Token approval to an unknown contract`,
          body: `${short(spender)} can now spend ${unlimited ? "all of" : "some of"} the ${short(token)} in ${short(owner)}. If you didn't mean to, revoke it.` });
      } else if (t0 === TOPIC.ApprovalForAll) {
        const op = lc(`0x${(l.topics[2] ?? "").slice(26)}`), on = l.data && BigInt(l.data.slice(0, 66) || "0x0") !== 0n;
        if (!on || (ctx.trusted!.has(op) && !this.flagged.has(op))) continue;
        this.raise(owner, { level: "danger", kind: "approve-all", fix: "approveAll", tx: l.transactionHash, token, spender: op,
          title: "Every NFT in a collection was handed over", body: `${short(op)} can now move all of ${short(owner)}'s NFTs in ${short(token)}. If you didn't mean to, revoke it now.` });
      } else if (t0 === TOPIC.Transfer) {
        const to = lc(`0x${(l.topics[2] ?? "").slice(26)}`);
        const k = `${owner}:${l.transactionHash}`;
        const g = outByTx.get(k) ?? { wallet: owner, tokens: new Set<string>(), to: new Set<string>() };
        g.tokens.add(token); g.to.add(to); outByTx.set(k, g);
        if (this.flagged.has(to)) this.raise(owner, { level: "danger", kind: "to-drainer", tx: l.transactionHash, token, title: "Tokens went to a known drainer address", body: `From ${short(owner)} to ${short(to)}.` });
      }
    }
    // Several different tokens leaving in a single transaction is what a drain looks like (or a big move you made).
    for (const [k, g] of outByTx) {
      if (g.tokens.size < 3) continue;
      const tx = k.split(":")[1];
      this.raise(g.wallet, { level: "danger", kind: "sweep", tx, title: `${g.tokens.size} different tokens left in one transaction`, body: `Sent to ${[...g.to].map(short).join(", ")}. If this wasn't you, move what's left to a new wallet now.` });
    }
  }

  /** One round of the watcher. Does nothing (no RPC) when no one is watching. */
  async tick() {
    const pub = this.d.pub;
    const wallets = this.watched();
    if (!pub || !wallets.length || this.busy) return;
    if (this.now() - this.lastScan < this.every - 1000) return;
    this.busy = true;
    try {
      const head = await pub.getBlockNumber();
      // Never more than one window behind: after downtime we start near the head instead of reading the whole gap.
      let from = this.from && head - this.from < this.maxSpan ? this.from + 1n : head - 200n;
      if (from > head) { this.lastScan = this.now(); return; }
      const logs: Log[] = [];
      for (let i = 0; i < wallets.length; i += 100) {
        const owners = wallets.slice(i, i + 100).map((w) => `0x${w.slice(2).padStart(64, "0")}`);
        const got = await pub.request({ method: "eth_getLogs", params: [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${head.toString(16)}`, topics: [[TOPIC.Approval, TOPIC.ApprovalForAll, TOPIC.Transfer], owners] }] }) as Log[];
        logs.push(...got);
      }
      this.digest(logs);
      this.from = head;
      this.lastScan = this.now();
      this.status = `watching ${wallets.length} wallet${wallets.length === 1 ? "" : "s"}`;
      if (this.now() - this.lastCode > this.codeEvery) { this.lastCode = this.now(); await this.checkCode(wallets); }
      this.save();
    } catch (e) {
      this.status = `last read failed: ${(e as Error).message.split("\n")[0].slice(0, 160)}`;
      this.lastScan = this.now();
    } finally { this.busy = false; }
  }

  /** EIP-7702: a normal wallet whose code becomes 0xef0100 + address has been handed to that contract. */
  async checkCode(wallets: string[]) {
    const pub = this.d.pub; if (!pub) return;
    for (const w of wallets) {
      const code = lc((await pub.getCode({ address: w as `0x${string}` }).catch(() => undefined)) ?? "0x");
      const prev = this.codeSeen.get(w); this.codeSeen.set(w, code);
      if (code.startsWith("0xef0100") && prev !== code) {
        const target = `0x${code.slice(8, 48)}`;
        const known = this.ctx().trusted!.has(target) && !this.flagged.has(target);
        this.raise(w, { level: known ? "info" : "danger", kind: "delegation", spender: target,
          title: "This wallet is delegated to a contract (EIP-7702)", body: `${short(target)} can act as ${short(w)}. If you didn't upgrade your wallet yourself, move your funds to a new wallet.` }, `delegation:${target}`);
      }
    }
  }

  /**
   * Our own services: a Trenchers Inference key used from a network (/24) it has never been used from, once it has
   * a history. Called on every authenticated key use; costs nothing (no RPC).
   */
  keyUsed(owner: string, keyId: string, display: string, ip: string) {
    const net = ip.includes(":") ? ip.split(":").slice(0, 3).join(":") : ip.split(".").slice(0, 3).join(".");
    if (!net || net === "?") return;
    const k = this.keyNets.get(keyId) ?? { nets: [], t: this.now() };
    if (k.nets.includes(net)) return;
    const established = k.nets.length >= 1 && this.now() - k.t > 3_600_000;
    k.nets.push(net); if (k.nets.length > 20) k.nets.shift();
    this.keyNets.set(keyId, k);
    if (established) {
      const h = createHash("sha256").update(net).digest("hex").slice(0, 8);
      this.raise(`acct:${lc(owner)}`, { level: "warn", kind: "key-new-network", title: `Your Inference key ${display} was used from a new network`, body: `First use from this network (ref ${h}). If that wasn't you or your app, revoke the key on trenchers.io/inference.` }, `key:${keyId}:${net}`);
    }
    this.save();
  }

  /** MetaMask's phishing list, refreshed at most once a day (for /guard/scan; the extension fetches its own). */
  private async loadPhishing() {
    if (this.now() - this.phishingAt < 86_400_000) return;
    this.phishingAt = this.now();
    try {
      const r = await fetch(clean(process.env.GUARD_PHISHING_URL) || "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json", { signal: AbortSignal.timeout(20_000) });
      const j = await r.json() as { blacklist?: string[] };
      if (j.blacklist?.length) this.phishing = new Set(j.blacklist.map(lc));
    } catch { /* keep the old list */ }
  }

  view() { return { status: this.status, accounts: this.accounts.size, wallets: this.watched().length, lastScan: this.lastScan ? new Date(this.lastScan).toISOString() : null, alertsSent: this.sent, scans: this.scans, phishingList: this.phishing.size, flagged: this.flagged.size }; }

  private limited(ip: string, per = 60) {
    const now = this.now(), h = (this.hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    h.push(now); this.hits.set(ip, h);
    if (this.hits.size > 50_000) this.hits.clear();
    return h.length > per;
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith("/guard/")) return false;
    res.setHeader("cache-control", "no-store");
    const send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "content-type, authorization"); res.statusCode = 204; res.end(); return true; }
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "?").split(",")[0].trim();
    if (path === "/guard/status") { send(200, { ...this.view(), free: this.free, holderMax: this.holderMax }); return true; }
    if (path === "/guard/lists") {
      res.setHeader("cache-control", "public, max-age=3600");
      send(200, { trusted: Object.fromEntries(Object.entries(this.ctx().names ?? {})), flagged: [...this.flagged], brands: BRANDS });
      return true;
    }
    if (this.limited(ip)) { send(429, { error: "Too many requests. Wait a minute." }); return true; }
    let b: Record<string, unknown> = {};
    if (req.method === "POST") {
      let raw = "";
      for await (const chunk of req) { raw += chunk; if (raw.length > 64_000) { send(413, { error: "too long" }); return true; } }
      try { b = JSON.parse(raw || "{}"); } catch { send(400, { error: "bad request" }); return true; }
    }
    if (path === "/guard/scan") {
      if (req.method !== "POST") { send(405, { error: "use POST" }); return true; }
      void this.loadPhishing();
      this.scans++;
      send(200, scan({ method: String(b.method ?? ""), params: Array.isArray(b.params) ? b.params : [], origin: typeof b.origin === "string" ? b.origin : undefined }, this.ctx()));
      return true;
    }
    if (path === "/guard/login") {
      if (req.method !== "POST") { send(405, { error: "use POST" }); return true; }
      const a = String(b.address ?? ""), time = String(b.time ?? ""), sig = String(b.signature ?? "");
      if (!isAddress(a) || !time || !sig) { send(400, { error: "bad request" }); return true; }
      const age = this.now() - Date.parse(time);
      if (!(age > -120_000 && age < 600_000)) { send(400, { error: "That signature is too old. Try again." }); return true; }
      const addr = getAddress(a);
      const ok = await verifyMessage({ address: addr, message: guardText(addr, time), signature: sig as `0x${string}` }).catch(() => false);
      if (!ok) { send(401, { error: "The signature doesn't match this wallet." }); return true; }
      // Your own wallet is watched from the start (it counts toward the limit).
      if (!this.accounts.has(lc(addr))) this.watch(addr, addr, "This wallet");
      send(200, { token: this.token(addr), state: this.state(addr) });
      return true;
    }
    const me = this.who(String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
    if (!me) { send(401, { error: "Sign in again." }); return true; }
    if (path === "/guard/state") { send(200, this.state(me)); return true; }
    if (req.method !== "POST") { send(405, { error: "use POST" }); return true; }
    if (path === "/guard/watch") {
      const r = this.watch(me, String(b.address ?? ""), typeof b.label === "string" ? b.label : undefined);
      send(r.ok ? 200 : 400, r.ok ? this.state(me) : r);
      return true;
    }
    if (path === "/guard/unwatch") { this.unwatch(me, String(b.address ?? "")); send(200, this.state(me)); return true; }
    if (path === "/guard/dismiss") {
      const id = String(b.id ?? "");
      for (const w of [...(this.accounts.get(me)?.watch.map((x) => x.addr) ?? []), `acct:${me}`]) { const l = this.feed.get(w); if (l) this.feed.set(w, l.filter((x) => x.id !== id)); }
      this.save(); send(200, this.state(me)); return true;
    }
    if (path === "/guard/telegram") {
      const url = this.d.telegramLink?.(me) ?? null;
      send(url ? 200 : 503, url ? { url } : { error: "Telegram alerts aren't available right now." });
      return true;
    }
    send(404, { error: "not found" });
    return true;
  }
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
