import { transport, urls, rateLimited } from "./rpc";
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11" as const;
const MC3_ABI = [{ type: "function", name: "getEthBalance", stateMutability: "view", inputs: [{ name: "addr", type: "address" }], outputs: [{ name: "balance", type: "uint256" }] }] as const;
import {
  createPublicClient, createWalletClient, decodeAbiParameters, encodeFunctionData, formatEther, http, defineChain, parseAbi,
  type Address, type Hash, type Hex, type Log, type PublicClient, type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TelegramFeed } from "./telegram";
import { Alerts } from "./alerts";
import { dcaBuys, defaultEvery, parse, type CustomRule } from "./custom-strategy";
import { ENV } from "./env";
import { FeeKeeper } from "./keeper";
import { BurnTracker } from "./burns";
import {
  PONS_RECORD_ABI, ALL_EVENTS, ADAPTER_ABI, AGENT_ABI, BOUGHT, CONFIG_ABI, LAUNCH_SWEPT, NFT_TRANSFER, CLAIMED, CURVE_ABI, CURVE_BUY, CURVE_SELL, ERC20_ABI, POOL_GRADUATED, RULE_APPLIED, POLICY_SET, FUND_ABI, SOLD, TOKEN_LAUNCHED, FOUNDATION_LAUNCHED, FOUNDATION_TOKEN_ABI, FOUNDATION_LEDGER_ABI, NFT_OWNER_ABI,
} from "./abis";

/**
 * The Trenchers trading engine. It follows Pons (launches, trades, graduations) and every awakened
 * agent (policy and current rule), turns each agent's rule into buys and sells, and sends them as
 * engine trades through the agent wallet, where the holder's caps are enforced on-chain.
 *
 * State is rebuilt from the chain on start (no database): agents from the starter fund's Claimed
 * events, rules from RuleApplied, positions and trade history from the adapter's Bought/Sold events.
 */

type Token = { token: Address; curve: Address; deployer: Address; launchedAt: number; volumeEth: number; graduated: boolean; symbol?: string; supply?: bigint; tx?: Hash; block?: bigint };
/** What the site shows for a specific-token strategy: the coin's ticker, name and logo (read from its Pons launch). */
export type TokenMeta = { token: Address; symbol: string; name: string; logo: string | null; graduated: boolean; mcapEth: number | null };
/** An agent's own coin (launched by its agent wallet): creator fees and a price history, from Pons's own trade events. */
/** An agent's coin on Programmable, paired with $TRENCHERS: launched by its agent wallet (version 4) or by its holder,
 *  linked to the Trencher by the coin's website (its collection page) and the holder's address at launch. */
