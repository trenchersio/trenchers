/**
 * Bitcoin's price, second by second, for the Trenchies trading desk. Coinbase's public live feed (no key) with its
 * public ticker as a fallback whenever the live feed goes quiet, and Kraken if Coinbase can't be reached. Keeps the
 * last two hours, one price per second (the last trade in that second).
 */
const KEEP = 2 * 3600;
const WS_URL = "wss://ws-feed.exchange.coinbase.com";

export class BtcFeed {
  private ticks = new Map<number, number>();
  private order: number[] = [];
  private ws: WebSocket | null = null;
  private lastWs = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  source = "starting";
  lastError: string | null = null;

  constructor(private log: (m: string) => void = () => {}) {}

  start() {
    this.connect();
    // the fallback: when the live feed has been quiet for 5 s, read the ticker once a second
    this.timer = setInterval(() => { if (Date.now() - this.lastWs > 5000) void this.poll(); }, 1000);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.ws?.close(); }

  private connect() {
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) { this.source = "polling (no WebSocket in this Node)"; return; }
    try {
      const ws = (this.ws = new WS(WS_URL));
      ws.onopen = () => ws.send(JSON.stringify({ type: "subscribe", product_ids: ["BTC-USD"], channels: ["ticker"] }));
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(String(ev.data)) as { type?: string; price?: string; time?: string };
          if (m.type !== "ticker" || !m.price) return;
          this.lastWs = Date.now(); this.source = "coinbase live";
          this.add(m.time ? Date.parse(m.time) / 1000 : Date.now() / 1000, Number(m.price));
        } catch { /* skip */ }
      };
      ws.onclose = () => { this.ws = null; setTimeout(() => this.connect(), 3000); };
      ws.onerror = () => { this.lastError = "live feed error"; try { ws.close(); } catch { /* */ } };
    } catch (e) { this.lastError = (e as Error).message; setTimeout(() => this.connect(), 10_000); }
  }
  private async poll() {
    try {
      const r = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", { headers: { "user-agent": "trenchers-engine" }, signal: AbortSignal.timeout(2500) });
      const j = (await r.json()) as { price?: string };
      if (j.price) { this.add(Date.now() / 1000, Number(j.price)); this.source = "coinbase ticker"; return; }
    } catch { /* try Kraken */ }
    try {
      const r = await fetch("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", { signal: AbortSignal.timeout(2500) });
      const j = (await r.json()) as { result?: Record<string, { c?: string[] }> };
      const v = Object.values(j.result ?? {})[0]?.c?.[0];
      if (v) { this.add(Date.now() / 1000, Number(v)); this.source = "kraken ticker"; }
    } catch (e) { this.lastError = (e as Error).message; }
  }
  /** Records a price (tests use this too). */
  add(t: number, price: number) {
    if (!(price > 0)) return;
    const s = Math.floor(t);
    if (!this.ticks.has(s)) { this.order.push(s); if (this.order.length && this.order[this.order.length - 2] > s) this.order.sort((a, b) => a - b); }
    this.ticks.set(s, price);
    while (this.order.length && this.order[0] < s - KEEP) this.ticks.delete(this.order.shift()!);
  }
  /** The price at second t: the last trade at or before it, if it's no more than `stale` seconds old. */
  priceAt(t: number, stale = 20): number | null {
    const s = Math.floor(t);
    for (let i = this.order.length - 1; i >= 0; i--) { const k = this.order[i]; if (k <= s) return s - k <= stale ? this.ticks.get(k)! : null; }
    return null;
  }
  get latest() { const k = this.order[this.order.length - 1]; return k === undefined ? null : { t: k, price: this.ticks.get(k)! }; }
  /** One point per second since `from` (gaps filled with the previous price), for the chart. */
  series(from: number, to = Date.now() / 1000) {
    const out: [number, number][] = []; let last: number | null = this.priceAt(from, 600);
    for (let s = Math.floor(from); s <= Math.floor(to); s++) { const p = this.ticks.get(s); if (p !== undefined) last = p; if (last !== null) out.push([s, last]); }
    return out;
  }
  view() { const l = this.latest; return { source: this.source, price: l?.price ?? null, ageSec: l ? Math.round(Date.now() / 1000 - l.t) : null, points: this.order.length, lastError: this.lastError }; }
}
