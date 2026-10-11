/**
 * V4 Builder end to end, on a local chain, with the site's own code.
 *
 * Starts anvil, deploys Uniswap v4 (PoolManager, PositionManager, Permit2, the real Universal Router) and the whole
 * V4 Builder (hook deployer, launch factory, 16 module factories), then drives it exactly as the website does:
 * probe the modules, predict the coin, mine the hook address, dry-run and send the launch, quote and send buys and
 * sells through the Universal Router, claim creator fees and run module actions. Finally the engine's indexer reads
 * it all back. Run from web/:  npx tsx scripts/builder-e2e.mts   (needs v4builder built: forge build)
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, decodeEventLog, encodeAbiParameters, http, parseAbi, parseAbiParameters, parseEther, formatEther,
  type Address, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Multicall3's creation code, as viem ships it (the site batches reads through Multicall3).
const multicall3Bytecode = readFileSync(new URL("../node_modules/viem/_esm/constants/contracts.js", import.meta.url), "utf8").match(/multicall3Bytecode = '(0x[0-9a-f]+)'/)![1] as Hex;
const PORT = 8549;
const RPC = `http://127.0.0.1:${PORT}`;
process.env.NEXT_PUBLIC_RPC_URL = RPC;
const OUT = new URL("../../v4builder/out/", import.meta.url);
const ROOT = new URL("../../v4builder/", import.meta.url);
const art = (file: string, name: string) => JSON.parse(readFileSync(new URL(`${file}/${name}.json`, OUT), "utf8")) as { abi: unknown[]; bytecode: { object: Hex } };
const KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const; // anvil's first dev account
const TRADER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const; // second dev account (anvil)
const me = privateKeyToAccount(KEY);
const trader = privateKeyToAccount(TRADER_KEY);
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wal = createWalletClient({ chain: foundry, transport: http(RPC), account: me });
const twal = createWalletClient({ chain: foundry, transport: http(RPC), account: trader });
let failures = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? "  ok  " : "  FAIL"} ${what}`); if (!cond) failures++; };
const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });

async function deploy(file: string, name: string, args: Hex = "0x", w = wal): Promise<Address> {
  const a = art(file, name);
  const hash = await w.sendTransaction({ data: (a.bytecode.object + args.slice(2)) as Hex, gas: 29_000_000n } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (!r.contractAddress || r.status !== "success") throw new Error(`deploy ${name} failed`);
  return r.contractAddress;
}
async function send(w: typeof wal, to: Address, data: Hex, value = 0n) {
  const hash = await w.sendTransaction({ to, data, value, gas: 15_000_000n } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx to ${to} reverted`);
  return r;
}

const anvil = spawn("/root/.foundry/bin/anvil", ["--port", String(PORT), "--code-size-limit", "60000", "--silent", "--gas-limit", "60000000"], { stdio: "ignore" });
const stop = () => { try { anvil.kill(); } catch {} };
process.on("exit", stop);

try {
  for (let i = 0; i < 50; i++) { try { await pub.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  console.log("local chain up");

  // ---------------------------------------------------------------- Uniswap v4, locally
  const mcHash = await wal.sendTransaction({ data: multicall3Bytecode, gas: 5_000_000n } as never);
  const mc = (await pub.waitForTransactionReceipt({ hash: mcHash })).contractAddress!;
  await rpc("anvil_setCode", ["0xca11bde05977b3631167028862be2a173976ca11", await pub.getCode({ address: mc })]);
  const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;
  const p2src = readFileSync(new URL("lib/permit2/test/utils/DeployPermit2.sol", ROOT), "utf8");
  await rpc("anvil_setCode", [PERMIT2, `0x${p2src.match(/hex"([0-9a-f]+)"/)![1]}`]);
  const manager = await deploy("PoolManager.sol", "PoolManager", encodeAbiParameters(parseAbiParameters("address"), [me.address]));
  const weth = await deploy("LocalInfra.sol", "LocalWETH");
  const posm = await deploy("PositionManager.sol", "PositionManager", encodeAbiParameters(parseAbiParameters("address, address, uint256, address, address"), [manager, PERMIT2, 300_000n, "0x0000000000000000000000000000000000000000", weth]));
  const ur = JSON.parse(readFileSync(new URL("lib/universal-router/out/UniversalRouter.sol/UniversalRouter.json", ROOT), "utf8"));
  const z = "0x0000000000000000000000000000000000000000" as Address, zb = `0x${"0".repeat(64)}` as Hex;
  const urArgs = encodeAbiParameters(parseAbiParameters("(address,address,address,address,bytes32,bytes32,address,address,address,address)"), [[PERMIT2, weth, z, z, zb, zb, manager, z, posm, z]]);
  const urHash = await wal.sendTransaction({ data: (ur.bytecode.object + urArgs.slice(2)) as Hex, gas: 29_000_000n } as never);
  const router = (await pub.waitForTransactionReceipt({ hash: urHash })).contractAddress!;
  const reg = await deploy("LocalInfra.sol", "LocalInfraRegistry", encodeAbiParameters(parseAbiParameters("address, address, address, address, address"), [manager, posm, router, PERMIT2, weth]));
  await rpc("anvil_setCode", ["0x0000000000000000000000000000000000Ba5e00", await pub.getCode({ address: reg })]);
  console.log("uniswap v4 deployed: manager", manager, "router", router);

  // ---------------------------------------------------------------- the V4 Builder
  const hookDeployer = await deploy("FoundationHookDeployerV2.sol", "FoundationHookDeployerV2");
  const codehash = async (a: Address) => (await import("viem")).keccak256((await pub.getCode({ address: a }))!);
  const hashes = await Promise.all([manager, posm, router, PERMIT2, hookDeployer].map(codehash));
  const factory = await deploy("FoundationFactoryV3Native.sol", "FoundationFactoryV3Native",
    encodeAbiParameters(parseAbiParameters("address, address, address, address, address, bytes32[5]"), [manager, posm, router, PERMIT2, hookDeployer, hashes as never]));
  const names = [["buyCooldown", "BuyCooldownFactoryV1.sol", "BuyCooldownFactoryV1"], ["buyWindow", "BuyWindowFactoryV1.sol", "BuyWindowFactoryV1"],
    ["priceMoveGuard", "PriceMoveGuardFactoryV1.sol", "PriceMoveGuardFactoryV1"], ["growingBuyLimit", "GrowingBuyLimitFactoryV1.sol", "GrowingBuyLimitFactoryV1"],
    ["launchWalletCap", "LaunchWalletCapFactoryV1.sol", "LaunchWalletCapFactoryV1"],
    ...["BuybackBurn:buybackBurn", "DipBuyback:dipBuyback", "LPRewards:lpRewards", "FullRangeLP:fullRangeLp", "BuyerRewards:buyerRewards", "NthBuyPot:nthBuyPot",
      "KingOfTheHill:kingOfTheHill", "HotPotato:hotPotato", "Plague:plague", "ReactivePair:reactivePair", "Entangled:entangled"].map((x) => { const [c, k] = x.split(":"); return [k, "EconomicModuleFactoriesV1.sol", `${c}FactoryV1`]; })];
  const modules: Record<string, Address> = {};
  for (const [k, f, n] of names) modules[k] = await deploy(f, n);
  console.log("builder deployed: factory", factory);

  // ---------------------------------------------------------------- the site's code, pointed at this chain
  const lib = await import("../lib/v4builder.ts");
  const act = await import("../lib/v4builder-actions.ts");
  Object.assign(lib.INFRA, { weth, router, permit2: PERMIT2, manager, pons: null });
  const cfg = { ready: true, reason: null, factory, hookDeployer, modules, startBlock: 0 } as never;

  const form = {
    name: "Tidewatch", symbol: "TIDE", description: "e2e", image: "", website: "https://x.com/trenchersio", pair: "eth" as const,
    startCap: "2", buyFeePct: 3, sellFeePct: 4, firstBuyEth: "0.2", firstBuyTrenchers: "0",
    modules: [
      { key: "priceMoveGuard" as const, values: { max: "40" }, sharePct: 0 },
      { key: "launchWalletCap" as const, values: { limit: "20", minutes: "30" }, sharePct: 0 },
      { key: "buybackBurn" as const, values: { minimum: "0.0001", maximum: "0.5", interval: "60", slippage: "5" }, sharePct: 30 },
      { key: "buyerRewards" as const, values: { minimum: "0.001", reward: "2" }, sharePct: 20 },
    ],
  };
  const steps: string[] = [];
  const prep = await act.prepareLaunch(cfg, me.address, form, (s) => { if (steps[steps.length - 1] !== s) steps.push(s); });
  ok(steps.join(",") === "probe,predict,mine,simulate", `launch prepared through ${steps.join(" → ")}`);
  ok((BigInt(prep.hook) & 0x3fffn) === 0x20ccn, `hook address carries the v4 permission bits (${prep.hook})`);
  ok(prep.firstBuyTokens > 0n, `dry run: first buy gets ${formatEther(prep.firstBuyTokens)} TIDE`);
  const launchData = (await import("viem")).encodeFunctionData({ abi: lib.FACTORY_ABI, functionName: "launchWithEthRoute", args: [prep.params, prep.path] });
  const r = await send(wal, factory, launchData, prep.value);
  const ev = r.logs.map((l) => { try { return decodeEventLog({ abi: lib.FACTORY_ABI, ...l }); } catch { return null; } }).find((e) => e?.eventName === "FoundationLaunchedV3");
  const args = ev?.args as { token: Address; hook: Address; ledger: Address; poolId: Hex } | undefined;
  ok(args?.token.toLowerCase() === prep.token.toLowerCase(), `launched at the predicted address ${prep.token}`);
  ok(args?.hook.toLowerCase() === prep.hook.toLowerCase(), "hook at the mined address");
  const ERC = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
  const myTide = await pub.readContract({ address: prep.token, abi: ERC, functionName: "balanceOf", args: [me.address] });
  ok(myTide >= prep.params.initialBuyMinimumTokenAmount && myTide > 0n, `creator holds ${formatEther(myTide)} TIDE from the first buy`);
  const mods = await pub.readContract({ address: prep.hook, abi: lib.HOOK_ABI, functionName: "moduleCount" });
  ok(mods === 4n, "4 modules bound to the hook");

  const coin = { token: prep.token, hook: prep.hook, quote: weth.toLowerCase() as Address, ledger: args!.ledger, creatorBuyBps: 300, creatorSellBps: 400 };

  // ---------------------------------------------------------------- a buy from another wallet, as the coin page sends it
  const ethIn = parseEther("0.3");
  const qb = await act.quoteTrade(coin, "buy", ethIn, 5);
  ok(qb.out > 0n && qb.minOut < qb.out, `buy quote: about ${formatEther(qb.out)} TIDE, at least ${formatEther(qb.minOut)}`);
  const exec = (c: { commands: Hex; inputs: Hex[] }) => (lib as typeof lib).encodeExecute(c as never, BigInt(Math.floor(Date.now() / 1000) + 600));
  await send(twal, router, exec(qb.call), qb.call.value);
  const tTide = await pub.readContract({ address: prep.token, abi: ERC, functionName: "balanceOf", args: [trader.address] });
  ok(tTide >= qb.minOut, `trader received ${formatEther(tTide)} TIDE (quote was ${formatEther(qb.out)}, ${(Number(tTide) / Number(qb.out) * 100).toFixed(2)}% of estimate)`);

  // ---------------------------------------------------------------- a sell, with the Permit2 approvals the page asks for
  const APPROVE = parseAbi(["function approve(address,uint256) returns (bool)"]);
  const enc = (await import("viem")).encodeFunctionData;
  await send(twal, prep.token, enc({ abi: APPROVE, functionName: "approve", args: [PERMIT2, 2n ** 256n - 1n] }));
  await send(twal, PERMIT2, enc({ abi: lib.PERMIT2_ABI, functionName: "approve", args: [prep.token, router, 2n ** 160n - 1n, Math.floor(Date.now() / 1000) + 86400] }));
  const sellAmt = tTide / 2n;
  const qs = await act.quoteTrade(coin, "sell", sellAmt, 5);
  const ethBefore = await pub.getBalance({ address: trader.address });
  const sr = await send(twal, router, exec(qs.call));
  const ethAfter = await pub.getBalance({ address: trader.address });
  const got = ethAfter - ethBefore + sr.gasUsed * sr.effectiveGasPrice;
  ok(got >= qs.minOut, `sold half for ${formatEther(got)} ETH (quote ${formatEther(qs.out)})`);

  // ---------------------------------------------------------------- fees: the 0.3% and the creator's claim
  const L = lib.LEDGER_ABI;
  const platform = await pub.readContract({ address: coin.ledger, abi: L, functionName: "platformReceived" });
  const creatorRecv = await pub.readContract({ address: coin.ledger, abi: L, functionName: "creatorReceived" });
  ok(platform > 0n, `Trenchers fee accrued: ${formatEther(platform)} WETH`);
  ok(creatorRecv > platform * 9n, `creator fees accrued: ${formatEther(creatorRecv)} WETH (3-4% vs 0.3%)`);
  const claimable = await pub.readContract({ address: coin.ledger, abi: L, functionName: "creatorCredited" });
  ok(claimable * 100n / creatorRecv === 50n, "creator keeps 50% of the creator fee (30% buyback, 20% rewards)");
  const W = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  const wBefore = await pub.readContract({ address: weth, abi: W, functionName: "balanceOf", args: [me.address] });
  await send(wal, coin.ledger, enc({ abi: L, functionName: "claimCreator" }));
  const wAfter = await pub.readContract({ address: weth, abi: W, functionName: "balanceOf", args: [me.address] });
  ok(wAfter - wBefore === claimable, `creator claimed ${formatEther(wAfter - wBefore)} WETH`);
  const pBefore = await pub.readContract({ address: weth, abi: W, functionName: "balanceOf", args: ["0xB03A251c7b5c83e44005c4A7BA6f5d96B8284D5A"] });
  await send(twal, coin.ledger, enc({ abi: L, functionName: "claimPlatform" }));
  const pAfter = await pub.readContract({ address: weth, abi: W, functionName: "balanceOf", args: ["0xB03A251c7b5c83e44005c4A7BA6f5d96B8284D5A"] });
  ok(pAfter - pBefore === platform, "anyone can sweep the 0.3% to the Trenchers buyback wallet");

  // ---------------------------------------------------------------- module actions from the coin page
  const OWED = parseAbi(["function owed(address) view returns (uint256)"]);
  const rewardsModule = (await pub.readContract({ address: prep.hook, abi: lib.HOOK_ABI, functionName: "moduleAt", args: [3n] })).instance;
  const owed = await pub.readContract({ address: rewardsModule, abi: OWED, functionName: "owed", args: [trader.address] });
  ok(owed > 0n, `trader earned ${formatEther(owed)} WETH cashback on the buy`);
  const tw0 = await pub.readContract({ address: weth, abi: W, functionName: "balanceOf", args: [trader.address] });
  await send(twal, prep.hook, enc({ abi: lib.HOOK_ABI, functionName: "executeModuleAction", args: [3n, lib.payAction([trader.address])] }));
  const tw1 = await pub.readContract({ address: weth, abi: W, functionName: "balanceOf", args: [trader.address] });
  ok(tw1 - tw0 === owed, "cashback claimed through executeModuleAction(pay)");
  await rpc("evm_increaseTime", [400]); await rpc("evm_mine", []);
  const supplyBefore = await pub.readContract({ address: prep.token, abi: ERC, functionName: "totalSupply" });
  try {
    await send(twal, prep.hook, enc({ abi: lib.HOOK_ABI, functionName: "executeModuleAction", args: [2n, lib.MODULE_ACTION.execute] }));
    const supplyAfter = await pub.readContract({ address: prep.token, abi: ERC, functionName: "totalSupply" });
    ok(supplyAfter < supplyBefore, `buyback bought and burned ${formatEther(supplyBefore - supplyAfter)} TIDE`);
  } catch (e) {
    ok(false, `buyback execute: ${(e as Error).message.split("\n")[0]}`);
  }

  // ---------------------------------------------------------------- a second coin linked to the first (linked-pool probe)
  const prep2 = await act.prepareLaunch(cfg, trader.address, { ...form, name: "Echo", symbol: "ECHO", firstBuyEth: "0", modules: [{ key: "reactivePair", values: { reference: prep.hook, base: "1", min: "0.25", max: "5" }, sharePct: 0 }] }, () => {});
  await send(twal, factory, enc({ abi: lib.FACTORY_ABI, functionName: "launchWithEthRoute", args: [prep2.params, prep2.path] }), prep2.value);
  ok((await pub.getCode({ address: prep2.token }))!.length > 2, "a reactive-pair coin linked to the first launched with no first buy");

  // ---------------------------------------------------------------- the engine reads it back
  const { BuilderIndex } = await import("../../engine/src/builder.ts");
  const idx = new BuilderIndex({ V4_FACTORY: factory, V4_HOOK_DEPLOYER: hookDeployer, V4_MODULES: JSON.stringify(modules), V4_START_BLOCK: "0", RPC_URL: RPC, CHAIN_ID: "31337", V4_POOL_MANAGER: manager });
  await idx.update();
  console.log("  index status", JSON.stringify(idx.status()));
  const view = idx.view();
  const c1 = view.coins.find((c) => c.token === prep.token.toLowerCase());
  ok(view.coins.length === 2, `engine indexed ${view.coins.length} coins`);
  ok(c1?.name === "Tidewatch" && c1.symbol === "TIDE" && c1.website === "https://x.com/trenchersio", "metadata read from the coin");
  ok(c1?.modules.join(",") === "priceMoveGuard,launchWalletCap,buybackBurn,buyerRewards", `modules named: ${c1?.modules.join(", ")}`);
  ok(c1?.creatorBuyBps === 300 && c1.creatorSellBps === 400, "fees read from the hook");
  ok((c1?.trades ?? 0) >= 3 && BigInt(c1?.volumeQuote ?? "0") > 0n, `swaps indexed: ${c1?.trades} trades, ${formatEther(BigInt(c1?.volumeQuote ?? "0"))} WETH volume`);
  ok(c1?.priceQuote !== null && BigInt(c1!.marketCapQuote!) > parseEther("2"), `spot value ${formatEther(BigInt(c1?.marketCapQuote ?? "0"))} WETH (started at 2)`);
  ok(idx.status().lastError === null, "no indexer errors");
} catch (e) {
  failures++;
  console.error("ERROR", e);
} finally {
  stop();
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}
