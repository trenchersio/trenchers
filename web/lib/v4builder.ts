/**
 * Trenchers V4 Builder: our own Uniswap v4 hook launches on Robinhood Chain.
 *
 * The launch contracts (open source, MIT) are deployed and configured by Trenchers
 * (v4builder/ in this repository). A launch is one transaction to our factory: it creates the coin (fixed 1B supply),
 * a per-coin v4 hook with the chosen modules, the pool, a permanent liquidity position (the whole supply, owned by
 * the dead address) and the creator's first buy. Every trade pays the creator's fee and a 0.3% Trenchers fee in the
 * pair token; the Trenchers fee goes to the buyback wallet that buys and burns $TRENCHERS.
 *
 * Everything here is computed from the chain, in the browser: module code hashes come from a probe run inside a single
 * eth_call, the hook address is mined locally, and trades are Universal Router commands (tested against the real
 * router in v4builder/test/WebFlows.t.sol, which these encoders mirror).
 */
import {
  encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, parseAbiParameters, toHex, zeroAddress,
  type Address, type Hex, type PublicClient,
} from "viem";
import artifacts from "@/lib/v4builder/artifacts.json";
import { mineHookSalt, randomSalt, sqrtPriceAtTick, tickForValuation, FOUNDATION_SUPPLY } from "@/lib/programmable";

export { mineHookSalt, randomSalt, sqrtPriceAtTick, FOUNDATION_SUPPLY };

export const TRENCHERS = getAddress("0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a");
export const WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
export const UNIVERSAL_ROUTER = getAddress("0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99");
export const PERMIT2 = getAddress("0x000000000022D473030F116dDEE9F6B43aC78BA3");
export const POOL_MANAGER = getAddress("0x8366a39CC670B4001A1121B8F6A443A643e40951");
export const PONS_FACTORY = getAddress("0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e");
export const PLATFORM_FEE_BPS = 30;
export const HOOK_FLAGS = 0x20cc;

/** The Uniswap v4 contracts every call goes to. Robinhood Chain's official deployment; the local end-to-end test
 *  (v4builder/e2e) points these at a local chain. Nothing in the site changes them. */
export const INFRA: { weth: Address; router: Address; permit2: Address; manager: Address; pons: Address | null } = {
  weth: WETH, router: UNIVERSAL_ROUTER, permit2: PERMIT2, manager: POOL_MANAGER, pons: PONS_FACTORY,
};

/** Where our deployment lives. Read from the engine (/builder/config), so the site needs no rebuild after deploying. */
export type BuilderConfig = {
  ready: boolean;
  reason: string | null;
  factory: Address | null;
  hookDeployer: Address | null;
  modules: Partial<Record<ModuleKey, Address>>;
  startBlock: number;
  mock?: boolean;
};

// ------------------------------------------------------------------ ABIs

