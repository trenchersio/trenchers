import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAddress, isAddress, verifyMessage, type Address, type PublicClient } from "viem";
import { NFT_OWNER_ABI } from "./abis";
import type { Backtest } from "./backtest";
import { formatEther } from "viem";
import type { PrizePot } from "./prizes";
import { DAY, GATHER, GOLDEN_FISH, HAT_TRICK_XP, HOUSE_ORDER, ITEMS, PICKS, PLAY_XP, PRIZE_SPLIT, RANK_XP, RENAMED, X_XP, item, levelOf, roundLabel, roundOf, roundStart, streakXp, weekLabel, weekOf, weekStart, type Resource } from "./trenchies-catalog";

/**
 * Trenchies: spawn a little Trenchie with your Trencher, pick 3 Pons coins every day, earn XP when your coins finish
 * in the day's top 3 (of every coin anyone picked), and spend it on a bigger house, a better ride and decor.
 *
 * Rounds: picks made during UTC day D count for round D+1 (00:00 to 24:00 UTC), settled a few minutes after it ends,
 * from the Pons prices the engine already keeps (backtest.ts). Invite-only while it's being built:
 *   TRENCHIES_ALLOW  wallets that may play, comma separated (default: CHAT_ADMINS, else the Deployer)
 *   TRENCHIES_OPEN=1 lets every Trencher holder in.
 * Players are kept next to the chat (trenchies.json).
 */
