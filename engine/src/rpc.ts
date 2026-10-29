import { fallback, http, type Transport } from "viem";

/**
 * RPC endpoints: RPC_URL may hold several URLs separated by commas or spaces (e.g. an Alchemy URL first, the
 * public one second); requests go to the first and move to the next when one fails or rate-limits.
 */
export const urls = (v: string | undefined) => (v ?? "").split(/[\s,]+/).map((u) => u.trim().replace(/^["']|["']$/g, "")).filter((u) => /^https?:\/\//.test(u));

/** Every RPC request this process sends, by method, so /health shows what the RPC bill is made of. */
const counts = new Map<string, number>();
const since = Date.now();
let recent: { t: number; m: string }[] = [];
function count(body: unknown) {
  try {
    const items = Array.isArray(body) ? body : [body];
    for (const it of items) { const m = (it as { method?: string })?.method ?? "?"; counts.set(m, (counts.get(m) ?? 0) + 1); recent.push({ t: Date.now(), m }); }
    if (recent.length > 40_000) recent = recent.filter((x) => Date.now() - x.t < 600_000);
  } catch { /* never break a request over counting */ }
}
export function rpcStats() {
  const hours = Math.max(1 / 60, (Date.now() - since) / 3_600_000);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  // The last 10 minutes show the steady rate; totals since start include the one-off history read at start-up.
  const last10 = recent.filter((x) => Date.now() - x.t < 600_000);
  const by10 = new Map<string, number>(); for (const x of last10) by10.set(x.m, (by10.get(x.m) ?? 0) + 1);
  const minutes = Math.min(10, (Date.now() - since) / 60_000);
  // Alchemy's published compute units per method (approximate), so the bill can be read straight off /health.
  const CU: Record<string, number> = { eth_getLogs: 75, eth_call: 26, eth_getBlockByNumber: 16, eth_blockNumber: 10, eth_getCode: 19, eth_getBalance: 19, eth_estimateGas: 87, eth_sendRawTransaction: 250, eth_getTransactionReceipt: 15, eth_chainId: 0, eth_gasPrice: 19, eth_maxPriorityFeePerGas: 10, eth_getTransactionCount: 26, eth_feeHistory: 10 };
  const cu = (m: Map<string, number>) => [...m].reduce((a, [k, v]) => a + v * (CU[k] ?? 26), 0);
  const cuPerDayNow = Math.round((cu(by10) / Math.max(1, minutes)) * 1440);
  return { budget: budget.view(), estimatedComputeUnitsPerDayAtLast10MinRate: cuPerDayNow, estimatedComputeUnitsSinceStart: cu(counts), requestsLastMinute: recent.filter((x) => Date.now() - x.t < 60_000).length, perDayAtLast10MinRate: Math.round((last10.length / Math.max(1, minutes)) * 1440),
    last10MinByMethod: Object.fromEntries([...by10].sort((a, b) => b[1] - a[1])),
    sinceStart: { since: new Date(since).toISOString(), total, perDayIncludingStartup: Math.round((total / hours) * 24), byMethod: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])) } };
}

export function transport(list: string[], opts: { retryCount?: number; retryDelay?: number; timeout?: number } = {}): Transport {
  const ts = list.map((u) => http(u, { retryCount: opts.retryCount ?? 1, retryDelay: opts.retryDelay ?? 1_000, timeout: opts.timeout ?? 20_000,
    onFetchRequest: async (req) => { try { count(await req.clone().json()); } catch { count(null); } } }));
  const inner = ts.length === 1 ? ts[0] : fallback(ts, { rank: false, retryCount: 1 });
  // Every request waits its turn in the shared budget below, before it is sent (so the wait never counts
  // against the request's own timeout).
  return ((cfg: Parameters<Transport>[0]) => {
    const t = inner(cfg);
    return { ...t, request: (async (args: unknown) => { await budget.take(); return (t.request as (a: unknown) => Promise<unknown>)(args); }) as typeof t.request };
  }) as Transport;
}

/**
 * A hard ceiling on RPC use, for the whole process (engine, inference desk, builder index, everything).
 * - RPC_MAX_PER_DAY (default 60,000): the day's budget, per UTC day.
 * - RPC_MAX_PER_MIN (default 400): a burst allowance, so trades in a busy minute are never slowed.
 * - Once the day's budget is spent, RPC_SLOW_PER_MIN (default 10) a minute until the day ends: the Arena and
 *   trading keep going, slowly, and the bill stays bounded (at most ~74,000 requests a day with the defaults).
 * A bug or a restart loop can therefore never run up the RPC bill again. /health shows the budget.
 */