const STRUCTS = [
  "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
  "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
  "struct LaunchParamsV3 { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorBuyFeeBps; uint16 creatorSellFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
  "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
  "struct Descriptor { bytes32 moduleId; uint16 abiVersion; uint8 phases; uint8 resources; uint32 beforeGas; uint32 afterGas; uint32 actionGas; bool failOpenAfter; bytes32 exclusiveGroup; }",
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
];
export const FACTORY_ABI = parseAbi([
  ...STRUCTS,
  "function launch(LaunchParamsV3 p) returns (LaunchResultV2 result)",
  "function launchWithEthRoute(LaunchParamsV3 p, bytes fundingPath) payable returns (LaunchResultV2 result)",
  "function launchOf(address token) view returns (LaunchResultV2)",
  "function hookInitCodeHash(address creator, address predictedToken, LaunchParamsV3 p) view returns (bytes32)",
  "function predictTokenAddress(address creator, bytes32 tokenSalt, Metadata metadata) view returns (address)",
  "function hookDeployer() view returns (address)",
  "event FoundationLaunchedV3(address indexed token, address indexed creator, bytes32 indexed poolId, address hook, address ledger, address quote, bytes32 metadataHash, bytes32 compositionHash, bytes32 custodyId, uint256 initialBuyQuoteAmount, LaunchResultV2 result)",
]);
export const HOOK_ABI = parseAbi([
  ...STRUCTS,
  "struct Module { address instance; bytes32 codeHash; bytes32 configurationHash; Descriptor descriptor; }",
  "function poolKey() view returns (PoolKey)",
  "function creator() view returns (address)", "function token() view returns (address)", "function quote() view returns (address)",
  "function ledger() view returns (address)", "function creatorBuyFeeBps() view returns (uint16)", "function creatorSellFeeBps() view returns (uint16)",
  "function moduleCount() view returns (uint256)", "function moduleAt(uint256) view returns (Module)",
  "function executeModuleAction(uint256 index, bytes data)",
]);
export const LEDGER_ABI = parseAbi([
  "function creator() view returns (address)", "function creatorCredited() view returns (uint256)", "function creatorClaimed() view returns (uint256)",
  "function platformReceived() view returns (uint256)", "function platformClaimed() view returns (uint256)", "function creatorReceived() view returns (uint256)",
  "function claimCreator() returns (uint256)", "function claimPlatform() returns (uint256)",
]);
export const PROBE_ABI = parseAbi([
  ...STRUCTS,
  "function probe(address factory, bytes configuration, address token, address quote, address creator) returns (bytes32 factoryCodeHash, bytes32 moduleCodeHash, bytes32 descriptorHash, Descriptor d)",
]);
export const ROUTER_ABI = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
export const PERMIT2_ABI = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);
export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)", "function symbol() view returns (string)", "function decimals() view returns (uint8)",
]);
const PONS_ABI = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "function memeHook() view returns (address)",
]);
const STATE_ABI = parseAbi(["function extsload(bytes32 slot) view returns (bytes32)"]);

export type Metadata = { name: string; symbol: string; description: string; imageURI: string; website: string; socialData: Hex };
export type Selection = { factory: Address; factoryCodeHash: Hex; moduleCodeHash: Hex; descriptorHash: Hex; configuration: Hex; creatorShareBps: number };
export type LaunchParamsV3 = {
  metadata: Metadata; quote: Address; quoteDecimals: number; initialTick: number; creatorBuyFeeBps: number; creatorSellFeeBps: number;
  additionalQuoteAmount: bigint; initialBuyQuoteAmount: bigint; initialBuyMinimumTokenAmount: bigint; deadline: bigint;
  tokenSalt: Hex; hookSalt: Hex; modules: Selection[];
};
export type PoolKey = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
export type PathKey = { intermediateCurrency: Address; fee: number; tickSpacing: number; hooks: Address; hookData: Hex };

// ------------------------------------------------------------------ the module catalogue

export type ModuleKey =
  | "buyCooldown" | "buyWindow" | "priceMoveGuard" | "growingBuyLimit" | "launchWalletCap"
  | "buybackBurn" | "dipBuyback" | "lpRewards" | "fullRangeLp"
  | "buyerRewards" | "nthBuyPot" | "kingOfTheHill" | "hotPotato" | "plague" | "reactivePair" | "entangled";

export type FieldType = "seconds" | "minutes" | "hour" | "hours" | "percent" | "quote" | "tokens" | "count" | "address";
export type Field = { key: string; label: string; type: FieldType; default: string; min?: number; max?: number; help?: string };
export type ModuleDef = {
  key: ModuleKey;
  name: string;
  group: "Trading rules" | "Fee engines" | "Games and rewards" | "Linked pools";
  artifact: keyof typeof artifacts;
  blurb: string;
  /** Runs on a share of the creator's fee: the builder asks what share. */
  budget: boolean;
  fields: Field[];
  encode: (v: Record<string, string>, quoteDecimals: number) => Hex;
};

const pct = (v: string) => Math.round(Number(v) * 100);
const units = (v: string, d: number) => {
  const [w, f = ""] = (v || "0").split(".");
  return BigInt(w || "0") * 10n ** BigInt(d) + BigInt((f + "0".repeat(d)).slice(0, d) || "0");
};
const enc = (types: string, values: readonly unknown[]) => encodeAbiParameters(parseAbiParameters(types), values as never);

