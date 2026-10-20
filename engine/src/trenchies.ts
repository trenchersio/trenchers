import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getAddress, isAddress, verifyMessage, type Address, type PublicClient } from "viem";
import { NFT_OWNER_ABI } from "./abis";
import type { Backtest } from "./backtest";
import { DAY, GATHER, HAT_TRICK_XP, HOUSE_ORDER, ITEMS, PICKS, PLAY_XP, RANK_XP, RENAMED, X_XP, item, levelOf, roundLabel, roundOf, roundStart, streakXp, type Resource } from "./trenchies-catalog";

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
  wood: number; stone: number; next: Partial<Record<Resource, number>>;
  x?: { handle: string; at: number }; xPending?: { handle: string; code: string; at: number };
  results: Result[]; seen: number | null;
};
type Settled = { at: number; coins: { token: Address; symbol: string; pct: number | null }[]; players: number };
type Round = { picks: Record<string, Address[]>; settled?: Settled };
type Host = { pub: PublicClient; nft: Address; prices: Backtest; symbolOf: (t: Address) => Promise<string>; log: (m: string) => void };

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const FILE = clean(process.env.TRENCHIES_FILE) || `${dirname(clean(process.env.CHAT_FILE) || "./chat.json")}/trenchies.json`;
const SECRET = clean(process.env.TRENCHIES_SECRET) || clean(process.env.CHAT_SECRET) || randomBytes(32).toString("hex");
const ALLOW = new Set((clean(process.env.TRENCHIES_ALLOW) || clean(process.env.CHAT_ADMINS) || "0x447D8F97c39df3d6FCAB8a02A54986283e818210").split(/[\s,]+/).filter((a) => isAddress(a)).map((a) => a.toLowerCase()));
const OPEN = () => clean(process.env.TRENCHIES_OPEN) === "1";
const NAME = /^[A-Za-z0-9_]{3,16}$/;
const lc = (a: string) => a.toLowerCase() as Address;

export class Trenchies {
  private players = new Map<string, Player>();
  private rounds = new Map<number, Round>();
  private coinCache: { at: number; list: unknown[] } | null = null;
  status = "ok";

  constructor(private host: Host) {
    try {
      if (existsSync(FILE)) {
        const j = JSON.parse(readFileSync(FILE, "utf8")) as { players: Player[]; rounds: [number, Round][] };
        for (const p of j.players ?? []) {
          p.wood ??= 0; p.stone ??= 0; p.next ??= {};
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
      writeFileSync(`${FILE}.tmp`, JSON.stringify({ players: [...this.players.values()], rounds: keep }));
      renameSync(`${FILE}.tmp`, FILE);
    } catch { /* keep in memory */ }
  }
  view() { return { players: this.players.size, rounds: this.rounds.size, invite: OPEN() ? "open to holders" : `${ALLOW.size} wallet(s)`, status: this.status }; }

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
      ...this.pub(p), bricks: p.bricks, held: p.held, wood: p.wood, stone: p.stone, next: { wood: p.next.wood ?? 0, stone: p.next.stone ?? 0 }, xPending: p.xPending ? { handle: p.xPending.handle, code: p.xPending.code } : null,
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
      else this.players.set(addr, { addr, name, nft, held: true, createdAt: Date.now(), xp: 0, bricks: 0, streak: 0, lastRound: null, hits: 0, wins: 0, hatTricks: 0, rounds: 0, items: ["shack", "bike"], house: "shack", vehicle: "bike", wood: 0, stone: 0, next: {}, results: [], seen: null });
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
      p[res] += got; p.xp += g.xp; p.bricks += g.xp; p.next[res] = Date.now() + g.every * 1000;
      this.save();
      send(200, { me: this.me(p, now), got, res, xp: g.xp });
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

  /** What other players picked most for the open round (a hint, without who). */
  private popular(r: number) {
    const rd = this.rounds.get(r); if (!rd) return [];
    const n = new Map<string, number>();
    for (const ps of Object.values(rd.picks)) for (const t of ps) n.set(t, (n.get(t) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([token, count]) => ({ token, symbol: this.host.prices.symbolOf(token as Address) ?? token.slice(2, 8), count }));
  }
}

export { ITEMS };
