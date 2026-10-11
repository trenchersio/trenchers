/**
 * The V4 Builder's wallet actions: launch a coin, buy and sell it with ETH, claim fees and run module actions.
 * Every call is simulated before the wallet opens, so a launch or trade that would fail is explained first.
 */
import { getAddress, hexToBytes, keccak256, maxUint160, maxUint256, parseAbi, type Address, type Hex, type PublicClient } from "viem";
import artifacts from "@/lib/v4builder/artifacts.json";
import { reader, reason as baseReason, sendCall } from "@/lib/chain";
import {
  ERC20_ABI, FACTORY_ABI, HOOK_ABI, INFRA, LEDGER_ABI, MODULES, PERMIT2_ABI, PLATFORM_FEE_BPS, ROUTER_ABI, TRENCHERS,
  buyWithEth, encodePath, fundingPath, liquidityOf, mineHookSalt, moduleDef, payAction, price1Per0, probeSelection, randomSalt, sellForEth,
  sqrtPriceOf, swapOut, tickForStart, trenchersPool, MODULE_ACTION,
  type BuilderConfig, type LaunchParamsV3, type ModuleKey, type PoolKey, type Selection,
} from "@/lib/v4builder";

const E18 = 10n ** 18n;
const HOOK_SPACING = 60;

/** Plain-English reasons for the launch system's errors. */
const REASONS: Record<string, string> = {
  InvalidConfiguration: "The contracts rejected this setup. Check the module settings (for example a batch range, a share of fees or a linked coin) and try again.",
  ModuleConflict: "Two of the chosen modules can't be combined.",
  DeadlineExpired: "That took too long and the launch expired. Try again.",
  InvalidSettlement: "The launch didn't settle cleanly, so nothing happened. Try a smaller first buy.",
  InvalidInfrastructure: "The builder's contracts don't match Robinhood Chain's Uniswap v4 contracts. Nothing was sent.",
  BuyerPaused: "This wallet holds the hot potato and can't sell yet.",
  TokensRequired: "This coin only sells to wallets that already hold some of it.",
  BuyTooSoon: "This wallet has to wait a little longer before buying again (buy cooldown).",
  BuyLimitExceeded: "That buy is bigger than this coin allows right now. Try a smaller amount.",
  WalletBuyLimitExceeded: "That would take this wallet over the coin's launch wallet cap.",
  PriceMoveExceeded: "That trade would move the price more than this coin allows. Split it into smaller trades.",
  BuyLocked: "Buying is locked until the linked coin rises far enough.",
  BuyLimit: "That buy is bigger than the linked-pair cap allows right now.",
  UnsupportedBuyRouter: "This coin only accepts buys through the standard Uniswap router.",
  ReferenceNotReady: "The linked coin has no price or liquidity yet.",
  UnsafePrice: "The price is moving too fast right now. Try again in a few minutes.",
  NoLiquidity: "The pool has no liquidity in range right now.",
  InvalidAction: "This module has nothing to do on request.",
  BuyWindowClosed: "Buying is closed right now. It opens again at the coin's buy window.",
  NotReady: "Not ready yet: the module is waiting for more fees or its next interval.",
  V4TooLittleReceived: "The price moved more than your slippage allows. Try again or raise the slippage.",
  V4TooMuchRequested: "The price moved more than your slippage allows. Try again or raise the slippage.",
};
export function reason(e: unknown): string {
  const t = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e)
    + String((e as { cause?: { data?: { errorName?: string } } })?.cause?.data?.errorName ?? "");
  for (const [k, v] of Object.entries(REASONS)) if (t.includes(k)) return v;
  return baseReason(e);
}

export type LaunchForm = {
  name: string; symbol: string; description: string; image: string; website: string;
  pair: "eth" | "trenchers";
  /** Starting value of the whole supply, in the pair token (ETH or $TRENCHERS), as text. */
  startCap: string;
  buyFeePct: number; sellFeePct: number;
  /** First buy, in ETH (spent on the pair token first for a $TRENCHERS pair). */
  firstBuyEth: string;
  /** For a $TRENCHERS pair: how much $TRENCHERS the first buy should spend. */
  firstBuyTrenchers: string;
  modules: { key: ModuleKey; values: Record<string, string>; sharePct: number }[];
};

export type LaunchStep = "probe" | "predict" | "mine" | "simulate" | "sign" | "chain";

