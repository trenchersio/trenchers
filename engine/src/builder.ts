/**
 * Trenchers V4 Builder: indexes every coin launched through our own Foundation factory on Robinhood Chain and serves
 * the website's read-outs: /builder/config (where the contracts are) and /builder/coins (every coin, its modules,
 * price, volume, fees and a small price history). The chain is the truth; this is a read-out rebuilt from logs.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createPublicClient, defineChain, encodeAbiParameters, keccak256, parseAbi, parseAbiParameters, toHex, type Address, type Hex, type PublicClient } from "viem";
import { transport, urls } from "./rpc";

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const isAddr = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);

const MODULE_KEYS = [
  ["buyCooldown", "buy-cooldown"], ["buyWindow", "buy-window"], ["priceMoveGuard", "price-move-guard"], ["growingBuyLimit", "growing-buy-limit"],
  ["launchWalletCap", "launch-wallet-cap"], ["buybackBurn", "buyback-burn"], ["dipBuyback", "dip-buyback"], ["lpRewards", "lp-rewards"],
  ["fullRangeLp", "full-range-lp"], ["buyerRewards", "buyer-rewards"], ["nthBuyPot", "nth-buy-pot"], ["kingOfTheHill", "king-of-the-hill"],
  ["hotPotato", "hot-potato"], ["plague", "plague"], ["reactivePair", "reactive-pair"], ["entangled", "entangled"],
] as const;
const MODULE_BY_ID = new Map<string, string>(MODULE_KEYS.map(([k, id]) => [keccak256(toHex(`trenchers.foundation.${id}.v1`)).toLowerCase(), k]));

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
const SUPPLY = 1_000_000_000n * 10n ** 18n;

type Log = { blockNumber: bigint | null; transactionHash: Hex | null; args: Record<string, unknown> };
type Coin = {
  token: Address; hook: Address; ledger: Address; poolId: Hex; quote: Address; creator: Address;
  name: string; symbol: string; image: string; description: string; website: string;
  launchedAt: number; block: number; tx: Hex | null; creatorBuyBps: number; creatorSellBps: number; modules: string[];
  priceQuote: string | null; marketCapQuote: string | null; volumeQuote: string; trades: number; feesQuote: string;
  chart: { t: number; p: number }[];
};

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
  lastError: string | null = null;

  constructor(env: Record<string, string | undefined> = process.env) {
    const f = clean(env.V4_FACTORY), d = clean(env.V4_HOOK_DEPLOYER);
    this.factory = isAddr(f) ? (f.toLowerCase() as Address) : null;
    this.hookDeployer = isAddr(d) ? (d.toLowerCase() as Address) : null;
    this.modules = {};
    try {
      const m = JSON.parse(clean(env.V4_MODULES) || "{}") as Record<string, string>;
      for (const [k, v] of Object.entries(m)) if (isAddr(v) && MODULE_KEYS.some(([x]) => x === k)) this.modules[k] = v.toLowerCase() as Address;
    } catch { this.problems.push("V4_MODULES is not valid JSON."); }
    if (!this.factory) this.problems.push("V4_FACTORY is not set: deploy the V4 Builder from the launch page.");
    if (!this.hookDeployer) this.problems.push("V4_HOOK_DEPLOYER is not set.");
    this.startBlock = Number(clean(env.V4_START_BLOCK) || "0") || 0;
    // Only the local end-to-end test points this elsewhere.
    this.manager = (isAddr(clean(env.V4_POOL_MANAGER)) ? clean(env.V4_POOL_MANAGER) : ROBINHOOD_POOL_MANAGER) as Address;
    this.range = Number(clean(env.LOG_RANGE) || "5000") || 5000;
    const rpc = clean(env.RPC_URL);
    const chainId = Number(clean(env.CHAIN_ID) || "4663");
    const chain = defineChain({ id: chainId, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [urls(rpc)[0] ?? rpc] } } });
    this.pub = rpc && this.factory ? (createPublicClient({ chain, transport: transport(urls(rpc)) }) as PublicClient) : null;
  }

  config() {
    return { ready: !!this.factory && !!this.hookDeployer, reason: this.problems[0] ?? null, factory: this.factory, hookDeployer: this.hookDeployer, modules: this.modules, startBlock: this.startBlock };
  }

  private async time(b: bigint) {
    if (!this.times.has(b)) this.times.set(b, Number((await this.pub!.getBlock({ blockNumber: b })).timestamp));
    if (this.times.size > 5000) this.times.delete(this.times.keys().next().value!);
    return this.times.get(b)!;
  }

  private async read<T>(address: Address, functionName: string, args: unknown[] = []): Promise<T | null> {
    try { return (await this.pub!.readContract({ address, abi: ABI, functionName: functionName as never, args: args as never })) as T; } catch { return null; }
  }

  /** Quote per token (1e18-scaled) from the pool's spot price: slot0 of pools[poolId] in the PoolManager. */
  private async price(c: Coin): Promise<bigint | null> {
    const slot = keccak256(encodeAbiParameters(parseAbiParameters("bytes32, uint256"), [c.poolId, 6n]));
    const word = await this.read<Hex>(this.manager, "extsload", [slot]);
    if (!word) return null;
    const sqrt = BigInt(word) & ((1n << 160n) - 1n);
    if (sqrt === 0n) return null;
    const p1per0 = (sqrt * sqrt * 10n ** 18n) >> 192n; // currency1 per currency0
    const tokenIs0 = BigInt(c.token) < BigInt(c.quote);
    return tokenIs0 ? p1per0 : p1per0 === 0n ? null : (10n ** 36n) / p1per0;
  }

  async update() {
    if (!this.pub || !this.factory) return;
    try {
      const head = Number(await this.pub.getBlockNumber());
      if (this.cursor < 0) this.cursor = (this.startBlock || Math.max(0, head - 200_000)) - 1;
      while (this.cursor < head) {
        const from = this.cursor + 1, to = Math.min(head, from + this.range);
        const launches = (await this.pub.getLogs({ address: this.factory, event: LAUNCHED as never, fromBlock: BigInt(from), toBlock: BigInt(to) })) as unknown as Log[];
        for (const l of launches) {
          const a = (l as unknown as { args: { token: Address; creator: Address; poolId: Hex; hook: Address; ledger: Address; quote: Address } }).args;
          const token = a.token.toLowerCase() as Address;
          const [name, symbol, image, description, website, nMods, buyBps, sellBps] = await Promise.all([
            this.read<string>(token, "name"), this.read<string>(token, "symbol"), this.read<string>(token, "image"),
            this.read<string>(token, "description"), this.read<string>(token, "website"),
            this.read<bigint>(a.hook, "moduleCount"), this.read<number>(a.hook, "creatorBuyFeeBps"), this.read<number>(a.hook, "creatorSellFeeBps"),
          ]);
          const modules: string[] = [];
          for (let i = 0n; i < (nMods ?? 0n); i++) {
            const m = await this.read<{ descriptor: { moduleId: Hex } }>(a.hook, "moduleAt", [i]);
            const k = m ? MODULE_BY_ID.get(m.descriptor.moduleId.toLowerCase()) : undefined;
            modules.push(k ?? "unknown");
          }
          const c: Coin = {
            token, hook: a.hook.toLowerCase() as Address, ledger: a.ledger.toLowerCase() as Address, poolId: a.poolId, quote: a.quote.toLowerCase() as Address,
            creator: a.creator.toLowerCase() as Address, name: name ?? "?", symbol: symbol ?? "?", image: image ?? "", description: description ?? "", website: website ?? "",
            launchedAt: await this.time(l.blockNumber!), block: Number(l.blockNumber), tx: l.transactionHash ?? null,
            creatorBuyBps: Number(buyBps ?? 0), creatorSellBps: Number(sellBps ?? 0), modules,
            priceQuote: null, marketCapQuote: null, volumeQuote: "0", trades: 0, feesQuote: "0", chart: [],
          };
          this.coins.set(token, c);
          this.byPool.set(a.poolId.toLowerCase(), token);
        }
        // Swaps on our coins' hooks (each hook emits FoundationSwap); price points come from the swap's own amounts.
        const hooks = [...this.coins.values()].map((c) => c.hook);
        for (let i = 0; i < hooks.length; i += 50) {
          const swaps = (await this.pub.getLogs({ address: hooks.slice(i, i + 50), event: SWAP as never, fromBlock: BigInt(from), toBlock: BigInt(to) })) as unknown as Log[];
          for (const s of swaps) {
            const a = (s as unknown as { args: { poolId: Hex; grossQuote: bigint; coreAmount0: bigint; coreAmount1: bigint } }).args;
            const c = this.coins.get(this.byPool.get(a.poolId.toLowerCase()) ?? "");
            if (!c) continue;
            c.trades += 1;
            c.volumeQuote = String(BigInt(c.volumeQuote) + a.grossQuote);
            const tokenIs0 = BigInt(c.token) < BigInt(c.quote);
            const tokAmt = tokenIs0 ? a.coreAmount0 : a.coreAmount1, qAmt = tokenIs0 ? a.coreAmount1 : a.coreAmount0;
            const t = tokAmt < 0n ? -tokAmt : tokAmt, q = qAmt < 0n ? -qAmt : qAmt;
            if (t > 0n) {
              c.chart.push({ t: await this.time(s.blockNumber!), p: Number((q * 10n ** 18n) / t) / 1e18 });
              if (c.chart.length > 400) c.chart.splice(0, c.chart.length - 400);
            }
          }
        }
        this.cursor = to;
      }
      // Spot prices and fees, refreshed every pass.
      for (const c of this.coins.values()) {
        const p = await this.price(c);
        c.priceQuote = p === null ? null : p.toString();
        c.marketCapQuote = p === null ? null : ((p * SUPPLY) / 10n ** 18n).toString();
        const fees = await this.read<bigint>(c.ledger, "creatorReceived");
        if (fees !== null) c.feesQuote = fees.toString();
      }
      this.lastError = null;
    } catch (e) { this.lastError = (e as Error).message.split("\n")[0]; }
  }

  view() {
    return { coins: [...this.coins.values()].sort((a, b) => b.launchedAt - a.launchedAt), updatedAt: Math.floor(Date.now() / 1000) };
  }

  status() {
    return { ready: !!this.factory, problems: this.problems, coins: this.coins.size, cursor: this.cursor, lastError: this.lastError };
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path !== "/builder/config" && path !== "/builder/coins") return false;
    res.setHeader("cache-control", "public, max-age=15");
    res.end(JSON.stringify(path === "/builder/config" ? this.config() : this.view()));
    return true;
  }
}