export const MODULES: ModuleDef[] = [
  { key: "buyCooldown", name: "Buy cooldown", group: "Trading rules", artifact: "BuyCooldownFactoryV1", budget: false,
    blurb: "Each wallet waits a set time between buys. Slows down bots that buy in bursts.",
    fields: [{ key: "seconds", label: "Wait between buys", type: "seconds", default: "30", min: 1, max: 86400 }],
    encode: (v) => enc("uint32", [Number(v.seconds)]) },
  { key: "buyWindow", name: "Buy window", group: "Trading rules", artifact: "BuyWindowFactoryV1", budget: false,
    blurb: "Buys are open for a few hours a day (UTC). Selling is never blocked.",
    fields: [{ key: "start", label: "Opens at (UTC hour)", type: "hour", default: "14", min: 0, max: 23 }, { key: "hours", label: "Open for", type: "hours", default: "8", min: 1, max: 23 }],
    encode: (v) => enc("uint8, uint8", [Number(v.start), Number(v.hours)]) },
  { key: "priceMoveGuard", name: "Price move guard", group: "Trading rules", artifact: "PriceMoveGuardFactoryV1", budget: false,
    blurb: "No single trade can move the price more than this. Big entries and exits have to be split up.",
    fields: [{ key: "max", label: "Largest move per trade", type: "percent", default: "15", min: 0.01, max: 50 }],
    encode: (v) => enc("uint16", [pct(v.max)]) },
  { key: "growingBuyLimit", name: "Growing buy limit", group: "Trading rules", artifact: "GrowingBuyLimitFactoryV1", budget: false,
    blurb: "A cap on each buy that starts small and grows to its full size over time.",
    fields: [{ key: "initial", label: "Cap at launch (of supply)", type: "percent", default: "0.5", min: 0.01, max: 100 }, { key: "final", label: "Final cap (of supply)", type: "percent", default: "5", min: 0.01, max: 100 }, { key: "seconds", label: "Grows over", type: "seconds", default: "1800", min: 1, max: 4294967295 }],
    encode: (v) => enc("uint16, uint16, uint32", [pct(v.initial), pct(v.final), Number(v.seconds)]) },
  { key: "launchWalletCap", name: "Launch wallet cap", group: "Trading rules", artifact: "LaunchWalletCapFactoryV1", budget: false,
    blurb: "For the first minutes, no wallet can buy more than a set share of the supply in total.",
    fields: [{ key: "limit", label: "Most per wallet (of supply)", type: "percent", default: "2", min: 0.01, max: 100 }, { key: "minutes", label: "For the first", type: "minutes", default: "30", min: 1, max: 4294967295 }],
    encode: (v) => enc("uint16, uint32", [pct(v.limit), Number(v.minutes)]) },

  ...(["buybackBurn", "dipBuyback", "lpRewards", "fullRangeLp"] as const).map((k): ModuleDef => ({
    key: k, group: "Fee engines", budget: true,
    name: { buybackBurn: "Buyback and burn", dipBuyback: "Dip buyback", lpRewards: "LP rewards", fullRangeLp: "Full-range LP" }[k],
    artifact: ({ buybackBurn: "BuybackBurnFactoryV1", dipBuyback: "DipBuybackFactoryV1", lpRewards: "LPRewardsFactoryV1", fullRangeLp: "FullRangeLPFactoryV1" } as const)[k],
    blurb: {
      buybackBurn: "A share of the creator fee buys the coin back and burns it, in batches, at a fair average price.",
      dipBuyback: "A share of the creator fee buys back only when the price has dipped below its recent average.",
      lpRewards: "A share of the creator fee is paid to everyone providing liquidity in the pool.",
      fullRangeLp: "A share of the creator fee is added as permanent full-range liquidity, deepening the pool for good.",
    }[k],
    fields: [
      { key: "minimum", label: "Smallest batch", type: "quote", default: "0.005" },
      { key: "maximum", label: "Largest batch", type: "quote", default: "0.5" },
      { key: "interval", label: "At most every", type: "seconds", default: "3600", min: 30, max: 604800 },
      { key: "slippage", label: "Price tolerance", type: "percent", default: "3", min: 0.01, max: 10 },
      ...(k === "dipBuyback" ? [{ key: "dip", label: "Buy when price is below average by", type: "percent" as const, default: "10", min: 0.01, max: 50 }] : []),
    ],
    encode: (v, d) => enc("uint128, uint128, uint32, uint32, uint16, uint16", [units(v.minimum, d), units(v.maximum, d), Number(v.interval), 300, pct(v.slippage), k === "dipBuyback" ? pct(v.dip) : 0]),
  })),

  { key: "buyerRewards", name: "Cashback", group: "Games and rewards", artifact: "BuyerRewardsFactoryV1", budget: true,
    blurb: "Every qualifying buy earns a cashback from the module's share of the creator fee.",
    fields: [{ key: "minimum", label: "Smallest qualifying buy", type: "quote", default: "0.01" }, { key: "reward", label: "Cashback per buy", type: "percent", default: "2", min: 0.01, max: 10 }],
    encode: (v, d) => enc("uint128, uint16, uint32, uint32", [units(v.minimum, d), pct(v.reward), 0, 0]) },
  { key: "nthBuyPot", name: "Lucky Nth buy", group: "Games and rewards", artifact: "NthBuyPotFactoryV1", budget: true,
    blurb: "A pot builds from the creator fee; every Nth qualifying buyer takes it.",
    fields: [{ key: "minimum", label: "Smallest qualifying buy", type: "quote", default: "0.01" }, { key: "n", label: "Every Nth buy wins", type: "count", default: "25", min: 2, max: 1000000 }],
    encode: (v, d) => enc("uint128, uint16, uint32, uint32", [units(v.minimum, d), 0, Number(v.n), 0]) },
  { key: "kingOfTheHill", name: "Top buyer crown", group: "Games and rewards", artifact: "KingOfTheHillFactoryV1", budget: true,
    blurb: "The biggest recent buyer wears the crown and collects the pot. The crown fades, so someone can always take it.",
    fields: [{ key: "minimum", label: "Smallest qualifying buy", type: "quote", default: "0.01" }, { key: "decay", label: "Crown fades over", type: "seconds", default: "3600", min: 60, max: 2592000 }],
    encode: (v, d) => enc("uint128, uint16, uint32, uint32", [units(v.minimum, d), 0, 0, Number(v.decay)]) },
  { key: "hotPotato", name: "Pass the bag", group: "Games and rewards", artifact: "HotPotatoFactoryV1", budget: false,
    blurb: "The last big buyer holds the bag and can't sell for a while, until someone else buys big and takes it.",
    fields: [{ key: "minimum", label: "Buy size that takes the bag", type: "quote", default: "0.05" }, { key: "pause", label: "Holder can't sell for", type: "seconds", default: "300", min: 1, max: 3600 }],
    encode: (v, d) => enc("uint128, uint32", [units(v.minimum, d), Number(v.pause)]) },
  { key: "plague", name: "Holders only", group: "Games and rewards", artifact: "PlagueFactoryV1", budget: false,
    blurb: "Only wallets that already hold some of the coin can buy it. Spreads by sending it to friends.",
    fields: [{ key: "minimum", label: "Must already hold", type: "tokens", default: "1000" }],
    encode: (v) => enc("uint128, uint32", [units(v.minimum, 18), 0]) },
  { key: "reactivePair", name: "Linked buy cap", group: "Linked pools", artifact: "ReactivePairFactoryV1", budget: false,
    blurb: "Linked to another coin with the same pair: the bigger that coin's price gets, the bigger the buys allowed here.",
    fields: [{ key: "reference", label: "Linked coin's hook", type: "address", default: "" }, { key: "base", label: "Buy cap now (of supply)", type: "percent", default: "1", min: 0.01, max: 100 }, { key: "min", label: "Smallest cap", type: "percent", default: "0.25", min: 0.01, max: 100 }, { key: "max", label: "Largest cap", type: "percent", default: "5", min: 0.01, max: 100 }],
    encode: (v) => enc("address, uint16, uint16, uint16, uint16", [v.reference as Address, pct(v.base), pct(v.min), pct(v.max), 0]) },
  { key: "entangled", name: "Linked unlock", group: "Linked pools", artifact: "EntangledFactoryV1", budget: false,
    blurb: "Buys stay locked until a linked coin rises by a set amount. Then they unlock for good.",
    fields: [{ key: "reference", label: "Linked coin's hook", type: "address", default: "" }, { key: "rise", label: "Unlocks when it rises by", type: "percent", default: "50", min: 0.01, max: 1000 }],
    encode: (v) => enc("address, uint16, uint16, uint16, uint16", [v.reference as Address, 0, 0, 0, pct(v.rise)]) },
];
export const moduleDef = (k: ModuleKey) => MODULES.find((m) => m.key === k)!;

