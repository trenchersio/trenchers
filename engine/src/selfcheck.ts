import { transport, urls } from "./rpc";
import {
  createPublicClient, decodeAbiParameters, decodeEventLog, defineChain, encodeFunctionData, formatEther, http, parseAbi, parseEther,
  type Address, type Hex, type Log, type PublicClient,
} from "viem";
import { CURVE_BUY, CURVE_SELL, ERC20_ABI, LAUNCH_SWEPT, POOL_GRADUATED, TOKEN_LAUNCHED } from "./abis";
import { ADAPTER_RUNTIME, LIVECHECK_RUNTIME } from "./livecheck-code";

/**
 * Live check against Robinhood Chain mainnet, read-only (no transaction is ever sent):
 *  - the Pons V2 factory and its settings;
 *  - recent Pons events decode with exactly the ABIs the engine uses;
 *  - the Trenchers trading route (the real PonsAdapter code) buys and sells a live curve coin and a live
 *    graduated (Uniswap v4) coin, simulated with eth_call and state overrides, so nothing is spent.
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address;
const ADAPTER = "0x00000000000000000000000000000000ad0a7e70" as Address;
const CHECKER = "0x00000000000000000000000000000000c4ec0001" as Address;
const CALLER = "0x00000000000000000000000000000000ca11e700" as Address;
const LIVECHECK_ABI = parseAbi(["function roundTrip(address adapter, address token, uint256 ethIn) payable returns (uint256 tokensOut, uint256 ethBack, uint8 venueAfter)"]);
const FACTORY_EXTRA = parseAbi([
  "function owner() view returns (address)",
  "function poolManager() view returns (address)",
  "function memeHook() view returns (address)",
  "function snipeTaxStartBps() view returns (uint256)",
  "function snipeTaxSeconds() view returns (uint256)",
]);
/** Pons V2 LaunchedToken record: the first 11 fields (the same ones the trading route reads). */
const FACTORY_ABI = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
]);

type Trip = { token: Address; symbol?: string; phase: number; ethIn: string; tokensOut?: string; ethBack?: string; roundTripLossPct?: number; venueAfter?: number; error?: string };

export async function logsBack(c: PublicClient, head: bigint, span: bigint, fetch: (from: bigint, to: bigint) => Promise<Log[]>, want = 200) {
  const out: Log[] = [];
  let step = 20_000n, to = head;
  const floor = head > span ? head - span : 0n;
  while (to > floor && out.length < want) {
    const from = to - step + 1n > floor ? to - step + 1n : floor;
    try { out.push(...(await fetch(from, to))); to = from - 1n; }
    catch { if (step <= 500n) { to = from - 1n; continue; } step /= 4n; }
  }
  return out;
}

async function roundTrip(c: PublicClient, token: Address, ethIn: bigint): Promise<Omit<Trip, "token" | "phase">> {
  const data = encodeFunctionData({ abi: LIVECHECK_ABI, functionName: "roundTrip", args: [ADAPTER, token, ethIn] });
  try {
    const r = await c.call({
      account: CALLER, to: CHECKER, data, value: ethIn,
      stateOverride: [
        { address: ADAPTER, code: ADAPTER_RUNTIME as Hex },
        { address: CHECKER, code: LIVECHECK_RUNTIME as Hex },
        { address: CALLER, balance: parseEther("10") },
      ],
    });
    const [tokensOut, ethBack, venueAfter] = decodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint8" }], r.data!);
    return { ethIn: formatEther(ethIn), tokensOut: tokensOut.toString(), ethBack: formatEther(ethBack), roundTripLossPct: +(100 - Number((ethBack * 10_000n) / ethIn) / 100).toFixed(2), venueAfter };
  } catch (e) {
    return { ethIn: formatEther(ethIn), error: ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0] };
  }
}

