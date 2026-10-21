import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAddress, isAddress, verifyMessage, type Address, type PublicClient } from "viem";
import { NFT_OWNER_ABI } from "./abis";
import type { Backtest } from "./backtest";
import { formatEther } from "viem";
import type { PrizePot } from "./prizes";
import { ACHIEVEMENTS, CHEER, COSMETICS, DAY, DESK, FLOORS, HAT_TRICK_XP, HOUSE_ORDER, ITEMS, PAINTS, PAINT_COST, PICKS, PLAY_COINS, PLAY_XP, PRIZE_SPLIT, QUESTS, RANK_COINS, RANK_XP, REFERRAL, RENAMED, ROOM_SLOTS, X_XP, cosmetic, deskRound, item, landValue, levelOf, roomLayout, roundLabel, roundOf, roundStart, streakXp, weekLabel, weekOf, weekStart, type Call, type ChestTier, type Slot } from "./trenchies-catalog";
import type { BtcFeed } from "./btc";
import { buyCosmetic, bump, canWear, checkAchievements, claimDaily, dailyState, emptyProgress, ensureQuests, gain, note, openChest, stat, swingNet, type Progress } from "./trenchies-rewards";

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
type Result = { round: number; picks: Pick[]; xp: number; coins?: number; parts: { label: string; xp: number }[]; at: number };
type DeskLog = { r: number; call: Call; result: "win" | "loss" | "push" | "void"; open: number | null; close: number | null; xp: number; coins: number; crowd: boolean };
type DeskRound = { calls: Record<string, Call>; open?: number | null; close?: number | null; done?: boolean };
type Player = Progress & {
  addr: string; name: string; nft: number; held: boolean; createdAt: number;
  xp: number; bricks: number; streak: number; lastRound: number | null;
  hits: number; wins: number; hatTricks: number; rounds: number;
  items: string[]; house: string; vehicle: string;
  next: Partial<Record<"net", number>>;
  /** The trading desk: current winning streak, best ever, calls paid in full today, recent results. */
  desk: { streak: number; best: number; day: number; paid: number; log: DeskLog[] };
  /** Your own house plan (room to slot), wall and floor paint per room, and where garden things stand. */
  layout: Record<string, string>; paint: Record<string, { wall?: number; floor?: number }>; place: Record<string, { x: number; y: number }>;
  /** Who may join this player's land (their Trenchie spawns here and they can chat), and who's asked to. */
  members: string[]; requests: { addr: string; at: number }[];
  /** Public land: anyone can walk in and chat. Private (the default): only members the owner accepted. */
  open?: boolean;
  /** Who invited them (a referral), and whether the inviter has been paid for it. */
  referredBy?: string; refPaid?: boolean;
  /** Today's visits and cheers (each land counts once a day). */
  visited: { day: number; lands: string[] }; cheered: { day: number; lands: string[] };
  /** Phone reminders already sent, so nothing repeats. */
  notified: { picks?: number; daily?: number; lastAt?: number };
  lastSeen: number;
  x?: { handle: string; at: number }; xPending?: { handle: string; code: string; at: number };
  results: Result[]; seen: number | null;
};
type Settled = { at: number; coins: { token: Address; symbol: string; pct: number | null }[]; players: number };
type Round = { picks: Record<string, Address[]>; settled?: Settled };
type Msg = { id: number; by: string; nft: number; text: string; at: number };
type Prize = { week: number; label: string; feesWei: string; potWei: string; winners: { name: string; addr: string; nft: number; xp: number; share: number; wei: string }[]; at: number; paid: string | null };
type Host = {
  pub: PublicClient; nft: Address; prices: Backtest; symbolOf: (t: Address) => Promise<string>; log: (m: string) => void;
  pot?: PrizePot; btc?: BtcFeed; announce?: (ids: number[], text: string) => void; notify?: (addr: string, msg: { title: string; body: string; url: string; tag?: string }) => void; site?: string;
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
  private desk = new Map<number, DeskRound>();
  private presence = new Map<string, Map<string, number>>();
  private lastSay = new Map<string, number>();
  private msgId = Date.now();
  status = "ok";

  constructor(private host: Host) {
    try {
      if (existsSync(FILE)) {
        const j = JSON.parse(readFileSync(FILE, "utf8")) as { players: Player[]; rounds: [number, Round][]; chats?: Record<string, Msg[]>; prizes?: Prize[]; desk?: [number, DeskRound][] };
        for (const [r, v] of j.desk ?? []) this.desk.set(r, v);
        for (const [k, v] of Object.entries(j.chats ?? {})) this.chats.set(k, v);
        for (const z of j.prizes ?? []) this.prizes.set(z.week, z);
        for (const p of j.players ?? []) {
          p.next ??= {}; p.members ??= []; p.requests ??= [];
          p.desk ??= { streak: 0, best: 0, day: -1, paid: 0, log: [] }; p.layout ??= {}; p.paint ??= {}; p.place ??= {};
          const e = emptyProgress();
          for (const k of Object.keys(e) as (keyof typeof e)[]) (p as Record<string, unknown>)[k] ??= e[k];
          p.visited ??= { day: -1, lands: [] }; p.cheered ??= { day: -1, lands: [] }; p.notified ??= {}; p.lastSeen ??= p.createdAt;
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
      const desk = [...this.desk.entries()].sort((a, b) => b[0] - a[0]).slice(0, 600);
      writeFileSync(`${FILE}.tmp`, JSON.stringify({ players: [...this.players.values()], rounds: keep, chats: Object.fromEntries(this.chats), prizes, desk }));
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
      const earned = PLAY_COINS + res.reduce((s, x) => s + (x.rank ? RANK_COINS[x.rank - 1] : 0), 0);
      gain(p, xp, "picks"); p.bricks += earned;
      p.stats.bestStreak = Math.max(p.stats.bestStreak ?? 0, p.streak);
      p.results.unshift({ round: r, picks: res, xp, coins: earned, parts, at: Date.now() }); p.results = p.results.slice(0, 30);
      checkAchievements(p);
      // a friend you invited has now played a whole day: your referral reward
      if (p.referredBy && !p.refPaid) {
        const ref = this.players.get(p.referredBy);
        if (ref) { p.refPaid = true; ref.bricks += REFERRAL.refBricks; ref.chests[REFERRAL.refChest]++; stat(ref, "referrals"); note(ref, "ref", `${p.name} played their first day: +${REFERRAL.refBricks} bricks and a ${REFERRAL.refChest} chest`); checkAchievements(ref); this.host.notify?.(ref.addr, { title: "Your friend is playing", body: `${p.name} played their first day of Trenchies. You got ${REFERRAL.refBricks} bricks and a ${REFERRAL.refChest} chest.`, url: `${this.host.site ?? ""}/trenchies/play`, tag: "trenchies-ref" }); }
      }
    }
    rd.settled = { at: Date.now(), coins, players: n };
    this.save();
    this.host.log(`Trenchies: round ${roundLabel(r)} settled (${n} players, top: ${coins.slice(0, 3).map((c) => `$${c.symbol} ${c.pct?.toFixed(1)}%`).join(", ")})`);
  }

  private pub(p: Player) {
    return { name: p.name, nft: p.nft, level: levelOf(p.xp), xp: p.xp, streak: p.streak, hits: p.hits, wins: p.wins, hatTricks: p.hatTricks, rounds: p.rounds, items: p.items, house: p.house, vehicle: p.vehicle, x: p.x?.handle ?? null, createdAt: p.createdAt, wear: p.wear, layout: p.layout, paint: p.paint, place: p.place, isOpen: !!p.open };
  }
  private me(p: Player, now: number) {
    const open = roundOf(now) + 1, live = roundOf(now), last = live - 1;
    const st = this.standings(live, now);
    return {
      ...this.pub(p), bricks: p.bricks, held: p.held,
      desk: { streak: p.desk.streak, best: p.desk.best, paidLeft: Math.max(0, DESK.paidPerDay - (p.desk.day === roundOf(now) ? p.desk.paid : 0)) },
      requests: p.requests.length, lands: [...this.players.values()].filter((h) => h.members.includes(p.addr)).map((h) => this.mini(h)),
      ...this.progress(p, now),
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
    if (op === "public") {
      const v = this.byName(q.get("name"));
      if (!v) { send(404, { error: "No Trenchie by that name." }); return true; }
      res.setHeader("cache-control", "public, max-age=60");
      send(200, { player: this.showcase(v) });
      return true;
    }

    const addr = this.who(b.token ?? q.get("token"));
    if (!addr || !this.allowed(addr)) { send(401, { error: "Sign in again." }); return true; }
    const p = this.players.get(addr) ?? null;

    if (op === "state") { if (p) { p.lastSeen = Date.now(); ensureQuests(p, roundOf(now)); } send(200, { me: p ? this.me(p, now) : null, now }); return true; }

    if (op === "spawn") {
      const nft = Number(b.nft), name = String(b.name ?? "").trim();
      if (!Number.isInteger(nft) || nft < 1 || nft > 2000) { send(400, { error: "Pick one of your Trenchers." }); return true; }
      if (!NAME.test(name)) { send(400, { error: "Names are 3 to 16 letters, numbers or _." }); return true; }
      const taken = [...this.players.values()].find((x) => x.name.toLowerCase() === name.toLowerCase() && x.addr !== addr);
      if (taken) { send(409, { error: "That name is taken. Try another." }); return true; }
      if (!(await this.holds(addr, nft))) { send(403, { error: `This wallet doesn't hold Trencher #${nft}.` }); return true; }
      if (p) { p.nft = nft; p.name = name; p.held = true; }
      else {
        const np: Player = { addr, name, nft, held: true, createdAt: Date.now(), xp: 0, bricks: 0, streak: 0, lastRound: null, hits: 0, wins: 0, hatTricks: 0, rounds: 0, items: ["shack", "bike"], house: "shack", vehicle: "bike", next: {}, members: [], requests: [], results: [], seen: null, desk: { streak: 0, best: 0, day: -1, paid: 0, log: [] }, layout: {}, paint: {}, place: {},
          ...emptyProgress(), visited: { day: -1, lands: [] }, cheered: { day: -1, lands: [] }, notified: {}, lastSeen: Date.now() };
        // invited by a friend (their Trenchie name): you both get bricks now, they get a chest once you've played a day
        const ref = this.byName(b.ref);
        if (ref && ref.addr !== addr) { np.referredBy = ref.addr; np.bricks += REFERRAL.newBricks; np.chests.common++; note(np, "ref", `Invited by ${ref.name}: +${REFERRAL.newBricks} bricks and a common chest`); }
        this.players.set(addr, np);
      }
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
      bump(p, roundOf(now), "pick");
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
        if (p.bricks < it.cost) { send(400, { error: `You need ${it.cost - p.bricks} more coins.` }); return true; }
        if (it.needsAch && !p.achievements.includes(it.needsAch)) { send(400, { error: `This one is only for "${ACHIEVEMENTS.find((a) => a.id === it.needsAch)?.name ?? it.needsAch}".` }); return true; }
        if (it.needsHouse !== undefined && HOUSE_ORDER.indexOf(p.house) < it.needsHouse) { send(400, { error: `This needs the ${item(HOUSE_ORDER[it.needsHouse])?.name} or bigger.` }); return true; }
        if (it.needs && !p.items.includes(it.needs)) { send(400, { error: `This needs the ${item(it.needs)?.name} first.` }); return true; }
        p.bricks -= it.cost; p.items.push(it.id);
        bump(p, roundOf(now), "build"); checkAchievements(p);
      } else if (!p.items.includes(it.id)) { send(400, { error: "Buy it first." }); return true; }
      if (it.kind === "house") p.house = it.id;
      if (it.kind === "vehicle") p.vehicle = it.id;
      this.save();
      send(200, { me: this.me(p, now) });
      return true;
    }
    if (op === "gather") { send(410, { error: "Gathering is gone: try the trading desk." }); return true; }
    if (op === "desk") { send(200, this.deskView(p, Number(q.get("since") ?? 0))); return true; }
    if (op === "desk/call") {
      const call = String(b.call ?? "") as Call; if (call !== "up" && call !== "down") { send(400, { error: "Call up or down." }); return true; }
      if (!this.host.btc?.latest) { send(503, { error: "The price feed is starting. Try again in a moment." }); return true; }
      const r = deskRound(now) + 1, rd = this.deskRound(r), first = !rd.calls[p.addr];
      rd.calls[p.addr] = call; if (first) bump(p, roundOf(now), "desk");
      this.save(); send(200, this.deskView(p, Number(b.since ?? 0))); return true;
    }
    if (op === "layout") {
      const room = String(b.room ?? ""), slot = String(b.slot ?? ""), S = ROOM_SLOTS[slot];
      if (!p.items.includes(room) || item(room)?.site !== "house") { send(400, { error: "Build that room first." }); return true; }
      if (!S) { send(400, { error: "Unknown spot." }); return true; }
      const cur = roomLayout(p.items, p.layout), from = cur[room], other = Object.keys(cur).find((r) => cur[r] === slot);
      const next = { ...cur, [room]: slot }; if (other && other !== room && from) next[other] = from;
      const used = new Set(Object.values(next));
      for (const sl of used) { const x = ROOM_SLOTS[sl]; if (x.behind && !used.has(x.behind)) { send(400, { error: "A room in the front row needs a room behind it." }); return true; } }
      const check = roomLayout(p.items, next); if (check[room] !== slot) { send(400, { error: "That spot doesn't work for this room." }); return true; }
      p.layout = next; this.save(); send(200, { me: this.me(p, now) }); return true;
    }
    if (op === "paint") {
      const room = String(b.room ?? ""), wall = b.wall === undefined ? undefined : Number(b.wall), floor = b.floor === undefined ? undefined : Number(b.floor);
      if (room !== "core" && (!p.items.includes(room) || item(room)?.site !== "house")) { send(400, { error: "Build that room first." }); return true; }
      if ((wall !== undefined && !(wall >= 0 && wall < PAINTS.length)) || (floor !== undefined && !(floor >= 0 && floor < FLOORS.length))) { send(400, { error: "Unknown colour." }); return true; }
      if (p.bricks < PAINT_COST) { send(400, { error: `Paint costs ${PAINT_COST} coins.` }); return true; }
      p.bricks -= PAINT_COST; p.paint[room] = { ...p.paint[room], ...(wall !== undefined ? { wall } : {}), ...(floor !== undefined ? { floor } : {}) };
      this.save(); send(200, { me: this.me(p, now) }); return true;
    }
    if (op === "place") {
      const id = String(b.id ?? ""), it = item(id);
      if (!it || !p.items.includes(id) || (it.kind !== "outdoor" && it.kind !== "statue")) { send(400, { error: "You can move garden things you own." }); return true; }
      if (b.x === null) delete p.place[id];
      else { const x = Number(b.x), y = Number(b.y); if (!(x >= 12 && x <= 42.4 && y >= 12 && y <= 42.4)) { send(400, { error: "Put it inside your garden." }); return true; } p.place[id] = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }; }
      this.save(); send(200, { me: this.me(p, now) }); return true;
    }
    if (op === "leaderboard") {
      const kind = q.get("kind") ?? "xp", score = (x: Player) => kind === "desk" ? (x.stats.deskWins ?? 0) : kind === "value" ? landValue(x.items) : kind === "cheers" ? (x.stats.cheersGot ?? 0) : kind === "bugs" ? Object.values(x.bugs).reduce((s, n) => s + n, 0) : x.xp;
      const all = [...this.players.values()].sort((x, y) => score(y) - score(x) || y.xp - x.xp);
      send(200, { kind, players: all.slice(0, 100).map((x, i) => ({ rank: i + 1, ...this.pub(x), score: score(x) })), me: all.findIndex((x) => x.addr === addr) + 1 });
      return true;
    }
    if (op === "daily") {
      const r = claimDaily(p, roundOf(now));
      if (!r) { send(400, { error: "Already claimed today. Come back tomorrow." }); return true; }
      this.save(); send(200, { me: this.me(p, now), reward: r }); return true;
    }
    if (op === "chest") {
      const tier = String(b.tier ?? "") as ChestTier;
      if (!["common", "rare", "epic"].includes(tier)) { send(400, { error: "Which chest?" }); return true; }
      const got = openChest(p, tier);
      if (!got) { send(400, { error: "You don't have one of those." }); return true; }
      bump(p, roundOf(now), "chest"); this.save(); send(200, { me: this.me(p, now), got }); return true;
    }
    if (op === "net") {
      const r = swingNet(p as Progress & { next: Partial<Record<string, number>> }, Date.now());
      if ("error" in r) { send(400, { error: r.error, next: r.next }); return true; }
      bump(p, roundOf(now), "net"); this.save(); send(200, { me: this.me(p, now), got: r.got, xp: r.xp }); return true;
    }
    if (op === "wear") {
      const slot = String(b.slot ?? "") as Slot, id = b.id === null || b.id === "" ? null : String(b.id ?? "");
      if (!["hat", "eyes", "neck", "back", "aura", "outline", "trail"].includes(slot)) { send(400, { error: "Unknown slot." }); return true; }
      if (id !== null && (cosmetic(id)?.slot !== slot || !canWear(p, id))) { send(400, { error: "You don't have that yet." }); return true; }
      if (id === null) delete p.wear[slot]; else p.wear[slot] = id;
      bump(p, roundOf(now), "wear"); this.save(); send(200, { me: this.me(p, now) }); return true;
    }
    if (op === "cosmetic/buy") {
      const err = buyCosmetic(p, String(b.id ?? "")); if (err) { send(400, { error: err }); return true; }
      this.save(); send(200, { me: this.me(p, now) }); return true;
    }
    if (op === "cheer") {
      const h = this.byName(b.name); if (!h || h.addr === p.addr) { send(400, { error: "Cheer someone else's land." }); return true; }
      const today = roundOf(now); if (p.cheered.day !== today) p.cheered = { day: today, lands: [] };
      if (p.cheered.lands.includes(h.addr)) { send(400, { error: "You already cheered this land today." }); return true; }
      p.cheered.lands.push(h.addr);
      if (p.cheered.lands.length <= CHEER.perDay) gain(p, CHEER.xp, "cheer");
      stat(p, "cheersGiven"); h.bricks += CHEER.ownerBricks; stat(h, "cheersGot");
      note(h, "cheer", `${p.name} cheered your land (+${CHEER.ownerBricks} coins)`);
      bump(p, today, "cheer"); checkAchievements(p); checkAchievements(h);
      this.save(); send(200, { me: this.me(p, now), cheers: h.stats.cheersGot ?? 0 }); return true;
    }
    if (op === "shared") { bump(p, roundOf(now), "share"); this.save(); send(200, { me: this.me(p, now) }); return true; }
    if (op === "inbox/seen") { const upTo = Number(b.id) || 0; p.inbox = p.inbox.filter((x) => x.id > upTo); this.save(); send(200, { ok: true }); return true; }
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
      if (first) gain(p, X_XP, "x");
      this.save();
      send(200, { me: this.me(p, now), bonus: first ? X_XP : 0 });
      return true;
    }
    send(404, { error: "not found" });
    return true;
  }

  // ------------------------------------------------------------------ progression read-outs

  private progress(p: Player, now: number) {
    const today = roundOf(now), qs = ensureQuests(p, today);
    return {
      daily: dailyState(p, today),
      quests: { list: qs.list.map((x) => ({ ...x, ...QUESTS.find((d) => d.id === x.id)! })), bonus: qs.bonus },
      chests: p.chests, bugs: p.bugs, achievements: p.achievements, achievementCount: ACHIEVEMENTS.length,
      stats: { ...p.stats, owned: p.items.length }, wardrobe: COSMETICS.filter((c) => canWear(p, c.id)).map((c) => c.id), wear: p.wear,
      inbox: p.inbox, netAt: p.next.net ?? 0, landValue: landValue(p.items), cheers: p.stats.cheersGot ?? 0,
      cheeredToday: p.cheered.day === today ? p.cheered.lands.length : 0,
    };
  }
  /** What anyone may see of a land (the public page and its share card). */
  private showcase(v: Player) {
    const all = [...this.players.values()].sort((x, y) => y.xp - x.xp);
    return { ...this.pub(v), wear: v.wear, landValue: landValue(v.items), cheers: v.stats.cheersGot ?? 0, rank: all.findIndex((x) => x.addr === v.addr) + 1, players: all.length, achievements: v.achievements.length, species: Object.keys(v.bugs).length, members: v.members.length };
  }
  /** Opening someone else's land: counts once per land per day (quests, the Explorer achievement, their visitor count). */
  private visit(p: Player, h: Player) {
    const today = roundOf(Date.now() / 1000);
    if (p.visited.day !== today) p.visited = { day: today, lands: [] };
    if (p.visited.lands.includes(h.addr)) return;
    p.visited.lands.push(h.addr); stat(p, "visits"); stat(h, "visitors");
    bump(p, today, "visit"); checkAchievements(p);
  }
  /**
   * Phone reminders (only for players who turned notifications on, at most one every 2 hours each):
   * picks closing within 2 hours, and the daily reward waiting.
   */
  remind(now = Date.now() / 1000) {
    if (!this.host.notify) return;
    const today = roundOf(now), open = today + 1, lockIn = roundStart(open) - now, hour = new Date(now * 1000).getUTCHours(), url = `${this.host.site ?? ""}/trenchies/play`;
    let changed = false;
    for (const p of this.players.values()) {
      if (Date.now() - p.lastSeen > 14 * DAY * 1000) continue; // gone quiet: leave them be
      if ((p.notified.lastAt ?? 0) > Date.now() - 2 * 3600_000) continue;
      let msg: { title: string; body: string; tag: string } | null = null;
      if (lockIn < 2 * 3600 && !(this.rounds.get(open)?.picks[p.addr]) && p.notified.picks !== open) { msg = { title: "Picks close soon", body: `Lock in your 3 picks for tomorrow: ${Math.max(1, Math.round(lockIn / 60))} minutes left.`, tag: "trenchies-picks" }; p.notified.picks = open; }
      else if (hour >= 8 && p.daily.last !== today && p.notified.daily !== today) { msg = { title: "Your daily reward is waiting", body: `Day ${dailyState(p, today).day + 1} of 7. Don't break the run.`, tag: "trenchies-daily" }; p.notified.daily = today; }
      if (msg) { p.notified.lastAt = Date.now(); changed = true; this.host.notify(p.addr, { ...msg, url }); }
    }
    if (changed) this.save();
  }

  // ------------------------------------------------------------------ the trading desk (Bitcoin, 5-minute rounds)

  private deskRound(r: number) { let x = this.desk.get(r); if (!x) this.desk.set(r, (x = { calls: {} })); return x; }
  private crowd(rd: DeskRound | undefined) { const v = Object.values(rd?.calls ?? {}); return { up: v.filter((c) => c === "up").length, down: v.filter((c) => c === "down").length }; }
  /** The desk as one player sees it: live price and chart, the running round, the next one (calls open), recent results. */
  private deskView(p: Player, since: number) {
    const now = Date.now() / 1000, cur = deskRound(now), btc = this.host.btc, from = since > 0 ? Math.max(since + 1, now - 300) : now - 1800; // first load: the last 30 minutes
    const live = this.desk.get(cur), next = this.desk.get(cur + 1);
    const start = cur * DESK.round, open = btc?.priceAt(start) ?? null;
    return {
      now, price: btc?.latest?.price ?? null, feed: btc?.view().source ?? "off", series: btc ? btc.series(from, now) : [],
      live: { round: cur, start, end: start + DESK.round, open, call: live?.calls[p.addr] ?? null, crowd: this.crowd(live) },
      next: { round: cur + 1, start: start + DESK.round, call: next?.calls[p.addr] ?? null, crowd: this.crowd(next) },
      streak: p.desk.streak, best: p.desk.best, paidLeft: Math.max(0, DESK.paidPerDay - (p.desk.day === roundOf(now) ? p.desk.paid : 0)),
      log: p.desk.log.slice(-30).reverse(),
      top: this.deskBoard(),
    };
  }
  private deskBoardCache: { at: number; list: unknown[] } | null = null;
  private deskBoard() {
    if (this.deskBoardCache && Date.now() - this.deskBoardCache.at < 30_000) return this.deskBoardCache.list;
    const list = [...this.players.values()].filter((x) => (x.stats.deskWins ?? 0) > 0).sort((a, b) => (b.stats.deskWins ?? 0) - (a.stats.deskWins ?? 0) || b.desk.best - a.desk.best).slice(0, 10)
      .map((x, i) => ({ rank: i + 1, ...this.mini(x), wins: x.stats.deskWins ?? 0, calls: x.stats.calls ?? 0, best: x.desk.best }));
    this.deskBoardCache = { at: Date.now(), list }; return list;
  }
  /** Every few seconds: settles desk rounds that have ended (once the price two seconds after the close is in). */
  deskTick(now = Date.now() / 1000) {
    const btc = this.host.btc; if (!btc) return;
    let changed = false;
    for (const [r, rd] of this.desk) {
      if (rd.done || (r + 1) * DESK.round > now - 2) continue;
      rd.open = btc.priceAt(r * DESK.round); rd.close = btc.priceAt((r + 1) * DESK.round); rd.done = true; changed = true;
      const cr = this.crowd(rd), today = roundOf(now);
      const result: "up" | "down" | "flat" | "void" = rd.open === null || rd.close === null ? "void" : rd.close > rd.open ? "up" : rd.close < rd.open ? "down" : "flat";
      for (const [addr, call] of Object.entries(rd.calls)) {
        const p = this.players.get(addr); if (!p) continue;
        if (p.desk.day !== today) p.desk = { ...p.desk, day: today, paid: 0 };
        const paid = p.desk.paid < DESK.paidPerDay; if (result !== "void") p.desk.paid++;
        let xp = 0, coins = 0, crowd = false, res: DeskLog["result"];
        if (result === "void") res = "void";
        else if (result === "flat") { res = "push"; xp = paid ? DESK.play.xp : 0; }
        else if (call === result) {
          res = "win"; p.desk.streak++; p.desk.best = Math.max(p.desk.best, p.desk.streak);
          const st = Math.min(DESK.streak.max, p.desk.streak - 1); crowd = (call === "up" ? cr.up : cr.down) < (call === "up" ? cr.down : cr.up);
          if (paid) { xp = DESK.win.xp + st * DESK.streak.xp + (crowd ? DESK.crowd.xp : 0); coins = DESK.win.coins + st * DESK.streak.coins + (crowd ? DESK.crowd.coins : 0); } else xp = 1;
          stat(p, "deskWins"); if (crowd) { stat(p, "crowdWins"); bump(p, today, "crowd"); } bump(p, today, "deskwin");
          p.stats.deskStreak = Math.max(p.stats.deskStreak ?? 0, p.desk.streak);
        } else { res = "loss"; p.desk.streak = 0; xp = paid ? DESK.play.xp : 0; }
        if (res !== "void") stat(p, "calls");
        if (xp) gain(p, xp, "desk"); p.bricks += coins;
        p.desk.log = [...p.desk.log.slice(-29), { r, call, result: res, open: rd.open ?? null, close: rd.close ?? null, xp, coins, crowd }];
        checkAchievements(p);
      }
    }
    // forget old rounds (keep two days)
    for (const r of this.desk.keys()) if (r < deskRound(now) - 600) this.desk.delete(r);
    if (changed) { this.deskBoardCache = null; this.save(); }
  }

  // ------------------------------------------------------------------ lands: join requests, members, chat

  private mini(p: Player) { return { name: p.name, nft: p.nft, level: levelOf(p.xp), x: p.x?.handle ?? null, wear: p.wear }; }
  private byName(n: unknown) { const s = String(n ?? "").trim().toLowerCase(); return [...this.players.values()].find((x) => x.name.toLowerCase() === s) ?? null; }
  private land(op: string, p: Player, b: Record<string, unknown>, q: URLSearchParams, send: (c: number, x: unknown) => void) {
    const h = this.byName(b.name ?? q.get("name"));
    if (!h) { send(404, { error: "No Trenchie by that name." }); return true; }
    const own = h.addr === p.addr, member = h.members.includes(p.addr) || !!h.open;
    const out = () => {
      const here = this.presence.get(h.addr) ?? new Map<string, number>(), t = Date.now();
      return {
        open: !!h.open, land: { ...this.pub(h), last: h.results[0] ?? null }, role: own ? "owner" : member ? "member" : h.requests.some((r) => r.addr === p.addr) ? "pending" : "visitor",
        members: h.members.map((a) => this.players.get(a)).filter((x): x is Player => !!x).map((x) => this.mini(x)),
        present: [...here.keys()].filter((a) => a !== h.addr && (here.get(a) ?? 0) > t - HERE && (h.open || h.members.includes(a))).map((a) => this.players.get(a)).filter((x): x is Player => !!x).map((x) => this.mini(x)),
        ownerHere: (here.get(h.addr) ?? 0) > t - HERE,
        chat: (this.chats.get(h.addr) ?? []).slice(-60),
        requests: own ? h.requests.map((r) => { const x = this.players.get(r.addr); return x ? { ...this.mini(x), at: r.at } : null; }).filter(Boolean) : undefined,
      };
    };
    if (op === "land") {
      if (!own) this.visit(p, h);
      if (own || member) { let m = this.presence.get(h.addr); if (!m) this.presence.set(h.addr, (m = new Map())); m.set(p.addr, Date.now()); }
      send(200, out()); return true;
    }
    if (op === "land/open") {
      if (!own) { send(403, { error: "Only the owner can change this." }); return true; }
      h.open = b.open === true; this.post(h, { by: "", nft: 0, text: h.open ? "This land is now public: anyone can walk in" : "This land is now private: members only" });
      this.save(); send(200, out()); return true;
    }
    if (op === "land/request") {
      if (own || member) { send(400, { error: h.open ? "This land is public: walk right in." : "You're already on this land." }); return true; }
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
        h.members.push(who.addr); stat(who, "joined"); checkAchievements(who);
        this.post(h, { by: "", nft: 0, text: `${who.name} joined the land` });
        this.host.notify?.(who.addr, { title: "You're in", body: `${h.name} let you join their land in Trenchies.`, url: `${this.host.site ?? ""}/trenchies/play`, tag: "trenchies-join" });
      }
      this.save(); send(200, out()); return true;
    }
    if (op === "land/leave") {
      const who = own ? this.byName(b.who) : p;
      if (!who || who.addr === h.addr || (!h.members.includes(who.addr) && !h.open)) { send(400, { error: "Not a member." }); return true; }
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
      bump(p, roundOf(Date.now() / 1000), "chat");
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
    for (const x of top) { stat(x.p, "podiums"); checkAchievements(x.p); note(x.p, "ach", `Top ${PRIZE_SPLIT.length} this week: the Champion Trophy is yours to place`); }
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
