import { decodeEventLog, formatEther, parseAbiItem, toEventSelector, pad, type Address, type Hash, type PublicClient } from "viem";
import { CURVE_BUY, CURVE_SELL } from "./abis";

/**
 * FOMO traders in the Arena: top traders on the FOMO app whose Pons trades on Robinhood Chain agents can copy.
 * Their wallets are watched with two narrow log queries (only their own trades): Pons curve buys and sells
 * that land in their wallet, and any Pons coin leaving their wallet (a sell on any venue, after graduation too).
 * While nobody copies them the watch runs every few minutes (just for the Arena cards); once an agent copies one
 * of them it runs every other engine tick, so copies follow within seconds.
 */
export const FOMO_TRADERS: { name: string; wallet: Address; pic: string }[] = [
  { name: "Rasmr", wallet: "0x2fbd041a069bb3d7099d55179169091cfeec4221", pic: "rasmr" },
  { name: "Frank", wallet: "0x696d1265c8fc4f14797abebfae3c43ebfa9d8e28", pic: "frank" },
  { name: "Unipcs", wallet: "0x0a6ebed0155edb4b21d92ad02897a626cd90119e", pic: "unipcs" },
  { name: "TM", wallet: "0x1a2acf82601cb26db5160e707a78a5dd9dbaa8e8", pic: "tm" },
  { name: "Fartman Sacks", wallet: "0x7f6e4e1e59be05dc717c8e5429154a7408609ee2", pic: "fartman" },
];

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const T_BUY = toEventSelector(CURVE_BUY), T_SELL = toEventSelector(CURVE_SELL), T_TRANSFER = toEventSelector(TRANSFER);
const lc = (a: string) => a.toLowerCase() as Address;
const WEEK = 7 * 86400;

export type WalletTrade = { wallet: Address; token: Address; symbol?: string; side: "buy" | "sell"; eth: number | null; time: number; tx: Hash };
type RawLog = { address: Address; topics: Hash[]; data: Hash; blockNumber: Hash; transactionHash: Hash; logIndex: Hash };

export class TraderWatch {
  private cursor = 0n;
  private lastRun = 0;
  private ticks = 0;
  private liveFrom = 0n;
  trades: WalletTrade[] = [];
  /** Blocks per second, measured once, for the week of history and block times. */
  private bps = 4;

  constructor(
    private pub: PublicClient,
    private host: {
      /** Pons curve address → its coin (ETH launches the engine follows). */
      tokenOfCurve: (curve: Address) => Address | undefined;
      isPons: (token: Address) => boolean;
      symbolOf: (token: Address) => Promise<string>;
      /** Wallets agents copy right now (besides the listed traders). */
      copied: () => Set<Address>;
      onTrade: (t: WalletTrade) => void;
      log: (m: string) => void;
      rangeMax: bigint;
    },
  ) {}

  private wallets() { return [...new Set([...FOMO_TRADERS.map((t) => t.wallet), ...this.host.copied()])]; }

