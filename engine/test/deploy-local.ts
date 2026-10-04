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
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

const RPC = "http://127.0.0.1:8545";
const chain = defineChain({ id: Number(process.env.CHAIN_ID || 31337), name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
// Hardhat's default accounts (#0 deployer, #1 holder, #2 engine, #3 coin dev)
const MNEMONIC = "test test test test test test test test test test test junk";
const [deployer, alice, dev] = [0, 1, 3].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
// A fresh key the node doesn't know, like on a public RPC: the engine must sign its own transactions.
const ENGINE_KEY = generatePrivateKey();
const engineAcct = privateKeyToAccount(ENGINE_KEY);
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


/** Deploys a full Trenchers system on a local node and prints its deployment code (for site tests). */
async function main() {
  const startBlock = (await pub.getBlockNumber()).toString();
  const registry = await deploy("MockERC6551Registry");
  const splitter = await deploy("RevenueSplitter", [deployer.address, deployer.address, BigInt(Math.floor(Date.now() / 1000))]);
  const nft = await deploy("TrenchersNFT", [splitter, deployer.address, "", "", parseEther("0.0002")]);
  const fund = await deploy("AgentStarterFund", [deployer.address, nft, registry, parseEther("0.0001"), 600n]);
  const config = await deploy("AgentConfig", [deployer.address]);
  const logic = await deploy("TrenchersAgentAccount", [config, fund]);
  await call(config, "AgentConfig", "propose", [4, logic]);
  const impl = await deploy("TrenchersAgentWallet", [config]);
  const launchpad = await deploy("MockPonsFactory");
  const adapter = await deploy("PonsAdapter", [launchpad, deployer.address]);
  await call(config, "AgentConfig", "propose", [0, engineAcct.address]);
  await pub.waitForTransactionReceipt({ hash: await wal().sendTransaction({ to: engineAcct.address, value: parseEther("1"), account: deployer, chain }) });
  await call(config, "AgentConfig", "propose", [1, adapter]);
  await call(config, "AgentConfig", "propose", [3, fund]);
  await call(nft, "TrenchersNFT", "setStarterFund", [fund]);
  await call(fund, "AgentStarterFund", "setAccount", [impl, zeroHash]);
  await call(splitter, "RevenueSplitter", "setPrimarySeller", [nft]);
  await call(splitter, "RevenueSplitter", "proposeDestination", [3, fund]);
  await call(nft, "TrenchersNFT", "setMintOpen", [true]);
  await call(nft, "TrenchersNFT", "mint", [2n], parseEther("0.0004"), alice);
  const dep = { chainId: chain.id, owner: deployer.address, registry, splitter, nft, fund, launchpad, adapter, startBlock, config, logic, impl, dist: deployer.address, version: 6 };
  console.log(JSON.stringify(dep));
  if (process.env.ENGINE_KEY_OUT) (await import("node:fs")).writeFileSync(process.env.ENGINE_KEY_OUT, ENGINE_KEY);
}
main().catch((e) => { console.error(e); process.exit(1); });