/** The selection a launch must commit to, read from the chain: run the module factory inside one eth_call (the probe
 *  contract is injected as a state override, never deployed) and take the code hash and descriptor it produces. */
export async function probeSelection(pub: PublicClient, factory: Address, configuration: Hex, quote: Address, creator: Address, creatorShareBps: number): Promise<Selection> {
  const probe = getAddress("0x00000000000000000000000000000000c0ffee01");
  const code = (artifacts.ModuleProbeV1 as { deployedBytecode: string | null }).deployedBytecode as Hex;
  const { result } = await pub.simulateContract({
    address: probe, abi: PROBE_ABI, functionName: "probe",
    args: [factory, configuration, getAddress("0x00000000000000000000000000000000000c0170"), quote, creator],
    stateOverride: [{ address: probe, code }],
  });
  const [factoryCodeHash, moduleCodeHash, descriptorHash] = result as unknown as [Hex, Hex, Hex];
  return { factory, factoryCodeHash, moduleCodeHash, descriptorHash, configuration, creatorShareBps };
}

// ------------------------------------------------------------------ prices and the $TRENCHERS route

/** $TRENCHERS's own pool on Pons (native ETH and $TRENCHERS, Pons's meme hook): the route ETH takes to buy it. */
export async function trenchersPool(pub: PublicClient): Promise<PoolKey | null> {
  if (!INFRA.pons) return null;
  try {
    const [t, hook] = await Promise.all([
      pub.readContract({ address: INFRA.pons!, abi: PONS_ABI, functionName: "getLaunchedToken", args: [TRENCHERS] }),
      pub.readContract({ address: INFRA.pons!, abi: PONS_ABI, functionName: "memeHook" }),
    ]);
    if (Number((t as { phase: number }).phase) !== 2) return null; // still on its bonding curve: no v4 pool yet
    const x = t as { poolFee: number; tickSpacing: number; pairToken: Address };
    if (x.pairToken !== zeroAddress) return null; // the route below assumes a native ETH pair
    return { currency0: zeroAddress, currency1: TRENCHERS, fee: Number(x.poolFee), tickSpacing: Number(x.tickSpacing), hooks: hook as Address };
  } catch { return null; }
}

