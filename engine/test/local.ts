/**
 * End-to-end engine test on a local Hardhat node (npx hardhat node, chain 31337):
 * deploys Trenchers + a mock Pons, mints and awakens agents, applies rules, launches coins,
 * then runs the real engine and checks that agents buy and sell according to their rules.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient, createWalletClient, defineChain, http, parseEther, keccak256, toHex, zeroHash, formatEther, parseEventLogs,
  type Abi, type Address, type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

const RPC = "http://127.0.0.1:8545";
const chain = defineChain({ id: 31337, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
// Hardhat's default accounts (#0 deployer, #1 holder, #2 engine, #3 coin dev)
const MNEMONIC = "test test test test test test test test test test test junk";
const [deployer, alice, engineAcct, dev] = [0, 1, 2, 3].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
const ENGINE_KEY = toHex(engineAcct.getHdKey().privateKey!);
const pub = createPublicClient({ chain, transport: http(RPC) });
const wal = (acct = deployer) => createWalletClient({ account: acct, chain, transport: http(RPC) });

const ART = join(import.meta.dirname, "../../contracts/artifacts/contracts");
function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const walk = (d: string): string | null => {
    for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { const r = walk(p); if (r) return r; } else if (f === `${name}.json`) return p; }
    return null;
  };
  const j = JSON.parse(readFileSync(walk(ART)!, "utf8")); return { abi: j.abi, bytecode: j.bytecode };
}
async function deploy(name: string, args: unknown[] = [], value = 0n) {
  const a = artifact(name);
  const hash = await wal().deployContract({ abi: a.abi, bytecode: a.bytecode, args, value });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
}
async function call(address: Address, name: string, fn: string, args: unknown[] = [], value = 0n, acct = deployer) {
  const hash = await wal(acct).writeContract({ address, abi: artifact(name).abi, functionName: fn, args, value, chain, account: acct });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${name}.${fn} reverted`);
  return r;
}
const read = <T,>(address: Address, name: string, fn: string, args: unknown[] = []) => pub.readContract({ address, abi: artifact(name).abi, functionName: fn, args }) as Promise<T>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "  ✓" : "  ✗"} ${msg}`); if (!ok) failures++; };

async function main() {
  const block0 = await pub.getBlockNumber();
  const registry = await deploy("MockERC6551Registry");
  const splitter = await deploy("RevenueSplitter", [deployer.address, deployer.address, BigInt(Math.floor(Date.now() / 1000))]);
  const nft = await deploy("TrenchersNFT", [splitter, deployer.address, "", "", parseEther("0.02")]);
  const fund = await deploy("AgentStarterFund", [deployer.address, nft, registry, parseEther("0.01"), 600n]);
  const config = await deploy("AgentConfig", [deployer.address]);
  const impl = await deploy("TrenchersAgentAccount", [config]);
  const pons = await deploy("MockPonsFactory");
  const adapter = await deploy("PonsAdapter", [pons, deployer.address]);
  await call(config, "AgentConfig", "propose", [0, engineAcct.address]);
  await call(config, "AgentConfig", "propose", [1, adapter]);
  await call(config, "AgentConfig", "propose", [3, fund]);
  await call(nft, "TrenchersNFT", "setStarterFund", [fund]);
  await call(fund, "AgentStarterFund", "setAccount", [impl, zeroHash]);
  await call(splitter, "RevenueSplitter", "setPrimarySeller", [nft]);
  await call(splitter, "RevenueSplitter", "proposeDestination", [3, fund]);
  await call(nft, "TrenchersNFT", "setMintOpen", [true]);
  console.log("deployed");

  // Alice mints and awakens #6 and #7, funds them and gives each a rule.
  await call(nft, "TrenchersNFT", "mint", [2n], parseEther("0.04"), alice);
  await call(fund, "AgentStarterFund", "claim", [6n], 0n, alice);
  await call(fund, "AgentStarterFund", "claim", [7n], 0n, alice);
  const w6 = await read<Address>(fund, "AgentStarterFund", "agentWallet", [6n]);
  const w7 = await read<Address>(fund, "AgentStarterFund", "agentWallet", [7n]);
  for (const w of [w6, w7]) await wal(alice).sendTransaction({ to: w, value: parseEther("0.5"), account: alice, chain });
  const rule6 = "Buy every new Pons launch, sell after 8 seconds.";
  const rule7 = "Buy every time a token's dev sells. Take profit at 20%, stop loss 10%.";
  await call(w6, "TrenchersAgentAccount", "setPolicy", [parseEther("0.05"), parseEther("0.2"), true, keccak256(toHex(rule6)), rule6], 0n, alice);
  await call(w7, "TrenchersAgentAccount", "setPolicy", [parseEther("0.05"), parseEther("0.2"), true, keccak256(toHex(rule7)), rule7], 0n, alice);
  console.log("agents ready");

  // The engine, in this process.
  Object.assign(process.env, {
    RPC_URL: RPC, CHAIN_ID: "31337", ENGINE_KEY, NFT_ADDRESS: nft, FUND_ADDRESS: fund, ADAPTER_ADDRESS: adapter,
    PONS_FACTORY: pons, START_BLOCK: (block0 + 1n).toString(), SNIPE_WAIT_SEC: "3", POLL_MS: "500",
  });
  const { Engine } = await import("../src/engine");
  const logs: string[] = [];
  const engine = new Engine((m) => { logs.push(m); console.log("   engine:", m); });
  await engine.start();
  check(engine.agents.size === 2, "engine found both awakened agents");
  check(engine.agents.get(w6.toLowerCase() as Address)?.rule?.trigger === "launch", "agent #6 rule read from chain: buy every launch");
  check(engine.agents.get(w7.toLowerCase() as Address)?.rule?.trigger === "devsell", "agent #7 rule read from chain: buy when the dev sells");

  let running = true;
  (async () => { while (running) { try { await engine.tick(); } catch (e) { console.log("tick error", (e as Error).message); } await sleep(500); } })();

  // A dev launches a coin: #6 should buy after the snipe window, then sell after 8 seconds.
  const launchTx = await call(pons, "MockPonsFactory", "launch", ["MOON", parseEther("100")], parseEther("5"), dev);
  const launched = parseEventLogs({ abi: artifact("MockPonsFactory").abi, logs: launchTx.logs, eventName: "TokenLaunched" })[0] as unknown as { args: { token: Address; curve: Address } };
  const coin = launched.args.token, curve = launched.args.curve;
  const bal6Before = await pub.getBalance({ address: w6 });
  await sleep(6000);
  const held6 = await read<bigint>(coin, "MockPonsToken", "balanceOf", [w6]);
  check(held6 > 0n, `agent #6 bought the new launch after the snipe window (${held6} tokens)`);
  check((await read<bigint>(coin, "MockPonsToken", "balanceOf", [w7])) === 0n, "agent #7 did not buy a plain launch");

  // The dev buys some then sells: #7 should buy on the dev sell.
  await call(curve, "MockPonsCurve", "buy", [parseEther("0.5"), 0n, dev.address], parseEther("0.5"), dev);
  const devTokens = await read<bigint>(coin, "MockPonsToken", "balanceOf", [dev.address]);
  await call(coin, "MockPonsToken", "approve", [curve, devTokens], 0n, dev);
  await call(curve, "MockPonsCurve", "sell", [devTokens / 2n, 0n, dev.address], 0n, dev);
  await sleep(8000);
  const buys7 = engine.trades.filter((t) => t.agent === 7 && t.side === "buy").length;
  check(buys7 === 1, "agent #7 bought when the dev sold (its stop loss or take profit may already have closed it)");

  await sleep(9000);
  check((await read<bigint>(coin, "MockPonsToken", "balanceOf", [w6])) === 0n, "agent #6 sold after its 8-second hold");
  const bal6After = await pub.getBalance({ address: w6 });
  check(bal6After > bal6Before - parseEther("0.01"), `agent #6's ETH came back into its wallet (net ${formatEther(bal6After - bal6Before)} ETH)`);

  // Someone buys a lot: #7's position rises past +20% and it takes profit.
  await call(curve, "MockPonsCurve", "buy", [parseEther("3"), 0n, dev.address], parseEther("3"), dev);
  await sleep(4000);
  check((await read<bigint>(coin, "MockPonsToken", "balanceOf", [w7])) === 0n && engine.trades.some((t) => t.agent === 7 && t.side === "sell"), "agent #7 closed its position on its stop loss / take profit");

  const arena = await engine.arena();
  console.log(JSON.stringify(arena.agents.map((a) => ({ rank: a.rank, id: a.id, pnlPct: +a.pnlPct.toFixed(2), pnlEth: +a.pnlEth.toFixed(5), trades: a.trades })), null, 0));
  check(arena.agents.length === 2 && arena.feed.length >= 4, `Arena shows both agents and their trades (${arena.feed.length} trades)`);
  check(arena.agents[0].pnlPct >= arena.agents[1].pnlPct && arena.agents.every((a) => a.trades === 2), "Arena ranks by weekly PnL, each agent with its buy and sell");

  // Engine limits: never the agent's own coin, and pausing stops trading.
  await call(w6, "TrenchersAgentAccount", "pause", [], 0n, alice);
  await sleep(16000); // policies refresh every 15s
  await call(pons, "MockPonsFactory", "launch", ["NEXT", parseEther("100")], parseEther("1"), dev);
  await sleep(6000);
  const trades6 = engine.trades.filter((t) => t.agent === 6).length;
  check(trades6 === 2, `paused agent #6 did not buy the next launch (${trades6} trades total)`);

  running = false;
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll engine checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
