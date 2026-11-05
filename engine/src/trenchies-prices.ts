import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address } from "viem";
import type { Backtest } from "./backtest";

/**
 * Prices for the Trenchies daily picks: Pons launchpad trades (the Backtest's curve prices) plus, once a coin has
 * graduated to Uniswap, its pool price. Graduated coins have no curve trades any more, so the pool is sampled instead:
 * every 10 minutes and again right after midnight UTC (when the day is settled), only for the coins that matter (picked
 * coins, $TRENCHERS, coins someone looked up). One read per coin per sample, so a few hundred reads a day at most.
 *
 * priceAt(t): the newest price at or before t from either source; a coin that graduated in the middle of a day
 * continues from its pool price, so its whole day counts.
 */
type Sample = [number, number]; // unix seconds, ETH per whole coin
const KEEP = 9 * 86_400, EVERY = 600, MAX_TRACK = 60;
const lc = (a: string) => a.toLowerCase() as Address;

export class PicksPrices {
  private samples = new Map<Address, Sample[]>();
  private track = new Map<Address, number>(); // token -> last time it mattered (picked or looked up)
  private sampledAt = 0;
  private busy = false;
  status = "starting";

  constructor(private base: Backtest, private spot: (t: Address) => Promise<number | null>, private graduated: (t: Address) => boolean, private pinned: Address[], private file: string, private log: (m: string) => void = () => {}) {
    try {
      if (existsSync(file)) {
        const j = JSON.parse(readFileSync(file, "utf8")) as { samples?: [Address, Sample[]][]; track?: [Address, number][]; sampledAt?: number };
        for (const [k, v] of j.samples ?? []) this.samples.set(k, v);
        for (const [k, v] of j.track ?? []) this.track.set(k, v);
        this.sampledAt = j.sampledAt ?? 0;
      }
    } catch { /* start empty */ }
    for (const t of pinned) this.track.set(lc(t), Number.MAX_SAFE_INTEGER);
  }
  private save() {
    try { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(`${this.file}.tmp`, JSON.stringify({ samples: [...this.samples], track: [...this.track], sampledAt: this.sampledAt })); renameSync(`${this.file}.tmp`, this.file); } catch { /* memory only */ }
  }

  /** Remember a coin (picked, or looked up) so its pool price is followed. */
  follow(token: Address) {
    token = lc(token); this.track.set(token, Math.max(this.track.get(token) ?? 0, Date.now() / 1000));
    if (this.track.size > MAX_TRACK) { const old = [...this.track].filter(([, t]) => t !== Number.MAX_SAFE_INTEGER).sort((a, b) => a[1] - b[1])[0]; if (old) this.track.delete(old[0]); }
  }

  /** Reads the pool price of every followed graduated coin (call it every minute; it samples every 10 and after midnight). */
  async tick(now = Date.now() / 1000) {
    if (this.busy) return;
    // every 10 minutes, plus once in the last 90 s before midnight UTC (the day's closing price) and once just after
    const day = Math.floor(now / 86_400) * 86_400, midnight = this.sampledAt < day && now >= day + 30;
    const closing = now >= day + 86_400 - 90 && now - this.sampledAt > 60;
    if (!midnight && !closing && now - this.sampledAt < EVERY) return;
    this.busy = true;
    try {
      let n = 0;
      for (const token of this.track.keys()) {
        if (!this.needsPool(token, now)) continue;
        const p = await this.spot(token).catch(() => null);
        if (p !== null && p > 0 && Number.isFinite(p)) { this.add(token, now, p); n++; }
      }
      // forget coins nobody has picked or looked up for 3 days (pinned ones stay), and old samples
      for (const [k, t] of this.track) if (t !== Number.MAX_SAFE_INTEGER && now - t > 3 * 86_400) this.track.delete(k);
      for (const [k, v] of this.samples) { const keep = v.filter(([t]) => now - t < KEEP); if (keep.length) this.samples.set(k, keep); else this.samples.delete(k); }
      this.sampledAt = now; this.status = `ok: ${n} graduated coin${n === 1 ? "" : "s"} priced from Uniswap`;
      this.save();
    } catch (e) { this.status = `last sample failed: ${(e as Error).message.split("\n")[0].slice(0, 120)}`; }
    finally { this.busy = false; }
  }
  /** Graduated, or quiet on its curve for an hour: the curve trades alone can't price it, so read it directly. */
  private needsPool(token: Address, now: number) { if (this.graduated(token)) return true; const last = this.base.info?.(token)?.lastTrade ?? null; return last === null || now - last > 3600; }
  add(token: Address, t: number, p: number) { const s = this.samples.get(token) ?? []; s.push([t, p]); this.samples.set(token, s); }