export const poolIdOf = (k: PoolKey) => keccak256(encodeAbiParameters(parseAbiParameters("address, address, uint24, int24, address"), [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));

/** A pool's sqrtPriceX96, straight from the PoolManager's storage (slot0 of pools[id], mapping at slot 6). */
export async function sqrtPriceOf(pub: PublicClient, key: PoolKey): Promise<bigint> {
  const slot = keccak256(encodeAbiParameters(parseAbiParameters("bytes32, uint256"), [poolIdOf(key), 6n]));
  const word = await pub.readContract({ address: INFRA.manager, abi: STATE_ABI, functionName: "extsload", args: [slot] }) as Hex;
  return BigInt(word) & ((1n << 160n) - 1n);
}

/** A pool's active liquidity (pools[id].liquidity, three words after slot0). */
export async function liquidityOf(pub: PublicClient, key: PoolKey): Promise<bigint> {
  const base = BigInt(keccak256(encodeAbiParameters(parseAbiParameters("bytes32, uint256"), [poolIdOf(key), 6n])));
  const word = await pub.readContract({ address: INFRA.manager, abi: STATE_ABI, functionName: "extsload", args: [toHex(base + 3n, { size: 32 })] }) as Hex;
  return BigInt(word) & ((1n << 128n) - 1n);
}

/** Output of an exact-input swap inside the active liquidity range (no tick crossings): an estimate used to set the
 *  minimum received, never trusted for anything else. */
export function swapOut(sqrtP: bigint, L: bigint, amountIn: bigint, zeroForOne: boolean): bigint {
  const Q = 1n << 96n;
  if (L === 0n || sqrtP === 0n || amountIn <= 0n) return 0n;
  if (zeroForOne) {
    const next = (L * Q * sqrtP) / (L * Q + amountIn * sqrtP);
    return (L * (sqrtP - next)) / Q;
  }
  const next = sqrtP + (amountIn * Q) / L;
  return (L * Q * (next - sqrtP)) / sqrtP / next;
}

/** currency1 per currency0, scaled by 1e18. */
export const price1Per0 = (sqrt: bigint) => (sqrt * sqrt * 10n ** 18n) >> 192n;

/** Starting tick for a full-supply valuation of `value` quote units. */
export const tickForStart = (token: Address, quote: Address, value: bigint) => tickForValuation(token, quote, { n: value, d: 1n });

// ------------------------------------------------------------------ launch calldata

export const fundingPath = (key: PoolKey | null): PathKey[] =>
  key ? [{ intermediateCurrency: zeroAddress, fee: key.fee, tickSpacing: key.tickSpacing, hooks: key.hooks, hookData: "0x" }] : [];
export const encodePath = (path: PathKey[]) =>
  encodeAbiParameters(parseAbiParameters("(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[]"), [path]);

// ------------------------------------------------------------------ trading (Universal Router), mirrors test/WebFlows.t.sol

const ADDRESS_THIS = "0x0000000000000000000000000000000000000002" as Address;
const MSG_SENDER = "0x0000000000000000000000000000000000000001" as Address;
const A = { SWAP_EXACT_IN_SINGLE: 0x06, SWAP_EXACT_IN: 0x07, SETTLE: 0x0b, SETTLE_ALL: 0x0c, TAKE: 0x0e, TAKE_ALL: 0x0f } as const;
const actions = (...a: number[]) => toHex(new Uint8Array(a));
const singleParams = (key: PoolKey, zeroForOne: boolean, amountIn: bigint, minOut: bigint) =>
  encodeAbiParameters(parseAbiParameters("((address,address,uint24,int24,address) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, uint256 minHopPriceX36, bytes hookData)"),
    [{ poolKey: [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], zeroForOne, amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: "0x" }] as never);
const multiParams = (currencyIn: Address, path: PathKey[], amountIn: bigint, minOut: bigint) =>
  encodeAbiParameters(parseAbiParameters("(address currencyIn, (address,uint24,int24,address,bytes)[] path, uint256[] minHopPriceX36, uint128 amountIn, uint128 amountOutMinimum)"),
    [{ currencyIn, path: path.map((p) => [p.intermediateCurrency, p.fee, p.tickSpacing, p.hooks, p.hookData]), minHopPriceX36: [], amountIn, amountOutMinimum: minOut }] as never);
const v4 = (acts: Hex, params: Hex[]) => encodeAbiParameters(parseAbiParameters("bytes, bytes[]"), [acts, params]);
const cur = (c: Address, n: bigint) => encodeAbiParameters(parseAbiParameters("address, uint256"), [c, n]);

export type RouterCall = { commands: Hex; inputs: Hex[]; value: bigint };

/** Buy a coin with native ETH. WETH pair: wrap, then one swap. $TRENCHERS pair: ETH → $TRENCHERS → coin, two hops. */
export function buyWithEth(o: { coinKey: PoolKey; token: Address; quote: Address; trenchersKey: PoolKey | null; ethIn: bigint; minOut: bigint }): RouterCall {
  if (o.quote.toLowerCase() === INFRA.weth.toLowerCase()) {
    const inputs = [
      encodeAbiParameters(parseAbiParameters("address, uint256"), [ADDRESS_THIS, o.ethIn]),
      v4(actions(A.SWAP_EXACT_IN_SINGLE, A.SETTLE, A.TAKE_ALL), [
        singleParams(o.coinKey, BigInt(INFRA.weth) < BigInt(o.token), o.ethIn, o.minOut),
        encodeAbiParameters(parseAbiParameters("address, uint256, bool"), [INFRA.weth, 0n, false]),
        cur(o.token, o.minOut),
      ]),
    ];
    return { commands: "0x0b10", inputs, value: o.ethIn };
  }
  if (!o.trenchersKey) throw new Error("$TRENCHERS has no ETH pool yet, so buy with $TRENCHERS directly.");
  const path: PathKey[] = [
    { intermediateCurrency: o.quote, fee: o.trenchersKey.fee, tickSpacing: o.trenchersKey.tickSpacing, hooks: o.trenchersKey.hooks, hookData: "0x" },
    { intermediateCurrency: o.token, fee: o.coinKey.fee, tickSpacing: o.coinKey.tickSpacing, hooks: o.coinKey.hooks, hookData: "0x" },
  ];
  return { commands: "0x10", inputs: [v4(actions(A.SWAP_EXACT_IN, A.SETTLE_ALL, A.TAKE_ALL), [multiParams(zeroAddress, path, o.ethIn, o.minOut), cur(zeroAddress, o.ethIn), cur(o.token, o.minOut)])], value: o.ethIn };
}

/** Sell a coin for native ETH (needs a Permit2 allowance for the router). */
export function sellForEth(o: { coinKey: PoolKey; token: Address; quote: Address; trenchersKey: PoolKey | null; amountIn: bigint; minOut: bigint }): RouterCall {
  if (o.quote.toLowerCase() === INFRA.weth.toLowerCase()) {
    const inputs = [
      v4(actions(A.SWAP_EXACT_IN_SINGLE, A.SETTLE_ALL, A.TAKE), [
        singleParams(o.coinKey, BigInt(o.token) < BigInt(INFRA.weth), o.amountIn, o.minOut),
        cur(o.token, o.amountIn),
        encodeAbiParameters(parseAbiParameters("address, address, uint256"), [INFRA.weth, ADDRESS_THIS, 0n]),
      ]),
      encodeAbiParameters(parseAbiParameters("address, uint256"), [MSG_SENDER, o.minOut]),
    ];
    return { commands: "0x100c", inputs, value: 0n };
  }
  if (!o.trenchersKey) throw new Error("$TRENCHERS has no ETH pool yet.");
  const path: PathKey[] = [
    { intermediateCurrency: o.quote, fee: o.coinKey.fee, tickSpacing: o.coinKey.tickSpacing, hooks: o.coinKey.hooks, hookData: "0x" },
    { intermediateCurrency: zeroAddress, fee: o.trenchersKey.fee, tickSpacing: o.trenchersKey.tickSpacing, hooks: o.trenchersKey.hooks, hookData: "0x" },
  ];
  return { commands: "0x10", inputs: [v4(actions(A.SWAP_EXACT_IN, A.SETTLE_ALL, A.TAKE_ALL), [multiParams(o.token, path, o.amountIn, o.minOut), cur(o.token, o.amountIn), cur(zeroAddress, o.minOut)])], value: 0n };
}

export const encodeExecute = (c: RouterCall, deadline: bigint) =>
  encodeFunctionData({ abi: ROUTER_ABI, functionName: "execute", args: [c.commands, c.inputs, deadline] });

/** Module actions, by module kind: what "run" means for each budget module. */
export const MODULE_ACTION = {
  execute: "0x61461954" as Hex, // bytes4(keccak256("execute()")), fee engines
} as const;
export const payAction = (recipients: Address[]) =>
  (`0x${keccak256(toHex("pay(address[])")).slice(2, 10)}${encodeAbiParameters(parseAbiParameters("address[]"), [recipients]).slice(2)}`) as Hex;

// ------------------------------------------------------------------ indexed coins (engine /builder/coins)

export type BuilderCoin = {
  token: Address; hook: Address; ledger: Address; poolId: Hex; quote: Address; creator: Address;
  name: string; symbol: string; image: string; description: string; website: string;
  launchedAt: number; block: number; tx: Hex | null;
  creatorBuyBps: number; creatorSellBps: number; modules: ModuleKey[];
  /** Quote per token, 1e18-scaled, from the pool's spot price. */
  priceQuote: string | null; marketCapQuote: string | null; volumeQuote: string; trades: number;
  feesQuote: string; holders?: number;
  chart?: { t: number; p: number }[];
};

export const quoteSymbol = (q: string) => (q.toLowerCase() === INFRA.weth.toLowerCase() ? "ETH" : q.toLowerCase() === TRENCHERS.toLowerCase() ? "TRENCHERS" : "?");
export const bps = (n: number) => `${(n / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
export const randomTokenSalt = randomSalt;
