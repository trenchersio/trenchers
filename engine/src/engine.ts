import {
  createPublicClient, createWalletClient, encodeFunctionData, formatEther, http, defineChain,
  type Address, type Hash, type Log, type PublicClient, type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parse, type CustomRule } from "./custom-strategy";
import { ENV } from "./env";
import {
  ADAPTER_ABI, AGENT_ABI, BOUGHT, CLAIMED, CURVE_ABI, CURVE_BUY, CURVE_SELL, ERC20_ABI, POOL_GRADUATED, RULE_APPLIED, SOLD, TOKEN_LAUNCHED,
} from "./abis";

/**
 * The Trenchers trading engine. It follows Pons (launches, trades, graduations) and every awakened
 * agent (policy and current rule), turns each agent's rule into buys and sells, and sends them as
 * engine trades through the agent wallet, where the holder's caps are enforced on-chain.
 *
 * State is rebuilt from the chain on start (no database): agents from the starter fund's Claimed
 * events, rules from RuleApplied, positions and trade history from the adapter's Bought/Sold events.
 */

type Token = { token: Address; curve: Address; deployer: Address; launchedAt: number; volumeEth: number; graduated: boolean; symbol?: string; supply?: bigint };
type Agent = {
  id: number; wallet: Address; owner?: Address; coin?: Address; live: boolean; perTrade: bigint; dailyCap: bigint; setBy?: Address;
  ruleVersion: number; ruleText: string | null; rule: CustomRule | null; balance: bigint; spentDay: bigint; spentToday: bigint;
};
type Position = { token: Address; ethIn: bigint; tokens: bigint; openedAt: number };
export type Trade = { agent: number; wallet: Address; token: Address; symbol?: string; side: "buy" | "sell"; eth: string; tokens: string; time: number; tx: Hash };
type Entry = { wallet: Address; token: Address; notBefore: number; reason: string };

const lc = (a: string) => a.toLowerCase() as Address;
const now = () => Math.floor(Date.now() / 1000);
const WEEK = 7 * 86400;

export class Engine {
  pub: PublicClient;
  wallet: WalletClient | null;
  engineAddress: Address | null;
  tokens = new Map<Address, Token>();
  curves = new Map<Address, Address>(); // curve -> token
  agents = new Map<Address, Agent>();
  positions = new Map<Address, Map<Address, Position>>();
  trades: Trade[] = [];
  realized: { wallet: Address; time: number; pnl: bigint }[] = [];
  entries: Entry[] = [];
  busy = new Set<string>();
  skipNoted = new Map<Address, number>();
  cursor = 0n;
  liveFrom = 0n;
  blockTimes = new Map<bigint, number>();
  lastAgentRefresh = 0;
  /** Offset between chain time and this server's clock, updated on every new block; decisions use chain time. */
  clockOffset = 0; lastHead = -1n;
  now() { return Math.floor(Date.now() / 1000 + this.clockOffset); }
  log: (msg: string) => void;

