/**
 * Programmable (programmable.market) Module Mode launches on Robinhood Chain, for agent coins paired with $TRENCHERS.
 *
 * How a launch is made (mirrors Programmable's own website flow, github.com/programmablehq/programmable):
 *  1. Our server reads Programmable's live launch release and module catalog (/api/programmable/catalog).
 *  2. Our server asks Programmable to compose the chosen modules (/api/programmable/compose): it returns the coin's
 *     metadata, the encoded module list, a fresh starting price and the ETH → $TRENCHERS route for the first buy.
 *  3. The browser picks the starting tick (about $5,000 market cap), finds the hook address Uniswap v4 needs
 *     (CREATE2 salt with the right permission bits), simulates, and the holder signs: from their own wallet, or
 *     through the agent wallet (version 4) so the agent itself is the coin's creator.
 */
import { encodeAbiParameters, encodeFunctionData, getAddress, getCreate2Address, parseAbi, parseAbiParameters, toHex, type Address, type Hex } from "viem";

/** $TRENCHERS: the only pair a Trenchers agent coin on Programmable can have. */
export const TRENCHERS_TOKEN = getAddress("0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a");
/** $TRENCHERS on Pons, where it trades. */
export const TRENCHERS_PONS_URL = `https://ponsfamily.com/launchpad/${TRENCHERS_TOKEN.toLowerCase()}`;
export const PROGRAMMABLE_SITE = "https://programmable.market";
export const programmableCoinUrl = (token: string) => `${PROGRAMMABLE_SITE}/token/${getAddress(token)}`;
export const FOUNDATION_SUPPLY = 1_000_000_000n * 10n ** 18n;
const TICK_SPACING = 60;
const MAX_TICK_RAW = 887_272;
export const START_MARKET_CAP_USD = 5_000n;

export type FieldKind = "percent" | "quote" | "token" | "integer" | "address";
export interface ModuleField { key: string; label: string; help?: string; kind: FieldKind; unit?: string; min?: string; max?: string; default?: string; required: boolean }
export interface ProgrammableModule {
  id: Hex; version: string; digest: Hex; name: string; summary: string; category: string;
  available: boolean; comingSoon: boolean; fields: ModuleField[];
}
export interface ProgrammableCatalog {
  available: boolean; reason: string | null; releaseDigest: Hex; factoryVersion: "v2" | "v3";
  factory: Address; hookDeployer: Address; modules: ProgrammableModule[];
}
export interface FundingHop { intermediateCurrency: Address; fee: number; tickSpacing: number; hooks: Address; hookData: Hex }
export interface ComposeResult {
  chainId: number; releaseDigest: Hex; token: Address;
  metadata: { name: string; symbol: string; description: string; imageURI: string; website: string; socialData: Hex };
  modules: { factory: Address; factoryCodeHash: Hex; moduleCodeHash: Hex; descriptorHash: Hex; configuration: Hex; creatorShareBps: number }[];
  startPrice: { price?: { usd: { numerator: string; denominator: string }; validUntil: string }; mode?: "quote"; valuationQuoteRaw?: string };
  ethFunding: { maximumEth: string; quoteAmount: string; path: FundingHop[] } | null;
}

