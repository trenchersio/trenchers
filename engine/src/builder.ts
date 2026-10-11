/**
 * Trenchers V4 Builder: indexes every coin launched through our own Foundation factory on Robinhood Chain and serves
 * the website's read-outs: /builder/config (where the contracts are), /builder/coins (every coin, its modules, price,
 * volume, fees and a small price history) and /builder/coin?token= (one coin with its full history).
 *
 * Only coins that are entirely ours are listed. The factory accepts any pair token and any module factory, so a coin
 * is shown only when its pair is WETH or $TRENCHERS and every module on its hook was created by one of our 16 module
 * factories (checked from the CREATE address: the module's address must be one our factory produced). A module never
 * names itself here; its name comes from the factory that made it. The chain is the truth; this is a read-out
 * rebuilt from logs.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createPublicClient, defineChain, encodeAbiParameters, getContractAddress, keccak256, parseAbi, parseAbiParameters,
  type Address, type Hex, type PublicClient,
} from "viem";
import { transport, urls } from "./rpc";

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const isAddr = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);

const MODULE_KEYS = [
  "buyCooldown", "buyWindow", "priceMoveGuard", "growingBuyLimit", "launchWalletCap", "buybackBurn", "dipBuyback", "lpRewards",
  "fullRangeLp", "buyerRewards", "nthBuyPot", "kingOfTheHill", "hotPotato", "plague", "reactivePair", "entangled",
] as const;

const ABI = parseAbi([
  "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
  "event FoundationLaunchedV3(address indexed token, address indexed creator, bytes32 indexed poolId, address hook, address ledger, address quote, bytes32 metadataHash, bytes32 compositionHash, bytes32 custodyId, uint256 initialBuyQuoteAmount, LaunchResultV2 result)",
  "event FoundationSwap(bytes32 indexed poolId, address indexed router, bool buy, bool exactInput, uint256 grossQuote, uint256 platformQuote, uint256 creatorQuote, int128 coreAmount0, int128 coreAmount1)",
  "struct Descriptor { bytes32 moduleId; uint16 abiVersion; uint8 phases; uint8 resources; uint32 beforeGas; uint32 afterGas; uint32 actionGas; bool failOpenAfter; bytes32 exclusiveGroup; }",
  "struct Module { address instance; bytes32 codeHash; bytes32 configurationHash; Descriptor descriptor; }",
  "function moduleCount() view returns (uint256)", "function moduleAt(uint256) view returns (Module)",
  "function creatorBuyFeeBps() view returns (uint16)", "function creatorSellFeeBps() view returns (uint16)",
  "function name() view returns (string)", "function symbol() view returns (string)", "function image() view returns (string)",
  "function description() view returns (string)", "function website() view returns (string)",
  "function creatorReceived() view returns (uint256)",
  "function extsload(bytes32 slot) view returns (bytes32)",
]);
const LAUNCHED = ABI.find((x) => x.type === "event" && x.name === "FoundationLaunchedV3")!;
const SWAP = ABI.find((x) => x.type === "event" && x.name === "FoundationSwap")!;
const ROBINHOOD_POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951" as Address;
const ROBINHOOD_WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const TRENCHERS = "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a";
const SUPPLY = 1_000_000_000n * 10n ** 18n;
const CHART_MAX = 400;
const LIST_POINTS = 48;
const LIST_MAX = 500;

type Log = { blockNumber: bigint | null; transactionHash: Hex | null; logIndex: number | null; address: Address; args: Record<string, unknown> };
type Coin = {
  token: Address; hook: Address; ledger: Address; poolId: Hex; quote: Address; creator: Address;
  name: string; symbol: string; image: string; description: string; website: string;
  launchedAt: number; block: number; tx: Hex | null; creatorBuyBps: number; creatorSellBps: number; modules: string[];
  priceQuote: string | null; marketCapQuote: string | null; volumeQuote: string; trades: number; feesQuote: string;
  chart: { t: number; p: number }[];
};

/** Keeps an https link (or nothing): launchers write whatever they like into their coin's metadata. */
const safeUrl = (u: string) => (/^https:\/\/[^\s"'<>]+$/.test(u) && u.length <= 2048 ? u : "");
const safeImage = (u: string) => (/^(https|ipfs):\/\/[^\s"'<>]+$/.test(u) || /^data:image\/(svg\+xml|png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(u)) && u.length <= 4096 ? u : "";

export class BuilderIndex {
  readonly factory: Address | null;
  readonly hookDeployer: Address | null;
  readonly modules: Record<string, Address>;
  readonly startBlock: number;
  readonly problems: string[] = [];
  private pub: PublicClient | null;
  private coins = new Map<string, Coin>();
  private byPool = new Map<string, string>();
  private cursor = -1;
  private range: number;
  private times = new Map<bigint, number>();
  private manager: Address;
  private weth: string;
  /** For each of our module factories: the addresses its CREATEs produced, by nonce (contracts start at nonce 1). */
  private created = new Map<Address, { upTo: number; set: Set<string> }>();
  private passes = 0;
  skipped = 0;
  lastError: string | null = null;

  constructor(env: Record<string, string | undefined> = process.env) {
    const f = clean(env.V4_FACTORY), d = clean(env.V4_HOOK_DEPLOYER);
    this.factory = isAddr(f) ? (f.toLowerCase() as Address) : null;
    this.hookDeployer = isAddr(d) ? (d.toLowerCase() as Address) : null;
    this.modules = {};
    try {
      const m = JSON.parse(clean(env.V4_MODULES) || "{}") as Record<string, string>;
      for (const [k, v] of Object.entries(m)) if (isAddr(v) && (MODULE_KEYS as readonly string[]).includes(k)) this.modules[k] = v.toLowerCase() as Address;
    } catch { this.problems.push("V4_MODULES is not valid JSON."); }
    if (!this.factory) this.problems.push("V4_FACTORY is not set: deploy the V4 Builder from the launch page.");
    if (!this.hookDeployer) this.problems.push("V4_HOOK_DEPLOYER is not set.");
    this.startBlock = Number(clean(env.V4_START_BLOCK) || "0") || 0;
    if (this.factory && !this.startBlock) this.problems.push("V4_START_BLOCK is not set: copy it from the launch page.");
    // Only the local end-to-end test points these elsewhere.
    this.manager = (isAddr(clean(env.V4_POOL_MANAGER)) ? clean(env.V4_POOL_MANAGER) : ROBINHOOD_POOL_MANAGER) as Address;
    this.weth = (isAddr(clean(env.V4_WETH)) ? clean(env.V4_WETH) : ROBINHOOD_WETH).toLowerCase();
    this.range = Math.max(1, Number(clean(env.LOG_RANGE) || "5000") || 5000);
    const rpc = clean(env.RPC_URL);
    const chainId = Number(clean(env.CHAIN_ID) || "4663");
    const chain = defineChain({ id: chainId, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [urls(rpc)[0] ?? rpc] } } });
    this.pub = rpc && this.factory && this.startBlock ? (createPublicClient({ chain, transport: transport(urls(rpc)) }) as PublicClient) : null;
  }

  config() {
    const ready = !!this.factory && !!this.hookDeployer && Object.keys(this.modules).length === MODULE_KEYS.length && !!this.startBlock;
    return { ready, reason: ready ? null : this.problems[0] ?? "The module factories are not all set (V4_MODULES).", factory: this.factory, hookDeployer: this.hookDeployer, modules: this.modules, startBlock: this.startBlock };
  }

  private async time(b: bigint) {
    if (!this.times.has(b)) this.times.set(b, Number((await this.pub!.getBlock({ blockNumber: b })).timestamp));
    if (this.times.size > 5000) this.times.delete(this.times.keys().next().value!);
    return this.times.get(b)!;
  }

  /** A read that must succeed: a failure aborts the pass and the range is read again next time. */
  private read<T>(address: Address, functionName: string, args: unknown[] = []): Promise<T> {
    return this.pub!.readContract({ address, abi: ABI, functionName: functionName as never, args: args as never }) as Promise<T>;
  }

  /** Which of our module factories created `instance`, if any. */
  private async factoryOf(instance: Address): Promise<string | null> {
    const want = instance.toLowerCase();
    for (const [key, f] of Object.entries(this.modules)) {
      let c = this.created.get(f);
      if (!c) { c = { upTo: 0, set: new Set() }; this.created.set(f, c); }
      if (c.set.has(want)) return key;
    }
    // Not seen yet: extend each factory's list up to its current nonce.
    for (const [key, f] of Object.entries(this.modules)) {
      const c = this.created.get(f)!;
      const nonce = await this.pub!.getTransactionCount({ address: f });
      for (let n = c.upTo + 1; n < nonce; n++) c.set.add(getContractAddress({ from: f, nonce: BigInt(n) }).toLowerCase());
      c.upTo = Math.max(c.upTo, nonce - 1);
      if (c.set.has(want)) return key;
    }
    return null;
  }

  /** Quote per token (1e18-scaled) from the pool's spot price: slot0 of pools[poolId] in the PoolManager. */
  private async price(c: Coin): Promise<bigint | null> {
    const slot = keccak256(encodeAbiParameters(parseAbiParameters("bytes32, uint256"), [c.poolId, 6n]));
    const word = await this.read<Hex>(this.manager, "extsload", [slot]);
    const sqrt = BigInt(word) & ((1n << 160n) - 1n);
    if (sqrt === 0n) return null;
    const p1per0 = (sqrt * sqrt * 10n ** 18n) >> 192n; // currency1 per currency0
    const tokenIs0 = BigInt(c.token) < BigInt(c.quote);
    return tokenIs0 ? p1per0 : p1per0 === 0n ? null : (10n ** 36n) / p1per0;
  }

  /** Reads one launch fully, or returns null when the coin isn't entirely ours (and so is never listed). */
  private async coinFrom(l: Log): Promise<Coin | null> {
    const a = l.args as { token: Address; creator: Address; poolId: Hex; hook: Address; ledger: Address; quote: Address };
    const quote = a.quote.toLowerCase();
    if (quote !== this.weth && quote !== TRENCHERS) return null;
    const token = a.token.toLowerCase() as Address;
    const [name, symbol, image, description, website, nMods, buyBps, sellBps] = await Promise.all([
      this.read<string>(token, "name"), this.read<string>(token, "symbol"), this.read<string>(token, "image"),
      this.read<string>(token, "description"), this.read<string>(token, "website"),
      this.read<bigint>(a.hook, "moduleCount"), this.read<number>(a.hook, "creatorBuyFeeBps"), this.read<number>(a.hook, "creatorSellFeeBps"),
    ]);
    // A coin pretending to be $TRENCHERS is never listed.
    if (/^\$?trenchers$/i.test(symbol.trim())) return null;
    const modules: string[] = [];
    for (let i = 0n; i < nMods; i++) {
      const m = await this.read<{ instance: Address }>(a.hook, "moduleAt", [i]);
      const key = await this.factoryOf(m.instance);
      if (!key) return null; // a module we didn't make: unknown behaviour, so not listed
      modules.push(key);
    }
    return {
      token, hook: a.hook.toLowerCase() as Address, ledger: a.ledger.toLowerCase() as Address, poolId: a.poolId, quote: quote as Address,
      creator: a.creator.toLowerCase() as Address, name: name.slice(0, 64), symbol: symbol.slice(0, 16), image: safeImage(image),
      description: description.slice(0, 280), website: safeUrl(website),
      launchedAt: await this.time(l.blockNumber!), block: Number(l.blockNumber), tx: l.transactionHash ?? null,
      creatorBuyBps: Number(buyBps), creatorSellBps: Number(sellBps), modules,
      priceQuote: null, marketCapQuote: null, volumeQuote: "0", trades: 0, feesQuote: "0", chart: [],
    };
  }

  async update() {
    if (!this.pub || !this.factory) return;
    this.passes++;
    try {
      const head = Number(await this.pub.getBlockNumber());
      if (this.cursor < 0) this.cursor = this.startBlock - 1;
      const touched = new Set<string>();
      while (this.cursor < head) {
        const from = this.cursor + 1, to = Math.min(head, from + this.range - 1);
        // Everything for this range is read first and applied together, so a failure halfway never counts anything twice.
        const launches = (await this.pub.getLogs({ address: this.factory, event: LAUNCHED as never, fromBlock: BigInt(from), toBlock: BigInt(to) })) as unknown as Log[];
        const fresh = new Map<string, Coin>();
        for (const l of launches) {
          const c = await this.coinFrom(l);
          if (c) fresh.set(c.poolId.toLowerCase(), c); else this.skipped++;
        }
        // Every FoundationSwap in the range, matched to our coins by pool id (one query, whatever the number of coins).
        const swaps = (await this.pub.getLogs({ event: SWAP as never, fromBlock: BigInt(from), toBlock: BigInt(to) })) as unknown as Log[];
        const deltas: { pool: string; vol: bigint; point: { t: number; p: number } | null }[] = [];
        for (const s of swaps) {
          const a = s.args as { poolId: Hex; grossQuote: bigint; coreAmount0: bigint; coreAmount1: bigint };
          const pool = a.poolId.toLowerCase();
          const c = fresh.get(pool) ?? this.coins.get(this.byPool.get(pool) ?? "");
          if (!c || s.address.toLowerCase() !== c.hook) continue; // only the coin's own hook speaks for its pool
          const tokenIs0 = BigInt(c.token) < BigInt(c.quote);
          const tokAmt = tokenIs0 ? a.coreAmount0 : a.coreAmount1, qAmt = tokenIs0 ? a.coreAmount1 : a.coreAmount0;
          const t = tokAmt < 0n ? -tokAmt : tokAmt, q = qAmt < 0n ? -qAmt : qAmt;
          deltas.push({ pool, vol: a.grossQuote, point: t > 0n ? { t: await this.time(s.blockNumber!), p: Number((q * 10n ** 18n) / t) / 1e18 } : null });
        }
        for (const [pool, c] of fresh) { this.coins.set(c.token, c); this.byPool.set(pool, c.token); touched.add(c.token); }
        for (const d of deltas) {
          const c = this.coins.get(this.byPool.get(d.pool) ?? "");
          if (!c) continue;
          c.trades += 1;
          c.volumeQuote = String(BigInt(c.volumeQuote) + d.vol);
          if (d.point) { c.chart.push(d.point); if (c.chart.length > CHART_MAX) c.chart.splice(0, c.chart.length - CHART_MAX); }
          touched.add(c.token);
        }
        this.cursor = to;
      }
      // Spot prices and fees: coins that traded now, everything every tenth pass.
      const all = this.passes % 10 === 1;
      for (const c of this.coins.values()) {
        if (!all && !touched.has(c.token) && c.priceQuote !== null) continue;
        const p = await this.price(c);
        c.priceQuote = p === null ? null : p.toString();
        c.marketCapQuote = p === null ? null : ((p * SUPPLY) / 10n ** 18n).toString();
        c.feesQuote = (await this.read<bigint>(c.ledger, "creatorReceived")).toString();
      }
      this.lastError = null;
    } catch (e) { this.lastError = (e as Error).message.split("\n")[0]; }
  }

  /** Every coin, newest first, with a short price line each (the coin page asks for its full history). */
  view() {
    const thin = (ch: Coin["chart"]) => ch.length <= LIST_POINTS ? ch : Array.from({ length: LIST_POINTS }, (_, i) => ch[Math.round((i * (ch.length - 1)) / (LIST_POINTS - 1))]);
    const coins = [...this.coins.values()].sort((a, b) => b.launchedAt - a.launchedAt).slice(0, LIST_MAX).map((c) => ({ ...c, chart: thin(c.chart) }));
    return { coins, total: this.coins.size, updatedAt: Math.floor(Date.now() / 1000) };
  }

  coin(token: string) {
    return this.coins.get(token.toLowerCase()) ?? null;
  }

  status() {
    return { ready: this.config().ready, problems: this.problems, coins: this.coins.size, skipped: this.skipped, cursor: this.cursor, lastError: this.lastError };
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path !== "/builder/config" && path !== "/builder/coins" && path !== "/builder/coin") return false;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "public, max-age=10");
    if (path === "/builder/coin") {
      const token = new URL(req.url ?? "", "http://x").searchParams.get("token") ?? "";
      const c = isAddr(token) ? this.coin(token) : null;
      res.statusCode = c ? 200 : 404;
      res.end(JSON.stringify(c ?? { error: "not_found" }));
      return true;
    }
    res.end(JSON.stringify(path === "/builder/config" ? this.config() : this.view()));
    return true;
  }
}