  constructor(log: (m: string) => void = (m) => console.log(new Date().toISOString(), m)) {
    const chain = defineChain({ id: ENV.CHAIN_ID, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ENV.RPC_URL] } } });
    this.pub = createPublicClient({ chain, transport: http(ENV.RPC_URL) }) as PublicClient;
    if (ENV.ENGINE_KEY) {
      const account = privateKeyToAccount(ENV.ENGINE_KEY);
      this.wallet = createWalletClient({ account, chain, transport: http(ENV.RPC_URL) });
      this.engineAddress = account.address;
    } else { this.wallet = null; this.engineAddress = null; }
    this.log = log;
  }

  // ------------------------------------------------------------------ chain sync

  async start() {
    const head = await this.pub.getBlockNumber();
    const start = ENV.START_BLOCK > 0n ? ENV.START_BLOCK : await this.deploymentBlock(head);
    this.cursor = start > 0n ? start - 1n : 0n;
    this.log(`Replaying history from block ${this.cursor + 1n} to ${head}${this.engineAddress ? ` · engine ${this.engineAddress}` : " · read-only (no ENGINE_KEY)"}${ENV.DRY_RUN ? " · DRY RUN" : ""}`);
    await this.sync(head, false);
    this.liveFrom = head;
    await this.refreshAgents(true);
    this.log(`Ready: ${this.tokens.size} Pons coins, ${this.agents.size} awakened agents, ${this.openCount()} open positions`);
  }

  async tick() {
    const latest = await this.pub.getBlock({ blockTag: "latest" });
    const head = latest.number!;
    if (head !== this.lastHead) { this.lastHead = head; this.clockOffset = Math.max(this.clockOffset, Number(latest.timestamp) - Date.now() / 1000); }
    if (head > this.cursor) await this.sync(head, true);
    if (Date.now() - this.lastAgentRefresh > 15_000) await this.refreshAgents(false);
    await this.runEntries();
    await this.runExits();
  }

  /** The block where the starter fund was deployed (binary search on its code), so history is read from there. */
  private async deploymentBlock(head: bigint) {
    let lo = 0n, hi = head;
    let historyOk = true;
    const has = async (n: bigint) => {
      try { const c = await this.pub.getCode({ address: ENV.FUND, blockNumber: n }); return !!c && c !== "0x"; }
      catch { historyOk = false; return true; } // RPC can't read old state: don't skip anything
    };
    if (!(await has(head))) throw new Error(`No contract at FUND_ADDRESS ${ENV.FUND} on this chain`);
    if (!(await has(0n)) && historyOk) { /* normal case: search below */ } else if (!historyOk) {
      this.log("RPC can't read historical state; reading history from block 0 (set START_BLOCK to speed this up)");
      return 0n;
    }
    while (lo < hi) { const mid = (lo + hi) / 2n; if (await has(mid)) hi = mid; else lo = mid + 1n; }
    if (!historyOk) { this.log("RPC can't read historical state; reading history from block 0 (set START_BLOCK to speed this up)"); return 0n; }
    this.log(`Contracts deployed at block ${lo}`);
    return lo;
  }

  private async blockTime(n: bigint) {
    let t = this.blockTimes.get(n);
    if (t === undefined) { t = Number((await this.pub.getBlock({ blockNumber: n })).timestamp); this.blockTimes.set(n, t); }
    if (this.blockTimes.size > 5000) this.blockTimes.clear();
    return t;
  }

  /** Reads all relevant logs up to `head` in order; `live` means new signals may lead to trades. */
  private async sync(head: bigint, live: boolean) {
    while (this.cursor < head) {
      const from = this.cursor + 1n;
      const to = from + ENV.LOG_RANGE - 1n < head ? from + ENV.LOG_RANGE - 1n : head;
      const [launches, grads, buys, sells, claims, bought, sold] = await Promise.all([
        this.pub.getLogs({ address: ENV.PONS_FACTORY, event: TOKEN_LAUNCHED, fromBlock: from, toBlock: to }),
        this.pub.getLogs({ address: ENV.PONS_FACTORY, event: POOL_GRADUATED, fromBlock: from, toBlock: to }),
        this.pub.getLogs({ event: CURVE_BUY, fromBlock: from, toBlock: to }),
        this.pub.getLogs({ event: CURVE_SELL, fromBlock: from, toBlock: to }),
        this.pub.getLogs({ address: ENV.FUND, event: CLAIMED, fromBlock: from, toBlock: to }),
        this.pub.getLogs({ address: ENV.ADAPTER, event: BOUGHT, fromBlock: from, toBlock: to }),
        this.pub.getLogs({ address: ENV.ADAPTER, event: SOLD, fromBlock: from, toBlock: to }),
      ]);
      const wallets = [...this.agents.keys(), ...claims.map((c) => lc(c.args.agentWallet!))];
      const rules = wallets.length ? await this.pub.getLogs({ address: wallets, event: RULE_APPLIED, fromBlock: from, toBlock: to }) : [];
      const all = [...launches, ...grads, ...buys, ...sells, ...claims, ...bought, ...sold, ...rules] as Log[];
      all.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || (a.logIndex! - b.logIndex!));
      for (const l of all) await this.onLog(l as Log & { eventName: string; args: Record<string, unknown> }, live);
      this.cursor = to;
    }
  }

  private async onLog(l: Log & { eventName: string; args: Record<string, unknown> }, live: boolean) {
    const t = await this.blockTime(l.blockNumber!);
    const a = l.args as Record<string, any>;
    switch (l.eventName) {
      case "TokenLaunched": {
        if (a.pairToken !== "0x0000000000000000000000000000000000000000") return; // ETH launches only
        const tok: Token = { token: lc(a.token), curve: lc(a.curve), deployer: lc(a.deployer), launchedAt: t, volumeEth: 0, graduated: false };
        this.tokens.set(tok.token, tok); this.curves.set(tok.curve, tok.token);
        if (live) this.signal("launch", tok, t);
        break;
      }
      case "PoolGraduated": {
        const tok = this.tokens.get(lc(a.token)); if (!tok) return;
        tok.graduated = true;
        if (live) this.signal("graduation", tok, t);
        break;
      }
      case "CurveBuy": case "CurveSell": {
        const token = this.curves.get(lc(l.address)); if (!token) return;
        const tok = this.tokens.get(token)!;
        const eth = Number(formatEther((l.eventName === "CurveBuy" ? a.quoteIn : a.quoteOut) as bigint));
        const before = tok.volumeEth;
        tok.volumeEth += eth;
        if (!live) return;
        this.signal("volume", tok, t, { before, after: tok.volumeEth });
        this.signal("mcap", tok, t);
        if (l.eventName === "CurveSell" && lc(a.seller) === tok.deployer) this.signal("devsell", tok, t);
        break;
      }
      case "Claimed": {
        const w = lc(a.agentWallet);
        if (live) { this.lastAgentRefresh = 0; this.log(`Agent #${Number(a.tokenId)} awakened (wallet ${w})`); }
        if (!this.agents.has(w)) this.agents.set(w, { id: Number(a.tokenId), wallet: w, live: false, perTrade: 0n, dailyCap: 0n, ruleVersion: 0, ruleText: null, rule: null, balance: 0n, spentDay: 0n, spentToday: 0n });
        break;
      }
      case "RuleApplied": {
        const ag = this.agents.get(lc(l.address)); if (!ag) return;
        ag.ruleVersion = Number(a.version); ag.ruleText = (a.ruleUri as string) || null;
        ag.rule = ag.ruleText ? parse(ag.ruleText).rule : null;
        this.log(`Agent #${ag.id} rule v${ag.ruleVersion}: ${ag.ruleText ?? "(no text)"}`);
        if (live) this.lastAgentRefresh = 0; // read its new limits and on/off switch straight away
        break;
      }
      case "Bought": {
        const w = lc(a.agent), token = lc(a.token);
        const book = this.book(w);
        const p = book.get(token);
        const ethIn = (a.ethIn as bigint), tokens = (a.tokensOut as bigint);
        if (p) { p.ethIn += ethIn; p.tokens += tokens; } else book.set(token, { token, ethIn, tokens, openedAt: t });
        this.addTrade(w, token, "buy", ethIn, tokens, t, l.transactionHash!);
        break;
      }
      case "Sold": {
        const w = lc(a.agent), token = lc(a.token);
        const book = this.book(w);
        const p = book.get(token);
        const tokensIn = a.tokensIn as bigint, ethOut = a.ethOut as bigint;
        if (p && p.tokens > 0n) {
          const part = tokensIn >= p.tokens ? p.ethIn : (p.ethIn * tokensIn) / p.tokens;
          this.realized.push({ wallet: w, time: t, pnl: ethOut - part });
          p.ethIn -= part; p.tokens -= tokensIn;
          if (p.tokens <= 0n) book.delete(token);
        }
        this.addTrade(w, token, "sell", ethOut, tokensIn, t, l.transactionHash!);
        break;
      }
    }
  }

  private book(w: Address) { let b = this.positions.get(w); if (!b) { b = new Map(); this.positions.set(w, b); } return b; }
  private openCount() { let n = 0; for (const b of this.positions.values()) n += b.size; return n; }
  private addTrade(w: Address, token: Address, side: "buy" | "sell", eth: bigint, tokens: bigint, time: number, tx: Hash) {
    this.trades.push({ agent: this.agents.get(w)?.id ?? 0, wallet: w, token, symbol: this.tokens.get(token)?.symbol, side, eth: formatEther(eth), tokens: tokens.toString(), time, tx });
    if (this.trades.length > 5000) this.trades.splice(0, this.trades.length - 5000);
  }

  // ------------------------------------------------------------------ agents

  private async refreshAgents(first: boolean, only?: Set<Address>) {
    if (!only) this.lastAgentRefresh = Date.now();
    for (const ag of this.agents.values()) {
      if (only && !only.has(ag.wallet)) continue;
      try {
        const [pol, owner, coin, balance, spentDay, spentToday] = await Promise.all([
          this.pub.readContract({ address: ag.wallet, abi: AGENT_ABI, functionName: "policy" }),
          this.pub.readContract({ address: ag.wallet, abi: AGENT_ABI, functionName: "owner" }),
          this.pub.readContract({ address: ag.wallet, abi: AGENT_ABI, functionName: "coin" }),
          this.pub.getBalance({ address: ag.wallet }),
          this.pub.readContract({ address: ag.wallet, abi: AGENT_ABI, functionName: "spentDay" }),
          this.pub.readContract({ address: ag.wallet, abi: AGENT_ABI, functionName: "spentToday" }),
        ]);
        const [perTrade, dailyCap, live, setBy] = pol;
        const wasLive = ag.live && ag.setBy === ag.owner;
        Object.assign(ag, { perTrade, dailyCap, live, setBy: lc(setBy), owner: lc(owner), coin: lc(coin), balance, spentDay, spentToday });
        const isLive = ag.live && ag.setBy === ag.owner;
        if (!first && isLive !== wasLive) this.log(`Agent #${ag.id} is now ${isLive ? "trading" : "paused"}`);
      } catch (e) { this.log(`Agent #${ag.id}: could not read (${(e as Error).message.split("\n")[0]})`); }
    }
  }

  private tradable(ag: Agent) { return !!ag.rule && ag.live && !!ag.owner && ag.setBy === ag.owner && ag.perTrade > 0n; }

  // ------------------------------------------------------------------ signals → entries

  private signal(kind: CustomRule["trigger"], tok: Token, t: number, extra?: { before: number; after: number }) {
    if (tok.graduated && kind !== "graduation") return;
    for (const ag of this.agents.values()) {
      const r = ag.rule;
      // Live/limits are checked again with fresh on-chain data when the entry is due (runEntries).
      if (!r || r.trigger !== kind || (!this.tradable(ag) && kind !== "launch")) continue;
      if (kind === "volume") {
        const th = (r.threshold ?? 50_000) / ENV.ETH_USD;
        if (!extra || !(extra.before < th && extra.after >= th)) continue;
      }
      if (kind === "mcap") continue; // evaluated in runEntries with fresh reserves (see below)
      if (kind === "graduation") { this.log(`Agent #${ag.id}: ${tok.token} graduated to Uniswap v4; graduated coins aren't tradable through the curve yet, skipped`); continue; }
      const notBefore = kind === "launch" ? tok.launchedAt + ENV.SNIPE_WAIT_SEC : t;
      this.entries.push({ wallet: ag.wallet, token: tok.token, notBefore, reason: kind });
    }
    if (kind === "mcap") this.mcapCheck(tok, t);
  }

  private mcapPrev = new Map<Address, number>();
  private async mcapCheck(tok: Token, t: number) {
    try {
      const [q, k] = await this.pub.readContract({ address: tok.curve, abi: CURVE_ABI, functionName: "getReserves" });
      tok.supply ??= await this.pub.readContract({ address: tok.token, abi: ERC20_ABI, functionName: "totalSupply" });
      const mcap = k > 0n ? Number(formatEther((q * tok.supply) / k)) : 0;
      const prev = this.mcapPrev.get(tok.token) ?? 0;
      this.mcapPrev.set(tok.token, mcap);
      for (const ag of this.agents.values()) {
        const r = ag.rule;
        if (!r || r.trigger !== "mcap" || !this.tradable(ag)) continue;
        const th = r.threshold ?? 5;
        if (prev < th && mcap >= th) this.entries.push({ wallet: ag.wallet, token: tok.token, notBefore: t, reason: `mcap ${mcap.toFixed(2)} ETH` });
      }
    } catch { /* curve unreadable */ }
  }

  private async runEntries() {
    const ts = this.now();
    const due = this.entries.filter((e) => e.notBefore <= ts);
    this.entries = this.entries.filter((e) => e.notBefore > ts && ts - e.notBefore < 600);
    if (due.length) await this.refreshAgents(false, new Set(due.map((e) => e.wallet)));
    for (const e of due) {
      const ag = this.agents.get(e.wallet); const tok = this.tokens.get(e.token);
      if (!ag || !tok || tok.graduated) continue;
      if (!this.tradable(ag)) { if (Date.now() - (this.skipNoted.get(ag.wallet) ?? 0) > 3_600_000) { this.skipNoted.set(ag.wallet, Date.now()); this.log(`Agent #${ag.id} skipped ${tok.token}: ${!ag.live || ag.setBy !== ag.owner ? "trading is switched off" : ag.perTrade === 0n ? "no per-trade limit set" : "no rule"}`); } continue; }
      const r = ag.rule!;
      if (ag.coin && ag.coin === tok.token) continue;
      const book = this.book(ag.wallet);
      if (book.has(tok.token) || book.size >= ENV.MAX_POSITIONS) continue;
      if (r.maxAgeMin && ts - tok.launchedAt > r.maxAgeMin * 60) continue;
      if (r.minLiquidityEth) {
        const liq = await this.pub.readContract({ address: tok.curve, abi: CURVE_ABI, functionName: "trackedQuote" }).catch(() => 0n);
        if (Number(formatEther(liq)) < r.minLiquidityEth) continue;
      }
      await this.buy(ag, tok, e.reason);
    }
  }

  // ------------------------------------------------------------------ trades

  private async buy(ag: Agent, tok: Token, reason: string) {
    const key = `${ag.wallet}:${tok.token}`; if (this.busy.has(key)) return; this.busy.add(key);
    try {
      const today = BigInt(Math.floor(this.now() / 86400));
      const spent = ag.spentDay === today ? ag.spentToday : 0n;
      let size = ag.perTrade;
      if (spent + size > ag.dailyCap) size = ag.dailyCap > spent ? ag.dailyCap - spent : 0n;
      if (size > ag.balance) size = ag.balance;
      if (size < 10_000_000_000n) return; // below 0.00000001 ETH: nothing worth trading
      const [q, k] = await this.pub.readContract({ address: tok.curve, abi: CURVE_ABI, functionName: "getReserves" });
      const expected = (k * size) / (q + size);
      const minOut = (expected * BigInt(100 - ENV.SLIPPAGE_PCT)) / 100n;
      const data = encodeFunctionData({ abi: ADAPTER_ABI, functionName: "buy", args: [tok.token, minOut] });
      this.log(`Agent #${ag.id} BUY ${tok.token} for ${formatEther(size)} ETH (${reason})`);
      const hash = await this.send(ag.wallet, "trade", [size, data]);
      if (hash) { ag.spentToday = spent + size; ag.spentDay = today; ag.balance -= size; }
    } catch (e) { this.log(`Agent #${ag.id} buy failed: ${(e as Error).message.split("\n")[0]}`); }
    finally { this.busy.delete(key); }
  }

  private async runExits() {
    const ts = this.now();
    for (const [w, book] of this.positions) {
      const ag = this.agents.get(w); if (!ag) continue;
      for (const p of book.values()) {
        const tok = this.tokens.get(p.token); if (!tok || tok.graduated) continue;
        const r = ag.rule;
        const age = ts - p.openedAt;
        let why: string | null = null;
        let value = 0n;
        try {
          const [q, k] = await this.pub.readContract({ address: tok.curve, abi: CURVE_ABI, functionName: "getReserves" });
          value = (q * p.tokens) / (k + p.tokens);
        } catch { continue; }
        const pnl = p.ethIn > 0n ? Number(value - p.ethIn) / Number(p.ethIn) * 100 : 0;
        if (r?.exit === "time" && age >= (r.holdSec ?? 60)) why = `held ${age}s`;
        else if (r?.exit === "tpsl" && r.takeProfitPct && pnl >= r.takeProfitPct) why = `take profit ${pnl.toFixed(1)}%`;
        else if (r?.exit === "tpsl" && r.stopLossPct && pnl <= -r.stopLossPct) why = `stop loss ${pnl.toFixed(1)}%`;
        else if (age >= ENV.MAX_HOLD_SEC) why = "max hold";
        else if (!r) why = "no rule any more";
        if (why) await this.sell(ag, tok, p, value, why);
      }
    }
  }

  private async sell(ag: Agent, tok: Token, p: Position, value: bigint, why: string) {
    const key = `${ag.wallet}:${tok.token}`; if (this.busy.has(key)) return; this.busy.add(key);
    try {
      const held = await this.pub.readContract({ address: tok.token, abi: ERC20_ABI, functionName: "balanceOf", args: [ag.wallet] });
      if (held === 0n) { this.book(ag.wallet).delete(tok.token); return; }
      const minOut = (value * BigInt(100 - ENV.SLIPPAGE_PCT)) / 100n;
      this.log(`Agent #${ag.id} SELL ${tok.token} (${why}), ~${Number(formatEther(value)).toPrecision(4)} ETH`);
      const ok = await this.send(ag.wallet, "approveRouter", [tok.token, held]);
      if (!ok) return;
      await this.send(ag.wallet, "trade", [0n, encodeFunctionData({ abi: ADAPTER_ABI, functionName: "sell", args: [tok.token, held, minOut] })]);
    } catch (e) { this.log(`Agent #${ag.id} sell failed: ${(e as Error).message.split("\n")[0]}`); }
    finally { this.busy.delete(key); }
  }

  private queue: Promise<unknown> = Promise.resolve();
  /** Sends one engine call to an agent wallet, one at a time (simple nonce handling), after a dry run. */
  private send(wallet: Address, fn: "trade" | "approveRouter", args: readonly unknown[]): Promise<Hash | null> {
    const job = this.queue.then(async () => {
      if (ENV.DRY_RUN || !this.wallet || !this.engineAddress) { this.log(`  (not sent: ${ENV.DRY_RUN ? "dry run" : "no ENGINE_KEY"})`); return null; }
      const { request } = await this.pub.simulateContract({ address: wallet, abi: AGENT_ABI, functionName: fn, args: args as never, account: this.wallet.account! });
      // Signed here with the engine key and sent raw: public RPCs don't hold keys (no eth_sendTransaction).
      const hash = await this.wallet.writeContract(request as never);
      const r = await this.pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(`${fn} reverted (${hash})`);
      return hash;
    });
    this.queue = job.catch(() => null);
    return job;
  }

  // ------------------------------------------------------------------ Arena

  /** Live leaderboard: each agent's value, open positions and trading PnL this week, from real trades. */
  async arena() {
    const weekStart = this.now() - WEEK;
    const rows = [];
    for (const ag of this.agents.values()) {
      const book = this.book(ag.wallet);
      ag.balance = await this.pub.getBalance({ address: ag.wallet }).catch(() => ag.balance);
      let open = 0n, cost = 0n;
      for (const p of book.values()) {
        const tok = this.tokens.get(p.token);
        cost += p.ethIn;
        if (!tok) continue;
        try { const [q, k] = await this.pub.readContract({ address: tok.curve, abi: CURVE_ABI, functionName: "getReserves" }); open += (q * p.tokens) / (k + p.tokens); } catch { /* skip */ }
      }
      const week = this.trades.filter((x) => x.wallet === ag.wallet && x.time >= weekStart);
      const realized = this.realized.filter((x) => x.wallet === ag.wallet && x.time >= weekStart).reduce((sum, x) => sum + x.pnl, 0n);
      const pnlEth = Number(formatEther(realized + open - cost));
      const nav = Number(formatEther(ag.balance + open));
      const base = nav - pnlEth;
      rows.push({
        id: ag.id, wallet: ag.wallet, owner: ag.owner, live: this.tradable(ag), rule: ag.ruleText, ruleVersion: ag.ruleVersion,
        nav, cash: Number(formatEther(ag.balance)), openPositions: book.size, pnlEth, pnlPct: base > 0 ? (pnlEth / base) * 100 : 0,
        trades: week.length,
      });
    }
    rows.sort((a, b) => b.pnlPct - a.pnlPct);
    return { updatedAt: this.now(), agents: rows.map((r, i) => ({ rank: i + 1, ...r })), feed: this.trades.slice(-50).reverse() };
  }
}