export const FOUNDATION_FACTORY_ABI = parseAbi([
  "struct Metadata { string name; string symbol; string description; string imageURI; string website; bytes socialData; }",
  "struct ModuleSelection { address factory; bytes32 factoryCodeHash; bytes32 moduleCodeHash; bytes32 descriptorHash; bytes configuration; uint16 creatorShareBps; }",
  "struct LaunchParams { Metadata metadata; address quote; uint8 quoteDecimals; int24 initialTick; uint16 creatorFeeBps; uint128 additionalQuoteAmount; uint128 initialBuyQuoteAmount; uint128 initialBuyMinimumTokenAmount; uint64 deadline; bytes32 tokenSalt; bytes32 hookSalt; ModuleSelection[] modules; }",
  "struct LaunchResultV2 { address token; address hook; address ledger; bytes32 poolId; address basePositionOwner; address creatorPositionOwner; address roundingInventoryRecipient; uint256 basePositionId; uint256 creatorPositionId; uint256 initialBuyTokenAmount; uint128 baseTokenPrincipal; uint128 baseTokenRounding; uint128 creatorQuotePrincipal; uint256 actualQuoteRefund; }",
  "function launchWithEthRoute(LaunchParams p, bytes fundingPath) payable returns (LaunchResultV2 result)",
  "function launchOf(address token) view returns (LaunchResultV2 result)",
  "function hookInitCodeHash(address creator, address predictedToken, LaunchParams p) view returns (bytes32)",
  "function predictTokenAddress(address creator, bytes32 tokenSalt, Metadata metadata) view returns (address)",
  "event FoundationLaunchedV2(address indexed token, address indexed creator, bytes32 indexed poolId, address hook, address ledger, address quote, bytes32 metadataHash, bytes32 compositionHash, bytes32 custodyId, uint256 initialBuyQuoteAmount, LaunchResultV2 result)",
]);
export const FOUNDATION_LEDGER_ABI = parseAbi([
  "function creator() view returns (address)", "function quote() view returns (address)",
  "function creatorCredited() view returns (uint256)", "function creatorClaimed() view returns (uint256)", "function claimCreator() returns (uint256)",
]);
/** Agent wallet version 4 (TrenchersAgentAccountV4): the agent wallet launches on Programmable itself. */
export const AGENT_V4_ABI = parseAbi([
  "function VERSION() view returns (uint256)",
  "function programmableFactory() view returns (address)", "function trenchersToken() view returns (address)",
  "function launchProgrammable(bytes data, uint256 value) returns (address coin)",
  "function coinLedger() view returns (address)", "function coin() view returns (address)",
  "function coinFeeTokensOwed() view returns (uint256)",
  "function claimCoinFees() returns (uint256)", "function withdrawable() view returns (uint256)",
]);

export type LaunchParams = {
  metadata: ComposeResult["metadata"]; quote: Address; quoteDecimals: number; initialTick: number; creatorFeeBps: number;
  additionalQuoteAmount: bigint; initialBuyQuoteAmount: bigint; initialBuyMinimumTokenAmount: bigint; deadline: bigint;
  tokenSalt: Hex; hookSalt: Hex; modules: ComposeResult["modules"];
};

// ------------------------------------------------------------------ starting price → tick (Uniswap TickMath)

