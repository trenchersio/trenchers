"use client";
import { useEffect, useState } from "react";
import { formatEther, parseAbi, parseAbiItem, zeroAddress, type Address, type Log } from "viem";
import { DEPLOYMENT, reader } from "@/lib/chain";
import { useCoins, type CoinInfo } from "./coins";

/**
 * An agent coin's figures read straight from Robinhood Chain (no trading engine needed): its Pons launch curve's
 * trades give the price chart, volume and the creator fees the agent earned.
 */
const FACTORY = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
]);
const CURVE = parseAbi(["function protocolFeeShareBps() view returns (uint16)"]);
const ERC20 = parseAbi(["function symbol() view returns (string)", "function totalSupply() view returns (uint256)"]);
const BUY = parseAbiItem("event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)");
const SELL = parseAbiItem("event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)");
const LAUNCHED = parseAbiItem("event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)");

type Trade = Log<bigint, number, false, typeof BUY | typeof SELL>;
type State = { curve: Address; from: bigint; last: bigint; logs: Trade[]; share: number; symbol: string; graduated: boolean; launchedAt: number; supply: number };
const states = new Map<string, State>();
const inflight = new Map<string, Promise<CoinInfo | null>>();

/** The block the coin was created in: by its code's first appearance (bisection), else by its TokenLaunched event. */
async function launchBlock(coin: Address, head: bigint): Promise<bigint> {
  const k = `trenchers:coinblock:${coin.toLowerCase()}`;
  try { const v = localStorage.getItem(k); if (v) return BigInt(v); } catch { /* private mode */ }
  const b = await findLaunchBlock(coin, head);
  try { localStorage.setItem(k, b.toString()); } catch { /* private mode */ }
  return b;
}
async function findLaunchBlock(coin: Address, head: bigint): Promise<bigint> {
  const c = reader();
  const floor = BigInt(DEPLOYMENT?.startBlock ?? "0");
  try {
    let lo = floor, hi = head;
    if (((await c.getCode({ address: coin, blockNumber: lo })) ?? "0x") !== "0x") return lo;
    while (hi - lo > 1n) {
      const mid = (lo + hi) / 2n;
      if (((await c.getCode({ address: coin, blockNumber: mid })) ?? "0x") !== "0x") hi = mid; else lo = mid;
    }
    return hi;
  } catch {
    // No historical state on this RPC: walk back through the factory's launches for this coin.
    let to = head, step = 50_000n;
    for (let i = 0; i < 400 && to > floor; i++) {
      const from = to - step + 1n > floor ? to - step + 1n : floor;
      try {
        const l = await c.getLogs({ address: DEPLOYMENT!.launchpad as Address, event: LAUNCHED, args: { token: coin }, fromBlock: from, toBlock: to });
        if (l.length) return l[0].blockNumber!;
        to = from - 1n;
      } catch { if (step > 2_000n) step /= 4n; else to = from - 1n; }
    }
    return floor;
  }
}

/** Trade events on the curve between two blocks, in chunks the public RPC accepts. */
async function curveLogs(curve: Address, from: bigint, to: bigint): Promise<Trade[]> {
  const c = reader();
  try { return (await c.getLogs({ address: curve, events: [BUY, SELL], fromBlock: from, toBlock: to })) as Trade[]; } catch { /* too big: chunk it */ }
  const out: Trade[] = [];
  let a = from, step = 50_000n;
  while (a <= to) {
    const b = a + step - 1n < to ? a + step - 1n : to;
    try { out.push(...((await c.getLogs({ address: curve, events: [BUY, SELL], fromBlock: a, toBlock: b })) as Trade[])); a = b + 1n; }
    catch { if (step > 1_000n) step /= 4n; else a = b + 1n; }
  }
  return out;
}