export const units = (v: string, d = 18) => {
  const t = (v || "0").trim();
  if (!/^\d*(\.\d*)?$/.test(t)) throw new Error("Use plain numbers, like 1.5");
  const [w, f = ""] = t.split(".");
  return BigInt(w || "0") * 10n ** BigInt(d) + BigInt((f + "0".repeat(d)).slice(0, d) || "0");
};

// ------------------------------------------------------------------ is this really our deployment?

type Art = { codeHash: string | null; maskedHash: string | null; immutables: [number, number][] | null };
const FACTORY_VIEWS = parseAbi([
  "function poolManager() view returns (address)", "function positionManager() view returns (address)", "function universalRouter() view returns (address)",
  "function permit2() view returns (address)", "function hookDeployer() view returns (address)",
]);
const MODULE_ART: Record<ModuleKey, keyof typeof artifacts> = Object.fromEntries(MODULES.map((m) => [m.key, m.artifact])) as never;
const verified = new Set<string>();

/** The site's addresses come from the engine. Before any money moves, the browser checks for itself that the factory,
 *  the hook deployer and each module factory it is about to use run exactly the code in this repository, wired to
 *  Robinhood Chain's official Uniswap v4 contracts. A tampered config fails here, before the wallet opens. */
export async function verifyDeployment(pub: PublicClient, cfg: BuilderConfig, moduleKeys: ModuleKey[] = []) {
  const key = `${cfg.factory}:${cfg.hookDeployer}:${moduleKeys.map((k) => cfg.modules[k]).join(",")}`;
  if (verified.has(key)) return;
  const bad = (what: string) => { throw new Error(`Safety check failed: the ${what} isn't the Trenchers V4 Builder contract. Nothing was sent. Please tell the team.`); };
  const code = async (a: Address) => { const c = await pub.getCode({ address: a }); if (!c || c === "0x") bad("contract at " + a); return c!; };
  const exact = async (a: Address, art: keyof typeof artifacts, what: string) => { if (keccak256(await code(a)) !== (artifacts[art] as Art).codeHash) bad(what); };
  await exact(cfg.hookDeployer!, "FoundationHookDeployerV2", "hook deployer");
  const fart = artifacts.FoundationFactoryV3Native as unknown as Art;
  const fc = await code(cfg.factory!);
  const bytes = hexToBytes(fc);
  for (const [st, ln] of fart.immutables ?? []) bytes.fill(0, st, st + ln);
  if (keccak256(bytes) !== fart.maskedHash) bad("launch factory");
  const [m, p, r, p2, d] = await Promise.all(["poolManager", "positionManager", "universalRouter", "permit2", "hookDeployer"].map((fn) =>
    pub.readContract({ address: cfg.factory!, abi: FACTORY_VIEWS, functionName: fn as never }) as Promise<Address>));
  if (m.toLowerCase() !== INFRA.manager.toLowerCase() || r.toLowerCase() !== INFRA.router.toLowerCase() || p2.toLowerCase() !== INFRA.permit2.toLowerCase()
    || d.toLowerCase() !== cfg.hookDeployer!.toLowerCase() || !p) bad("launch factory's wiring");
  for (const k of moduleKeys) await exact(cfg.modules[k]!, MODULE_ART[k], `${moduleDef(k).name} factory`);
  verified.add(key);
}

/** A coin from the list is only traded after the factory confirms it launched it with this hook and ledger, and the
 *  hook's pool is the coin against WETH or $TRENCHERS. */
async function verifyCoin(pub: PublicClient, cfg: BuilderConfig, c: CoinRef, key: PoolKey) {
  await verifyDeployment(pub, cfg);
  const l = await pub.readContract({ address: cfg.factory!, abi: FACTORY_ABI, functionName: "launchOf", args: [c.token] }) as { hook: Address; ledger: Address };
  const q = c.quote.toLowerCase();
  const pair = [key.currency0.toLowerCase(), key.currency1.toLowerCase()].sort().join();
  if (l.hook.toLowerCase() !== c.hook.toLowerCase() || l.ledger.toLowerCase() !== c.ledger.toLowerCase() || key.hooks.toLowerCase() !== c.hook.toLowerCase()
    || (q !== INFRA.weth.toLowerCase() && q !== TRENCHERS.toLowerCase()) || pair !== [c.token.toLowerCase(), q].sort().join()) {
    throw new Error("Safety check failed: this coin wasn't launched by the Trenchers V4 Builder as listed. Nothing was sent.");
  }
}

