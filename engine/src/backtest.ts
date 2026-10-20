import type { IncomingMessage, ServerResponse } from "node:http";
import { formatEther, type Address, type Log, type PublicClient } from "viem";
import { CURVE_BUY, CURVE_SELL } from "./abis";
import { Span, rateLimited } from "./rpc";
import { parse, describe, validate, type CustomRule } from "./custom-strategy";

/**
 * "Test this rule on last week": replays a rule against the last 7 days of Pons coins.
 *
 * Data: every Pons coin's curve trades (price, volume, dev sells), kept in memory for coins launched in the last
 * 8 days. Read a few times a day in large block windows (one log read plus one block read per window), so it costs
 * a handful of chain reads, not a stream. Nothing is stored on disk; after a restart the week is read again once.
 *
 * The replay is an estimate: entry at the first trade price after the signal, exit at the first trade price that
 * reaches the take profit / stop loss / hold time, 1% fee each way, at most 6 open positions, one buy per coin.
 * Coins that graduate move to Uniswap, so a position still open then is valued at its last curve price.
 */
type Tok = { token: Address; deployer: Address; launchedAt: number; symbol?: string; supply?: bigint; graduated: boolean };
export type Host = { pub: PublicClient; curves: Map<Address, Address>; tokens: Map<Address, Tok>; log: (m: string) => void; ethUsd: number; snipeWait: number; maxPositions: number; maxHold: number };
type Series = { pts: number[]; vol: number }; // pts: t, price (ETH per coin), lifetime volume (ETH), dev sell (1/0), repeated

const DAY = 86400, KEEP = 8 * DAY, WINDOW = 7 * DAY, FEE = 0.01, MAX_PTS = 4 * 6000;
const lc = (a: string) => a.toLowerCase() as Address;

export type TradeOut = { symbol: string; token: Address; in: number; out: number; pct: number; why: string; open: boolean };
export type Result = {
  ok: true; rule: string; understood: string[]; from: number; to: number; coins: number;
  trades: number; wins: number; losses: number; open: number; winRate: number; avgPct: number; pnlEth: number; size: number;
  best: TradeOut | null; worst: TradeOut | null; sample: TradeOut[]; notes: string[];
} | { ok: false; error: string };

export class Backtest {
  private series = new Map<Address, Series>();
  private cursor = 0n;
  private span = new Span(50_000n);
  private running = false;
  updatedAt = 0;
  status = "waiting for the engine to start";
  private cache = new Map<string, { at: number; r: Result }>();

  constructor(private host: Host) {}

