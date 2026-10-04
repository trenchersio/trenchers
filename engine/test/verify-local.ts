/**
 * Tests the mainnet verifier (src/verify.ts) on a local Hardhat node running as chain 4663:
 *   cd contracts && HH_CHAIN_ID=4663 npx hardhat node   (then)   cd engine && npx tsx test/verify-local.ts
 * Deploys exactly like the launch page (with mock Pons + registry), then expects every check to pass,
 * and expects the verifier to catch a wrong setting.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, parseEther, parseEventLogs, zeroHash, type Abi, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { verifyDeployment, MAINNET_LAUNCH, type Deployment } from "../src/verify";

const RPC = "http://127.0.0.1:8545";
const chain = defineChain({ id: 4663, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const M = "test test test test test test test test test test test junk";
const [deployer, safe, engine, guardian] = [0, 1, 2, 3].map((i) => mnemonicToAccount(M, { addressIndex: i }));
const pub = createPublicClient({ chain, transport: http(RPC) });
const wal = createWalletClient({ account: deployer, chain, transport: http(RPC) });
const ARTDIR = join(import.meta.dirname, "../../contracts/artifacts/contracts");
const art = (name: string): { abi: Abi; bytecode: Hex } => {
  const walk = (d: string): string | null => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { const r = walk(p); if (r) return r; } else if (f === `${name}.json`) return p; } return null; };
  return JSON.parse(readFileSync(walk(ARTDIR)!, "utf8"));
};
const deploy = async (name: string, args: unknown[]) => (await pub.waitForTransactionReceipt({ hash: await wal.deployContract({ ...art(name), args }) })).contractAddress!;
const call = async (to: Address, name: string, fn: string, args: unknown[] = [], value = 0n) => {
  const r = await pub.waitForTransactionReceipt({ hash: await wal.writeContract({ address: to, abi: art(name).abi, functionName: fn, args, value }) });
  if (r.status !== "success") throw new Error(`${name}.${fn} reverted`); return r;
};

async function main() {
  const L = { ...MAINNET_LAUNCH };
  L.registry = await deploy("MockERC6551Registry", []);
  L.ponsFactory = await deploy("MockPonsFactory", []);
  const R = { safe: safe.address, deployer: deployer.address, guardian: guardian.address, engine: engine.address };
  const startBlock = (await pub.getBlockNumber()).toString();
  // the launch page, step by step
  const splitter = await deploy("RevenueSplitter", [deployer.address, R.safe, BigInt(Math.floor(Date.now() / 1000))]);
  const nft = await deploy("TrenchersNFT", [splitter, R.deployer, L.contractUri, L.contractUri, parseEther(L.mintPriceEth)]);
  const fund = await deploy("AgentStarterFund", [R.safe, nft, L.registry, parseEther(L.starterEth), BigInt(L.rescueDelay)]);
  const config = await deploy("AgentConfig", [deployer.address]);
  const logic = await deploy("TrenchersAgentAccount", [config, fund]);
  await call(config, "AgentConfig", "propose", [4, logic]);
  const impl = await deploy("TrenchersAgentWallet", [config]);
  const dist = await deploy("AgentFeeDistributor", [deployer.address, L.registry, nft, BigInt(L.rescueDelay)]);
  await call(config, "AgentConfig", "propose", [3, fund]);
  await call(nft, "TrenchersNFT", "setStarterFund", [fund]);
  await call(nft, "TrenchersNFT", "setBaseURI", [L.baseUri]);
  await call(config, "AgentConfig", "propose", [0, R.engine]);
  await call(config, "AgentConfig", "setGuardian", [R.guardian]);
  const adapter = await deploy("PonsAdapter", [L.ponsFactory, R.safe]);
  await call(config, "AgentConfig", "propose", [1, adapter]);
  await call(dist, "AgentFeeDistributor", "setAccount", [impl, zeroHash]);
  await call(splitter, "RevenueSplitter", "setPrimarySeller", [nft]);
  await call(splitter, "RevenueSplitter", "proposeDestination", [3, fund]);
  await call(config, "AgentConfig", "seal");
  for (const [a, n] of [[splitter, "RevenueSplitter"], [nft, "TrenchersNFT"], [config, "AgentConfig"], [dist, "AgentFeeDistributor"]] as const) await call(a, n, "transferOwnership", [R.safe]);
  const d: Deployment = { chainId: 4663, startBlock, splitter, nft, fund, config, logic, impl, dist, adapter };

  // two live coins on the mock Pons: one on its curve, one graduated to its pool
  const launch = async (name: string) => {
    const r = await call(L.ponsFactory, "MockPonsFactory", "launch", [name, parseEther("100")], parseEther("5"));
    return (parseEventLogs({ abi: art("MockPonsFactory").abi, logs: r.logs, eventName: "TokenLaunched" })[0] as unknown as { args: { token: Address } }).args.token;
  };
  const curve = await launch("CURVE"), pool = await launch("POOL");
  await call(L.ponsFactory, "MockPonsFactory", "graduateAll", [pool]);

  let fails = 0;
  const good = await verifyDeployment(RPC, d, R, L, { coins: { curve, pool } });
  console.log(JSON.stringify({ code: good.code, rehearsal: good.rehearsal, problems: good.problems }, null, 2));
  if (!good.ok) { fails++; console.log("✗ expected every check to pass"); } else console.log("✓ correct deployment: every check passes");
  const bad = await verifyDeployment(RPC, d, { ...R, engine: guardian.address === R.engine ? safe.address : deployer.address }, L, { coins: { curve, pool } });
  if (bad.ok) { fails++; console.log("✗ a wrong engine wallet was not caught"); } else console.log(`✓ wrong setting caught: ${(bad.problems as string[])[0]}`);
  const nope = await verifyDeployment(RPC, { ...d, logic: impl }, R, L, { coins: { curve, pool } });
  if (nope.ok) { fails++; console.log("✗ wrong code was not caught"); } else console.log(`✓ wrong code caught: ${(nope.problems as string[])[0]}`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