/** The newest tradable ETH-paired Pons coins on mainnet: one on its curve (older than 5 minutes), one graduated. */
export async function findLiveCoins(c: PublicClient): Promise<{ curve?: Address; pool?: Address }> {
  const head = await c.getBlockNumber();
  const now = Number((await c.getBlock()).timestamp);
  const info = (t: Address) => c.readContract({ address: PONS_FACTORY, abi: FACTORY_ABI, functionName: "getLaunchedToken", args: [t] }).catch(() => null) as Promise<{ pairToken: Address; phase: number } | null>;
  const out: { curve?: Address; pool?: Address } = {};
  const launches = await logsBack(c, head, 3_000_000n, (a, b) => c.getLogs({ address: PONS_FACTORY, event: TOKEN_LAUNCHED, fromBlock: a, toBlock: b }) as Promise<Log[]>, 100);
  for (const l of [...launches].reverse()) {
    const ev = decodeEventLog({ abi: [TOKEN_LAUNCHED], data: l.data, topics: l.topics as never }) as { args: { token: Address; pairToken: Address } };
    if (ev.args.pairToken !== "0x0000000000000000000000000000000000000000") continue;
    if (now - Number((await c.getBlock({ blockNumber: l.blockNumber! })).timestamp) < 300) continue;
    const i = await info(ev.args.token);
    if (i && Number(i.phase) === 0) { out.curve = ev.args.token; break; }
  }
  const grads = await logsBack(c, head, 6_000_000n, (a, b) => c.getLogs({ address: PONS_FACTORY, event: POOL_GRADUATED, fromBlock: a, toBlock: b }) as Promise<Log[]>, 20);
  for (const l of [...grads].reverse()) {
    const ev = decodeEventLog({ abi: [POOL_GRADUATED], data: l.data, topics: l.topics as never }) as { args: { token: Address } };
    const i = await info(ev.args.token);
    if (i && i.pairToken === "0x0000000000000000000000000000000000000000" && Number(i.phase) === 2) { out.pool = ev.args.token; break; }
  }
  return out;
}