  /** Reads curve trades since the last read (the last 8 days on the first run). */
  async update() {
    if (this.running) return; this.running = true;
    try {
      const { pub } = this.host;
      const head = await pub.getBlockNumber();
      const headT = Number((await pub.getBlock({ blockNumber: head })).timestamp);
      if (this.cursor === 0n) {
        // How many blocks 8 days is on this chain, from one block 50,000 back.
        const back = head > 50_000n ? 50_000n : head;
        const oldT = Number((await pub.getBlock({ blockNumber: head - back })).timestamp);
        const perSec = Number(back) / Math.max(1, headT - oldT);
        const n = BigInt(Math.ceil(perSec * KEEP));
        this.cursor = head > n ? head - n : 0n;
      }
      let from = this.cursor + 1n, fromT: number | null = null, reads = 0;
      while (from <= head) {
        const to = from + this.span.size - 1n < head ? from + this.span.size - 1n : head;
        let logs: Log[];
        try { logs = (await pub.getLogs({ events: [CURVE_BUY, CURVE_SELL], fromBlock: from, toBlock: to })) as Log[]; reads++; }
        catch (e) { if (rateLimited(e)) throw e; this.span.fail(e); continue; }
        this.span.ok(logs.length);
        const ta = fromT ?? Number((await pub.getBlock({ blockNumber: from })).timestamp);
        const tb = to === head ? headT : Number((await pub.getBlock({ blockNumber: to })).timestamp);
        const time = (b: bigint) => (to === from ? ta : Math.round(ta + ((tb - ta) * Number(b - from)) / Number(to - from)));
        logs.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || a.logIndex! - b.logIndex!);
        for (const l of logs) this.add(l, time(l.blockNumber!));
        this.cursor = to; from = to + 1n; fromT = tb;
      }
      // Forget trades older than 8 days (keeping the last one before, as the starting price), and quiet coins.
      const cut = headT - KEEP;
      for (const [k, sr] of this.series) {
        const P = sr.pts; let i = 0;
        while (i + 4 < P.length && P[i + 4] < cut) i += 4;
        if (i) P.splice(0, i);
        if (!P.length || P[P.length - 4] < cut) this.series.delete(k);
      }
      this.updatedAt = headT; this.cache.clear();
      this.status = `ok: ${this.series.size} coins from the last 8 days (${reads} reads this update)`;
    } catch (e) {
      this.status = `update failed, retrying later: ${(e as Error).message.split("\n")[0].slice(0, 120)}`;
    } finally { this.running = false; }
  }

  private add(l: Log, t: number) {
    const token = this.host.curves.get(lc(l.address)); if (!token) return;
    const tk = this.host.tokens.get(token); if (!tk) return;
    const a = (l as unknown as { eventName: string; args: Record<string, bigint | string> });
    const buy = a.eventName === "CurveBuy";
    const eth = Number(formatEther((buy ? a.args.quoteIn : a.args.quoteOut) as bigint));
    const units = Number(formatEther((buy ? a.args.tokensOut : a.args.tokensIn) as bigint));
    const cut = Number(formatEther((a.args.fee as bigint) + (a.args.tax as bigint)));
    const net = buy ? Math.max(0, eth - cut) : eth + cut;
    if (!(units > 0 && net > 0)) return;
    let s = this.series.get(token); if (!s) this.series.set(token, (s = { pts: [], vol: 0 }));
    s.vol += eth;
    const dev = !buy && lc(a.args.seller as string) === tk.deployer ? 1 : 0;
    // Very busy coins: keep the latest 6,000 trades (older ones go first).
    if (s.pts.length >= MAX_PTS) s.pts.splice(0, 4 * 1000);
    s.pts.push(t, net / units, s.vol, dev);
  }

  /** The coin's price at time t: its last trade at or before t, or its first trade after t (a coin launched later). */
  priceAt(token: Address, t: number): number | null {
    const P = this.series.get(token)?.pts; if (!P?.length) return null;
    let best: number | null = null;
    for (let i = 0; i < P.length; i += 4) { if (P[i] <= t) best = P[i + 1]; else { if (best === null) best = P[i + 1]; break; } }
    return best;
  }
  /** Coins that traded since `since`: price now, change and volume since then. For the Trenchies daily picks. */
  active(since: number, limit = 80) {
    const out: { token: Address; symbol: string; price: number; changePct: number; volEth: number; trades: number; launchedAt: number; graduated: boolean }[] = [];
    for (const [token, sr] of this.series) {
      const P = sr.pts; if (!P.length || P[P.length - 4] < since) continue;
      const tk = this.host.tokens.get(token); if (!tk || tk.graduated) continue;
      let first = -1, trades = 0, vol0 = 0;
      for (let i = 0; i < P.length; i += 4) if (P[i] >= since) { if (first < 0) { first = i; vol0 = i ? P[i - 2] : 0; } trades++; }
      const start = first > 0 ? P[first - 3] : P[1], now = P[P.length - 3];
      out.push({ token, symbol: tk.symbol ?? token.slice(2, 8).toUpperCase(), price: now, changePct: start > 0 ? (now / start - 1) * 100 : 0, volEth: sr.vol - vol0, trades, launchedAt: tk.launchedAt, graduated: tk.graduated });
    }
    return out.sort((a, b) => b.volEth - a.volEth).slice(0, limit);
  }
  symbolOf(token: Address) { const tk = this.host.tokens.get(token); return tk ? tk.symbol ?? token.slice(2, 8).toUpperCase() : null; }
  known(token: Address) { return this.host.tokens.has(token); }

  /** Replays `rule` over the last 7 days. `size`: ETH per trade, for the ETH result. */
  run(text: string, size = 0.01): Result {
    const p = parse(text);
    const r = p.rule;
    if (!text.trim() || p.missed) return { ok: false, error: "That rule couldn't be read. Write it like: Buy every new launch, take profit at 40%, stop loss 20%." };
    const bad = validate(r); if (bad) return { ok: false, error: bad };
    if (r.trigger === "graduation") return { ok: false, error: "Graduation rules can't be tested yet: once a coin graduates its trades move to Uniswap, which this test doesn't read." };
    if (r.trigger === "dexupdate") return { ok: false, error: "The DexScreener signal isn't supported yet." };
    if (r.trigger === "token") return { ok: false, error: "Plans for one specific coin aren't tested: there's nothing to compare them against." };
    if (r.trigger === "copy") return { ok: false, error: "To see how copying would have done, look at that agent's own trades in the Arena." };
    if (!this.updatedAt) return { ok: false, error: "The test data is still loading. Try again in a few minutes." };

    const now = this.updatedAt, from = now - WINDOW;
    const notes: string[] = [];
    if (r.minLiquidityEth) notes.push("The liquidity filter isn't applied in the test (past liquidity isn't stored).");
    // 1. When would the rule have bought each coin?
    type Entry = { token: Address; i: number; t: number };
    const entries: Entry[] = [];
    let coins = 0;
    for (const [token, s] of this.series) {
      const tk = this.host.tokens.get(token); if (!tk || tk.launchedAt < from) continue;
      coins++;
      const P = s.pts, n = P.length / 4;
      let i = -1;
      if (r.trigger === "launch") { for (let k = 0; k < n; k++) if (P[k * 4] >= tk.launchedAt + this.host.snipeWait) { i = k; break; } }
      else if (r.trigger === "volume") { const th = (r.threshold ?? 50_000) / this.host.ethUsd; for (let k = 0; k < n; k++) if (P[k * 4 + 2] >= th) { i = k; break; } }
      else if (r.trigger === "mcap") { const sup = tk.supply ? Number(formatEther(tk.supply)) : 1e9; for (let k = 0; k < n; k++) if (P[k * 4 + 1] * sup >= (r.threshold ?? 5)) { i = k; break; } }
      else if (r.trigger === "devsell") { for (let k = 0; k < n; k++) if (P[k * 4 + 3]) { i = Math.min(n - 1, k + 1); break; } }
      if (i < 0) continue;
      if (r.maxAgeMin && P[i * 4] - tk.launchedAt > r.maxAgeMin * 60) continue;
      entries.push({ token, i, t: P[i * 4] });
    }
    entries.sort((a, b) => a.t - b.t);
    // 2. Walk them in time order, at most `maxPositions` open at once.
    const trades: TradeOut[] = []; const openUntil: number[] = [];
    for (const e of entries) {
      for (let k = openUntil.length - 1; k >= 0; k--) if (openUntil[k] <= e.t) openUntil.splice(k, 1);
      if (openUntil.length >= this.host.maxPositions) continue;
      const P = this.series.get(e.token)!.pts, n = P.length / 4, entry = P[e.i * 4 + 1];
      let j = -1, why = "";
      for (let k = e.i + 1; k < n; k++) {
        const t = P[k * 4], px = P[k * 4 + 1], age = t - e.t, ch = (px / entry - 1) * 100;
        if (r.exit === "time" && age >= (r.holdSec ?? 60)) { j = k; why = "time"; break; }
        if (r.exit === "tpsl" && r.takeProfitPct && ch >= r.takeProfitPct) { j = k; why = "take profit"; break; }
        if (r.exit === "tpsl" && r.stopLossPct && ch <= -r.stopLossPct) { j = k; why = "stop loss"; break; }
        if (age >= this.host.maxHold) { j = k; why = "max hold"; break; }
      }
      // A time exit with no trade after it: the price hadn't moved, so it sells at the last price.
      const lastI = n - 1, lastT = P[lastI * 4];
      let open = false;
      if (j < 0) {
        if (r.exit === "time" && now - e.t >= (r.holdSec ?? 60)) { j = lastI; why = "time"; }
        else { j = lastI; open = true; why = "still open"; }
      }
      const exit = P[j * 4 + 1];
      const pct = ((exit * (1 - FEE)) / (entry * (1 + FEE)) - 1) * 100;
      const tk = this.host.tokens.get(e.token)!;
      trades.push({ symbol: tk.symbol ?? e.token.slice(2, 8).toUpperCase(), token: e.token, in: e.t, out: open ? now : P[j * 4], pct, why, open });
      openUntil.push(open ? Infinity : Math.max(P[j * 4], e.t + 1));
      void lastT;
    }
    const closed = trades.filter((x) => !x.open);
    const wins = closed.filter((x) => x.pct > 0).length;
    const all = trades.length ? trades.reduce((s, x) => s + x.pct, 0) / trades.length : 0;
    const sorted = [...trades].sort((a, b) => b.pct - a.pct);
    if (trades.some((x) => x.open)) notes.push("Positions still open at the end are valued at their last price.");
    return {
      ok: true, rule: describe(r), understood: p.understood, from, to: now, coins,
      trades: trades.length, wins, losses: closed.length - wins, open: trades.length - closed.length,
      winRate: closed.length ? Math.round((wins / closed.length) * 100) : 0, avgPct: +all.toFixed(2),
      pnlEth: +((trades.reduce((s, x) => s + x.pct, 0) / 100) * size).toFixed(6), size,
      best: sorted[0] ?? null, worst: sorted.at(-1) ?? null, sample: [...trades].sort((a, b) => b.in - a.in).slice(0, 12), notes,
    };
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path !== "/backtest") return false;
    const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    const text = (q.get("rule") ?? "").slice(0, 600), size = Math.min(10, Math.max(0.0001, Number(q.get("size")) || 0.01));
    const key = `${size}|${text.trim().toLowerCase()}`;
    let hit = this.cache.get(key);
    if (!hit || Date.now() - hit.at > 300_000) { hit = { at: Date.now(), r: this.run(text, size) }; this.cache.set(key, hit); if (this.cache.size > 500) this.cache.clear(); }
    res.setHeader("cache-control", "public, max-age=60");
    res.end(JSON.stringify(hit.r));
    return true;
  }
}

export type { CustomRule };