async function load(agent: number, wallet: Address, coin: Address): Promise<CoinInfo | null> {
  if (!DEPLOYMENT) return null;
  const c = reader();
  const key = coin.toLowerCase();
  const head = await c.getBlockNumber();
  let s = states.get(key);
  const lt = (await c.readContract({ address: DEPLOYMENT.launchpad as Address, abi: FACTORY, functionName: "getLaunchedToken", args: [coin] })) as { curve: Address; phase: number };
  if (!s) {
    if (!lt.curve || lt.curve === zeroAddress) return null;
    const [from, share, symbol, supply] = await Promise.all([
      launchBlock(coin, head),
      c.readContract({ address: lt.curve, abi: CURVE, functionName: "protocolFeeShareBps" }).then(Number).catch(() => -1),
      c.readContract({ address: coin, abi: ERC20, functionName: "symbol" }).catch(() => "?"),
      c.readContract({ address: coin, abi: ERC20, functionName: "totalSupply" }).then((v) => Number(formatEther(v))).catch(() => 1e9),
    ]);
    const launchedAt = Number((await c.getBlock({ blockNumber: from })).timestamp);
    s = { curve: lt.curve, from, last: from - 1n, logs: [], share, symbol, graduated: false, launchedAt, supply };
    states.set(key, s);
  }
  s.graduated = Number(lt.phase) === 2;
  if (head > s.last) { s.logs.push(...(await curveLogs(s.curve, s.last + 1n, head))); s.last = head; }

  // Block times: the launch block's and the head's, with trades placed in between by block number.
  const headTime = Number((await c.getBlock({ blockNumber: head })).timestamp);
  const span = Number(head - s.from) || 1;
  const when = (b: bigint) => s!.launchedAt + ((headTime - s!.launchedAt) * Number(b - s!.from)) / span;

  let fee = 0n, tax = 0n, vol = 0;
  const chart: { t: number; p: number }[] = [];
  for (const l of [...s.logs].sort((x, y) => Number(x.blockNumber! - y.blockNumber!) || x.logIndex! - y.logIndex!)) {
    const a = l.args as { quoteIn?: bigint; tokensOut?: bigint; quoteOut?: bigint; tokensIn?: bigint; fee: bigint; tax: bigint };
    const buy = l.eventName === "CurveBuy";
    const eth = Number(formatEther((buy ? a.quoteIn : a.quoteOut) ?? 0n)), units = Number(formatEther((buy ? a.tokensOut : a.tokensIn) ?? 0n));
    fee += a.fee; tax += a.tax; vol += eth;
    // The curve's own price, without the trade's fee and tax (a launch-time snipe tax would otherwise show as a fake spike).
    const cut = Number(formatEther(a.fee + a.tax)), net = buy ? Math.max(0, eth - cut) : eth + cut;
    if (units > 0 && net > 0) chart.push({ t: when(l.blockNumber!), p: net / units });
  }
  if (chart.length) chart.push({ t: headTime, p: chart[chart.length - 1].p });
  const creator = s.share >= 0 ? (fee * BigInt(10_000 - s.share)) / 10_000n + tax : tax;
  return {
    agent, wallet, coin, curve: s.curve, symbol: s.symbol, launchedAt: s.launchedAt,
    feesEth: Number(formatEther(creator)), feesExact: s.share >= 0, volumeEth: vol, trades: s.logs.length, graduated: s.graduated,
    price: chart.length ? chart[chart.length - 1].p : null, chart, supply: s.supply,
  };
}

export function chainCoinInfo(agent: number, wallet: Address, coin: Address) {
  const key = coin.toLowerCase();
  let p = inflight.get(key);
  if (!p) { p = load(agent, wallet, coin).finally(() => inflight.delete(key)); inflight.set(key, p); }
  return p;
}

/**
 * The coin's figures: read from the chain, refreshed every 30 seconds. While the chain read is running (or if it fails),
 * the trading engine's figures stand in, so a chart is there as soon as either answers.
 */
export function useCoinInfo(agent: number | null | undefined, wallet: string | null | undefined, coin: string | null | undefined): CoinInfo | null {
  const engine = useCoins();
  const [mine, setMine] = useState<CoinInfo | null>(null);
  useEffect(() => {
    setMine(null);
    if (!agent || !wallet || !coin || coin === zeroAddress) return;
    let alive = true;
    const go = () => chainCoinInfo(agent, wallet as Address, coin as Address).then((i) => alive && i && setMine(i)).catch(() => {});
    go(); const iv = setInterval(go, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, [agent, wallet, coin]);
  const fromEngine = engine?.find((c) => coin && c.coin.toLowerCase() === coin.toLowerCase()) ?? null;
  if (mine && (!fromEngine || mine.trades >= fromEngine.trades)) return mine;
  return fromEngine ?? mine;
}