  /** Pool sample at or before t (newest), or null. */
  private sampleAt(token: Address, t: number): Sample | null {
    const s = this.samples.get(lc(token)); if (!s?.length) return null;
    let best: Sample | null = null; for (const x of s) { if (x[0] <= t) best = x; else break; }
    return best;
  }

  // ---------------------------------------------------------------- the interface Trenchies uses (same as Backtest)

  get updatedAt() {
    // Settling a day needs both sources past midnight; with no graduated coins followed, the curve prices decide.
    const g = [...this.track.keys()].some((t) => this.graduated(t));
    return g ? Math.min(this.base.updatedAt, this.sampledAt) : this.base.updatedAt;
  }
  priceAt(token: Address, t: number): number | null {
    token = lc(token);
    const curve = this.base.priceAt(token, t), last = this.base.info?.(token)?.lastTrade ?? null, s = this.sampleAt(token, t);
    // a pool/direct sample newer than the coin's last curve trade is its current price
    if (s && (curve === null || last === null || s[0] > last)) return s[1];
    return curve;
  }
  symbolOf(token: Address) { return this.base.symbolOf(token); }
  known(token: Address) { return this.base.known(token) && this.priceAt(token, Date.now() / 1000) !== null; }
  info(token: Address) { return this.base.info?.(token) ?? null; }

  /** Pons launchpad coins that traded since `since`, plus followed graduated coins (marked graduated). */
  active(since: number, limit = 80) {
    const list = this.base.active(since, limit);
    const now = Date.now() / 1000;
    for (const token of this.track.keys()) {
      if (list.some((c) => c.token === token)) continue;
      const p = this.priceAt(token, now), p0 = this.priceAt(token, since); if (p === null) continue;
      list.push({ token, symbol: this.base.symbolOf(token) ?? token.slice(2, 8).toUpperCase(), price: p, changePct: p0 ? (p / p0 - 1) * 100 : 0, volEth: 0, trades: 0, launchedAt: 0, graduated: this.graduated(token) });
    }
    // pinned coins ($TRENCHERS) first among the graduated ones
    return list.sort((a, b) => Number(b.graduated && this.pinned.includes(b.token)) - Number(a.graduated && this.pinned.includes(a.token)));
  }

  /** Any Pons coin someone pasted (graduated, or quiet today): price it now and follow it from here. */
  async lookup(token: Address) {
    token = lc(token);
    if (!this.base.known(token)) return null;
    const now = Date.now() / 1000;
    // spot() also settles whether the coin has graduated (the engine checks its curve), so ask it first
    const p0 = await this.spot(token).catch(() => null);
    this.follow(token);
    if (p0 !== null && p0 > 0 && this.needsPool(token, now)) { this.add(token, now, p0); this.save(); }
    const p = this.priceAt(token, now);
    if (p === null) return null;
    const pd = this.priceAt(token, now - 86_400);
    return { token, symbol: this.base.symbolOf(token) ?? token.slice(2, 8).toUpperCase(), price: p, changePct: pd ? (p / pd - 1) * 100 : 0, volEth: 0, trades: 0, launchedAt: 0, graduated: this.graduated(token) };
  }
  view() { return { status: this.status, followed: this.track.size, sampledAt: this.sampledAt ? new Date(this.sampledAt * 1000).toISOString() : null }; }
}