export async function liveCheck(rpc: string) {
  const chain = defineChain({ id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [urls(rpc)[0]] } } });
  const c = createPublicClient({ chain, transport: transport(urls(rpc)) }) as PublicClient;
  const report: Record<string, unknown> = { rpc: rpc.replace(/\/v2\/[^,]+/g, "/v2/…"), at: new Date().toISOString() };
  const problems: string[] = [];
  report.chainId = await c.getChainId();
  if (report.chainId !== 4663) problems.push(`chain id is ${report.chainId}, expected 4663`);
  const head = await c.getBlockNumber();
  report.block = head.toString();

  // 1. The factory and its settings.
  const code = await c.getCode({ address: PONS_FACTORY });
  const f: Record<string, unknown> = { address: PONS_FACTORY, hasCode: !!code && code !== "0x" };
  for (const fn of ["owner", "poolManager", "memeHook", "snipeTaxStartBps", "snipeTaxSeconds"] as const) {
    try { const v = await c.readContract({ address: PONS_FACTORY, abi: FACTORY_EXTRA, functionName: fn }); f[fn] = typeof v === "bigint" ? Number(v) : v; }
    catch { f[fn] = "not available"; }
  }
  report.factory = f;
  if (!f.hasCode) problems.push("no Pons factory code at the expected address");
  if (typeof f.poolManager !== "string" || typeof f.memeHook !== "string") problems.push("factory.poolManager() / memeHook() not readable: graduated-coin trading would fail");

  // 1b. What the Trenchers launch needs on mainnet: the ERC-6551 registry, the team Safe, the Deployer's gas.
  const SAFE = "0xF928e1A70d0CBf092193D4E3FE4F68edfffe4b10" as Address, DEPLOYER = "0x447D8F97c39df3d6FCAB8a02A54986283e818210" as Address;
  const SAFE_ABI = parseAbi(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"]);
  const has = async (a: Address) => { const x = await c.getCode({ address: a }).catch(() => undefined); return !!x && x !== "0x"; };
  const launch: Record<string, unknown> = {
    erc6551Registry: await has("0x000000006551c19487814612e58FE06813775758"),
    limitBreakValidator: await has("0x721C008fdff27BF06E7E123956E2Fe03B63342e3"),
    deployerEth: formatEther(await c.getBalance({ address: DEPLOYER })),
  };
  try {
    launch.safeThreshold = Number(await c.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getThreshold" }));
    launch.safeOwners = await c.readContract({ address: SAFE, abi: SAFE_ABI, functionName: "getOwners" });
  } catch { launch.safe = "not readable"; problems.push("team Safe not readable on mainnet"); }
  report.launch = launch;
  if (!launch.erc6551Registry) problems.push("no ERC-6551 registry on mainnet: agent wallets can't be created");

  // 2. Recent events decode with the engine's ABIs.
  const launches = await logsBack(c, head, 3_000_000n, (a, b) => c.getLogs({ address: PONS_FACTORY, event: TOKEN_LAUNCHED, fromBlock: a, toBlock: b }) as Promise<Log[]>, 300);
  const grads = await logsBack(c, head, 6_000_000n, (a, b) => c.getLogs({ address: PONS_FACTORY, event: POOL_GRADUATED, fromBlock: a, toBlock: b }) as Promise<Log[]>, 20);
  const swepts = await logsBack(c, head, 6_000_000n, (a, b) => c.getLogs({ address: PONS_FACTORY, event: LAUNCH_SWEPT, fromBlock: a, toBlock: b }) as Promise<Log[]>, 20);
  const curveEvents = [CURVE_BUY, CURVE_SELL];
  const buys = await logsBack(c, head, 200_000n, (a, b) => c.getLogs({ event: curveEvents[0] as never, fromBlock: a, toBlock: b }) as Promise<Log[]>, 100);
  const sells = await logsBack(c, head, 200_000n, (a, b) => c.getLogs({ event: curveEvents[1] as never, fromBlock: a, toBlock: b }) as Promise<Log[]>, 100);
  const decodes = (logs: Log[], abi: readonly unknown[]) => {
    let ok = 0, bad = 0;
    for (const l of logs) { try { decodeEventLog({ abi: abi as never, data: l.data, topics: l.topics as never }); ok++; } catch { bad++; } }
    return { found: logs.length, decoded: ok, failed: bad };
  };
  report.events = {
    TokenLaunched: decodes(launches, [TOKEN_LAUNCHED]), PoolGraduated: decodes(grads, [POOL_GRADUATED]), LaunchSwept: decodes(swepts, [LAUNCH_SWEPT]),
    CurveBuy: decodes(buys, [curveEvents[0]]), CurveSell: decodes(sells, [curveEvents[1]]),
  };
  for (const [k, v] of Object.entries(report.events as Record<string, { found: number; failed: number }>)) if (v.failed > 0) problems.push(`${k}: ${v.failed} of ${v.found} recent events don't decode with the engine's ABI`);
  if (launches.length === 0) problems.push("no recent TokenLaunched events found");

  // 3. Round trips through the real trading route on live coins.
  const phaseOf = async (t: Address) => {
    const r = await c.readContract({ address: PONS_FACTORY, abi: FACTORY_ABI, functionName: "getLaunchedToken", args: [t] }) as { pairToken: Address; phase: number; curve: Address };
    return r;
  };
  const symbol = (t: Address) => c.readContract({ address: t, abi: ERC20_ABI, functionName: "symbol" }).catch(() => undefined) as Promise<string | undefined>;
  const now = Number((await c.getBlock()).timestamp);
  const curveTrips: Trip[] = [];
  for (const l of [...launches].reverse()) {
    if (curveTrips.length >= 3) break;
    const ev = decodeEventLog({ abi: [TOKEN_LAUNCHED], data: l.data, topics: l.topics as never }) as { args: { token: Address; pairToken: Address } };
    if (ev.args.pairToken !== "0x0000000000000000000000000000000000000000") continue;
    const blockTime = Number((await c.getBlock({ blockNumber: l.blockNumber! })).timestamp);
    if (now - blockTime < 300) continue; // past any anti-snipe window
    const info = await phaseOf(ev.args.token).catch(() => null);
    if (!info || Number(info.phase) !== 0) continue;
    curveTrips.push({ token: ev.args.token, symbol: await symbol(ev.args.token), phase: 0, ...(await roundTrip(c, ev.args.token, parseEther("0.0005"))) });
  }
  const poolTrips: Trip[] = [];
  for (const l of [...grads].reverse()) {
    if (poolTrips.length >= 2) break;
    const ev = decodeEventLog({ abi: [POOL_GRADUATED], data: l.data, topics: l.topics as never }) as { args: { token: Address } };
    const info = await phaseOf(ev.args.token).catch(() => null);
    if (!info || info.pairToken !== "0x0000000000000000000000000000000000000000") continue;
    poolTrips.push({ token: ev.args.token, symbol: await symbol(ev.args.token), phase: Number(info.phase), ...(await roundTrip(c, ev.args.token, parseEther("0.0005"))) });
  }
  report.curveRoundTrips = curveTrips;
  report.poolRoundTrips = poolTrips;
  if (curveTrips.length === 0) problems.push("no live curve coin found to test");
  if (curveTrips.some((t) => t.error)) problems.push("a buy+sell round trip on a live curve coin failed");
  if (poolTrips.some((t) => t.error)) problems.push("a buy+sell round trip on a live graduated coin failed");
  if (poolTrips.length === 0) report.poolNote = "no graduated ETH coin found in the scanned range";
  report.ok = problems.length === 0;
  report.problems = problems;
  return report;
}