/** ETH needed for an exact amount of $TRENCHERS through its Pons pool, with headroom (unspent ETH is refunded). */
async function ethForTrenchers(pub: PublicClient, key: PoolKey, amount: bigint) {
  const [sqrtP, L] = await Promise.all([sqrtPriceOf(pub, key), liquidityOf(pub, key)]);
  if (sqrtP === 0n || L === 0n) throw new Error("$TRENCHERS has no price on its pool yet.");
  // ETH is currency0: an exact amount of currency1 out moves the price down to `next`.
  const Q = 1n << 96n;
  const drop = (amount * Q) / L;
  if (drop >= sqrtP) throw new Error("That's more $TRENCHERS than its pool can sell in one go. Try a smaller first buy.");
  const next = sqrtP - drop;
  const ethIn = (L * Q * (sqrtP - next)) / sqrtP / next + 1n;
  const per = price1Per0(sqrtP);
  if (per === 0n) throw new Error("$TRENCHERS has no price on its pool yet.");
  // Pool fee and the Pons hook's tax on top, then 3% for the price moving before the launch lands. Unspent ETH comes back.
  const feePips = BigInt(key.fee) + 10_000n; // the pool's fee plus up to 1% hook tax
  return (ethIn * (1_000_000n + feePips)) / 1_000_000n * 103n / 100n + 1n;
}

/** The coin's on-chain picture when the launcher gives none: a small badge (gradient and ticker) as an SVG data URI.
 *  The token contract requires an image, and this keeps a launch possible without hosting one. */
export function badgeImage(symbol: string): string {
  const t = symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 4) || "?";
  const h = [...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,52%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},70%,32%)"/></linearGradient></defs><rect width="256" height="256" fill="url(#g)"/><text x="128" y="128" dy=".35em" text-anchor="middle" font-family="monospace" font-weight="700" font-size="${t.length > 3 ? 64 : 84}" fill="#fff">${t}</text></svg>`;
  return `data:image/svg+xml;base64,${typeof btoa === "function" ? btoa(svg) : Buffer.from(svg).toString("base64")}`;
}

/** Everything a launch needs except the signature: probes the modules, predicts the coin, mines the hook address and
 *  simulates the whole launch to set the first buy's minimum. Returns the call ready to send. */
export async function prepareLaunch(cfg: BuilderConfig, creator: Address, f: LaunchForm, onStep: (s: LaunchStep, detail?: string) => void) {
  if (!cfg.factory || !cfg.hookDeployer) throw new Error("The V4 Builder contracts aren't live yet.");
  const pub = reader();
  const quote = f.pair === "eth" ? INFRA.weth : TRENCHERS;

  onStep("probe");
  await verifyDeployment(pub, cfg, f.modules.map((m) => m.key));
  const modules: Selection[] = [];
  for (const m of f.modules) {
    const def = moduleDef(m.key);
    const factory = cfg.modules[m.key];
    if (!factory) throw new Error(`${def.name} isn't deployed yet.`);
    const configuration = def.encode(m.values, 18);
    modules.push(await probeSelection(pub, getAddress(factory), configuration, quote, creator, def.budget ? Math.round(m.sharePct * 100) : 0));
  }

  onStep("predict");
  const metadata = { name: f.name.trim(), symbol: f.symbol.trim().toUpperCase(), description: f.description.trim(), imageURI: f.image.trim() || badgeImage(f.symbol), website: f.website.trim(), socialData: "0x" as Hex };
  const tokenSalt = randomSalt();
  const token = await pub.readContract({ address: cfg.factory, abi: FACTORY_ABI, functionName: "predictTokenAddress", args: [creator, tokenSalt, metadata] }) as Address;
  const initialTick = tickForStart(token, quote, units(f.startCap));
  if (initialTick % HOOK_SPACING !== 0) throw new Error("Couldn't place the starting price.");

  const trenchersKey = f.pair === "trenchers" ? await trenchersPool(pub) : null;
  if (f.pair === "trenchers" && !trenchersKey && units(f.firstBuyTrenchers) > 0n) throw new Error("$TRENCHERS is still on its bonding curve, so a first buy can't route through it yet. Launch with no first buy, or pair with ETH.");
  const initialBuy = f.pair === "eth" ? units(f.firstBuyEth) : units(f.firstBuyTrenchers);
  const value = initialBuy === 0n ? 0n : f.pair === "eth" ? initialBuy : await ethForTrenchers(pub, trenchersKey!, initialBuy);
  const path = encodePath(f.pair === "eth" ? [] : fundingPath(trenchersKey));

  const p: LaunchParamsV3 = {
    metadata, quote, quoteDecimals: 18, initialTick,
    creatorBuyFeeBps: f.buyFeePct * 100, creatorSellFeeBps: f.sellFeePct * 100,
    additionalQuoteAmount: 0n, initialBuyQuoteAmount: initialBuy, initialBuyMinimumTokenAmount: 0n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 60), tokenSalt, hookSalt: `0x${"0".repeat(64)}`, modules,
  };

  onStep("mine");
  const initHash = await pub.readContract({ address: cfg.factory, abi: FACTORY_ABI, functionName: "hookInitCodeHash", args: [creator, token, p] }) as Hex;
  const { salt, hook } = await mineHookSalt(cfg.hookDeployer, initHash, (n) => onStep("mine", `${n.toLocaleString()} addresses tried`));
  p.hookSalt = salt;

  onStep("simulate");
  const { result } = await pub.simulateContract({ address: cfg.factory, abi: FACTORY_ABI, functionName: "launchWithEthRoute", args: [p, path], value, account: creator });
  const got = (result as { initialBuyTokenAmount: bigint }).initialBuyTokenAmount;
  p.initialBuyMinimumTokenAmount = (got * 97n) / 100n;
  return { params: p, path, value, token, hook, firstBuyTokens: got, maxEth: value };
}