type ProgrammableCoin = { token: Address; agent: number; wallet: Address; creator: Address; ledger: Address; hook: Address; launchedAt: number; byAgent: boolean; tx?: Hash };
type AgentCoin = { token: Address; curve: Address; agent: number; wallet: Address; launchedAt: number; feeWei: bigint; taxWei: bigint; volumeEth: number; trades: number; points: { t: number; p: number }[] };
type Agent = {
  id: number; wallet: Address; owner?: Address; coin?: Address; live: boolean; perTrade: bigint; dailyCap: bigint; setBy?: Address;
  ruleVersion: number; ruleText: string | null; rule: CustomRule | null; balance: bigint; spentDay: bigint; spentToday: bigint;
  /** When the current rule was applied (chain time): a specific-token plan (DCA, budget) counts from here. */
  ruleAt?: number;
  /** How the engine read the rule, and a warning when it can't follow all of it (shown to the holder). */
  understood?: string[]; ruleWarning?: string | null;
};
type Position = { token: Address; ethIn: bigint; tokens: bigint; openedAt: number };
export type Trade = { agent: number; wallet: Address; token: Address; symbol?: string; side: "buy" | "sell"; eth: string; tokens: string; time: number; tx: Hash; pnlPct?: number };
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
  /** Coins launched by agent wallets, keyed by token. */
  agentCoins = new Map<Address, AgentCoin>();
  pgCoins = new Map<Address, ProgrammableCoin>();
  private feeShare = new Map<Address, number>();
  positions = new Map<Address, Map<Address, Position>>();
  trades: Trade[] = [];
  realized: { wallet: Address; time: number; pnl: bigint }[] = [];
  entries: Entry[] = [];
  busy = new Set<string>();
  skipNoted = new Map<Address, number>();
  /** AgentConfig (read from an agent wallet) and its emergency stop. */
  configAddress: Address | null = null;
  /** Each agent's value (ETH) every 2 minutes, last 24 hours, for the value chart. In memory: restarts start fresh. */
  history = new Map<Address, { t: number; v: number }[]>();
  lastSnapshot = 0;
  telegram: TelegramFeed | null = null;
  /** Private alerts to holders about their own agents' trades (same bot). */
  alerts: Alerts | null = null;
  burns!: BurnTracker;
  paused = false;
  cursor = 0n;
  liveFrom = 0n;
  blockTimes = new Map<bigint, number>();
  /** While replaying history: block times are interpolated between the window's first and last block
   *  (2 RPC calls per window instead of one per log, which takes hours on a busy chain). */
  private interp: { a: bigint; b: bigint; ta: number; tb: number } | null = null;
  /** The trading route agents actually use (AgentConfig.router), which is where Bought/Sold are emitted. */
  adapter: Address = lc(ENV.ADAPTER);
  lastAgentRefresh = 0;
  private started = false;
  private lastPauseRead = 0;
  private multicall = false;
  private chainDef: object;
  /** Unfiltered curve trades (every Pons coin) are only read for recent history and when a rule needs them. */
  private replayCurvesFrom = 0n;
  /** Volume signals are only trusted for coins launched after curve trades were read without a gap. */
  curvesFrom = 0n;
  private curvesTo = -1n;
  private lastWindow: { b: bigint; tb: number } | null = null;
  /** Offset between chain time and this server's clock, updated on every new block; decisions use chain time. */
  clockOffset = 0; lastHead = -1n;
  now() { return Math.floor(Date.now() / 1000 + this.clockOffset); }
  log: (msg: string) => void;

  constructor(log: (m: string) => void = (m) => console.log(new Date().toISOString(), m)) {
    const chain = defineChain({ id: ENV.CHAIN_ID, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ENV.RPC_URL] } } });
    // Public RPCs throttle bursts: retry with backoff, and fall back to a second endpoint if one is set.
    this.chainDef = chain;
    this.pub = createPublicClient({ chain, transport: transport(urls(ENV.RPC_URL)), batch: { multicall: { wait: 16, batchSize: 16_384 } } }) as PublicClient;
    if (ENV.ENGINE_KEY) {
      const account = privateKeyToAccount(ENV.ENGINE_KEY);
      this.wallet = createWalletClient({ account, chain, transport: transport(urls(ENV.RPC_URL)) });
      this.engineAddress = account.address;
    } else { this.wallet = null; this.engineAddress = null; }
    this.log = log;
    this.burns = new BurnTracker(this.pub, ENV.LOG_RANGE_MAX);
    if (ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT) {
      this.telegram = new TelegramFeed(
        { api: process.env.TELEGRAM_API, token: ENV.TELEGRAM_BOT_TOKEN, chat: ENV.TELEGRAM_CHAT, site: ENV.SITE_URL, explorer: ENV.EXPLORER_URL, imageBase: ENV.IMAGE_BASE, nft: ENV.NFT },
        this.pub, (m) => this.log(m),
        (id) => { const ag = [...this.agents.values()].find((a) => a.id === id); return ag ? `Its agent: ${Number(formatEther(ag.balance)).toFixed(4)} ETH · rule v${ag.ruleVersion}, and its track record moves with the NFT.` : null; },
      );
      void this.telegram.check();
    }
    if (ENV.TELEGRAM_BOT_TOKEN && !/^(off|false|0|no)$/i.test((process.env.TELEGRAM_ALERTS || "").trim())) {
      this.alerts = new Alerts({ api: process.env.TELEGRAM_API, token: ENV.TELEGRAM_BOT_TOKEN, site: ENV.SITE_URL, explorer: ENV.EXPLORER_URL, imageBase: ENV.IMAGE_BASE },
        (addr) => [...this.agents.values()].filter((a) => a.owner === addr.toLowerCase()).map((a) => a.id).sort((x, y) => x - y), (m) => this.log(m));
      void this.alerts.start();
    }
  }

  // ------------------------------------------------------------------ chain sync

  /** First block of this process's lifetime (minus a margin): NFT moves from here on are posted even during the replay. */
  private catchUpFrom = 2n ** 255n;
  /** NFT mints are read for the site's activity ticker from here on (about the last day). */
  private activityFrom = 2n ** 255n;
  /** Recent mints, awakenings and agent coin launches for the site's live ticker (newest last). */
  activity: { kind: "mint" | "awaken" | "coin"; id: number; time: number; tx: string | null; symbol?: string; count?: number }[] = [];
  private noteActivity(e: Engine["activity"][number]) {
    if (e.tx && this.activity.some((x) => x.kind === e.kind && x.tx === e.tx && x.id === e.id)) return;
    this.activity.push(e); this.activity.sort((a, b) => a.time - b.time);
    if (this.activity.length > 120) this.activity.splice(0, this.activity.length - 120);
  }
  /** The ticker: activity plus agents' best closed trades, newest first. */
  activityFeed() {
    const wins = this.trades.filter((x) => x.side === "sell" && (x.pnlPct ?? 0) >= 50).slice(-30)
      .map((x) => ({ kind: "win" as const, id: x.agent, time: x.time, tx: x.tx as string, symbol: x.symbol, pct: Math.round(x.pnlPct!) }));
    // Every other trade too (the last dozen), so the ticker shows agents at work.
    const trades = this.trades.filter((x) => x.agent && !(x.side === "sell" && (x.pnlPct ?? 0) >= 50)).slice(-12)
      .map((x) => ({ kind: "trade" as const, id: x.agent, time: x.time, tx: x.tx as string, symbol: x.symbol, side: x.side, eth: +Number(x.eth).toPrecision(3), pct: x.pnlPct === undefined ? undefined : Math.round(x.pnlPct * 10) / 10 }));
    return [...this.activity, ...wins, ...trades].sort((a, b) => b.time - a.time).slice(0, 40);
  }
  async start() {
    const head = await this.pub.getBlockNumber();
    this.catchUpFrom = head > 100n ? head - 100n : 0n;
    this.activityFrom = head > 350_000n ? head - 350_000n : 0n;
    // Post what happened while the engine was down (restarts, redeploys), up to a day back.
    const saved = this.telegram?.savedBlock() ?? null;
    if (saved !== null && saved + 1n < this.catchUpFrom && head - saved < 400_000n) { this.catchUpFrom = saved + 1n; this.log(`telegram: posting mints, sales and awakenings since block ${saved + 1n}`); }
    // A failed start resumes where it stopped: history already read is never read again (it used to start over,
    // reading millions of blocks every 30 s while the RPC was struggling).
    if (!this.started) {
      const start = ENV.START_BLOCK > 0n ? ENV.START_BLOCK : await this.deploymentBlock(head);
      this.cursor = start > 0n ? start - 1n : 0n;
      this.started = true;
    } else this.log(`Resuming history from block ${this.cursor + 1n}`);
    this.replayCurvesFrom = head > ENV.CURVE_REPLAY_BLOCKS ? head - ENV.CURVE_REPLAY_BLOCKS : 0n;
    if (!this.multicall) {
      const code = await this.pub.getCode({ address: MULTICALL3 }).catch(() => undefined);
      if (code && code !== "0x") { this.multicall = true; (this.chainDef as { contracts?: unknown }).contracts = { multicall3: { address: MULTICALL3 } }; this.log("Multicall3 found: agent reads are batched"); }
    }
    await this.discoverHouse(false);
    await this.resolveRouter();
    this.log(`Replaying history from block ${this.cursor + 1n} to ${head}${this.engineAddress ? ` · engine ${this.engineAddress}` : " · read-only (no ENGINE_KEY)"}${ENV.DRY_RUN ? " · DRY RUN" : ""}`);
    await this.sync(head, false);
    this.interp = null;
    this.liveFrom = head;
    await this.refreshAgents(true);
    this.log(`Ready: ${this.tokens.size} Pons coins, ${this.agents.size} awakened agents, ${this.openCount()} open positions`);
  }

  async tick() {
    const latest = await this.pub.getBlock({ blockTag: "latest" });
    const head = latest.number!;
    this.headTime = Number(latest.timestamp);
    if (head !== this.lastHead) { this.lastHead = head; this.clockOffset = Math.max(this.clockOffset, Number(latest.timestamp) - Date.now() / 1000); }
    // The team's emergency stop: one cheap read every 15 s (agents themselves are re-read on their events, and every 5 minutes as a backstop).
    if (Date.now() - this.lastPauseRead > 15_000) { this.lastPauseRead = Date.now(); await this.readPause(); }
    this.head = head;
    if (head > this.cursor) {
      try { await this.sync(head, true); this.syncError = null; }
      catch (e) { this.syncError = (e as Error).message.split("\n")[0].slice(0, 160); this.log(`reading new blocks failed at ${this.cursor + 1n}: ${this.syncError}`); }
    }
    // Agents are re-read straight away on their own events (awakening, new rule, start/pause); this is the backstop.
    if (Date.now() - this.lastAgentRefresh > 300_000) await this.refreshAgents(false);
    if (Date.now() - this.lastSnapshot > 600_000) await this.snapshot();
    if (Date.now() - this.lastRecover > 600_000) { await this.resolveRouter(); await this.recoverHoldings().catch((e) => this.log(`holdings check failed: ${(e as Error).message.split("\n")[0]}`)); }
    if (ENV.FEE_KEEPER && ENV.DIST && Date.now() - this.feeKeeper.last > 600_000) await this.feeKeeper.run().catch((e) => this.log(`fee share upkeep failed: ${(e as Error).message.split("\n")[0]}`));
    if (this.paused) { this.entries = []; return; } // emergency stop: no buys, no sells
    await this.runEntries();
    await this.runTokenPlans();
    await this.runExits();
  }

  /** Reads the team's emergency stop from AgentConfig. */
  private async readPause() {
    try {
      if (!this.configAddress) {
        const any = this.agents.values().next().value as Agent | undefined;
        if (!any) return;
        this.configAddress = lc(await this.pub.readContract({ address: any.wallet, abi: AGENT_ABI, functionName: "config" }));
      }
      const p = await this.pub.readContract({ address: this.configAddress, abi: CONFIG_ABI, functionName: "paused" });
      if (p !== this.paused) this.log(p ? "EMERGENCY STOP is on: all trading paused by the team" : "Emergency stop lifted: trading resumes");
      this.paused = p;
    } catch { /* keep the last known state */ }
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

  private headTime = 0;
  /** Blocks read per log query: halves on failure, grows back on success. */
  private range = ENV.LOG_RANGE_MAX;
  head = 0n;
  syncError: string | null = null;
  private async blockTime(n: bigint) {
    // Live: a block seen this tick is at most a few seconds old, so the head's time is precise enough
    // (and saves a chain read per block, which public RPCs rate-limit).
    if (!this.interp && this.headTime && this.lastHead !== undefined && n >= this.lastHead - 100n) return this.headTime;
    if (this.interp) {
      const { a, b, ta, tb } = this.interp;
      return b === a ? ta : Math.round(ta + ((tb - ta) * Number(n - a)) / Number(b - a));
    }
    let t = this.blockTimes.get(n);
    if (t === undefined) { t = Number((await this.pub.getBlock({ blockNumber: n })).timestamp); this.blockTimes.set(n, t); }
    if (this.blockTimes.size > 5000) this.blockTimes.clear();
    return t;
  }

  /** Does any trading agent's rule react to every Pons coin's curve trades (volume, market cap, dev sells)? */
  private needCurves() { for (const ag of this.agents.values()) if (ag.rule && (ag.rule.trigger === "volume" || ag.rule.trigger === "mcap" || ag.rule.trigger === "devsell") && this.tradable(ag)) return true; return false; }

  /** Reads all relevant logs up to `head` in order; `live` means new signals may lead to trades. */
  private async sync(head: bigint, live: boolean) {
    while (this.cursor < head) {
      const from = this.cursor + 1n;
      const to = from + this.range - 1n < head ? from + this.range - 1n : head;
      const fixed = [ENV.PONS_FACTORY, ENV.FUND, this.adapter, ENV.NFT, ENV.PROGRAMMABLE_FACTORY].filter(Boolean).map((x) => lc(x as Address));
      const wallets = [...this.agents.keys()];
      const agentCurves = [...this.agentCoins.values()].map((c) => c.curve);
      // Every Pons coin's curve trades: recent history and live, and only while a rule needs them.
      const allCurves = live ? this.needCurves() : to >= this.replayCurvesFrom;
      let logs: Log[] = [];
      try {
        // Replay, or catching up after a pause: interpolate block times (one block read per window, reusing the last).
        if (!live || head - from > 100n) {
          const ta = this.lastWindow && this.lastWindow.b === from - 1n ? this.lastWindow.tb : Number((await this.pub.getBlock({ blockNumber: from })).timestamp);
          const tb = Number((await this.pub.getBlock({ blockNumber: to })).timestamp);
          this.interp = { a: from, b: to, ta, tb };
        } else this.interp = null;
        // One query for everything Trenchers emits (factory, fund, route, NFT, agent wallets, agent coins' curves),
        // in groups of 300 addresses, plus one for all curve trades when they are needed.
        const addrs = [...new Set([...fixed, ...wallets, ...agentCurves])];
        const qs: Promise<Log[]>[] = [];
        for (let i = 0; i < addrs.length; i += 300) qs.push(this.pub.getLogs({ address: addrs.slice(i, i + 300), events: ALL_EVENTS, fromBlock: from, toBlock: to }) as Promise<Log[]>);
        if (allCurves) qs.push(this.pub.getLogs({ events: [CURVE_BUY, CURVE_SELL], fromBlock: from, toBlock: to }) as Promise<Log[]>);
        logs = (await Promise.all(qs)).flat();
        // Wallets awakened in this window: their first rule may be in the same window.
        const known = new Set(wallets);
        const fresh = logs.filter((l) => lc(l.address) === lc(ENV.FUND) && (l as { eventName?: string }).eventName === "Claimed").map((l) => lc((l as unknown as { args: { agentWallet: Address } }).args.agentWallet)).filter((w) => !known.has(w));
        if (fresh.length) logs.push(...(await this.pub.getLogs({ address: fresh, events: [RULE_APPLIED, POLICY_SET], fromBlock: from, toBlock: to }) as Log[]));
      } catch (e) {
        const m = (e as Error).message;
        // A rate limit: smaller windows only make more calls; wait it out (the caller pauses).
        if (rateLimited(e)) throw e;
        // Too many logs in one window (busy blocks) or a flaky RPC: read a smaller window instead of retrying the
        // same one forever, which would freeze awakenings, rules and trades behind it.
        if (this.range > 1_000n) { this.range = this.range / 2n > 1_000n ? this.range / 2n : 1_000n; this.log(`Reading blocks ${from}-${to} failed (${m.split("\n")[0].slice(0, 100)}); retrying ${this.range} blocks at a time`); continue; }
        throw e;
      }
      if (this.interp) this.lastWindow = { b: to, tb: this.interp.tb };
      // Window size follows how busy the chain is: bigger while quiet (fewer calls), smaller when full.
      if (logs.length < 2_000 && this.range < ENV.LOG_RANGE_MAX) this.range = this.range * 2n < ENV.LOG_RANGE_MAX ? this.range * 2n : ENV.LOG_RANGE_MAX;
      else if (logs.length > 8_000 && this.range > 1_000n) this.range = this.range / 2n;
      if (allCurves) { if (this.curvesTo !== from - 1n) this.curvesFrom = from; this.curvesTo = to; }
      const ev = (l: Log) => (l as { eventName?: string }).eventName;
      const at = (l: Log, x: string | null | undefined) => !!x && lc(l.address) === lc(x as Address);
      const factoryLogs = logs.filter((l) => at(l, ENV.PONS_FACTORY) && ["TokenLaunched", "PoolGraduated", "LaunchSwept"].includes(ev(l) ?? "")) as (Log & { eventName: string; args: Record<string, any> })[];
      const seenCurve = new Set<string>();
      const curveLogs = logs.filter((l) => (ev(l) === "CurveBuy" || ev(l) === "CurveSell") && !seenCurve.has(`${l.transactionHash}:${l.logIndex}`) && seenCurve.add(`${l.transactionHash}:${l.logIndex}`)) as (Log & { eventName: string; args: Record<string, any> })[];
      const claims = logs.filter((l) => at(l, ENV.FUND) && ev(l) === "Claimed") as (Log & { eventName: string; args: Record<string, any> })[];
      const adapterLogs = logs.filter((l) => at(l, this.adapter) && (ev(l) === "Bought" || ev(l) === "Sold")) as (Log & { eventName: string; args: Record<string, any> })[];
      const nftMoves = logs.filter((l) => at(l, ENV.NFT) && ev(l) === "Transfer" && (l as { args?: { tokenId?: unknown } }).args?.tokenId !== undefined) as (Log & { eventName: string; args: Record<string, any> })[];
      const pgLaunches = logs.filter((l) => at(l, ENV.PROGRAMMABLE_FACTORY) && ev(l) === "FoundationLaunchedV2");
      const rules = logs.filter((l) => (ev(l) === "RuleApplied" || ev(l) === "PolicySet") && !fixed.includes(lc(l.address)));
      const launches = factoryLogs.filter((l) => l.eventName === "TokenLaunched");
      const grads = factoryLogs.filter((l) => l.eventName !== "TokenLaunched");
      const swepts: typeof grads = [];
      const buys = curveLogs.filter((l) => l.eventName === "CurveBuy"), sells = curveLogs.filter((l) => l.eventName === "CurveSell");
      const bought = adapterLogs, sold: typeof adapterLogs = [];
      const all = [...launches, ...grads, ...swepts, ...buys, ...sells, ...claims, ...bought, ...sold, ...rules] as Log[];
      all.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || (a.logIndex! - b.logIndex!));
      for (const l of all) {
        try { await this.onLog(l as Log & { eventName: string; args: Record<string, unknown> }, live); }
        catch (e) {
          // One event that can't be read must not stop every event after it. Retried once, then logged and skipped.
          try { await this.onLog(l as Log & { eventName: string; args: Record<string, unknown> }, live); }
          catch { this.log(`Skipped a ${(l as { eventName?: string }).eventName ?? "log"} at block ${l.blockNumber} (${(e as Error).message.split("\n")[0].slice(0, 100)})`); }
        }
      }
      for (const l of pgLaunches) await this.onProgrammableLaunch(l as unknown as Log & { args: Record<string, any> }).catch((e) => this.log(`programmable: ${(e as Error).message.split("\n")[0]}`));
      // While catching up after a restart, mints and sales made since this process started are still posted
      // (the previous process stopped when this one came up, so it never saw them).
      // Mints for the site's ticker (grouped per transaction).
      const mintsByTx = new Map<string, { ids: number[]; block: bigint }>();
      for (const l of nftMoves) if (l.args.from === "0x0000000000000000000000000000000000000000" && l.transactionHash) {
        const m = mintsByTx.get(l.transactionHash) ?? { ids: [], block: l.blockNumber! }; m.ids.push(Number(l.args.tokenId)); mintsByTx.set(l.transactionHash, m);
      }
      for (const [tx, m] of mintsByTx) this.noteActivity({ kind: "mint", id: m.ids[0], count: m.ids.length, time: await this.blockTime(m.block), tx });
      const moves = !this.telegram ? [] : live ? nftMoves : nftMoves.filter((l) => l.blockNumber! >= this.catchUpFrom);
      if (moves.length && this.telegram) {
        this.log(`NFT: ${moves.length} transfer${moves.length > 1 ? "s" : ""} seen (${moves.map((m) => `#${Number(m.args.tokenId)}`).join(", ")}), posting to Telegram`);
        this.telegram.onTransfers(moves).catch((e) => this.log(`telegram: ${(e as Error).message.split("\n")[0]}`));
      }
      this.cursor = to;
      if (this.telegram && to >= this.catchUpFrom) this.telegram.markBlock(to);
      if (!live) this.log(`History read up to block ${to} of ${head} (${launches.length} launches, ${buys.length + sells.length} curve trades in this window)`);
    }
  }

  private async onLog(l: Log & { eventName: string; args: Record<string, unknown> }, live: boolean) {
    // Curve trades are emitted by every Pons coin; skip coins we don't follow before any RPC call
    // (on mainnet that's thousands of logs per replay window).
    if ((l.eventName === "CurveBuy" || l.eventName === "CurveSell") && !this.curves.has(lc(l.address))) return;
    const a = l.args as Record<string, any>;
    // Replayed curve trades only add to a coin's volume; they don't need a time (except agent coins, for their chart).
    const curveLog = l.eventName === "CurveBuy" || l.eventName === "CurveSell";
    const agentCoin = curveLog ? this.agentCoins.get(this.curves.get(lc(l.address))!) : undefined;
    const t = !live && curveLog && !agentCoin ? 0 : await this.blockTime(l.blockNumber!);
    switch (l.eventName) {
      case "TokenLaunched": {
        if (a.pairToken !== "0x0000000000000000000000000000000000000000") return; // ETH launches only
        const tok: Token = { token: lc(a.token), curve: lc(a.curve), deployer: lc(a.deployer), launchedAt: t, volumeEth: 0, graduated: false, tx: l.transactionHash ?? undefined, block: l.blockNumber ?? undefined };
        this.tokens.set(tok.token, tok); this.curves.set(tok.curve, tok.token);
        // Launched by an agent wallet: follow it as that agent's coin (fees, chart).
        const ag = this.agents.get(tok.deployer);
        if (ag) { this.agentCoins.set(tok.token, { token: tok.token, curve: tok.curve, agent: ag.id, wallet: ag.wallet, launchedAt: t, feeWei: 0n, taxWei: 0n, volumeEth: 0, trades: 0, points: [] }); this.noteActivity({ kind: "coin", id: ag.id, time: t, tx: l.transactionHash ?? null, symbol: this.symbols.get(tok.token) }); }
        if (live) this.signal("launch", tok, t);
        break;
      }
      // Graduation: the curve sells out (LaunchSwept), then anyone creates the Uniswap pool (PoolGraduated).
      // The trading route completes the pool step itself if needed, so agents can act on the first signal.
      case "LaunchSwept": case "PoolGraduated": {
        const tok = this.tokens.get(lc(a.token)); if (!tok) return;
        const first = !tok.graduated;
        tok.graduated = true;
        if (live && first) this.signal("graduation", tok, t);
        break;
      }
      case "CurveBuy": case "CurveSell": {
        const token = this.curves.get(lc(l.address)); if (!token) return;
        if (l.eventName === "CurveBuy" && a.recipient && this.agents.has(lc(a.recipient as string))) this.touch(lc(a.recipient as string), token);
        const tok = this.tokens.get(token)!;
        const eth = Number(formatEther((l.eventName === "CurveBuy" ? a.quoteIn : a.quoteOut) as bigint));
        const before = tok.volumeEth;
        tok.volumeEth += eth;
        if (agentCoin) {
          agentCoin.feeWei += a.fee as bigint; agentCoin.taxWei += a.tax as bigint; agentCoin.volumeEth += eth; agentCoin.trades++;
          const units = Number(formatEther((l.eventName === "CurveBuy" ? a.tokensOut : a.tokensIn) as bigint));
          const cut = Number(formatEther((a.fee as bigint) + (a.tax as bigint))), net = l.eventName === "CurveBuy" ? Math.max(0, eth - cut) : eth + cut; // the curve's price, without fee and tax
          if (units > 0 && net > 0) { agentCoin.points.push({ t, p: net / units }); if (agentCoin.points.length > 2000) agentCoin.points.splice(0, agentCoin.points.length - 2000); }
        }
        if (!live) return;
        if (tok.block !== undefined && tok.block >= this.curvesFrom) this.signal("volume", tok, t, { before, after: tok.volumeEth }); // only coins whose whole volume was read
        this.signal("mcap", tok, t);
        if (l.eventName === "CurveSell" && lc(a.seller) === tok.deployer) this.signal("devsell", tok, t);
        break;
      }
      case "Claimed": {
        const w = lc(a.agentWallet);
        if (live) { this.lastAgentRefresh = 0; this.log(`Agent #${Number(a.tokenId)} awakened (wallet ${w})`); }
        this.noteActivity({ kind: "awaken", id: Number(a.tokenId), time: t, tx: l.transactionHash ?? null });
        if (this.telegram && (live || l.blockNumber! >= this.catchUpFrom)) this.telegram.onAwaken(Number(a.tokenId), lc(a.holder), w, a.amount as bigint, l.transactionHash ?? null).catch(() => {});
        if (!this.agents.has(w)) this.agents.set(w, { id: Number(a.tokenId), wallet: w, live: false, perTrade: 0n, dailyCap: 0n, ruleVersion: 0, ruleText: null, rule: null, balance: 0n, spentDay: 0n, spentToday: 0n });
        break;
      }
      case "PolicySet": {
        // Start / pause / new limits: read the agent again straight away instead of on the next 15 s refresh.
        if (live) this.lastAgentRefresh = 0;
        break;
      }
      case "RuleApplied": {
        const ag = this.agents.get(lc(l.address)); if (!ag) return;
        ag.ruleVersion = Number(a.version); ag.ruleText = (a.ruleUri as string) || null; ag.ruleAt = t || this.now();
        for (const k of [...this.planNext.keys()]) if (k.startsWith(ag.wallet)) this.planNext.delete(k); // a new plan is checked straight away
        const parsed = ag.ruleText ? parse(ag.ruleText) : null;
        ag.rule = parsed?.rule ?? null;
        ag.understood = parsed?.understood ?? [];
        ag.ruleWarning = !parsed ? "No rule text found"
          : parsed.rule.trigger === "dexupdate" ? "The DexScreener signal isn't supported yet, so this agent won't buy"
          : parsed.missed ? "Part of this rule wasn't understood; the agent follows the parts listed"
          : null;
        if (ag.ruleWarning) this.log(`Agent #${ag.id} rule warning: ${ag.ruleWarning}`);
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
        await this.symbolOf(token);
        this.touch(w, token);
        this.addTrade(w, token, "buy", ethIn, tokens, t, l.transactionHash!, undefined, live ? "live" : l.blockNumber! >= this.catchUpFrom ? "catchup" : false);
        break;
      }
      case "Sold": {
        const w = lc(a.agent), token = lc(a.token);
        const book = this.book(w);
        const p = book.get(token);
        const tokensIn = a.tokensIn as bigint, ethOut = a.ethOut as bigint;
        let pnlPct: number | undefined;
        if (p && p.tokens > 0n) {
          const part = tokensIn >= p.tokens ? p.ethIn : (p.ethIn * tokensIn) / p.tokens;
          this.realized.push({ wallet: w, time: t, pnl: ethOut - part });
          if (part > 0n) pnlPct = (Number(formatEther(ethOut)) / Number(formatEther(part)) - 1) * 100;
          p.ethIn -= part; p.tokens -= tokensIn;
          if (p.tokens <= 0n) book.delete(token);
        }
        await this.symbolOf(token);
        this.addTrade(w, token, "sell", ethOut, tokensIn, t, l.transactionHash!, pnlPct, live ? "live" : l.blockNumber! >= this.catchUpFrom ? "catchup" : false);
        break;
      }
    }
  }

  private symbols = new Map<Address, string>();
  /** The coin's ticker (cached); falls back to a short address. */
  /**
   * A Programmable launch paired with $TRENCHERS becomes an agent's coin when it was launched by that agent's wallet, or by the
   * Trencher's holder with the Trencher's collection page as the coin's website. One coin per agent (Pons or Programmable).
   */
  private async onProgrammableLaunch(l: Log & { args: Record<string, any> }) {
    const a = l.args;
    if (lc(a.quote) !== ENV.TRENCHERS_TOKEN) return;
    const token = lc(a.token), creator = lc(a.creator);
    if (this.pgCoins.has(token)) return;
    let ag = this.agents.get(creator), byAgent = !!ag;
    if (!ag) {
      const site = await this.pub.readContract({ address: token, abi: FOUNDATION_TOKEN_ABI, functionName: "website" }).catch(() => "") as string;
      const m = /^https:\/\/(?:www\.)?trenchers\.io\/collection#(\d{1,4})$/.exec(site.trim());
      if (!m) return;
      const id = Number(m[1]);
      const cand = [...this.agents.values()].find((x) => x.id === id);
      if (!cand) return;
      // The holder at the launch block (falls back to today's holder if the RPC can't read old state).
      const holder = await this.pub.readContract({ address: ENV.NFT, abi: NFT_OWNER_ABI, functionName: "ownerOf", args: [BigInt(id)], blockNumber: l.blockNumber! })
        .catch(() => this.pub.readContract({ address: ENV.NFT, abi: NFT_OWNER_ABI, functionName: "ownerOf", args: [BigInt(id)] })).catch(() => null);
      if (!holder || lc(holder as Address) !== creator) return;
      ag = cand;
    }
    // One coin per agent: a Pons coin (or an earlier Programmable one) wins.
    if ((ag.coin && !/^0x0+$/.test(ag.coin) && lc(ag.coin) !== token) || [...this.agentCoins.values()].some((c) => c.wallet === ag!.wallet)
      || [...this.pgCoins.values()].some((c) => c.wallet === ag!.wallet)) return;
    const t = await this.blockTime(l.blockNumber!);
    this.pgCoins.set(token, { token, agent: ag.id, wallet: ag.wallet, creator, ledger: lc(a.ledger), hook: lc(a.hook), launchedAt: t, byAgent, tx: l.transactionHash ?? undefined });
    this.noteActivity({ kind: "coin", id: ag.id, time: t, tx: l.transactionHash ?? null, symbol: await this.symbolOf(token) });
    this.log(`Agent #${ag.id} coin on Programmable: ${token} (${byAgent ? "launched by the agent wallet" : "launched by its holder"})`);
  }

  private async symbolOf(token: Address) {
    let sym = this.symbols.get(token);
    if (sym === undefined) {
      sym = await this.pub.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }).catch(() => "") as string;
      sym = (sym || token.slice(2, 8)).replace(/^\$/, "").slice(0, 14).toUpperCase();
      this.symbols.set(token, sym);
      const tok = this.tokens.get(token); if (tok) tok.symbol = sym;
    }
    return sym;
  }

  private book(w: Address) { let b = this.positions.get(w); if (!b) { b = new Map(); this.positions.set(w, b); } return b; }
  private openCount() { let n = 0; for (const b of this.positions.values()) n += b.size; return n; }
  private addTrade(w: Address, token: Address, side: "buy" | "sell", eth: bigint, tokens: bigint, time: number, tx: Hash, pnlPct?: number, post: "live" | "catchup" | false = false) {
    const tr: Trade = { agent: this.agents.get(w)?.id ?? 0, wallet: w, token, symbol: this.symbols.get(token) ?? this.tokens.get(token)?.symbol, side, eth: formatEther(eth), tokens: tokens.toString(), time, tx, pnlPct };
    this.trades.push(tr);
    if (this.telegram && post) void this.telegram.onTrade(tr)?.catch(() => {});
    if (this.alerts && post === "live") this.alerts.onTrade(tr, this.agents.get(w)?.owner);
    if (this.trades.length > 5000) this.trades.splice(0, this.trades.length - 5000);
  }

  // ------------------------------------------------------------------ agents

  /** Uses the router agents really trade through, even if ADAPTER_ADDRESS was set to something else. */
  private async resolveRouter() {
    const any = this.agents.values().next().value as Agent | undefined;
    if (!any) return;
    try {
      this.configAddress ??= lc(await this.pub.readContract({ address: any.wallet, abi: AGENT_ABI, functionName: "config" }));
      const r = lc(await this.pub.readContract({ address: this.configAddress!, abi: CONFIG_ABI, functionName: "router" }));
      if (r !== this.adapter) { this.log(`ADAPTER_ADDRESS is ${this.adapter}, but agents trade through ${r}: using ${r}`); this.adapter = r; }
    } catch { /* keep the configured one */ }
  }

  /** Coins an agent holds without a recorded buy (e.g. bought while the engine restarted): picked up as
   *  positions so the agent's exit rule still sells them. */
  private lastRecover = 0;
  feeKeeper = new FeeKeeper(this);
  /** Coins each agent wallet ever received from a buy (its own or someone buying for it): the only ones it can hold. */
  private touched = new Map<Address, Set<Address>>();
  private touch(wallet: Address, token: Address) { let s = this.touched.get(wallet); if (!s) this.touched.set(wallet, (s = new Set())); s.add(token); }

  private async recoverHoldings() {
    this.lastRecover = Date.now();
    for (const ag of this.agents.values()) {
      if (!this.tradable(ag)) continue;
      // Only the coins this wallet ever bought or was sent by a buy (not all 11,000+ Pons coins every minute,
      // which made each round slow and used up the RPC's rate limit).
      const toks = [...(this.touched.get(ag.wallet) ?? [])].map((t) => this.tokens.get(t)).filter((t): t is NonNullable<typeof t> => !!t);
      if (!toks.length) continue;
      const book = this.book(ag.wallet);
      const bals = await Promise.all(toks.map((t) => this.pub.readContract({ address: t.token, abi: ERC20_ABI, functionName: "balanceOf", args: [ag.wallet] }).catch(() => 0n)));
      for (let i = 0; i < toks.length; i++) {
        const tok = toks[i], bal = bals[i];
        if (bal === 0n || book.has(tok.token) || lc(tok.token) === ag.coin) continue;
        let value = 0n;
        try { value = await this.quoteSell(tok, bal); } catch { /* unknown */ }
        book.set(tok.token, { token: tok.token, ethIn: value, tokens: bal, openedAt: this.now() });
        this.log(`Agent #${ag.id} holds ${tok.token} without a recorded buy: managing it now (worth ~${Number(formatEther(value)).toPrecision(3)} ETH)`);
      }
    }
  }

  /** House agents (#1-5) never claim a starter balance, so no Claimed event announces them: look up their
   *  wallets directly. `scan` reads the rules of a wallet found after the history replay. */
  private houseKnown = new Set<number>();
  private async discoverHouse(scan: boolean) {
    for (let id = 1; id <= 5; id++) {
      if (this.houseKnown.has(id)) continue;
      try {
        const w = lc(await this.pub.readContract({ address: ENV.FUND, abi: FUND_ABI, functionName: "agentWallet", args: [BigInt(id)] }));
        const code = await this.pub.getCode({ address: w });
        if (!code || code === "0x") continue;
        this.houseKnown.add(id);
        if (this.agents.has(w)) continue;
        this.agents.set(w, { id, wallet: w, live: false, perTrade: 0n, dailyCap: 0n, ruleVersion: 0, ruleText: null, rule: null, balance: 0n, spentDay: 0n, spentToday: 0n });
        this.log(`House agent #${id} found (wallet ${w})`);
        if (scan) {
          const head = await this.pub.getBlockNumber();
          for (let f = ENV.START_BLOCK; f <= head; f += ENV.LOG_RANGE) {
            const t = f + ENV.LOG_RANGE - 1n < head ? f + ENV.LOG_RANGE - 1n : head;
            const logs = await this.pub.getLogs({ address: w, event: RULE_APPLIED, fromBlock: f, toBlock: t });
            for (const l of logs) await this.onLog(l as unknown as Log & { eventName: string; args: Record<string, unknown> }, false);
          }
        }
      } catch { /* awakening not open yet, or the RPC hiccuped: try again on the next refresh */ }
    }
  }

  private async refreshAgents(first: boolean, only?: Set<Address>) {
    if (!only) { this.lastAgentRefresh = Date.now(); await this.readPause(); if (!first) await this.discoverHouse(true); }
    // All agents at once: with Multicall3 every read (balances too) goes out as one request instead of six per agent.
    await Promise.all([...this.agents.values()].map(async (ag) => {
      if (only && !only.has(ag.wallet)) return;
      try {
        const [pol, owner, coin, balance, spentDay, spentToday] = await Promise.all([
          this.pub.readContract({ address: ag.wallet, abi: AGENT_ABI, functionName: "policy" }),
          this.pub.readContract({ address: ag.wallet, abi: AGENT_ABI, functionName: "owner" }),
          this.pub.readContract({ address: ag.wallet, abi: AGENT_ABI, functionName: "coin" }),
          this.multicall ? this.pub.readContract({ address: MULTICALL3, abi: MC3_ABI, functionName: "getEthBalance", args: [ag.wallet] }) : this.pub.getBalance({ address: ag.wallet }),
          this.pub.readContract({ address: ag.wallet, abi: AGENT_ABI, functionName: "spentDay" }),
          this.pub.readContract({ address: ag.wallet, abi: AGENT_ABI, functionName: "spentToday" }),
        ]);
        const [perTrade, dailyCap, live, setBy] = pol;
        const wasLive = ag.live && ag.setBy === ag.owner;
        Object.assign(ag, { perTrade, dailyCap, live, setBy: lc(setBy), owner: lc(owner), coin: lc(coin), balance, spentDay, spentToday });
        const isLive = ag.live && ag.setBy === ag.owner;
        if (!first && isLive !== wasLive) this.log(`Agent #${ag.id} is now ${isLive ? "trading" : "paused"}`);
      } catch (e) { this.log(`Agent #${ag.id}: could not read (${(e as Error).message.split("\n")[0]})`); }
    }));
  }

  private tradable(ag: Agent) { return !!ag.rule && ag.live && !!ag.owner && ag.setBy === ag.owner && ag.perTrade > 0n; }

  // ------------------------------------------------------------------ signals → entries

  /** How often each kind of Pons signal was seen, and when last: shows on /health whether the chain is busy. */
  seen: Record<string, { n: number; last: number }> = {};
  private noteOnce(key: string, msg: string) {
    if (Date.now() - (this.skipNoted.get(key as Address) ?? 0) < 3_600_000) return;
    this.skipNoted.set(key as Address, Date.now()); this.log(msg);
  }
  private sellFails = new Map<string, { n: number; first: number }>();

  /** Why an agent can't buy right now (null: it's ready), with a short code the site uses to offer a fix. */
  blockedOf(ag: Agent): { code: "no-rule" | "unsupported" | "off" | "no-limit" | "max-positions" | "daily-limit" | "no-eth"; text: string } | null {
    const today = BigInt(Math.floor(this.now() / 86400));
    const spent = ag.spentDay === today ? ag.spentToday : 0n;
    if (!ag.rule) return { code: "no-rule", text: "no rule" };
    if (ag.rule.trigger === "dexupdate") return { code: "unsupported", text: "its DexScreener signal isn't supported yet" };
    if (ag.rule.trigger === "token" && ag.rule.token && this.notPons.has(lc(ag.rule.token))) return { code: "unsupported", text: "its token isn't a Pons coin paired with ETH, so the agent can't buy it" };
    if (ag.rule.trigger === "token" && ag.coin && ag.rule.token && lc(ag.rule.token) === ag.coin) return { code: "unsupported", text: "an agent can't buy its own coin" };
    if (!ag.live || ag.setBy !== ag.owner) return { code: "off", text: "trading switched off" };
    if (ag.perTrade === 0n) return { code: "no-limit", text: "no per-trade limit" };
    if (this.book(ag.wallet).size >= ENV.MAX_POSITIONS) return { code: "max-positions", text: `holding the maximum ${ENV.MAX_POSITIONS} positions` };
    if (spent >= ag.dailyCap) return { code: "daily-limit", text: "daily limit reached (resets 00:00 UTC)" };
    if (ag.balance < 10_000_000_000n) return { code: "no-eth", text: "no ETH left in its wallet" };
    return null;
  }

  /** Why each agent is or isn't trading right now, for /health. */
  diag() {
    const now = this.now(), today = BigInt(Math.floor(now / 86400));
    const ago = (t: number) => (t ? `${Math.round((now - t) / 60)} min ago` : "never");
    const agents = [...this.agents.values()].map((ag) => {
      const book = this.book(ag.wallet), mine = this.trades.filter((x) => x.wallet === ag.wallet);
      const last = mine.length ? Math.max(...mine.map((x) => x.time)) : 0;
      const spent = ag.spentDay === today ? ag.spentToday : 0n;
      const blocked = this.blockedOf(ag)?.text ?? null;
      return { id: ag.id, trigger: ag.rule?.trigger ?? null, ready: !blocked, waitingFor: blocked ?? (ag.rule!.trigger === "token" ? this.planStatus(ag) : `the next ${ag.rule!.trigger} signal`), open: book.size,
        balance: Number(formatEther(ag.balance)).toFixed(5), spentToday: `${formatEther(spent)} / ${formatEther(ag.dailyCap)} ETH`, lastTrade: ago(last) };
    }).filter((a) => a.trigger || a.open);
    const launches = [...this.tokens.values()].reduce((m, x) => Math.max(m, x.launchedAt), 0);
    const signals = Object.fromEntries(Object.entries(this.seen).map(([k, v]) => [k, `${v.n} since start, last ${ago(v.last)}`]));
    return { lastPonsLaunch: ago(launches), signals, agents };
  }

  private signal(kind: CustomRule["trigger"], tok: Token, t: number, extra?: { before: number; after: number }) {
    if (kind !== "mcap" && (kind !== "volume" || (extra && extra.before < 50_000 / ENV.ETH_USD && extra.after >= 50_000 / ENV.ETH_USD))) {
      const k = kind === "volume" ? "volume crossed $50k" : kind; const v = (this.seen[k] ??= { n: 0, last: 0 }); v.n++; v.last = Math.max(v.last, t);
    }
    if (tok.graduated && kind !== "graduation" && kind !== "devsell") return; // curve signals stop once a coin graduates
    for (const ag of this.agents.values()) {
      const r = ag.rule;
      // Live/limits are checked again with fresh on-chain data when the entry is due (runEntries).
      if (!r || r.trigger !== kind || (!this.tradable(ag) && kind !== "launch")) continue;
      if (kind === "volume") {
        const th = (r.threshold ?? 50_000) / ENV.ETH_USD;
        if (!extra || !(extra.before < th && extra.after >= th)) continue;
      }
      if (kind === "mcap") continue; // evaluated in runEntries with fresh reserves (see below)

      const notBefore = kind === "launch" ? tok.launchedAt + ENV.SNIPE_WAIT_SEC : t;
      this.entries.push({ wallet: ag.wallet, token: tok.token, notBefore, reason: kind });
    }
    // Market-cap triggers need two chain reads per curve trade: only when an agent actually uses one.
    if (kind === "mcap" && [...this.agents.values()].some((ag) => ag.rule?.trigger === "mcap" && this.tradable(ag))) this.mcapCheck(tok, t);
  }

  /** True once the coin's curve has sold out (graduation may still be completing). */
  private async onPool(tok: Token) {
    if (tok.graduated) return true;
    const done = await this.pub.readContract({ address: tok.curve, abi: CURVE_ABI, functionName: "graduated" }).catch(() => false);
    if (done) tok.graduated = true;
    return done;
  }

  /** The v4 pool's virtual reserves (Pons seeds a full-range position, so it behaves like x * y = k). */
  private async poolReserves(tok: Token) {
    const [sp, L] = await this.pub.readContract({ address: this.adapter, abi: ADAPTER_ABI, functionName: "poolState", args: [tok.token] });
    if (sp === 0n || L === 0n) throw new Error("pool not ready");
    return { eth: (L << 96n) / sp, coins: (L * sp) >> 96n };
  }

  /** Fee-free estimate of the coins a buy of `eth` gets now, including price impact (curve or pool). */
  private async quoteBuy(tok: Token, eth: bigint): Promise<bigint> {
    if (!(await this.onPool(tok))) {
      const [q, k] = await this.pub.readContract({ address: tok.curve, abi: CURVE_ABI, functionName: "getReserves" });
      return (k * eth) / (q + eth);
    }
    const r = await this.poolReserves(tok);
    return (r.coins * eth) / (r.eth + eth);
  }

  /** Estimate of the ETH a sale of `coins` brings now, including price impact and ~2% fees (curve or pool). */
  private async quoteSell(tok: Token, coins: bigint): Promise<bigint> {
    if (!(await this.onPool(tok))) {
      const [q, k] = await this.pub.readContract({ address: tok.curve, abi: CURVE_ABI, functionName: "getReserves" });
      return (q * coins) / (k + coins);
    }
    const r = await this.poolReserves(tok);
    return ((r.eth * coins) / (r.coins + coins)) * 98n / 100n;
  }

  /** Exact result of a trade, by simulating the agent wallet's own call from the engine (minOut 0). */
  private async simulateTrade(wallet: Address, value: bigint, data: Hex): Promise<bigint> {
    const { result } = await this.pub.simulateContract({ address: wallet, abi: AGENT_ABI, functionName: "trade", args: [value, data], account: this.wallet?.account ?? this.engineAddress! });
    return decodeAbiParameters([{ type: "uint256" }], result as Hex)[0];
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
      if (!ag || !tok) continue;
      if (!this.tradable(ag)) { if (Date.now() - (this.skipNoted.get(ag.wallet) ?? 0) > 3_600_000) { this.skipNoted.set(ag.wallet, Date.now()); this.log(`Agent #${ag.id} skipped ${tok.token}: ${!ag.live || ag.setBy !== ag.owner ? "trading is switched off" : ag.perTrade === 0n ? "no per-trade limit set" : "no rule"}`); } continue; }
      const r = ag.rule!;
      if ((ag.coin && ag.coin === tok.token) || this.agentCoins.get(tok.token)?.wallet === ag.wallet) continue; // never its own coin
      const book = this.book(ag.wallet);
      if (book.has(tok.token)) continue;
      if (book.size >= ENV.MAX_POSITIONS) { this.noteOnce(`full:${ag.wallet}`, `Agent #${ag.id} skipped ${tok.token}: already holds the maximum ${ENV.MAX_POSITIONS} positions`); continue; }
      if (r.maxAgeMin && ts - tok.launchedAt > r.maxAgeMin * 60) continue;
      if (r.minLiquidityEth) {
        const liq = await this.pub.readContract({ address: tok.curve, abi: CURVE_ABI, functionName: "trackedQuote" }).catch(() => 0n);
        if (Number(formatEther(liq)) < r.minLiquidityEth) continue;
      }
      await this.buy(ag, tok, e.reason);
    }
  }

  // ------------------------------------------------------------------ specific-token plans

  /** Coins confirmed not to be ETH-paired Pons launches (a rule pointing at one can't trade). */
  notPons = new Set<Address>();
  private notPonsAt = new Map<Address, number>();
  private lookedUp = new Map<Address, number>();
  /** The coin a specific-token rule names: followed already, or looked up on the Pons factory (older launches). */
  async ensureToken(addr: Address): Promise<Token | null> {
    const a = lc(addr);
    const known = this.tokens.get(a); if (known) return known;
    // A "not Pons" verdict is re-checked every 30 minutes, so nothing stays blocked by one bad answer.
    if (this.notPons.has(a) && Date.now() - (this.notPonsAt.get(a) ?? 0) > 1_800_000) this.notPons.delete(a);
    if (this.notPons.has(a) || Date.now() - (this.lookedUp.get(a) ?? 0) < 120_000) return null;
    this.lookedUp.set(a, Date.now());
    try {
      const rec = await this.pub.readContract({ address: ENV.PONS_FACTORY, abi: PONS_RECORD_ABI, functionName: "getLaunchedToken", args: [a] }) as { token: Address; curve: Address; deployer: Address; pairToken: Address };
      if (!rec || /^0x0+$/.test(rec.token) || !/^0x0+$/.test(rec.pairToken)) { this.notPons.add(a); this.notPonsAt.set(a, Date.now()); this.log(`${a} isn't an ETH-paired Pons coin`); return null; }
      const tok: Token = { token: a, curve: lc(rec.curve), deployer: lc(rec.deployer), launchedAt: 0, volumeEth: 0, graduated: false };
      this.tokens.set(a, tok); this.curves.set(tok.curve, a);
      await this.onPool(tok).catch(() => false);
      this.log(`Following ${a} (${await this.symbolOf(a)}) for a specific-token strategy`);
      return tok;
    } catch (e) {
      // Only the factory itself refusing (a contract revert) means "not a Pons coin". Network and RPC errors
      // (timeouts, rate limits, "invalid response"...) are retried, never remembered: a hiccup must not stop a plan.
      const m = (e as Error).message, reverted = (e as { name?: string }).name === "ContractFunctionExecutionError" && /revert/i.test(m) && !/HTTP|timeout|rate|fetch|network|socket/i.test(m);
      if (reverted) { this.notPons.add(a); this.notPonsAt.set(a, Date.now()); this.log(`${a} isn't a Pons coin (${m.split("\n")[0].slice(0, 80)})`); }
      else this.log(`${a}: lookup failed, retrying (${m.split("\n")[0].slice(0, 80)})`);
      return null;
    }
  }

  /** Market cap in ETH right now (curve or Uniswap pool). */
  private mcapCache = new Map<Address, { t: number; v: number }>();
  async mcapOf(tok: Token): Promise<number> {
    const c = this.mcapCache.get(tok.token);
    if (c && Date.now() - c.t < 15_000) return c.v;
    tok.supply ??= await this.pub.readContract({ address: tok.token, abi: ERC20_ABI, functionName: "totalSupply" });
    let v: number;
    if (!(await this.onPool(tok))) {
      const [q, k] = await this.pub.readContract({ address: tok.curve, abi: CURVE_ABI, functionName: "getReserves" });
      v = k > 0n ? Number(formatEther((q * tok.supply) / k)) : 0;
    } else {
      const r = await this.poolReserves(tok);
      v = r.coins > 0n ? Number(formatEther((r.eth * tok.supply) / r.coins)) : 0;
    }
    this.mcapCache.set(tok.token, { t: Date.now(), v });
    return v;
  }

  /** The buys an agent made into its rule's token since the rule was applied. */
  private planBuys(ag: Agent) {
    const token = lc(ag.rule!.token!), from = ag.ruleAt ?? 0;
    const buys = this.trades.filter((x) => x.wallet === ag.wallet && x.token === token && x.side === "buy" && x.time >= from);
    const spent = buys.reduce((s, x) => s + Number(x.eth), 0);
    return { buys, spent, last: buys.length ? Math.max(...buys.map((x) => x.time)) : 0 };
  }

  /** In words, where a specific-token plan stands (for /health). */
  planStatus(ag: Agent) {
    const r = ag.rule!; const { buys, spent } = this.planBuys(ag);
    const budget = r.budgetEth ? ` · ${spent.toFixed(4)} / ${r.budgetEth} ETH` : "";
    if (r.budgetEth && spent >= r.budgetEth * 0.999) return `plan complete: budget spent${budget}`;
    if (r.tokenMode === "once") return buys.length ? "plan complete: bought" : "its one buy";
    if (r.tokenMode === "dca") { const n = dcaBuys(r); return buys.length >= n ? `plan complete: ${n} buys${budget}` : `DCA buy ${buys.length + 1} of ${n}${budget}`; }
    return `market cap below ${r.threshold} ETH${budget}`;
  }

  private planNext = new Map<string, number>();
  /** Specific-token strategies run on time and price, not on Pons events: checked every few seconds. */
  private async runTokenPlans() {
    const ts = this.now();
    for (const ag of this.agents.values()) {
      const r = ag.rule;
      if (!r || r.trigger !== "token" || !r.token || !this.tradable(ag)) continue;
      const key = `${ag.wallet}:${lc(r.token)}`;
      if ((this.planNext.get(key) ?? 0) > Date.now()) continue;
      this.planNext.set(key, Date.now() + 20_000);
      const tok = await this.ensureToken(r.token as Address);
      if (!tok || (ag.coin && ag.coin === tok.token)) continue;
      const { buys, spent, last } = this.planBuys(ag);
      const budgetLeft = r.budgetEth ? r.budgetEth - spent : Infinity;
      if (budgetLeft <= r.budgetEth! * 0.001) continue;
      const every = (r.everyHours ?? defaultEvery(r)) * 3600;
      const from = ag.ruleAt ?? ts;
      let due = false, cap = Number.isFinite(budgetLeft) ? budgetLeft : Infinity, why = "";
      if (r.tokenMode === "dca") {
        const n = dcaBuys(r), slots = Math.min(n, Math.floor((ts - from) / every) + 1);
        // One buy per slot; after downtime it catches up one buy at a time, never two within half an interval.
        due = buys.length < slots && ts - last >= every / 2;
        if (r.budgetEth) cap = Math.min(budgetLeft, r.budgetEth / n);
        why = `DCA ${buys.length + 1}/${n}`;
      } else if (r.tokenMode === "below") {
        if (ts - last < every) continue;
        const mcap = await this.mcapOf(tok).catch(() => null);
        if (mcap === null) continue;
        due = mcap <= (r.threshold ?? 0);
        why = `mcap ${mcap.toFixed(2)} ETH <= ${r.threshold}`;
      } else { due = buys.length === 0; why = "buy once"; }
      if (!due) continue;
      // Don't fire again before this buy's Bought event is read back.
      this.planNext.set(key, Date.now() + 60_000);
      await this.refreshAgents(false, new Set([ag.wallet]));
      if (!this.tradable(ag)) continue;
      const max = Number.isFinite(cap) ? BigInt(Math.round(cap * 1e18)) : undefined;
      // Sent: the next tick reads its Bought event first, so a few seconds is enough. Not sent: wait a minute.
      const ok = await this.buy(ag, tok, why, max);
      this.planNext.set(key, Date.now() + (ok ? 5_000 : 60_000));
    }
  }

  /** Ticker, name and logo of a coin; the logo is the image link in its Pons launch transaction. Cached. */
  private metas = new Map<Address, TokenMeta & { at: number }>();
  async tokenMeta(addr: Address): Promise<TokenMeta | null> {
    const a = lc(addr);
    const c = this.metas.get(a);
    if (c && Date.now() - c.at < 600_000) return { ...c, mcapEth: await this.mcapOf(this.tokens.get(a)!).catch(() => c.mcapEth) };
    const tok = await this.ensureToken(a);
    if (!tok) return null;
    const [symbol, name] = await Promise.all([this.symbolOf(a), this.pub.readContract({ address: a, abi: ERC20_ABI, functionName: "name" }).catch(() => "") as Promise<string>]);
    let logo = c?.logo ?? null;
    if (!logo) logo = await this.launchLogo(tok).catch(() => null);
    const meta = { token: a, symbol, name, logo, graduated: tok.graduated, mcapEth: await this.mcapOf(tok).catch(() => null), at: Date.now() };
    this.metas.set(a, meta);
    const { at: _at, ...out } = meta; return out;
  }

  /** The image link among the strings in the coin's launch transaction (name, symbol, logo, description...). */
  private async launchLogo(tok: Token): Promise<string | null> {
    let hash = tok.tx;
    if (!hash) {
      // Launched before the engine's history: find its launch block (the coin's code appears there), then the event.
      const head = await this.pub.getBlockNumber();
      const has = async (n: bigint) => { const code = await this.pub.getCode({ address: tok.token, blockNumber: n }); return !!code && code !== "0x"; };
      let lo = 0n, hi = head;
      while (lo < hi) { const mid = (lo + hi) / 2n; if (await has(mid)) hi = mid; else lo = mid + 1n; }
      const logs = await this.pub.getLogs({ address: ENV.PONS_FACTORY, event: TOKEN_LAUNCHED, args: { token: tok.token }, fromBlock: lo, toBlock: lo });
      hash = logs[0]?.transactionHash ?? undefined;
      if (!hash) return null;
      tok.tx = hash;
      if (!tok.launchedAt) tok.launchedAt = await this.blockTime(lo).catch(() => 0);
    }
    const tx = await this.pub.getTransaction({ hash });
    const bytes = Buffer.from(tx.input.slice(2), "hex");
    // ABI-encoded strings sit in the calldata as plain text padded with zeros; the logo comes before the socials.
    const urls = bytes.toString("latin1").match(/(?:https?|ipfs):\/\/[\x21-\x7e]+/gi) ?? [];
    const url = urls.find((u) => /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(u)) ?? urls.find((u) => !/(x|twitter)\.com|t\.me|discord|warpcast|farcaster/i.test(u)) ?? null;
    if (!url) { const d = bytes.toString("latin1").match(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/); return d && d[0].length < 200_000 ? d[0] : null; }
    return url.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${url.slice(7).replace(/^ipfs\//, "")}` : url;
  }

  // ------------------------------------------------------------------ trades

  private async buy(ag: Agent, tok: Token, reason: string, maxSize?: bigint): Promise<boolean> {
    const key = `${ag.wallet}:${tok.token}`; if (this.busy.has(key)) return false; this.busy.add(key);
    try {
      const today = BigInt(Math.floor(this.now() / 86400));
      const spent = ag.spentDay === today ? ag.spentToday : 0n;
      let size = ag.perTrade;
      if (maxSize !== undefined && maxSize < size) size = maxSize;
      if (spent + size > ag.dailyCap) size = ag.dailyCap > spent ? ag.dailyCap - spent : 0n;
      if (size > ag.balance) size = ag.balance;
      if (size < 10_000_000_000n) { this.noteOnce(`size:${ag.wallet}`, `Agent #${ag.id} skipped ${tok.token}: ${spent >= ag.dailyCap ? "daily limit reached" : "no ETH left in its wallet"}`); return false; } // nothing worth trading
      // What the trade would really get right now (fees, snipe tax, price impact, graduation all included).
      const sim = await this.simulateTrade(ag.wallet, size, encodeFunctionData({ abi: ADAPTER_ABI, functionName: "buy", args: [tok.token, 0n] }));
      const fair = await this.quoteBuy(tok, size).catch(() => 0n);
      if (fair > 0n && sim * 100n < fair * 70n) {
        // Much worse than the fee-free price: most likely Pons's anti-snipe tax. Try again shortly.
        if (this.now() - tok.launchedAt < 120) { this.entries.push({ wallet: ag.wallet, token: tok.token, notBefore: this.now() + 3, reason }); this.log(`Agent #${ag.id} waits: ${tok.token} is still taxed (${Number(sim * 100n / fair)}% of fair)`); }
        else this.log(`Agent #${ag.id} skipped ${tok.token}: price ${Number(sim * 100n / fair)}% of fair`);
        return false;
      }
      const minOut = (sim * BigInt(100 - ENV.SLIPPAGE_PCT)) / 100n;
      const data = encodeFunctionData({ abi: ADAPTER_ABI, functionName: "buy", args: [tok.token, minOut] });
      this.log(`Agent #${ag.id} BUY ${tok.token} for ${formatEther(size)} ETH (${reason})`);
      const hash = await this.send(ag.wallet, "trade", [size, data]);
      if (hash) { ag.spentToday = spent + size; ag.spentDay = today; ag.balance -= size; }
      return !!hash;
    } catch (e) { this.log(`Agent #${ag.id} buy failed: ${(e as Error).message.split("\n")[0]}`); return false; }
    finally { this.busy.delete(key); }
  }

  /** When each position's price was last read for a take-profit / stop-loss check (prices are only read for those). */
  private quotedAt = new Map<string, number>();
  private async runExits() {
    const ts = this.now();
    for (const [w, book] of this.positions) {
      const ag = this.agents.get(w); if (!ag) continue;
      // A paused agent can't sell anyway (its wallet refuses trades): don't spend chain reads on it.
      if (!ag.live || ag.setBy !== ag.owner) continue;
      for (const p of book.values()) {
        const tok = this.tokens.get(p.token); if (!tok) continue;
        const r = ag.rule;
        const age = ts - p.openedAt;
        let why: string | null = null;
        if (r?.exit === "time" && age >= (r.holdSec ?? 60)) why = `held ${age}s`;
        else if (age >= ENV.MAX_HOLD_SEC && !(r?.exit === "hold" && !!r.token && lc(r.token) === p.token)) why = "max hold";
        else if (!r) why = "no rule any more";
        else if (r.exit === "tpsl" && (r.takeProfitPct || r.stopLossPct)) {
          // Only take-profit / stop-loss needs the price, and at most every 15 s per position.
          const k = `${w}:${p.token}`;
          if (Date.now() - (this.quotedAt.get(k) ?? 0) < 15_000) continue;
          this.quotedAt.set(k, Date.now());
          let value = 0n;
          try { value = await this.quoteSell(tok, p.tokens); this.sellFails.delete(`q:${w}:${tok.token}`); }
          catch (e) { this.failed(`q:${w}:${tok.token}`, ag, tok, p, `it can't be priced (${(e as Error).message.split("\n")[0].slice(0, 80)})`); continue; }
          const pnl = p.ethIn > 0n ? Number(value - p.ethIn) / Number(p.ethIn) * 100 : 0;
          if (r.takeProfitPct && pnl >= r.takeProfitPct) why = `take profit ${pnl.toFixed(1)}%`;
          else if (r.stopLossPct && pnl <= -r.stopLossPct) why = `stop loss ${pnl.toFixed(1)}%`;
          if (why) { await this.sell(ag, tok, p, value, why); continue; }
        }
        if (why) {
          let value = 0n;
          try { value = await this.quoteSell(tok, p.tokens); }
          catch (e) { this.failed(`q:${w}:${tok.token}`, ag, tok, p, `it can't be priced (${(e as Error).message.split("\n")[0].slice(0, 80)})`); continue; }
          await this.sell(ag, tok, p, value, why);
        }
      }
    }
  }

  private async sell(ag: Agent, tok: Token, p: Position, value: bigint, why: string) {
    const key = `${ag.wallet}:${tok.token}`; if (this.busy.has(key)) return; this.busy.add(key);
    try {
      const held = await this.pub.readContract({ address: tok.token, abi: ERC20_ABI, functionName: "balanceOf", args: [ag.wallet] });
      if (held === 0n) { this.book(ag.wallet).delete(tok.token); return; }
      const ok = await this.send(ag.wallet, "approveRouter", [tok.token, held]);
      if (!ok) return;
      // The exact proceeds right now (simulated after the approval), so slippage is measured from reality.
      const sim = await this.simulateTrade(ag.wallet, 0n, encodeFunctionData({ abi: ADAPTER_ABI, functionName: "sell", args: [tok.token, held, 0n] })).catch(() => value);
      const minOut = (sim * BigInt(100 - ENV.SLIPPAGE_PCT)) / 100n;
      this.log(`Agent #${ag.id} SELL ${tok.token} (${why}), ~${Number(formatEther(sim)).toPrecision(4)} ETH`);
      await this.send(ag.wallet, "trade", [0n, encodeFunctionData({ abi: ADAPTER_ABI, functionName: "sell", args: [tok.token, held, minOut] })]);
      this.sellFails.delete(`s:${key}`);
    } catch (e) { this.log(`Agent #${ag.id} sell failed: ${(e as Error).message.split("\n")[0]}`); this.failed(`s:${key}`, ag, tok, p, "its sell keeps failing"); }
    finally { this.busy.delete(key); }
  }

  /**
   * Counts failures on one position. Once it has failed at least 5 times over 30+ minutes it stops counting against the
   * agent's open slots, so a coin that can't be sold doesn't block new trades for good. Its tokens stay in the wallet.
   */
  private failed(key: string, ag: Agent, tok: Token, p: Position, why: string) {
    const now = Date.now(), f = this.sellFails.get(key) ?? { n: 0, first: now };
    f.n++; this.sellFails.set(key, f);
    if (f.n < 5 || now - f.first < 1_800_000) return false;
    this.book(ag.wallet).delete(p.token); this.sellFails.delete(key);
    this.log(`Agent #${ag.id} set aside ${tok.token}: ${why}. Its tokens stay in the agent wallet; the slot is free for new trades.`);
    return true;
  }

  private queue: Promise<unknown> = Promise.resolve();
  /** Sends one engine call to an agent wallet, one at a time (simple nonce handling), after a dry run. */
  private send(wallet: Address, fn: "trade" | "approveRouter", args: readonly unknown[]): Promise<Hash | null> {
    return this.sendTo(wallet, AGENT_ABI as readonly unknown[], fn, args);
  }
  /** Any engine transaction (agent trades, fee distributor upkeep), queued so nonces never clash. */
  sendTo(address: Address, abi: readonly unknown[], fn: string, args: readonly unknown[]): Promise<Hash | null> {
    const job = this.queue.then(async () => {
      if (ENV.DRY_RUN || !this.wallet || !this.engineAddress) { this.log(`  (not sent: ${ENV.DRY_RUN ? "dry run" : "no ENGINE_KEY"})`); return null; }
      const { request } = await this.pub.simulateContract({ address, abi: abi as never, functionName: fn as never, args: args as never, account: this.wallet.account! });
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

  /** Agent value: ETH in the wallet plus open positions at what they'd sell for now. */
  private async valueOf(ag: Agent) {
    const book = this.book(ag.wallet);
    ag.balance = await (this.multicall ? this.pub.readContract({ address: MULTICALL3, abi: MC3_ABI, functionName: "getEthBalance", args: [ag.wallet] }) : this.pub.getBalance({ address: ag.wallet })).catch(() => ag.balance);
    let open = 0n, cost = 0n;
    const positions: { token: Address; symbol?: string; cost: number; value: number; since: number }[] = [];
    for (const p of book.values()) {
      const tok = this.tokens.get(p.token) ?? await this.ensureToken(p.token).catch(() => null);
      cost += p.ethIn;
      let value = 0n;
      if (tok) { try { value = await this.quoteSell(tok, p.tokens); } catch (e) { this.noteOnce(`val:${ag.wallet}:${p.token}`, `Agent #${ag.id}: can't value ${p.token} (${(e as Error).message.split("\n")[0].slice(0, 80)})`); } }
      else this.noteOnce(`val:${ag.wallet}:${p.token}`, `Agent #${ag.id}: can't value ${p.token} (coin not followed yet)`);
      open += value;
      positions.push({ token: p.token, symbol: this.symbols.get(p.token), cost: Number(formatEther(p.ethIn)), value: Number(formatEther(value)), since: p.openedAt });
    }
    return { open, cost, positions, nav: Number(formatEther(ag.balance + open)) };
  }

  private async snapshot() {
    this.lastSnapshot = Date.now();
    const t = this.now();
    await Promise.all([...this.agents.values()].map(async (ag) => {
      try {
        const { nav } = await this.valueOf(ag);
        const h = this.history.get(ag.wallet) ?? [];
        h.push({ t, v: nav });
        while (h.length > 720) h.shift();
        this.history.set(ag.wallet, h);
      } catch { /* next time */ }
    }));
  }

  /**
   * Value over time, rebuilt from the agent's own trades (so it survives restarts): each closed trade moves the value
   * by its profit or loss; the snapshots taken since this process started add the open positions' moves in between.
   * Deposits and withdrawals aren't trades, so they show up only in snapshots.
   */
  private valueHistory(wallet: Address, nav: number, unrealized: bigint) {
    const now = this.now();
    const real = this.realized.filter((x) => x.wallet === wallet && x.time > 0).sort((a, b) => a.time - b.time);
    const total = real.reduce((s, x) => s + x.pnl, 0n);
    const base = nav - Number(formatEther(total + unrealized));
    const firstTrade = this.trades.find((x) => x.wallet === wallet && x.time > 0)?.time;
    const pts: { t: number; v: number }[] = [];
    if (firstTrade) pts.push({ t: firstTrade - 1, v: base });
    let cum = 0n;
    for (const x of real) { cum += x.pnl; pts.push({ t: x.time, v: base + Number(formatEther(cum)) }); }
    const snaps = this.history.get(wallet) ?? [];
    const merged = [...pts.filter((p) => !snaps.length || p.t < snaps[0].t), ...snaps, { t: now, v: nav }];
    if (merged.length === 1) merged.unshift({ t: now - 3600, v: nav });
    const step = Math.max(1, Math.ceil(merged.length / 400));
    return merged.filter((_, i) => i % step === 0 || i === merged.length - 1);
  }

  /** Agent coins: creator fees earned on the launch curve (Pons's fee minus the protocol's share, plus any creator tax),
   *  trading volume and a price history (ETH per coin), from the curve's own trade events. */
  async coins() {
    const out = [];
    for (const c of this.agentCoins.values()) {
      let share = this.feeShare.get(c.curve);
      if (share === undefined) {
        share = Number(await this.pub.readContract({ address: c.curve, abi: parseAbi(["function protocolFeeShareBps() view returns (uint16)"]), functionName: "protocolFeeShareBps" }).catch(() => -1));
        if (share >= 0) this.feeShare.set(c.curve, share);
      }
      const creatorWei = share >= 0 ? (c.feeWei * BigInt(10_000 - share)) / 10_000n + c.taxWei : c.taxWei;
      const tok = this.tokens.get(c.token);
      const pts = c.points, step = Math.max(1, Math.ceil(pts.length / 300));
      out.push({
        agent: c.agent, wallet: c.wallet, coin: c.token, curve: c.curve, symbol: await this.symbolOf(c.token), launchedAt: c.launchedAt,
        feesEth: Number(formatEther(creatorWei)), feesExact: share >= 0, volumeEth: c.volumeEth, trades: c.trades, graduated: !!tok?.graduated,
        price: pts.length ? pts[pts.length - 1].p : null, chart: pts.filter((_, i) => i % step === 0 || i === pts.length - 1),
      });
    }
    for (const c of this.pgCoins.values()) {
      // Creator fees are paid in $TRENCHERS through the coin's ledger (collected or not).
      const credited = await this.pub.readContract({ address: c.ledger, abi: FOUNDATION_LEDGER_ABI, functionName: "creatorCredited" }).catch(() => 0n) as bigint;
      out.push({
        agent: c.agent, wallet: c.wallet, coin: c.token, curve: c.hook, symbol: await this.symbolOf(c.token), launchedAt: c.launchedAt,
        feesEth: 0, feesExact: false, volumeEth: 0, trades: 0, graduated: true, price: null, chart: [],
        venue: "programmable" as const, creator: c.creator, ledger: c.ledger, byAgent: c.byAgent, feesTrenchers: Number(formatEther(credited)),
      } as (typeof out)[number]);
    }
    return { updatedAt: this.now(), coins: out.sort((a, b) => a.agent - b.agent) };
  }

  /** One trade by its transaction (for share links); the newest match if a tx holds several. */
  findTrade(tx: string, agent?: number) {
    const t = tx.toLowerCase();
    for (let i = this.trades.length - 1; i >= 0; i--) { const x = this.trades[i]; if (x.tx.toLowerCase() === t && (!agent || x.agent === agent)) return x; }
    return null;
  }

  /** Live leaderboard: each agent's value, open positions and trading PnL this week, from real trades. */
  async arena() {
    const weekStart = this.now() - WEEK;
    const rows = [];
    // Every agent valued at once, so the reads go out batched together.
    const vals = new Map(await Promise.all([...this.agents.values()].map(async (ag) => [ag.wallet, await this.valueOf(ag)] as const)));
    for (const ag of this.agents.values()) {
      const { open, cost, positions, nav } = vals.get(ag.wallet)!;
      const mine = this.trades.filter((x) => x.wallet === ag.wallet);
      const week = mine.filter((x) => x.time >= weekStart);
      const realized = this.realized.filter((x) => x.wallet === ag.wallet && x.time >= weekStart).reduce((sum, x) => sum + x.pnl, 0n);
      const pnlEth = Number(formatEther(realized + open - cost));
      const base = nav - pnlEth;
      const best = week.filter((x) => x.side === "sell" && x.pnlPct !== undefined).sort((a, b) => b.pnlPct! - a.pnlPct!)[0];
      const sells = week.filter((x) => x.side === "sell" && x.pnlPct !== undefined);
      rows.push({
        id: ag.id, wallet: ag.wallet, owner: ag.owner, live: this.tradable(ag), blocked: this.blockedOf(ag),
        spentToday: Number(formatEther(ag.spentDay === BigInt(Math.floor(this.now() / 86400)) ? ag.spentToday : 0n)), dailyCap: Number(formatEther(ag.dailyCap)),
        target: ag.rule?.trigger === "token" && ag.rule.token ? await this.tokenMeta(ag.rule.token as Address).then((m) => (m ? { token: m.token, symbol: m.symbol, logo: m.logo, mode: ag.rule!.tokenMode ?? "once", status: this.planStatus(ag) } : { token: lc(ag.rule!.token!), symbol: null, logo: null, mode: ag.rule!.tokenMode ?? "once", status: null })).catch(() => null) : null,
        coin: ag.coin && !/^0x0+$/.test(ag.coin) ? ag.coin : ([...this.agentCoins.values()].find((c) => c.wallet === ag.wallet)?.token ?? [...this.pgCoins.values()].find((c) => c.wallet === ag.wallet)?.token ?? null), rule: ag.ruleText, ruleVersion: ag.ruleVersion, understood: ag.understood ?? [], ruleWarning: ag.ruleWarning ?? null,
        nav, cash: Number(formatEther(ag.balance)), openPositions: positions.length, positions, pnlEth, pnlPct: base > 0 ? (pnlEth / base) * 100 : 0,
        trades: week.length, wins: sells.filter((x) => x.pnlPct! > 0).length, closed: sells.length,
        biggest: best ? { symbol: best.symbol ?? best.token.slice(2, 8), pct: best.pnlPct! } : null,
        history: this.valueHistory(ag.wallet, nav, open - cost),
        recent: mine.slice(-30).reverse(),
      });
    }
    rows.sort((a, b) => b.pnlPct - a.pnlPct || b.nav - a.nav || b.trades - a.trades);
    return { updatedAt: this.now(), chainId: ENV.CHAIN_ID, nft: ENV.NFT, paused: this.paused, agents: rows.map((r, i) => ({ rank: i + 1, ...r })), feed: this.trades.slice(-50).reverse() };
  }

}