const Q96 = 1n << 96n, Q192 = Q96 * Q96;
const MIN_TICK = Math.ceil(-MAX_TICK_RAW / TICK_SPACING) * TICK_SPACING;
const MAX_TICK = Math.floor(MAX_TICK_RAW / TICK_SPACING) * TICK_SPACING;
const MAGIC: bigint[] = [
  0xfffcb933bd6fad37aa2d162d1a594001n, 0xfff97272373d413259a46990580e213an, 0xfff2e50f5f656932ef12357cf3c7fdccn, 0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n, 0xff973b41fa98c081472e6896dfb254c0n, 0xff2ea16466c96a3843ec78b326b52861n, 0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n, 0xf987a7253ac413176f2b074cf7815e54n, 0xf3392b0822b70005940c7a398e4b70f3n, 0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n, 0xa9f746462d870fdf8a65dc1f90e061e5n, 0x70d869a156d2a1b890bb3df62baf32f7n, 0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n, 0x5d6af8dedb81196699c329225ee604n, 0x2216e584f5fa1ea926041bedfe98n, 0x48a170391f7dc42444e8fa2n,
];
/** sqrt(1.0001^tick) * 2^96, exactly as Uniswap's TickMath.getSqrtPriceAtTick. */
export function sqrtPriceAtTick(tick: number): bigint {
  const abs = BigInt(Math.abs(tick));
  if (abs > BigInt(MAX_TICK_RAW)) throw new Error("tick out of range");
  let ratio = (abs & 1n) !== 0n ? MAGIC[0] : 0x100000000000000000000000000000000n;
  for (let i = 1; i < 20; i++) if ((abs & (1n << BigInt(i))) !== 0n) ratio = (ratio * MAGIC[i]) >> 128n;
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n);
}
function valuationAtTick(tick: number, tokenIsCurrency0: boolean) {
  const sq = sqrtPriceAtTick(tick) ** 2n;
  return tokenIsCurrency0 ? { n: sq * FOUNDATION_SUPPLY, d: Q192 } : { n: Q192 * FOUNDATION_SUPPLY, d: sq };
}
/** The 60-spaced tick whose full-supply valuation is closest to `target` quote units (a fraction). */
export function tickForValuation(token: Address, quote: Address, target: { n: bigint; d: bigint }): number {
  const tokenIsCurrency0 = BigInt(token) < BigInt(quote);
  const [rn, rd] = tokenIsCurrency0 ? [target.n, FOUNDATION_SUPPLY * target.d] : [FOUNDATION_SUPPLY * target.d, target.n];
  const cmp = (t: number) => sqrtPriceAtTick(t) ** 2n * rd - rn * Q192;
  const min = MIN_TICK + TICK_SPACING, max = MAX_TICK - TICK_SPACING;
  if (cmp(min) > 0n || cmp(max) < 0n) throw new Error("The starting price is outside the supported range.");
  let lo = min, hi = max;
  while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); if (cmp(mid) <= 0n) lo = mid; else hi = mid - 1; }
  const lower = Math.floor(lo / TICK_SPACING) * TICK_SPACING;
  const abs = (x: bigint) => (x < 0n ? -x : x);
  const cands = [...new Set([Math.max(min, lower), Math.min(max, lower + TICK_SPACING)])].map((t) => {
    const v = valuationAtTick(t, tokenIsCurrency0);
    return { t, v, err: abs(v.n * target.d - target.n * v.d) };
  }).sort((a, b) => { const x = a.err * b.v.d - b.err * a.v.d; return x < 0n ? -1 : x > 0n ? 1 : a.t - b.t; });
  return cands[0].t;
}
/** Starting tick from Programmable's price reference: about $5,000 for the whole supply (or an explicit quote valuation). */
export function startTick(token: Address, quoteDecimals: number, startPrice: ComposeResult["startPrice"]): number {
  if (startPrice.mode === "quote" && startPrice.valuationQuoteRaw) return tickForValuation(token, TRENCHERS_TOKEN, { n: BigInt(startPrice.valuationQuoteRaw), d: 1n });
  const usd = startPrice.price?.usd;
  if (!usd) throw new Error("Programmable didn't return a starting price. Try again.");
  const units = 10n ** BigInt(quoteDecimals);
  return tickForValuation(token, TRENCHERS_TOKEN, { n: START_MARKET_CAP_USD * units * BigInt(usd.denominator), d: BigInt(usd.numerator) });
}

// ------------------------------------------------------------------ hook address, funding route, calldata

/** Uniswap v4 reads a hook's permissions from its address: Programmable's hook needs these low bits. */
export async function mineHookSalt(hookDeployer: Address, initCodeHash: Hex, onProgress?: (tries: number) => void): Promise<{ salt: Hex; hook: Address }> {
  const mask = (1n << 14n) - 1n, flags = 0x20ccn;
  for (let n = 0n; n < 2_000_000n; n++) {
    const salt = toHex(n, { size: 32 });
    const hook = getCreate2Address({ from: hookDeployer, salt, bytecodeHash: initCodeHash });
    if ((BigInt(hook) & mask) === flags) return { salt, hook };
    if (n % 2048n === 0n) { onProgress?.(Number(n)); await new Promise((r) => setTimeout(r, 0)); }
  }
  throw new Error("Couldn't find a hook address. Try again.");
}
export const encodeFundingPath = (path: FundingHop[]) =>
  encodeAbiParameters(parseAbiParameters("(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[]"), [path]);
export const encodeLaunch = (p: LaunchParams, path: FundingHop[]) =>
  encodeFunctionData({ abi: FOUNDATION_FACTORY_ABI, functionName: "launchWithEthRoute", args: [p, encodeFundingPath(path)] });

/** 32 random bytes for the coin's CREATE2 salt. */
export function randomSalt(): Hex {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  return toHex(b);
}

/** Percent text ("2.5") → basis points (250), at most two decimals. */
export function percentToBps(v: string): string {
  if (!/^\d+(\.\d{1,2})?$/.test(v.trim())) throw new Error("Use a percentage with at most two decimals.");
  const [w, f = ""] = v.trim().split(".");
  return String(BigInt(w) * 100n + BigInt((f + "00").slice(0, 2)));
}
export const bpsToPercent = (bps: string) => { const n = BigInt(bps); return `${n / 100n}${n % 100n ? `.${String(n % 100n).padStart(2, "0").replace(/0$/, "")}` : ""}`; };