export async function sendLaunch(cfg: BuilderConfig, creator: Address, prep: Awaited<ReturnType<typeof prepareLaunch>>, onStep: (s: LaunchStep) => void) {
  return sendCall(creator, { address: cfg.factory!, abi: FACTORY_ABI, functionName: "launchWithEthRoute", args: [prep.params, prep.path], value: prep.value }, (ph) => onStep(ph));
}

// ------------------------------------------------------------------ trading

export type CoinRef = { token: Address; hook: Address; quote: Address; ledger: Address; creatorBuyBps: number; creatorSellBps: number };

export async function coinKey(pub: PublicClient, hook: Address): Promise<PoolKey> {
  const k = await pub.readContract({ address: hook, abi: HOOK_ABI, functionName: "poolKey" }) as PoolKey;
  return { currency0: k.currency0, currency1: k.currency1, fee: Number(k.fee), tickSpacing: Number(k.tickSpacing), hooks: k.hooks };
}

/** Estimated output and the router call for a buy (ETH in) or a sell (coin in), with the minimum set by slippage. */
export async function quoteTrade(c: CoinRef, side: "buy" | "sell", amountIn: bigint, slippagePct: number, cfg?: BuilderConfig) {
  const pub = reader();
  const key = await coinKey(pub, c.hook);
  if (cfg) await verifyCoin(pub, cfg, c, key);
  const [sqrtP, L] = await Promise.all([sqrtPriceOf(pub, key), liquidityOf(pub, key)]);
  const tokenIs0 = BigInt(c.token) < BigInt(c.quote);
  const isTrenchers = c.quote.toLowerCase() === TRENCHERS.toLowerCase();
  const tk = isTrenchers ? await trenchersPool(pub) : null;
  if (isTrenchers && !tk) throw new Error("$TRENCHERS has no ETH pool yet, so this coin can't be traded with ETH here.");
  let tkSqrt = 0n, tkL = 0n;
  if (tk) [tkSqrt, tkL] = await Promise.all([sqrtPriceOf(pub, tk), liquidityOf(pub, tk)]);
  const feeBuy = BigInt(PLATFORM_FEE_BPS + c.creatorBuyBps), feeSell = BigInt(PLATFORM_FEE_BPS + c.creatorSellBps);
  let out: bigint;
  if (side === "buy") {
    const quoteIn = tk ? swapOut(tkSqrt, tkL, (amountIn * 99n) / 100n, true) : amountIn; // Pons pool fees, roughly
    out = swapOut(sqrtP, L, (quoteIn * (10_000n - feeBuy)) / 10_000n, !tokenIs0);
  } else {
    const quoteOut = (swapOut(sqrtP, L, amountIn, tokenIs0) * (10_000n - feeSell)) / 10_000n;
    out = tk ? (swapOut(tkSqrt, tkL, quoteOut, false) * 99n) / 100n : quoteOut;
  }
  const minOut = (out * BigInt(Math.round((100 - slippagePct) * 100))) / 10_000n;
  const call = side === "buy"
    ? buyWithEth({ coinKey: key, token: c.token, quote: c.quote, trenchersKey: tk, ethIn: amountIn, minOut })
    : sellForEth({ coinKey: key, token: c.token, quote: c.quote, trenchersKey: tk, amountIn, minOut });
  return { out, minOut, call };
}