const num = (v: string | undefined, d: number) => { const n = Number((v ?? "").trim()); return Number.isFinite(n) && n > 0 ? n : d; };
export const budget = new (class Budget {
  readonly perMin = num(process.env.RPC_MAX_PER_MIN, 400);
  readonly perDay = num(process.env.RPC_MAX_PER_DAY, 60_000);
  readonly slowPerMin = num(process.env.RPC_SLOW_PER_MIN, 10);
  private times: number[] = [];
  private day = new Date().toISOString().slice(0, 10);
  usedToday = 0;
  waitedMs = 0;
  private chain: Promise<void> = Promise.resolve();
  take(): Promise<void> {
    // one at a time, in order, so a burst is spread out instead of all waking together
    const turn = this.chain.then(() => this.next());
    this.chain = turn.catch(() => undefined);
    return turn;
  }
  private async next() {
    for (;;) {
      const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
      if (today !== this.day) { this.day = today; this.usedToday = 0; }
      const cap = this.usedToday >= this.perDay ? this.slowPerMin : this.perMin;
      this.times = this.times.filter((t) => now - t < 60_000);
      if (this.times.length >= cap) { const wait = 60_000 - (now - this.times[this.times.length - cap]) + 5; this.waitedMs += wait; await new Promise((r) => setTimeout(r, Math.max(50, wait))); continue; }
      this.times.push(now); this.usedToday++;
      return;
    }
  }
  view() { return { perDayBudget: this.perDay, usedToday: this.usedToday, burstPerMinute: this.perMin, slowPerMinuteOnceSpent: this.slowPerMin, lastMinute: this.times.filter((t) => Date.now() - t < 60_000).length, dayBudgetSpent: this.usedToday >= this.perDay, secondsWaitedSinceStart: Math.round(this.waitedMs / 1000) }; }
})();

/** The mainnet endpoints for /verify and /livecheck: MAINNET_RPC_URL, else the engine's own RPC_URL when it is mainnet, else public. */
export function mainnetRpcs(): string[] {
  const own = urls(process.env.MAINNET_RPC_URL);
  if (own.length) return own;
  const eng = urls(process.env.RPC_URL).filter((u) => !/testnet/i.test(u));
  return eng.length ? eng : ["https://rpc.mainnet.chain.robinhood.com"];
}

/** Plain-English version of an RPC error (the public RPC's Cloudflare check returns a whole web page). */
export function explain(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/Just a moment|cf_chl|challenges\.cloudflare/i.test(m)) return "The public Robinhood Chain RPC (rpc.mainnet.chain.robinhood.com) is blocking this server with a Cloudflare check. Set RPC_URL in Railway to a provider URL, e.g. https://robinhood-mainnet.g.alchemy.com/v2/YOUR_KEY";
  if (/fetch failed|ENOTFOUND|EAI_AGAIN/i.test(m)) return `Couldn't reach the RPC at all (${m.match(/URL: (\S+)/)?.[1]?.replace(/\/v2\/.+/, "/v2/…") ?? "check RPC_URL"}): check the URL has no typo, space or quotes, and that Robinhood Chain Mainnet is enabled on that Alchemy app.`;
  return m.length > 600 ? `${m.slice(0, 600)}…` : m;
}

/** Hides API keys in RPC URLs (e.g. Alchemy's /v2/KEY) before anything is shown on a public page. */
export const scrub = (s: string) => s.replace(/(\/v[23]\/)[A-Za-z0-9_-]{8,}/g, "$1…").replace(/(quiknode\.pro\/)[A-Za-z0-9_-]+/g, "$1…").replace(/(chainstack\.com\/)[A-Za-z0-9_-]+/g, "$1…");

/** True when an RPC error means "slow down" (rate limit, compute units, monthly capacity), not "this query was too
 *  big". viem often reports these as a bare "RPC Request failed.", with the real reason in `details` or the status. */
export function rateLimited(e: unknown): boolean {
  const x = e as { message?: string; details?: string; status?: number; code?: number; cause?: { status?: number; details?: string; code?: number } } | null;
  const status = x?.status ?? x?.cause?.status, code = x?.code ?? x?.cause?.code;
  const text = `${x?.message ?? ""} ${x?.details ?? ""} ${x?.cause?.details ?? ""}`;
  return status === 429 || code === 429 || code === -32005 || /rate ?limit|too many requests|429|capacity|compute units|exceeded your|monthly|quota|throughput/i.test(text);
}

/**
 * The block window for a history scan: starts big (fewer calls), halves when a query is too large, grows back while
 * results are small. A rate-limit error is never answered by shrinking (smaller windows only mean more calls): it is
 * passed on, so the scan stops and resumes from where it was on its next run.
 */
export class Span {
  size: bigint;
  constructor(private readonly max: bigint, private readonly min = 1_000n) { this.size = max; }
  /** After a successful query with `n` results. */
  ok(n: number) { if (n < 2_000 && this.size < this.max) this.size = this.size * 2n < this.max ? this.size * 2n : this.max; else if (n > 8_000 && this.size > this.min) this.size = this.size / 2n; }
  /** After a failed query: throws if the scan should stop (rate limit, or already at the smallest window). */
  fail(e: unknown) { if (rateLimited(e) || this.size <= this.min) throw e; this.size = this.size / 2n > this.min ? this.size / 2n : this.min; }
}
