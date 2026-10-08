import { transport, urls } from "./rpc";
import {
  createPublicClient, createWalletClient, decodeAbiParameters, encodeFunctionData, formatEther, http, defineChain, parseAbi,
  type Address, type Hash, type Hex, type Log, type PublicClient, type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TelegramFeed } from "./telegram";
import { parse, type CustomRule } from "./custom-strategy";
import { ENV } from "./env";
import { FeeKeeper } from "./keeper";
import {
  ADAPTER_ABI, AGENT_ABI, BOUGHT, CONFIG_ABI, LAUNCH_SWEPT, NFT_TRANSFER, CLAIMED, CURVE_ABI, CURVE_BUY, CURVE_SELL, ERC20_ABI, POOL_GRADUATED, RULE_APPLIED, POLICY_SET, FUND_ABI, SOLD, TOKEN_LAUNCHED,
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
/** An agent's own coin (launched by its agent wallet): creator fees and a price history, from Pons's own trade events. */
type AgentCoin = { token: Address; curve: Address; agent: number; wallet: Address; launchedAt: number; feeWei: bigint; taxWei: bigint; volumeEth: number; trades: number; points: { t: number; p: number }[] };
type Agent = {
  id: number; wallet: Address; owner?: Address; coin?: Address; live: boolean; perTrade: bigint; dailyCap: bigint; setBy?: Address;
  ruleVersion: number; ruleText: string | null; rule: CustomRule | null; balance: bigint; spentDay: bigint; spentToday: bigint;
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
  /** Offset between chain time and this server's clock, updated on every new block; decisions use chain time. */
  clockOffset = 0; lastHead = -1n;
  now() { return Math.floor(Date.now() / 1000 + this.clockOffset); }
  log: (msg: string) => void;

  constructor(log: (m: string) => void = (m) => console.log(new Date().toISOString(), m)) {
    const chain = defineChain({ id: ENV.CHAIN_ID, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [ENV.RPC_URL] } } });
    // Public RPCs throttle bursts: retry with backoff, and fall back to a second endpoint if one is set.
    this.pub = createPublicClient({ chain, transport: transport(urls(ENV.RPC_URL)), batch: { multicall: { wait: 16 } } }) as PublicClient;
    if (ENV.ENGINE_KEY) {
      const account = privateKeyToAccount(ENV.ENGINE_KEY);
      this.wallet = createWalletClient({ account, chain, transport: transport(urls(ENV.RPC_URL)) });
      this.engineAddress = account.address;
    } else { this.wallet = null; this.engineAddress = null; }
    this.log = log;
    if (ENV.TELEGRAM_BOT_TOKEN && ENV.TELEGRAM_CHAT) {
      this.telegram = new TelegramFeed(
        { api: process.env.TELEGRAM_API, token: ENV.TELEGRAM_BOT_TOKEN, chat: ENV.TELEGRAM_CHAT, site: ENV.SITE_URL, explorer: ENV.EXPLORER_URL, imageBase: ENV.IMAGE_BASE, nft: ENV.NFT },
        this.pub, (m) => this.log(m),
        (id) => { const ag = [...this.agents.values()].find((a) => a.id === id); return ag ? `Its agent: ${Number(formatEther(ag.balance)).toFixed(4)} ETH · rule v${ag.ruleVersion}, and its track record moves with the NFT.` : null; },
      );
    }
  }

  // ------------------------------------------------------------------ chain sync

  /** First block of this process's lifetime (minus a margin): NFT moves from here on are posted even during the replay. */
  private catchUpFrom = 2n ** 255n;
  async start() {
    const head = await this.pub.getBlockNumber();
    this.catchUpFrom = head > 100n ? head - 100n : 0n;
    const start = ENV.START_BLOCK > 0n ? ENV.START_BLOCK : await this.deploymentBlock(head);
    this.cursor = start > 0n ? start - 1n : 0n;
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
    if (head > this.cursor) await this.sync(head, true);
    if (Date.now() - this.lastAgentRefresh > 15_000) await this.refreshAgents(false);
    if (Date.now() - this.lastSnapshot > 120_000) await this.snapshot();
    if (Date.now() - this.lastRecover > 60_000) { await this.resolveRouter(); await this.recoverHoldings().catch((e) => this.log(`holdings check failed: ${(e as Error).message.split("\n")[0]}`)); }
    if (ENV.FEE_KEEPER && ENV.DIST && Date.now() - this.feeKeeper.last > 600_000) await this.feeKeeper.run().catch((e) => this.log(`fee share upkeep failed: ${(e as Error).message.split("\n")[0]}`));
    if (this.paused) { this.entries = []; return; } // emergency stop: no buys, no sells
    await this.runEntries();
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

  /** Reads all relevant logs up to `head` in order; `live` means new signals may lead to trades. */
  private async sync(head: bigint, live: boolean) {
    while (this.cursor < head) {
      const from = this.cursor + 1n;
      const to = from + ENV.LOG_RANGE - 1n < head ? from + ENV.LOG_RANGE - 1n : head;
      // Replay, or catching up after a pause: interpolate block times (two reads per window, not one per block).
      if (!live || head - from > 100n) {
        const [ba, bb] = await Promise.all([this.pub.getBlock({ blockNumber: from }), this.pub.getBlock({ blockNumber: to })]);
        this.interp = { a: from, b: to, ta: Number(ba.timestamp), tb: Number(bb.timestamp) };
      } else this.interp = null;
      const [factoryLogs, curveLogs, claims, adapterLogs, nftMoves] = await Promise.all([
        this.pub.getLogs({ address: ENV.PONS_FACTORY, events: [TOKEN_LAUNCHED, POOL_GRADUATED, LAUNCH_SWEPT], fromBlock: from, toBlock: to }),
        this.pub.getLogs({ events: [CURVE_BUY, CURVE_SELL], fromBlock: from, toBlock: to }),
        this.pub.getLogs({ address: ENV.FUND, event: CLAIMED, fromBlock: from, toBlock: to }),
        this.pub.getLogs({ address: this.adapter, events: [BOUGHT, SOLD], fromBlock: from, toBlock: to }),
        this.telegram && (live || to >= this.catchUpFrom) ? this.pub.getLogs({ address: ENV.NFT, event: NFT_TRANSFER, fromBlock: from, toBlock: to }) : Promise.resolve([]),
      ]);
      const launches = factoryLogs.filter((l) => l.eventName === "TokenLaunched");
      const grads = factoryLogs.filter((l) => l.eventName !== "TokenLaunched");
      const swepts: typeof grads = [];
      const buys = curveLogs.filter((l) => l.eventName === "CurveBuy"), sells = curveLogs.filter((l) => l.eventName === "CurveSell");
      const bought = adapterLogs, sold: typeof adapterLogs = [];
      const wallets = [...this.agents.keys(), ...claims.map((c) => lc(c.args.agentWallet!))];
      const rules = wallets.length ? await this.pub.getLogs({ address: wallets, events: [RULE_APPLIED, POLICY_SET], fromBlock: from, toBlock: to }) : [];
      const all = [...launches, ...grads, ...swepts, ...buys, ...sells, ...claims, ...bought, ...sold, ...rules] as Log[];
      all.sort((a, b) => Number(a.blockNumber! - b.blockNumber!) || (a.logIndex! - b.logIndex!));
      for (const l of all) await this.onLog(l as Log & { eventName: string; args: Record<string, unknown> }, live);
      // While catching up after a restart, mints and sales made since this process started are still posted
      // (the previous process stopped when this one came up, so it never saw them).
      const moves = live ? nftMoves : nftMoves.filter((l) => l.blockNumber! >= this.catchUpFrom);
      if (moves.length && this.telegram) {
        this.log(`NFT: ${moves.length} transfer${moves.length > 1 ? "s" : ""} seen (${moves.map((m) => `#${Number(m.args.tokenId)}`).join(", ")}), posting to Telegram`);
        this.telegram.onTransfers(moves).catch((e) => this.log(`telegram: ${(e as Error).message.split("\n")[0]}`));
      }
      this.cursor = to;
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
        const tok: Token = { token: lc(a.token), curve: lc(a.curve), deployer: lc(a.deployer), launchedAt: t, volumeEth: 0, graduated: false };
        this.tokens.set(tok.token, tok); this.curves.set(tok.curve, tok.token);
        // Launched by an agent wallet: follow it as that agent's coin (fees, chart).
        const ag = this.agents.get(tok.deployer);
        if (ag) this.agentCoins.set(tok.token, { token: tok.token, curve: tok.curve, agent: ag.id, wallet: ag.wallet, launchedAt: t, feeWei: 0n, taxWei: 0n, volumeEth: 0, trades: 0, points: [] });
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
        this.signal("volume", tok, t, { before, after: tok.volumeEth });
        this.signal("mcap", tok, t);
        if (l.eventName === "CurveSell" && lc(a.seller) === tok.deployer) this.signal("devsell", tok, t);
        break;
      }
      case "Claimed": {
        const w = lc(a.agentWallet);
        if (live) { this.lastAgentRefresh = 0; this.log(`Agent #${Number(a.tokenId)} awakened (wallet ${w})`); }
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
        ag.ruleVersion = Number(a.version); ag.ruleText = (a.ruleUri as string) || null;
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
        this.addTrade(w, token, "buy", ethIn, tokens, t, l.transactionHash!);
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
        this.addTrade(w, token, "sell", ethOut, tokensIn, t, l.transactionHash!, pnlPct);
        break;
      }
    }
  }

  private symbols = new Map<Address, string>();
  /** The coin's ticker (cached); falls back to a short address. */
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
  private addTrade(w: Address, token: Address, side: "buy" | "sell", eth: bigint, tokens: bigint, time: number, tx: Hash, pnlPct?: number) {
    this.trades.push({ agent: this.agents.get(w)?.id ?? 0, wallet: w, token, symbol: this.symbols.get(token) ?? this.tokens.get(token)?.symbol, side, eth: formatEther(eth), tokens: tokens.toString(), time, tx, pnlPct });
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

  /** How often each kind of Pons signal was seen, and when last: shows on /health whether the chain is busy. */
  seen: Record<string, { n: number; last: number }> = {};
  private noteOnce(key: string, msg: string) {
    if (Date.now() - (this.skipNoted.get(key as Address) ?? 0) < 3_600_000) return;
    this.skipNoted.set(key as Address, Date.now()); this.log(msg);
  }
  private sellFails = new Map<string, { n: number; first: number }>();

  /** Why each agent is or isn't trading right now, for /health. */
  diag() {
    const now = this.now(), today = BigInt(Math.floor(now / 86400));
    const ago = (t: number) => (t ? `${Math.round((now - t) / 60)} min ago` : "never");
    const agents = [...this.agents.values()].map((ag) => {
      const book = this.book(ag.wallet), mine = this.trades.filter((x) => x.wallet === ag.wallet);
      const last = mine.length ? Math.max(...mine.map((x) => x.time)) : 0;
      const spent = ag.spentDay === today ? ag.spentToday : 0n;
      const blocked = !ag.rule ? "no rule" : !ag.live || ag.setBy !== ag.owner ? "trading switched off" : ag.perTrade === 0n ? "no per-trade limit"
        : book.size >= ENV.MAX_POSITIONS ? `holding the maximum ${ENV.MAX_POSITIONS} positions` : spent >= ag.dailyCap ? "daily limit reached (resets 00:00 UTC)"
        : ag.balance < 10_000_000_000n ? "no ETH left in its wallet" : null;
      return { id: ag.id, trigger: ag.rule?.trigger ?? null, ready: !blocked, waitingFor: blocked ?? `the next ${ag.rule!.trigger} signal`, open: book.size,
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

  // ------------------------------------------------------------------ trades

  private async buy(ag: Agent, tok: Token, reason: string) {
    const key = `${ag.wallet}:${tok.token}`; if (this.busy.has(key)) return; this.busy.add(key);
    try {
      const today = BigInt(Math.floor(this.now() / 86400));
      const spent = ag.spentDay === today ? ag.spentToday : 0n;
      let size = ag.perTrade;
      if (spent + size > ag.dailyCap) size = ag.dailyCap > spent ? ag.dailyCap - spent : 0n;
      if (size > ag.balance) size = ag.balance;
      if (size < 10_000_000_000n) { this.noteOnce(`size:${ag.wallet}`, `Agent #${ag.id} skipped ${tok.token}: ${spent >= ag.dailyCap ? "daily limit reached" : "no ETH left in its wallet"}`); return; } // nothing worth trading
      // What the trade would really get right now (fees, snipe tax, price impact, graduation all included).
      const sim = await this.simulateTrade(ag.wallet, size, encodeFunctionData({ abi: ADAPTER_ABI, functionName: "buy", args: [tok.token, 0n] }));
      const fair = await this.quoteBuy(tok, size).catch(() => 0n);
      if (fair > 0n && sim * 100n < fair * 70n) {
        // Much worse than the fee-free price: most likely Pons's anti-snipe tax. Try again shortly.
        if (this.now() - tok.launchedAt < 120) { this.entries.push({ wallet: ag.wallet, token: tok.token, notBefore: this.now() + 3, reason }); this.log(`Agent #${ag.id} waits: ${tok.token} is still taxed (${Number(sim * 100n / fair)}% of fair)`); }
        else this.log(`Agent #${ag.id} skipped ${tok.token}: price ${Number(sim * 100n / fair)}% of fair`);
        return;
      }
      const minOut = (sim * BigInt(100 - ENV.SLIPPAGE_PCT)) / 100n;
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
        const tok = this.tokens.get(p.token); if (!tok) continue;
        const r = ag.rule;
        const age = ts - p.openedAt;
        let why: string | null = null;
        let value = 0n;
        try { value = await this.quoteSell(tok, p.tokens); this.sellFails.delete(`q:${w}:${tok.token}`); }
        catch (e) { this.failed(`q:${w}:${tok.token}`, ag, tok, p, `it can't be priced (${(e as Error).message.split("\n")[0].slice(0, 80)})`); continue; }
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
    ag.balance = await this.pub.getBalance({ address: ag.wallet }).catch(() => ag.balance);
    let open = 0n, cost = 0n;
    const positions: { token: Address; symbol?: string; cost: number; value: number; since: number }[] = [];
    for (const p of book.values()) {
      const tok = this.tokens.get(p.token);
      cost += p.ethIn;
      let value = 0n;
      if (tok) { try { value = await this.quoteSell(tok, p.tokens); } catch { /* skip */ } }
      open += value;
      positions.push({ token: p.token, symbol: this.symbols.get(p.token), cost: Number(formatEther(p.ethIn)), value: Number(formatEther(value)), since: p.openedAt });
    }
    return { open, cost, positions, nav: Number(formatEther(ag.balance + open)) };
  }

  private async snapshot() {
    this.lastSnapshot = Date.now();
    const t = this.now();
    for (const ag of this.agents.values()) {
      try {
        const { nav } = await this.valueOf(ag);
        const h = this.history.get(ag.wallet) ?? [];
        h.push({ t, v: nav });
        while (h.length > 720) h.shift();
        this.history.set(ag.wallet, h);
      } catch { /* next time */ }
    }
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
    return { updatedAt: this.now(), coins: out.sort((a, b) => a.agent - b.agent) };
  }

  /** Live leaderboard: each agent's value, open positions and trading PnL this week, from real trades. */
  async arena() {
    const weekStart = this.now() - WEEK;
    const rows = [];
    for (const ag of this.agents.values()) {
      const { open, cost, positions, nav } = await this.valueOf(ag);
      const mine = this.trades.filter((x) => x.wallet === ag.wallet);
      const week = mine.filter((x) => x.time >= weekStart);
      const realized = this.realized.filter((x) => x.wallet === ag.wallet && x.time >= weekStart).reduce((sum, x) => sum + x.pnl, 0n);
      const pnlEth = Number(formatEther(realized + open - cost));
      const base = nav - pnlEth;
      const best = week.filter((x) => x.side === "sell" && x.pnlPct !== undefined).sort((a, b) => b.pnlPct! - a.pnlPct!)[0];
      const sells = week.filter((x) => x.side === "sell" && x.pnlPct !== undefined);
      rows.push({
        id: ag.id, wallet: ag.wallet, owner: ag.owner, live: this.tradable(ag),
        coin: ag.coin && !/^0x0+$/.test(ag.coin) ? ag.coin : ([...this.agentCoins.values()].find((c) => c.wallet === ag.wallet)?.token ?? null), rule: ag.ruleText, ruleVersion: ag.ruleVersion, understood: ag.understood ?? [], ruleWarning: ag.ruleWarning ?? null,
        nav, cash: Number(formatEther(ag.balance)), openPositions: positions.length, positions, pnlEth, pnlPct: base > 0 ? (pnlEth / base) * 100 : 0,
        trades: week.length, wins: sells.filter((x) => x.pnlPct! > 0).length, closed: sells.length,
        biggest: best ? { symbol: best.symbol ?? best.token.slice(2, 8), pct: best.pnlPct! } : null,
        history: this.valueHistory(ag.wallet, nav, open - cost),
        recent: mine.slice(-30).reverse(),
      });
    }
    rows.sort((a, b) => b.pnlPct - a.pnlPct);
    return { updatedAt: this.now(), chainId: ENV.CHAIN_ID, nft: ENV.NFT, paused: this.paused, agents: rows.map((r, i) => ({ rank: i + 1, ...r })), feed: this.trades.slice(-50).reverse() };
  }

}