export async function trade(cfg: BuilderConfig, from: Address, c: CoinRef, side: "buy" | "sell", amountIn: bigint, slippagePct: number, shownMin: bigint, onPhase: (p: "approve" | "sign" | "chain") => void) {
  const pub = reader();
  await verifyCoin(pub, cfg, c, await coinKey(pub, c.hook));
  if (side === "sell") {
    // Sells pull the coin through Permit2: a one-time approval to Permit2, then a Permit2 allowance for the router.
    const a = await pub.readContract({ address: c.token, abi: ERC20_ABI, functionName: "allowance", args: [from, INFRA.permit2] }) as bigint;
    if (a < amountIn) { onPhase("approve"); await sendCall(from, { address: c.token, abi: ERC20_ABI, functionName: "approve", args: [INFRA.permit2, maxUint256] }); }
    const [amt, exp] = await pub.readContract({ address: INFRA.permit2, abi: PERMIT2_ABI, functionName: "allowance", args: [from, c.token, INFRA.router] }) as [bigint, number, number];
    if (amt < amountIn || Number(exp) < Date.now() / 1000 + 600) {
      onPhase("approve");
      await sendCall(from, { address: INFRA.permit2, abi: PERMIT2_ABI, functionName: "approve", args: [c.token, INFRA.router, maxUint160, Math.floor(Date.now() / 1000) + 30 * 86400] });
    }
  }
  const q = await quoteTrade(c, side, amountIn, slippagePct);
  // Never accept less than the minimum the page showed: if the price moved against the trade since, stop instead.
  if (q.minOut < shownMin) throw new Error("The price moved since your quote. Check the new amounts and try again.");
  const call = q.call;
  return sendCall(from, { address: INFRA.router, abi: ROUTER_ABI, functionName: "execute", args: [call.commands, call.inputs, BigInt(Math.floor(Date.now() / 1000) + 600)], value: call.value }, (p) => onPhase(p));
}

// ------------------------------------------------------------------ fees and modules

export async function claimable(c: CoinRef) {
  const pub = reader();
  const [credited, claimed] = await Promise.all([
    pub.readContract({ address: c.ledger, abi: LEDGER_ABI, functionName: "creatorCredited" }) as Promise<bigint>,
    pub.readContract({ address: c.ledger, abi: LEDGER_ABI, functionName: "creatorClaimed" }) as Promise<bigint>,
  ]);
  return credited - claimed;
}

export async function claimCreator(cfg: BuilderConfig, from: Address, c: CoinRef, onPhase: (p: "sign" | "chain") => void) {
  const pub = reader();
  await verifyCoin(pub, cfg, c, await coinKey(pub, c.hook));
  return sendCall(from, { address: c.ledger, abi: LEDGER_ABI, functionName: "claimCreator" }, onPhase);
}

/** Run a fee engine (buyback, dip buyback, LP rewards, full-range LP) or pay out a games module's rewards. */
export async function moduleAction(cfg: BuilderConfig, from: Address, c: CoinRef, index: number, key: ModuleKey, onPhase: (p: "sign" | "chain") => void) {
  const pub = reader();
  await verifyCoin(pub, cfg, c, await coinKey(pub, c.hook));
  const data = moduleDef(key).group === "Fee engines" ? MODULE_ACTION.execute : payAction([from]);
  return sendCall(from, { address: c.hook, abi: HOOK_ABI, functionName: "executeModuleAction", args: [BigInt(index), data] }, onPhase);
}

export const ACTIONABLE: Partial<Record<ModuleKey, string>> = {
  buybackBurn: "Run buyback", dipBuyback: "Run dip buyback", lpRewards: "Pay LP rewards", fullRangeLp: "Add liquidity",
  buyerRewards: "Claim my cashback", nthBuyPot: "Claim my pot", kingOfTheHill: "Claim my winnings",
};
export { MODULES };