export const loginText = (addr: string, time: string) => `Sign in to Trenchies\n\nWallet: ${addr}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;

type Pick = { token: Address; symbol: string; pct: number | null; rank: number | null };
type Result = { round: number; picks: Pick[]; xp: number; parts: { label: string; xp: number }[]; at: number };
type Player = {
  addr: string; name: string; nft: number; held: boolean; createdAt: number;
  xp: number; bricks: number; streak: number; lastRound: number | null;
  hits: number; wins: number; hatTricks: number; rounds: number;
  items: string[]; house: string; vehicle: string;
  wood: number; stone: number; fish: number; next: Partial<Record<Resource, number>>;
  /** Who may join this player's land (their Trenchie spawns here and they can chat), and who's asked to. */
  members: string[]; requests: { addr: string; at: number }[];
  x?: { handle: string; at: number }; xPending?: { handle: string; code: string; at: number };
  results: Result[]; seen: number | null;
};
type Settled = { at: number; coins: { token: Address; symbol: string; pct: number | null }[]; players: number };
type Round = { picks: Record<string, Address[]>; settled?: Settled };
type Msg = { id: number; by: string; nft: number; text: string; at: number };
type Prize = { week: number; label: string; feesWei: string; potWei: string; winners: { name: string; addr: string; nft: number; xp: number; share: number; wei: string }[]; at: number; paid: string | null };
type Host = {
  pub: PublicClient; nft: Address; prices: Backtest; symbolOf: (t: Address) => Promise<string>; log: (m: string) => void;
  pot?: PrizePot; announce?: (ids: number[], text: string) => void; notify?: (addr: string, msg: { title: string; body: string; url: string; tag?: string }) => void; site?: string;
};

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const FILE = clean(process.env.TRENCHIES_FILE) || `${dirname(clean(process.env.CHAT_FILE) || "./chat.json")}/trenchies.json`;
const SECRET = clean(process.env.TRENCHIES_SECRET) || clean(process.env.CHAT_SECRET) || randomBytes(32).toString("hex");
const ALLOW = new Set((clean(process.env.TRENCHIES_ALLOW) || clean(process.env.CHAT_ADMINS) || "0x447D8F97c39df3d6FCAB8a02A54986283e818210").split(/[\s,]+/).filter((a) => isAddress(a)).map((a) => a.toLowerCase()));
const OPEN = () => clean(process.env.TRENCHIES_OPEN) === "1";
const ADMINS = new Set((clean(process.env.CHAT_ADMINS) || "0x447D8F97c39df3d6FCAB8a02A54986283e818210").split(/[\s,]+/).filter((a) => isAddress(a)).map((a) => a.toLowerCase()));
const HERE = 40_000; // a member counts as "on the land" for 40 s after their last check-in
const MAX_MEMBERS = 24;
const NAME = /^[A-Za-z0-9_]{3,16}$/;
const lc = (a: string) => a.toLowerCase() as Address;

export class Trenchies {
  private players = new Map<string, Player>();
  private rounds = new Map<number, Round>();
  private coinCache: { at: number; list: unknown[] } | null = null;
  private chats = new Map<string, Msg[]>();
  private prizes = new Map<number, Prize>();
  private presence = new Map<string, Map<string, number>>();
  private lastSay = new Map<string, number>();
  private msgId = Date.now();
  status = "ok";

  constructor(private host: Host) {
    try {
      if (existsSync(FILE)) {
        const j = JSON.parse(readFileSync(FILE, "utf8")) as { players: Player[]; rounds: [number, Round][]; chats?: Record<string, Msg[]>; prizes?: Prize[] };
        for (const [k, v] of Object.entries(j.chats ?? {})) this.chats.set(k, v);
        for (const z of j.prizes ?? []) this.prizes.set(z.week, z);
        for (const p of j.players ?? []) {
          p.wood ??= 0; p.stone ??= 0; p.fish ??= 0; p.next ??= {}; p.members ??= []; p.requests ??= [];
          p.items = [...new Set(p.items.map((i) => RENAMED[i] ?? i))]; p.vehicle = RENAMED[p.vehicle] ?? p.vehicle;
          this.players.set(p.addr, p);
        }
        for (const [r, v] of j.rounds ?? []) this.rounds.set(r, v);
      }
    } catch { /* start empty */ }
  }
  private save() {
    try {
      const keep = [...this.rounds.entries()].sort((a, b) => b[0] - a[0]).slice(0, 90);
      mkdirSync(dirname(FILE), { recursive: true });
      const prizes = [...this.prizes.values()].sort((a, b) => b.week - a.week).slice(0, 52);
      writeFileSync(`${FILE}.tmp`, JSON.stringify({ players: [...this.players.values()], rounds: keep, chats: Object.fromEntries(this.chats), prizes }));
      renameSync(`${FILE}.tmp`, FILE);
    } catch { /* keep in memory */ }
  }
  view() { return { players: this.players.size, rounds: this.rounds.size, invite: OPEN() ? "open to holders" : `${ALLOW.size} wallet(s)`, status: this.status, prizes: this.host.pot?.view() ?? "off", weeksPaid: [...this.prizes.values()].filter((z) => z.paid).length }; }

  // ------------------------------------------------------------------ sessions

  private sign(addr: string, exp: number) { return createHmac("sha256", SECRET).update(`trenchies:${addr}:${exp}`).digest("hex").slice(0, 32); }
  private token(addr: string) { const exp = Date.now() + 7 * DAY * 1000; return `${addr}.${exp}.${this.sign(addr, exp)}`; }
  private who(t: unknown): string | null {
    if (typeof t !== "string") return null;
    const [addr, exp, sig] = t.split(".");
    if (!addr || !exp || !sig || Number(exp) < Date.now() || this.sign(addr, Number(exp)) !== sig) return null;
    return addr;
  }
  private allowed(addr: string) { return OPEN() || ALLOW.has(addr); }
  private async holds(addr: string, nft: number) {
    try { return lc(await this.host.pub.readContract({ address: this.host.nft, abi: NFT_OWNER_ABI, functionName: "ownerOf", args: [BigInt(nft)] }) as string) === addr; }
    catch { return false; }
  }

  // ------------------------------------------------------------------ rounds

  private round(r: number) { let x = this.rounds.get(r); if (!x) this.rounds.set(r, (x = { picks: {} })); return x; }
  /** Live % change of a coin over round r so far (or the whole round once it's over). */
  private change(token: Address, r: number, now: number) {
    const a = this.host.prices.priceAt(token, roundStart(r)), b = this.host.prices.priceAt(token, Math.min(now, roundStart(r + 1)));
    return a && b ? (b / a - 1) * 100 : null;
  }
  private standings(r: number, now: number) {
    const rd = this.rounds.get(r); if (!rd) return [];
    const tokens = [...new Set(Object.values(rd.picks).flat())];
    return tokens.map((token) => ({ token, symbol: this.host.prices.symbolOf(token) ?? token.slice(2, 8), pct: this.change(token, r, now), by: Object.values(rd.picks).filter((p) => p.includes(token)).length }))
      .sort((a, b) => (b.pct ?? -1e9) - (a.pct ?? -1e9));
  }

  /** Every minute: settles the round that just ended, once the price data covers its last minute. */
  tick(now = Date.now() / 1000) {
    this.settleRound(now);
    this.settleWeek(now);
  }
  private settleRound(now: number) {
    const r = roundOf(now) - 1, rd = this.rounds.get(r);
    if (!rd || rd.settled || this.host.prices.updatedAt < roundStart(r + 1)) return;
    const coins = this.standings(r, roundStart(r + 1)).map(({ token, symbol, pct }) => ({ token, symbol, pct }));
    const top = coins.filter((c) => c.pct !== null).slice(0, 3).map((c) => c.token);
    let n = 0;
    for (const [addr, picks] of Object.entries(rd.picks)) {
      const p = this.players.get(addr); if (!p || !picks.length) continue;
      n++;
      const res: Pick[] = picks.map((token) => { const c = coins.find((x) => x.token === token); const i = top.indexOf(token); return { token, symbol: c?.symbol ?? token.slice(2, 8), pct: c?.pct ?? null, rank: i >= 0 ? i + 1 : null }; });
      p.streak = p.lastRound === r - 1 ? p.streak + 1 : 1; p.lastRound = r; p.rounds++;
      const parts = [{ label: "Played the day", xp: PLAY_XP }];
      for (const x of res) if (x.rank) parts.push({ label: `$${x.symbol} finished #${x.rank}`, xp: RANK_XP[x.rank - 1] });
      if (p.streak > 1) parts.push({ label: `${p.streak}-day streak`, xp: streakXp(p.streak) });
      const hits = res.filter((x) => x.rank).length;
      if (hits === PICKS) { parts.push({ label: "Hat trick: all 3 in the top 3", xp: HAT_TRICK_XP }); p.hatTricks++; }
      if (res.some((x) => x.rank === 1)) p.wins++;
      p.hits += hits;
      const xp = parts.reduce((s, x) => s + x.xp, 0);
      p.xp += xp; p.bricks += xp;
      p.results.unshift({ round: r, picks: res, xp, parts, at: Date.now() }); p.results = p.results.slice(0, 30);
    }
    rd.settled = { at: Date.now(), coins, players: n };
    this.save();
    this.host.log(`Trenchies: round ${roundLabel(r)} settled (${n} players, top: ${coins.slice(0, 3).map((c) => `$${c.symbol} ${c.pct?.toFixed(1)}%`).join(", ")})`);
  }

  private pub(p: Player) {
    return { name: p.name, nft: p.nft, level: levelOf(p.xp), xp: p.xp, streak: p.streak, hits: p.hits, wins: p.wins, hatTricks: p.hatTricks, rounds: p.rounds, items: p.items, house: p.house, vehicle: p.vehicle, x: p.x?.handle ?? null, createdAt: p.createdAt };
  }
  private me(p: Player, now: number) {
    const open = roundOf(now) + 1, live = roundOf(now), last = live - 1;
    const st = this.standings(live, now);
    return {
      ...this.pub(p), bricks: p.bricks, held: p.held, wood: p.wood, stone: p.stone, fish: p.fish, next: { wood: p.next.wood ?? 0, stone: p.next.stone ?? 0, fish: p.next.fish ?? 0 },
      requests: p.requests.length, lands: [...this.players.values()].filter((h) => h.members.includes(p.addr)).map((h) => this.mini(h)),
      week: this.weekRank(p.addr, now), xPending: p.xPending ? { handle: p.xPending.handle, code: p.xPending.code } : null,
      open: { round: open, label: roundLabel(open), lockAt: roundStart(open), picks: (this.rounds.get(open)?.picks[p.addr] ?? []).map((t) => ({ token: t, symbol: this.host.prices.symbolOf(t) ?? t.slice(2, 8) })) },
      live: { round: live, label: roundLabel(live), endsAt: roundStart(live + 1), dataAt: this.host.prices.updatedAt, players: Object.keys(this.rounds.get(live)?.picks ?? {}).length,
        picks: (this.rounds.get(live)?.picks[p.addr] ?? []).map((t) => { const i = st.findIndex((x) => x.token === t); return { token: t, symbol: st[i]?.symbol ?? t.slice(2, 8), pct: st[i]?.pct ?? null, place: i >= 0 ? i + 1 : null }; }),
        top: st.slice(0, 5) },
      last: (() => { const s = this.rounds.get(last)?.settled; return s ? { round: last, label: roundLabel(last), top: s.coins.slice(0, 5), players: s.players } : null; })(),
      results: p.results.slice(0, 10), unseen: p.results[0] && p.results[0].round !== p.seen ? p.results[0] : null,
    };
  }

  // ------------------------------------------------------------------ http

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (!path.startsWith("/trenchies/")) return false;
    res.setHeader("cache-control", "no-store");
    const send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); res.setHeader("Access-Control-Allow-Headers", "content-type"); res.statusCode = 204; res.end(); return true; }
    const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    let b: Record<string, unknown> = {};
    if (req.method === "POST") {
      let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 4_000) { send(413, { error: "too long" }); return true; } }
      try { b = JSON.parse(raw || "{}"); } catch { send(400, { error: "bad request" }); return true; }
    }
    const now = Date.now() / 1000;
    const op = path.slice("/trenchies/".length);

    if (op === "login") {
      const { address, time, signature } = b as { address?: string; time?: string; signature?: string };
      if (!address || !isAddress(address) || !time || !signature) { send(400, { error: "bad request" }); return true; }
      const age = Date.now() - Date.parse(time); if (!(age > -120_000 && age < 600_000)) { send(400, { error: "That signature is too old. Try again." }); return true; }
      const a = getAddress(address);
      if (!(await verifyMessage({ address: a, message: loginText(a, time), signature: signature as `0x${string}` }).catch(() => false))) { send(401, { error: "The signature doesn't match this wallet." }); return true; }
      const addr = a.toLowerCase();
      if (!this.allowed(addr)) { send(403, { error: "invite-only", allowed: false }); return true; }
      const p = this.players.get(addr);
      if (p) { p.held = await this.holds(addr, p.nft); this.save(); }
      send(200, { token: this.token(addr), allowed: true, me: p ? this.me(p, now) : null });
      return true;
    }

    if (op === "prizes") { send(200, this.prizeView(now, this.who(q.get("token")))); return true; }

    const addr = this.who(b.token ?? q.get("token"));
    if (!addr || !this.allowed(addr)) { send(401, { error: "Sign in again." }); return true; }
    const p = this.players.get(addr) ?? null;

    if (op === "state") { send(200, { me: p ? this.me(p, now) : null, now }); return true; }

    if (op === "spawn") {
      const nft = Number(b.nft), name = String(b.name ?? "").trim();
      if (!Number.isInteger(nft) || nft < 1 || nft > 2000) { send(400, { error: "Pick one of your Trenchers." }); return true; }
      if (!NAME.test(name)) { send(400, { error: "Names are 3 to 16 letters, numbers or _." }); return true; }
      const taken = [...this.players.values()].find((x) => x.name.toLowerCase() === name.toLowerCase() && x.addr !== addr);
      if (taken) { send(409, { error: "That name is taken. Try another." }); return true; }
      if (!(await this.holds(addr, nft))) { send(403, { error: `This wallet doesn't hold Trencher #${nft}.` }); return true; }
      if (p) { p.nft = nft; p.name = name; p.held = true; }
      else this.players.set(addr, { addr, name, nft, held: true, createdAt: Date.now(), xp: 0, bricks: 0, streak: 0, lastRound: null, hits: 0, wins: 0, hatTricks: 0, rounds: 0, items: ["shack", "bike"], house: "shack", vehicle: "bike", wood: 0, stone: 0, fish: 0, next: {}, members: [], requests: [], results: [], seen: null });
      this.save();
      send(200, { me: this.me(this.players.get(addr)!, now) });
      return true;
    }
    if (!p) { send(404, { error: "Spawn your Trenchie first." }); return true; }

    if (op === "coins") {
      if (!this.coinCache || Date.now() - this.coinCache.at > 300_000) {
        const list = this.host.prices.active(now - DAY, 60);
        await Promise.all(list.filter((c) => /^[0-9A-F]{6}$/.test(c.symbol)).slice(0, 60).map(async (c) => { c.symbol = await this.host.symbolOf(c.token).catch(() => c.symbol); }));
        this.coinCache = { at: Date.now(), list };
      }
      const s = (q.get("q") ?? "").trim().toLowerCase();
      const list = (this.coinCache.list as { token: string; symbol: string }[]).filter((c) => !s || c.symbol.toLowerCase().includes(s) || c.token.includes(s));
      send(200, { coins: list, dataAt: this.host.prices.updatedAt, popular: this.popular(roundOf(now) + 1) });
      return true;
    }
    if (op === "picks") {
      if (!p.held) { send(403, { error: "Your Trenchie's Trencher isn't in this wallet any more. Spawn again with one you hold." }); return true; }
      const toks = Array.isArray(b.tokens) ? [...new Set((b.tokens as unknown[]).map((t) => String(t).toLowerCase()))] : [];
      if (toks.length !== PICKS || !toks.every((t) => /^0x[0-9a-f]{40}$/.test(t) && this.host.prices.known(t as Address))) { send(400, { error: `Pick ${PICKS} different Pons coins.` }); return true; }
      const open = roundOf(now) + 1;
      this.round(open).picks[addr] = toks as Address[];
      this.save();
      send(200, { me: this.me(p, now) });
      return true;
    }
    if (op === "seen") { p.seen = Number(b.round) || p.seen; this.save(); send(200, { ok: true }); return true; }
    if (op === "buy" || op === "equip") {
      const it = item(String(b.id ?? "")); if (!it) { send(400, { error: "Unknown item." }); return true; }
      if (op === "buy") {
        if (p.items.includes(it.id)) { send(400, { error: "You already own this." }); return true; }
        if (levelOf(p.xp) < it.level) { send(400, { error: `Reach level ${it.level} first.` }); return true; }
        if (p.bricks < it.cost) { send(400, { error: `You need ${it.cost - p.bricks} more bricks.` }); return true; }
        if ((it.wood ?? 0) > p.wood) { send(400, { error: `You need ${(it.wood ?? 0) - p.wood} more wood. Chop the tree on your land.` }); return true; }
        if ((it.stone ?? 0) > p.stone) { send(400, { error: `You need ${(it.stone ?? 0) - p.stone} more stone. Mine the rock on your land.` }); return true; }
        if (it.needsHouse !== undefined && HOUSE_ORDER.indexOf(p.house) < it.needsHouse) { send(400, { error: `This needs the ${item(HOUSE_ORDER[it.needsHouse])?.name} or bigger.` }); return true; }
        p.bricks -= it.cost; p.wood -= it.wood ?? 0; p.stone -= it.stone ?? 0; p.items.push(it.id);
      } else if (!p.items.includes(it.id)) { send(400, { error: "Buy it first." }); return true; }
      if (it.kind === "house") p.house = it.id;
      if (it.kind === "vehicle") p.vehicle = it.id;
      this.save();
      send(200, { me: this.me(p, now) });
      return true;
    }
    if (op === "gather") {
      const res = String(b.res ?? "") as Resource, g = GATHER[res];
      if (!g) { send(400, { error: "Gather wood or stone." }); return true; }
      const at = p.next[res] ?? 0;
      if (Date.now() < at) { send(400, { error: `It's still regrowing.`, next: at }); return true; }
      const got = g.min + Math.floor(Math.random() * (g.max - g.min + 1));
      const golden = res === "fish" && Math.random() < GOLDEN_FISH.chance, xp = g.xp + (golden ? GOLDEN_FISH.xp : 0);
      p[res] += got; p.xp += xp; p.bricks += xp; p.next[res] = Date.now() + g.every * 1000;
      this.save();
      send(200, { me: this.me(p, now), got, res, xp, golden });
      return true;
    }
    if (op === "leaderboard") {
      const all = [...this.players.values()].sort((x, y) => y.xp - x.xp || y.hits - x.hits);
      send(200, { players: all.slice(0, 100).map((x, i) => ({ rank: i + 1, ...this.pub(x) })), me: all.findIndex((x) => x.addr === addr) + 1 });
      return true;
    }
    if (op === "visit") {
      const name = (q.get("name") ?? "").trim().toLowerCase();
      const v = [...this.players.values()].find((x) => x.name.toLowerCase() === name);
      if (!v) { send(404, { error: "No Trenchie by that name." }); return true; }
      send(200, { player: { ...this.pub(v), last: v.results[0] ?? null } });
      return true;
    }
    if (op.startsWith("land")) return this.land(op, p, b, q, send);
    if (op === "prizes/paid") {
      if (!ADMINS.has(addr)) { send(403, { error: "Only the team can mark a payout." }); return true; }
      const z = this.prizes.get(Number(b.week)); const tx = String(b.tx ?? "").trim();
      if (!z || !/^0x[0-9a-fA-F]{64}$/.test(tx)) { send(400, { error: "Give the week and the payout transaction." }); return true; }
      z.paid = tx; this.save();
      send(200, this.prizeView(now, addr));
      return true;
    }
    if (op === "x/start") {
      const handle = String(b.handle ?? "").trim().replace(/^@/, "");
      if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) { send(400, { error: "That isn't an X handle." }); return true; }
      p.xPending = { handle, code: `TRENCHIE-${randomBytes(3).toString("hex").toUpperCase()}`, at: Date.now() };
      this.save();
      send(200, { me: this.me(p, now) });
      return true;
    }
    if (op === "x/verify") {
      const pend = p.xPending; if (!pend) { send(400, { error: "Start again with your handle." }); return true; }
      const url = String(b.url ?? "").trim();
      const m = url.match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/);
      if (!m || m[1].toLowerCase() !== pend.handle.toLowerCase()) { send(400, { error: `Paste the link to your post from @${pend.handle}.` }); return true; }
      try {
        const r = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(`https://twitter.com/${m[1]}/status/${m[2]}`)}`, { signal: AbortSignal.timeout(10_000) });
        const j = (await r.json()) as { html?: string; author_url?: string };
        const author = (j.author_url ?? "").toLowerCase().split("/").pop();
        if (!r.ok || !j.html?.includes(pend.code) || author !== pend.handle.toLowerCase()) { send(400, { error: `That post doesn't show the code ${pend.code} from @${pend.handle} yet. Check it's public and try again.` }); return true; }
      } catch { send(502, { error: "Couldn't reach X right now. Try again in a minute." }); return true; }
      const first = !p.x;
      p.x = { handle: pend.handle, at: Date.now() }; p.xPending = undefined;
      if (first) { p.xp += X_XP; p.bricks += X_XP; }
      this.save();
      send(200, { me: this.me(p, now), bonus: first ? X_XP : 0 });
      return true;
    }
    send(404, { error: "not found" });
    return true;
  }

  // ------------------------------------------------------------------ lands: join requests, members, chat

  private mini(p: Player) { return { name: p.name, nft: p.nft, level: levelOf(p.xp), x: p.x?.handle ?? null }; }
  private byName(n: unknown) { const s = String(n ?? "").trim().toLowerCase(); return [...this.players.values()].find((x) => x.name.toLowerCase() === s) ?? null; }
  private land(op: string, p: Player, b: Record<string, unknown>, q: URLSearchParams, send: (c: number, x: unknown) => void) {
    const h = this.byName(b.name ?? q.get("name"));
    if (!h) { send(404, { error: "No Trenchie by that name." }); return true; }
    const own = h.addr === p.addr, member = h.members.includes(p.addr);
    const out = () => {
      const here = this.presence.get(h.addr) ?? new Map<string, number>(), t = Date.now();
      return {
        land: { ...this.pub(h), last: h.results[0] ?? null }, role: own ? "owner" : member ? "member" : h.requests.some((r) => r.addr === p.addr) ? "pending" : "visitor",
        members: h.members.map((a) => this.players.get(a)).filter((x): x is Player => !!x).map((x) => this.mini(x)),
        present: h.members.filter((a) => (here.get(a) ?? 0) > t - HERE).map((a) => this.players.get(a)).filter((x): x is Player => !!x).map((x) => this.mini(x)),
        ownerHere: (here.get(h.addr) ?? 0) > t - HERE,
        chat: (this.chats.get(h.addr) ?? []).slice(-60),
        requests: own ? h.requests.map((r) => { const x = this.players.get(r.addr); return x ? { ...this.mini(x), at: r.at } : null; }).filter(Boolean) : undefined,
      };
    };
    if (op === "land") {
      if (own || member) { let m = this.presence.get(h.addr); if (!m) this.presence.set(h.addr, (m = new Map())); m.set(p.addr, Date.now()); }
      send(200, out()); return true;
    }
    if (op === "land/request") {
      if (own || member) { send(400, { error: "You're already on this land." }); return true; }
      if (h.members.length >= MAX_MEMBERS) { send(400, { error: "This land is full." }); return true; }
      if (!h.requests.some((r) => r.addr === p.addr)) {
        h.requests = [...h.requests.slice(-19), { addr: p.addr, at: Date.now() }];
        this.save();
        this.host.notify?.(h.addr, { title: "Someone wants to join your land", body: `${p.name} asked to join ${h.name}'s land in Trenchies.`, url: `${this.host.site ?? ""}/trenchies/play`, tag: "trenchies-join" });
      }
      send(200, out()); return true;
    }
    if (op === "land/answer") {
      if (!own) { send(403, { error: "Only the owner can answer." }); return true; }
      const who = this.byName(b.who); if (!who) { send(404, { error: "No Trenchie by that name." }); return true; }
      h.requests = h.requests.filter((r) => r.addr !== who.addr);
      if (b.accept === true && !h.members.includes(who.addr)) {
        if (h.members.length >= MAX_MEMBERS) { send(400, { error: `A land holds up to ${MAX_MEMBERS} members.` }); return true; }
        h.members.push(who.addr);
        this.post(h, { by: "", nft: 0, text: `${who.name} joined the land` });
        this.host.notify?.(who.addr, { title: "You're in", body: `${h.name} let you join their land in Trenchies.`, url: `${this.host.site ?? ""}/trenchies/play`, tag: "trenchies-join" });
      }
      this.save(); send(200, out()); return true;
    }
    if (op === "land/leave") {
      const who = own ? this.byName(b.who) : p;
      if (!who || who.addr === h.addr || !h.members.includes(who.addr)) { send(400, { error: "Not a member." }); return true; }
      h.members = h.members.filter((a) => a !== who.addr); this.presence.get(h.addr)?.delete(who.addr);
      this.post(h, { by: "", nft: 0, text: own ? `${who.name} was removed` : `${who.name} left the land` });
      this.save(); send(200, out()); return true;
    }
    if (op === "land/say") {
      if (!own && !member) { send(403, { error: "Ask to join this land to chat here." }); return true; }
      const text = String(b.text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!text) { send(400, { error: "Say something." }); return true; }
      const last = this.lastSay.get(p.addr) ?? 0; if (Date.now() - last < 1500) { send(429, { error: "Slow down a little." }); return true; }
      this.lastSay.set(p.addr, Date.now());
      this.post(h, { by: p.name, nft: p.nft, text });
      this.save(); send(200, out()); return true;
    }
    send(404, { error: "not found" }); return true;
  }
  private post(h: Player, m: Omit<Msg, "id" | "at">) {
    const list = this.chats.get(h.addr) ?? []; list.push({ ...m, id: ++this.msgId, at: Date.now() }); this.chats.set(h.addr, list.slice(-100));
  }

  // ------------------------------------------------------------------ weekly prizes

  /** XP each player's picks earned in week w (settled days only), best first. */
  private weekBoard(w: number) {
    const a = weekStart(w) / DAY, z = weekStart(w + 1) / DAY;
    return [...this.players.values()].map((p) => { const rs = p.results.filter((r) => r.round >= a && r.round < z); return { p, xp: rs.reduce((s, r) => s + r.xp, 0), hits: rs.reduce((s, r) => s + r.picks.filter((x) => x.rank).length, 0) }; })
      .filter((x) => x.xp > 0).sort((x, y) => y.xp - x.xp || y.hits - x.hits || x.p.createdAt - y.p.createdAt);
  }
  private weekRank(addr: string, now: number) {
    const b = this.weekBoard(weekOf(now)), i = b.findIndex((x) => x.p.addr === addr);
    return { rank: i >= 0 ? i + 1 : null, xp: i >= 0 ? b[i].xp : 0, players: b.length };
  }
  /** Once a week has ended and its last day is settled: work out the winners and their share of the pot. */
  private settleWeek(now: number) {
    const w = weekOf(now) - 1; if (this.prizes.has(w) || !this.host.pot) return;
    const lastRound = weekStart(w + 1) / DAY - 1, rd = this.rounds.get(lastRound);
    if (rd && !rd.settled) return; // wait for Sunday to settle
    if (now < weekStart(w + 1) + 600) return;
    const pot = this.host.pot.potWei(w), fees = this.host.pot.feesIn(w);
    const top = this.weekBoard(w).slice(0, PRIZE_SPLIT.length), total = PRIZE_SPLIT.slice(0, top.length).reduce((s, x) => s + x, 0) || 1;
    const winners = top.map((x, i) => { const share = Math.round((PRIZE_SPLIT[i] / total) * 1000) / 10; return { name: x.p.name, addr: x.p.addr, nft: x.p.nft, xp: x.xp, share, wei: ((pot * BigInt(Math.round(share * 10))) / 1000n).toString() }; });
    this.prizes.set(w, { week: w, label: weekLabel(w), feesWei: fees.toString(), potWei: pot.toString(), winners, at: Date.now(), paid: null });
    this.save();
    this.host.log(`Trenchies: week ${weekLabel(w)} settled, pot ${formatEther(pot)} ETH, winners ${winners.map((x) => x.name).join(", ") || "none"}`);
    if (winners.length && pot > 0n) {
      const eth = (v: string) => Number(formatEther(BigInt(v))).toFixed(4);
      this.host.announce?.(winners.map((x) => x.nft), [`🏆 <b>Trenchies weekly prizes</b> (${weekLabel(w)})`, `Pot: <b>${eth(pot.toString())} ETH</b> (5% of the $TRENCHERS creator fees this week)`, "", ...winners.map((x, i) => `${["🥇", "🥈", "🥉"][i]} <b>${x.name}</b> (Trencher #${x.nft}): ${x.xp} XP → ${eth(x.wei)} ETH`), "", `Play: ${this.host.site ?? ""}/trenchies`].join("\n"));
      for (const x of winners) this.host.notify?.(x.addr, { title: "You won a Trenchies weekly prize", body: `Your picks finished in the top ${PRIZE_SPLIT.length} this week: ${eth(x.wei)} ETH is on its way.`, url: `${this.host.site ?? ""}/trenchies/play`, tag: "trenchies-prize" });
    }
  }
  private prizeView(now: number, viewer: string | null) {
    const w = weekOf(now), board = this.weekBoard(w), pot = this.host.pot?.view(now) ?? null;
    return {
      pot, split: PRIZE_SPLIT, week: { week: w, label: weekLabel(w), start: weekStart(w), end: weekStart(w + 1) },
      standings: board.slice(0, 10).map((x, i) => ({ rank: i + 1, ...this.mini(x.p), xp: x.xp, hits: x.hits })),
      me: viewer ? this.weekRank(viewer, now) : null, admin: !!viewer && ADMINS.has(viewer),
      past: [...this.prizes.values()].sort((a, b) => b.week - a.week).slice(0, 8).map((z) => ({ ...z, winners: z.winners.map((x) => ({ ...x, addr: viewer && ADMINS.has(viewer) ? x.addr : `${x.addr.slice(0, 6)}…${x.addr.slice(-4)}` })) })),
    };
  }

  /** What other players picked most for the open round (a hint, without who). */
  private popular(r: number) {
    const rd = this.rounds.get(r); if (!rd) return [];
    const n = new Map<string, number>();
    for (const ps of Object.values(rd.picks)) for (const t of ps) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([token, count]) => ({ token, symbol: this.host.prices.symbolOf(token as Address) ?? token.slice(2, 8), count }));
  }
}

export { ITEMS };