  /** Called every engine tick with the chain head and its time. */
  async run(head: bigint, headTime: number) {
    this.ticks++;
    const copying = this.host.copied().size > 0;
    const due = this.cursor === 0n || (copying ? this.ticks % 2 === 0 : Date.now() - this.lastRun > 180_000);
    if (!due || head <= this.cursor) return;
    this.lastRun = Date.now();
    if (this.cursor === 0n) {
      // First run: measure the block rate and read back a week (at most ~3M blocks).
      try {
        const back = head > 200_000n ? 200_000n : head;
        const old = await this.pub.getBlock({ blockNumber: head - back });
        const dt = headTime - Number(old.timestamp);
        if (dt > 0) this.bps = Number(back) / dt;
      } catch { /* keep the guess */ }
      const want = BigInt(Math.min(3_000_000, Math.round(this.bps * WEEK)));
      this.cursor = head > want ? head - want : 0n;
      this.liveFrom = head;
    }
    const ws = this.wallets().map((w) => pad(w, { size: 32 }).toLowerCase() as Hash);
    while (this.cursor < head) {
      const from = this.cursor + 1n, to = from + this.host.rangeMax - 1n < head ? from + this.host.rangeMax - 1n : head;
      const hex = (n: bigint) => `0x${n.toString(16)}`;
      let curve: RawLog[], out: RawLog[];
      try {
        [curve, out] = await Promise.all([
          this.pub.request({ method: "eth_getLogs", params: [{ fromBlock: hex(from), toBlock: hex(to), topics: [[T_BUY, T_SELL], null, ws] }] } as never) as Promise<RawLog[]>,
          this.pub.request({ method: "eth_getLogs", params: [{ fromBlock: hex(from), toBlock: hex(to), topics: [T_TRANSFER, ws] }] } as never) as Promise<RawLog[]>,
        ]);
      } catch (e) { this.host.log(`fomo traders: reading ${from}-${to} failed (${(e as Error).message.split("\n")[0].slice(0, 100)})`); return; }
      const timeOf = (b: bigint) => Math.round(headTime - Number(head - b) / this.bps);
      const seenSell = new Set<string>();
      for (const l of [...curve].sort((a, b) => Number(BigInt(a.blockNumber) - BigInt(b.blockNumber)) || Number(BigInt(a.logIndex) - BigInt(b.logIndex)))) {
        const token = this.host.tokenOfCurve(lc(l.address)); if (!token) continue;
        let ev: { eventName: string; args: Record<string, unknown> };
        try { ev = decodeEventLog({ abi: [CURVE_BUY, CURVE_SELL], data: l.data, topics: l.topics as [Hash, ...Hash[]] }) as never; } catch { continue; }
        const buy = ev.eventName === "CurveBuy";
        const wallet = lc(ev.args.recipient as string);
        if (!buy) seenSell.add(`${l.transactionHash}:${token}`);
        await this.add({ wallet, token, side: buy ? "buy" : "sell", eth: Number(formatEther((buy ? ev.args.quoteIn : ev.args.quoteOut) as bigint)), time: timeOf(BigInt(l.blockNumber)), tx: l.transactionHash }, BigInt(l.blockNumber));
      }
      // A Pons coin leaving their wallet that wasn't a curve sell: sold on the DEX after graduation (or moved).
      for (const l of out) {
        const token = lc(l.address);
        if (!this.host.isPons(token) || seenSell.has(`${l.transactionHash}:${token}`)) continue;
        const wallet = lc(`0x${l.topics[1].slice(26)}`);
        seenSell.add(`${l.transactionHash}:${token}`);
        await this.add({ wallet, token, side: "sell", eth: null, time: timeOf(BigInt(l.blockNumber)), tx: l.transactionHash }, BigInt(l.blockNumber));
      }
      this.cursor = to;
    }
    const cut = Math.floor(Date.now() / 1000) - WEEK;
    if (this.trades.length && this.trades[0].time < cut) this.trades = this.trades.filter((t) => t.time >= cut);
  }

  private async add(t: WalletTrade, block: bigint) {
    if (this.trades.some((x) => x.tx === t.tx && x.token === t.token && x.side === t.side && x.wallet === t.wallet)) return;
    t.symbol = await this.host.symbolOf(t.token).catch(() => undefined);
    this.trades.push(t);
    if (this.trades.length > 4000) this.trades.splice(0, this.trades.length - 4000);
    if (block > this.liveFrom) { this.host.log(`fomo trader ${nameOf(t.wallet) ?? t.wallet} ${t.side}s ${t.symbol ?? t.token}${t.eth ? ` for ${t.eth.toFixed(4)} ETH` : ""}`); this.host.onTrade(t); }
  }

  /** The Arena's Copytrade cards: each trader's last week of Pons trades. */
  cards(copiers: (wallet: Address) => number) {
    return FOMO_TRADERS.map((tr) => {
      const mine = this.trades.filter((t) => t.wallet === tr.wallet);
      const buys = mine.filter((t) => t.side === "buy"), sells = mine.filter((t) => t.side === "sell");
      const volume = mine.reduce((s, t) => s + (t.eth ?? 0), 0);
      const coins = new Map<string, { symbol: string; n: number }>();
      for (const t of mine) { const c = coins.get(t.token) ?? { symbol: t.symbol ?? t.token.slice(2, 8), n: 0 }; c.n++; coins.set(t.token, c); }
      // Realized ETH on coins they bought and sold on the curve this week (both sides known).
      let pnl = 0, closed = 0;
      for (const tok of new Set(sells.map((s) => s.token))) {
        const b = buys.filter((x) => x.token === tok), s = sells.filter((x) => x.token === tok);
        if (!b.length || s.some((x) => x.eth === null)) continue;
        pnl += s.reduce((a, x) => a + x.eth!, 0) - b.reduce((a, x) => a + x.eth!, 0); closed++;
      }
      return {
        ...tr, trades: mine.length, buys: buys.length, sells: sells.length, volumeEth: volume, coins: coins.size,
        top: [...coins.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((c) => c.symbol),
        realizedEth: closed ? pnl : null, last: mine.at(-1)?.time ?? null, copiedBy: copiers(tr.wallet),
        recent: mine.slice(-6).reverse().map(({ token, symbol, side, eth, time, tx }) => ({ token, symbol, side, eth, time, tx })),
      };
    });
  }
}

export const nameOf = (w: string) => FOMO_TRADERS.find((t) => t.wallet === w.toLowerCase())?.name ?? null;
