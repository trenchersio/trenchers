import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAddress, isAddress, verifyMessage } from "viem";

/**
 * Trenchies early XP: sign in with X on trenchers.io/trenchies, then earn XP before the game opens.
 *   follow @trenchersx once          +5 XP
 *   like each of its recent posts      +1 XP per post
 *   reply to each of its recent posts  +1 XP per post
 * And for using Trenchers, once a wallet is linked (one signature):
 *   each Trencher NFT held            +50 XP (each NFT counts for one profile only)
 *   each trade your Trencher makes     +1 XP (up to 20 a day per Trencher)
 *   each coin launched                 +25 XP (on the V4 launcher, or by your Trencher)
 *   inference credit bought            +10 XP per $1
 * A leaderboard ranks everyone.
 *
 * Every task is checked with the X API before XP is given. Checks are kept cheap (X bills per item read):
 *   follow  not checked with X either: counts once the player opened it from the page and came back
 *           once ("owned reads", $0.001 each), shared by everyone checking in the same minute
 *   like    not checked with X (to keep costs down): counts once the player opened it from the page and came back
 *   reply   the same as likes
 * A daily spending cap stops checks when it is reached (XPOINTS_BUDGET_USD, default 5).
 *
 * Settings (Railway, Mainnet service):
 *   X_CLIENT_ID, X_CLIENT_SECRET  the OAuth 2.0 keys of your X developer app (User authentication settings:
 *                                 type "Web App", callback URL https://<engine>/xp/callback, website trenchers.io)
 *   X_BEARER_TOKEN                optional: the app's bearer token, used to read @trenchersx's posts before the
 *                                 account itself has signed in here
 *   X_ACCOUNT                     the account to follow (default trenchersx)
 *   X_REDIRECT_URI                optional: the exact callback URL, if it differs from https://<host>/xp/callback
 *   XPOINTS_FILE                  where profiles are kept (default next to the chat file, on the volume)
 *   XPOINTS_BUDGET_USD            daily cap on X API spend for checks (default 5)
 */
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const FILE = clean(process.env.XPOINTS_FILE) || `${dirname(clean(process.env.CHAT_FILE) || "./chat.json")}/xpoints.json`;
const SECRET = clean(process.env.XPOINTS_SECRET) || clean(process.env.TRENCHIES_SECRET) || clean(process.env.CHAT_SECRET) || randomBytes(32).toString("hex");
const ID = () => clean(process.env.X_CLIENT_ID), KEY = () => clean(process.env.X_CLIENT_SECRET), BEARER = () => clean(process.env.X_BEARER_TOKEN);
const ACCOUNT = () => (clean(process.env.X_ACCOUNT) || "trenchersx").replace(/^@/, "");
const BUDGET = () => Number(clean(process.env.XPOINTS_BUDGET_USD) || 5);
const SITE = () => (clean(process.env.SITE_URL) || "https://www.trenchers.io").replace(/\/$/, "");
const API = "https://api.x.com/2";
const SCOPES = "tweet.read users.read follows.read offline.access";
/** Likes and replies count once opened from the page this long ago (no X check: it keeps the cost near zero). */
const OPEN_WAIT = 5000;
const DAY = 86_400_000;
export const XP_RULES = { follow: 5, like: 1, reply: 1, posts: 3, original: 15, originalsPerDay: 1, nft: 50, trade: 1, tradesPerDay: 20, coin: 25, inferencePerUsd: 10 } as const;
/** Who reviews original posts: these X handles, signed in on /trenchies (XPOINTS_ADMINS, comma-separated; default the account). */
const ADMINS = () => new Set((clean(process.env.XPOINTS_ADMINS) || ACCOUNT()).split(",").map((h) => h.trim().replace(/^@/, "").toLowerCase()).filter(Boolean));
/** A link to an X post: https://x.com/<handle>/status/<id> (twitter.com and mobile links too). */
const POST_URL = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:[/?#].*)?$/i;
/** What the rest of the engine knows about a wallet. */
export type XpHost = {
  nftsOf: (wallet: string) => number[];
  /** Trades per UTC day (day number to count) for one Trencher. */
  tradeDays: (nft: number) => Record<number, number>;
  coinsOf: (wallet: string, nfts: number[]) => string[];
  inferenceUsd: (wallet: string) => number;
};
const linkText = (handle: string, wallet: string, time: string) => `Link this wallet to Trenchies XP\n\nX: @${handle}\nWallet: ${wallet}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;

type Tokens = { access: string; refresh?: string; exp: number };
type Usage = { nfts: number[]; trades: number; coins: string[]; usd: number };
type Profile = { id: string; handle: string; name: string; avatar: string; createdAt: number; lastSeen: number; xp: number; followed: number | null; done: Record<string, { like?: number; reply?: number }>; tokens?: Tokens; log: { t: number; xp: number; why: string }[];
  wallet?: string; usage?: Usage; originals?: Original[] };
/** An original post about Trenchies, waiting for (or after) a manual review. */
type Original = { id: string; url: string; at: number; status: "pending" | "ok" | "no"; decidedAt?: number; by?: string };
type Post = { id: string; text: string; at: number };

export class XPoints {
  private users = new Map<string, Profile>();
  private account: { id: string | null; owner?: Tokens } = { id: null };
  private posts: { at: number; list: Post[] } = { at: 0, list: [] };
  private followers: { at: number; ids: Set<string> } = { at: 0, ids: new Set() };
  private pending = new Map<string, { verifier: string; ret: string; at: number }>();
  private spend = { day: 0, usd: 0 };
  private lastCheck = new Map<string, number>();
  /** When each player opened each task from the page (likes and replies count from this). */
  private opened = new Map<string, number>();
  private board: { at: number; list: { rank: number; handle: string; name: string; avatar: string; xp: number }[] } | null = null;
  lastError: string | null = null;

  /** Which profile each Trencher NFT and coin counts for (first to link it). */
  private claimed: { nft: Record<string, string>; coin: Record<string, string> } = { nft: {}, coin: {} };
  constructor(private log: (m: string) => void = () => {}, private host?: XpHost) {
    try {
      if (existsSync(FILE)) {
        const j = JSON.parse(readFileSync(FILE, "utf8")) as { users: Profile[]; account?: XPoints["account"]; claimed?: XPoints["claimed"] };
        for (const u of j.users ?? []) { u.log ??= []; u.done ??= {}; this.users.set(u.id, u); }
        if (j.account) this.account = j.account;
        if (j.claimed) this.claimed = j.claimed;
      }
    } catch { /* start empty */ }
  }
  private save() {
    try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(`${FILE}.tmp`, JSON.stringify({ users: [...this.users.values()], account: this.account, claimed: this.claimed })); renameSync(`${FILE}.tmp`, FILE); } catch { /* keep in memory */ }
  }
  get ready() { return !!(ID() && KEY()); }
  view() { return { ready: this.ready, players: this.users.size, account: ACCOUNT(), accountSignedIn: !!this.account.owner, spentTodayUsd: +this.spend.usd.toFixed(3), budgetUsd: BUDGET(), lastError: this.lastError }; }

  // ------------------------------------------------------------------ sessions
  private sign(id: string, exp: number) { return createHmac("sha256", SECRET).update(`xp:${id}:${exp}`).digest("hex").slice(0, 32); }
  private session(id: string) { const exp = Date.now() + 30 * DAY; return `${id}.${exp}.${this.sign(id, exp)}`; }
  private who(t: unknown) { if (typeof t !== "string") return null; const [id, exp, sig] = t.split("."); if (!id || !exp || !sig || Number(exp) < Date.now() || this.sign(id, Number(exp)) !== sig) return null; return this.users.get(id) ?? null; }

  // ------------------------------------------------------------------ X API
  /** Counts estimated spend; false when today's cap is used up. */
  private charge(usd: number) {
    const d = Math.floor(Date.now() / DAY); if (this.spend.day !== d) this.spend = { day: d, usd: 0 };
    if (this.spend.usd + usd > BUDGET()) return false;
    this.spend.usd += usd; return true;
  }
  private async tokenCall(body: Record<string, string>) {
    const r = await fetch(`${API}/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${ID()}:${KEY()}`).toString("base64")}` }, body: new URLSearchParams(body), signal: AbortSignal.timeout(10_000) });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || `X sign-in failed (${r.status})`);
    return { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in ?? 7200) * 1000 - 60_000 } as Tokens;
  }
  /** A fresh access token for these tokens (refreshing it when it's about to expire). */
  private async access(t: Tokens | undefined, save: (t: Tokens) => void) {
    if (!t) return null;
    if (t.exp > Date.now()) return t.access;
    if (!t.refresh) return null;
    try { const n = await this.tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: ID() }); n.refresh ??= t.refresh; save(n); this.save(); return n.access; }
    catch (e) { this.lastError = (e as Error).message; return null; }
  }
  private async get<T>(path: string, token: string): Promise<T> {
    const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const j = (await r.json().catch(() => ({}))) as T & { title?: string; detail?: string };
    if (!r.ok) { const m = `X API ${r.status}: ${j.detail || j.title || "error"}`; this.lastError = `${path.split("?")[0]} ${m}`; throw new Error(m); }
    return j;
  }
  private async ownerToken() { return this.access(this.account.owner, (t) => { this.account.owner = t; }); }
  private async accountId(token?: string) {
    if (this.account.id) return this.account.id;
    const t = token ?? (await this.ownerToken()) ?? BEARER(); if (!t) return null;
    const j = await this.get<{ data?: { id: string } }>(`/users/by/username/${ACCOUNT()}`, t);
    if (j.data?.id) { this.account.id = j.data.id; this.save(); }
    return this.account.id;
  }
  /** @trenchersx's latest posts (not replies or reposts), refreshed every 10 minutes. */
  async tasks(userToken?: string) {
    if (Date.now() - this.posts.at < 10 * 60_000 && this.posts.list.length) return this.posts.list;
    const owner = await this.ownerToken(), t = owner ?? BEARER() ?? userToken; if (!t) return this.posts.list;
    try {
      const id = await this.accountId(t); if (!id) return this.posts.list;
      if (!this.charge(owner ? 0.005 : 0.025)) return this.posts.list;
      const j = await this.get<{ data?: { id: string; text: string; created_at: string }[] }>(`/users/${id}/tweets?max_results=5&exclude=retweets,replies&tweet.fields=created_at`, t);
      this.posts = { at: Date.now(), list: (j.data ?? []).slice(0, XP_RULES.posts).map((p) => ({ id: p.id, text: p.text, at: Date.parse(p.created_at) })) };
    } catch { this.posts.at = Date.now() - 8 * 60_000; /* try again in 2 minutes */ }
    return this.posts.list;
  }
  private async isFollowing(u: Profile, token: string) {
    const owner = await this.ownerToken();
    if (owner) {
      // newest followers of the account, shared by everyone checking within a minute
      if (Date.now() - this.followers.at > 60_000) {
        if (!this.charge(0.1)) throw new Error("busy");
        const id = await this.accountId(owner);
        const j = await this.get<{ data?: { id: string }[] }>(`/users/${id}/followers?max_results=100`, owner);
        this.followers = { at: Date.now(), ids: new Set((j.data ?? []).map((x) => x.id)) };
      }
      if (this.followers.ids.has(u.id)) return true;
    }
    if (!this.charge(0.5)) throw new Error("busy");
    const j = await this.get<{ data?: { id: string; username: string }[] }>(`/users/${u.id}/following?max_results=50&user.fields=username`, token);
    const acc = await this.accountId(token);
    return (j.data ?? []).some((x) => x.id === acc || x.username.toLowerCase() === ACCOUNT().toLowerCase());
  }


  // ------------------------------------------------------------------ using Trenchers (linked wallet)
  /** Brings a profile's usage XP up to date: new NFTs held, trades made, coins launched, inference bought. */
  sync(u: Profile) {
    if (!u.wallet || !this.host) return false;
    const h = this.host, w = u.wallet.toLowerCase(), was: Usage = u.usage ?? { nfts: [], trades: 0, coins: [], usd: 0 };
    const now: Usage = { nfts: [...was.nfts], trades: 0, coins: [...was.coins], usd: was.usd };
    for (const id of h.nftsOf(w)) { const k = String(id); if (!this.claimed.nft[k]) this.claimed.nft[k] = u.id; if (this.claimed.nft[k] === u.id && !now.nfts.includes(id)) now.nfts.push(id); }
    for (const id of now.nfts) for (const n of Object.values(h.tradeDays(id))) now.trades += Math.min(n, XP_RULES.tradesPerDay);
    now.trades = Math.max(now.trades, was.trades);
    for (const c of h.coinsOf(w, now.nfts)) { const k = c.toLowerCase(); if (!this.claimed.coin[k]) this.claimed.coin[k] = u.id; if (this.claimed.coin[k] === u.id && !now.coins.includes(k)) now.coins.push(k); }
    now.usd = Math.max(was.usd, Math.floor(h.inferenceUsd(w)));
    let changed = false;
    const add = (n: number, xp: number, why: string) => { if (n > 0) { this.give(u, n * xp, why); changed = true; } };
    add(now.nfts.length - was.nfts.length, XP_RULES.nft, `Holds ${now.nfts.length - was.nfts.length === 1 ? "a Trencher" : `${now.nfts.length - was.nfts.length} Trenchers`}`);
    add(now.trades - was.trades, XP_RULES.trade, `${now.trades - was.trades} trade${now.trades - was.trades === 1 ? "" : "s"} by your Trencher`);
    add(now.coins.length - was.coins.length, XP_RULES.coin, `Launched ${now.coins.length - was.coins.length === 1 ? "a coin" : `${now.coins.length - was.coins.length} coins`}`);
    add(now.usd - was.usd, XP_RULES.inferencePerUsd, `Bought $${now.usd - was.usd} of inference`);
    u.usage = now;
    return changed;
  }
  /** Every 10 minutes: usage XP for everyone with a linked wallet. */
  tick() { let any = false; for (const u of this.users.values()) if (u.wallet && this.sync(u)) any = true; if (any) this.save(); }

  // ------------------------------------------------------------------ read-outs
  private rank(id: string) { const all = [...this.users.values()].sort((a, b) => b.xp - a.xp || a.createdAt - b.createdAt); return { rank: all.findIndex((u) => u.id === id) + 1, players: all.length }; }
  private leaderboard() {
    if (this.board && Date.now() - this.board.at < 30_000) return this.board.list;
    const list = [...this.users.values()].sort((a, b) => b.xp - a.xp || a.createdAt - b.createdAt).slice(0, 100).map((u, i) => ({ rank: i + 1, handle: u.handle, name: u.name, avatar: u.avatar, xp: u.xp }));
    this.board = { at: Date.now(), list }; return list;
  }
  private async me(u: Profile) {
    const posts = await this.tasks();
    return {
      id: u.id, handle: u.handle, name: u.name, avatar: u.avatar, xp: u.xp, ...this.rank(u.id), followed: !!u.followed,
      account: ACCOUNT(), rules: XP_RULES,
      posts: posts.map((p) => ({ ...p, liked: !!u.done[p.id]?.like, replied: !!u.done[p.id]?.reply })),
      log: u.log.slice(-12).reverse(),
      wallet: u.wallet ?? null, usage: u.usage ?? { nfts: [], trades: 0, coins: [], usd: 0 },
      originals: (u.originals ?? []).slice(-10).reverse().map((o) => ({ id: o.id, url: o.url, at: o.at, status: o.status })),
      admin: this.isAdmin(u), toReview: this.isAdmin(u) ? this.reviewQueue().length : 0,
    };
  }
  private isAdmin(u: Profile) { return ADMINS().has(u.handle.toLowerCase()); }
  private reviewQueue() { const out: { u: Profile; o: Original }[] = []; for (const u of this.users.values()) for (const o of u.originals ?? []) if (o.status === "pending") out.push({ u, o }); return out.sort((a, b) => a.o.at - b.o.at); }
  private give(u: Profile, xp: number, why: string) { u.xp += xp; u.log = [...u.log.slice(-49), { t: Date.now(), xp, why }]; this.board = null; }

  // ------------------------------------------------------------------ http
  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith("/xp/")) return false;
    res.setHeader("cache-control", "no-store");
    const send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    const go = (url: string) => { res.statusCode = 302; res.setHeader("location", url); res.removeHeader("content-type"); res.end(); };
    if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "content-type"); res.statusCode = 204; res.end(); return true; }
    const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    let b: Record<string, unknown> = {};
    if (req.method === "POST") { let raw = ""; for await (const c of req) { raw += c; if (raw.length > 2000) { send(413, { error: "too long" }); return true; } } try { b = JSON.parse(raw || "{}"); } catch { send(400, { error: "bad request" }); return true; } }
    const op = path.slice(4);
    const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? ""), redirect = clean(process.env.X_REDIRECT_URI) || `https://${host}/xp/callback`;
    const back = (ret: string, frag: string) => go(`${ret || `${SITE()}/trenchies`}#${frag}`);

    if (op === "status") { send(200, { ready: this.ready, account: ACCOUNT(), players: this.users.size, rules: XP_RULES }); return true; }
    if (op === "board") { send(200, { players: this.users.size, top: this.leaderboard() }); return true; }
    if (op === "login") {
      if (!this.ready) { send(503, { error: "X sign-in isn't switched on yet." }); return true; }
      const ret = String(q.get("ret") ?? ""), safe = /^https:\/\/(www\.)?trenchers\.io\//.test(ret) || /^http:\/\/localhost(:\d+)?\//.test(ret) ? ret : `${SITE()}/trenchies`;
      const state = randomBytes(16).toString("hex"), verifier = randomBytes(32).toString("base64url");
      const now = Date.now(); for (const [k, v] of this.pending) if (now - v.at > 15 * 60_000) this.pending.delete(k);
      this.pending.set(state, { verifier, ret: safe, at: now });
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      go(`https://x.com/i/oauth2/authorize?${new URLSearchParams({ response_type: "code", client_id: ID(), redirect_uri: redirect, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: "S256" })}`);
      return true;
    }
    if (op === "callback") {
      const p = this.pending.get(String(q.get("state") ?? "")); const ret = p?.ret ?? `${SITE()}/trenchies`;
      if (!p || !q.get("code")) { back(ret, "xp-error=cancelled"); return true; }
      this.pending.delete(String(q.get("state")));
      try {
        const t = await this.tokenCall({ grant_type: "authorization_code", code: String(q.get("code")), redirect_uri: redirect, code_verifier: p.verifier, client_id: ID() });
        const j = await this.get<{ data: { id: string; username: string; name: string; profile_image_url?: string } }>(`/users/me?user.fields=profile_image_url`, t.access);
        const d = j.data, now = Date.now();
        const u: Profile = this.users.get(d.id) ?? { id: d.id, handle: d.username, name: d.name, avatar: "", createdAt: now, lastSeen: now, xp: 0, followed: null, done: {}, log: [] };
        Object.assign(u, { handle: d.username, name: d.name, avatar: (d.profile_image_url ?? "").replace("_normal", "_200x200"), lastSeen: now, tokens: t });
        this.users.set(u.id, u);
        if (d.username.toLowerCase() === ACCOUNT().toLowerCase()) { this.account = { id: d.id, owner: t }; this.log(`XP: @${d.username} signed in, checks now use its own reads`); }
        this.board = null; this.save();
        back(ret, `xp=${this.session(u.id)}`);
      } catch (e) { this.lastError = (e as Error).message; back(ret, "xp-error=signin"); }
      return true;
    }

    const u = this.who(b.s ?? q.get("s"));
    if (!u) { send(401, { error: "Sign in with X again." }); return true; }
    if (op === "me") { u.lastSeen = Date.now(); if (this.sync(u)) this.save(); send(200, { me: await this.me(u) }); return true; }
    if (op === "original") {
      const m = POST_URL.exec(String(b.url ?? "").trim());
      if (!m) { send(400, { error: "Paste the link to your post, like https://x.com/you/status/123…" }); return true; }
      if (m[1].toLowerCase() !== u.handle.toLowerCase()) { send(400, { error: `That post isn't from @${u.handle}. Post it from your own account.` }); return true; }
      const id = m[2];
      for (const x of this.users.values()) if (x.originals?.some((o) => o.id === id)) { send(400, { error: "That post was already sent in." }); return true; }
      const list = (u.originals ??= []), today = Math.floor(Date.now() / DAY);
      if (list.filter((o) => o.status !== "no" && Math.floor(o.at / DAY) === today).length >= XP_RULES.originalsPerDay) { send(400, { error: "One post a day counts. Post again tomorrow." }); return true; }
      if (list.filter((o) => o.status === "pending").length >= 3) { send(400, { error: "You have posts waiting for review. Give us a moment." }); return true; }
      list.push({ id, url: `https://x.com/${m[1]}/status/${id}`, at: Date.now(), status: "pending" }); if (list.length > 60) list.splice(0, list.length - 60);
      this.save(); send(200, { me: await this.me(u) }); return true;
    }
    if (op === "review") {
      if (!this.isAdmin(u)) { send(403, { error: "Only the team can review posts." }); return true; }
      if (req.method === "POST") {
        const who = this.users.get(String(b.user ?? "")), o = who?.originals?.find((x) => x.id === String(b.id ?? ""));
        if (!who || !o) { send(404, { error: "That post isn't in the list any more." }); return true; }
        if (o.status === "pending") {
          o.status = b.ok === true ? "ok" : "no"; o.decidedAt = Date.now(); o.by = u.handle;
          if (o.status === "ok") this.give(who, XP_RULES.original, "Original post about Trenchies");
          this.save();
        }
      }
      const done: { u: Profile; o: Original }[] = []; for (const x of this.users.values()) for (const o of x.originals ?? []) if (o.status !== "pending") done.push({ u: x, o });
      const row = ({ u: x, o }: { u: Profile; o: Original }) => ({ user: x.id, handle: x.handle, name: x.name, avatar: x.avatar, xp: x.xp, id: o.id, url: o.url, at: o.at, status: o.status, by: o.by ?? null });
      send(200, { pending: this.reviewQueue().slice(0, 100).map(row), recent: done.sort((a, b) => (b.o.decidedAt ?? 0) - (a.o.decidedAt ?? 0)).slice(0, 20).map(row) }); return true;
    }
    if (op === "wallet") {
      const { address, time, signature } = b as { address?: string; time?: string; signature?: string };
      if (!address || !isAddress(address) || !time || !signature) { send(400, { error: "bad request" }); return true; }
      const age = Date.now() - Date.parse(time); if (!(age > -120_000 && age < 600_000)) { send(400, { error: "That signature is too old. Try again." }); return true; }
      const a = getAddress(address);
      if (!(await verifyMessage({ address: a, message: linkText(u.handle, a, time), signature: signature as `0x${string}` }).catch(() => false))) { send(401, { error: "The signature doesn't match this wallet." }); return true; }
      const taken = [...this.users.values()].find((x) => x.id !== u.id && x.wallet === a.toLowerCase());
      if (taken) { send(409, { error: `This wallet is already linked to @${taken.handle}.` }); return true; }
      if (u.wallet && u.wallet !== a.toLowerCase()) { send(409, { error: "Your profile already has a wallet linked." }); return true; }
      u.wallet = a.toLowerCase(); this.sync(u); this.save();
      send(200, { me: await this.me(u) }); return true;
    }
    if (op === "open") {
      const task = String(b.task ?? ""); if (!/^(follow|like:\d+|reply:\d+)$/.test(task)) { send(400, { error: "Unknown task." }); return true; }
      if (!this.opened.has(`${u.id}:${task}`)) this.opened.set(`${u.id}:${task}`, Date.now());
      if (this.opened.size > 200_000) this.opened.clear();
      send(200, { ok: true }); return true;
    }
    if (op === "check") {
      const task = String(b.task ?? ""), [kind, post] = task.split(":");
      // likes and replies: no X call, just "opened from here a few seconds ago"
      if (kind === "like" || kind === "reply") {
        const posts = await this.tasks();
        if (!posts.some((p) => p.id === post)) { send(400, { error: "That post isn't one of today's." }); return true; }
        const d = (u.done[post] ??= {});
        if (!d[kind]) {
          const at = this.opened.get(`${u.id}:${task}`);
          if (!at || Date.now() - at < OPEN_WAIT) { send(200, { ok: false, me: await this.me(u), msg: kind === "like" ? "Like it on X first, then come back." : "Reply on X first, then come back." }); return true; }
          d[kind] = Date.now(); this.give(u, kind === "like" ? XP_RULES.like : XP_RULES.reply, kind === "like" ? "Liked a post" : "Replied to a post"); this.save();
        }
        send(200, { ok: true, me: await this.me(u) }); return true;
      }
      // following: the same, no X call (X can't cheaply tell us about follows that happened long ago)
      if (kind === "follow") {
        if (!u.followed) {
          const at = this.opened.get(`${u.id}:follow`);
          if (!at || Date.now() - at < OPEN_WAIT) { send(200, { ok: false, me: await this.me(u), msg: `Tap Follow to open @${ACCOUNT()} on X, then come back.` }); return true; }
          u.followed = Date.now(); this.give(u, XP_RULES.follow, `Followed @${ACCOUNT()}`); this.save();
        }
        send(200, { ok: true, me: await this.me(u) }); return true;
      }
      send(400, { error: "Unknown task." }); return true;
    }
    send(404, { error: "not found" });
    return true;
  }
}
