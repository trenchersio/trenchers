"use client";
import {
  createPublicClient, createWalletClient, custom, encodeFunctionData, http, parseAbi, toHex,
  type Address, type EIP1193Provider, type Hash, type PublicClient,
} from "viem";
import { chain } from "./constants";
import { TESTNET_DEPLOYMENT } from "./testnet/deployment";
import { MAINNET_DEPLOYMENT } from "./mainnet/deployment";
import { waitForWallet } from "./eip6963";

/**
 * Reading and writing the live Trenchers contracts from the main site. Reads go through the chain's
 * public RPC; writes go through the wallet the visitor connected (the same one the header shows).
 */

/** The live deployment for the site's chain (NEXT_PUBLIC_CHAIN=robinhood: mainnet; otherwise testnet). */
/** NEXT_PUBLIC_DEPLOYMENT (a deployment code) overrides it, e.g. for a staging copy or local testing. */
const OVERRIDE = (() => { try { return process.env.NEXT_PUBLIC_DEPLOYMENT ? JSON.parse(process.env.NEXT_PUBLIC_DEPLOYMENT) : null; } catch { return null; } })();
export const DEPLOYMENT: typeof TESTNET_DEPLOYMENT = OVERRIDE ?? (chain.id === MAINNET_DEPLOYMENT.chainId ? MAINNET_DEPLOYMENT : chain.id === TESTNET_DEPLOYMENT?.chainId ? TESTNET_DEPLOYMENT : null);

export const ABI = {
  nft: parseAbi([
    "function ownerOf(uint256) view returns (address)",
    "function totalSupply() view returns (uint256)",
    "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  ]),
  fund: parseAbi([
    "function claimed(uint256) view returns (bool)",
    "function agentWallet(uint256) view returns (address)",
    "function CLAIM() view returns (uint256)",
    "function claim(uint256)",
  ]),
  splitter: parseAbi(["function owed(uint8) view returns (uint256)", "function release(uint8)"]),
  registry: parseAbi(["function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) returns (address)"]),
  config: parseAbi([
    "function paused() view returns (bool)",
    "function accountLogic() view returns (address)",
    "function accountLogicVersions() view returns (uint256)",
    "function launcher() view returns (address)",
    "function pending(uint8 key) view returns (address value, uint64 eta)",
  ]),
  agent: parseAbi([
    "function policy() view returns (uint128 perTrade, uint128 dailyCap, bool live, address setBy)",
    "function owner() view returns (address)",
    "function lockedNow() view returns (uint256)",
    "function withdrawable() view returns (uint256)",
    "function ruleVersion() view returns (uint32)",
    "function starterLockedAt() view returns (uint256)",
    "function setPolicy(uint128 perTrade, uint128 dailyCap, bool live, bytes32 ruleHash, string ruleUri)",
    "function pause()",
    "function withdraw(uint256 amount)",
    "event RuleApplied(uint32 indexed version, bytes32 ruleHash, string ruleUri)",
    // TrenchersAgentWallet: the code version (original unless the holder opted in to an offered fix)
    "function agentLogic() view returns (address)",
    "function ORIGINAL_VERSION() view returns (address)",
    "function setAgentVersion(address logic)",
    "function coin() view returns (address)",
    "function launchCoin(bytes data, uint256 value, address coin) returns (bytes)",
  ]),
};

let pub: PublicClient | null = null;
// Reads are batched: contract reads go out together through Multicall3, other calls as one JSON-RPC batch.
export const reader = () => (pub ??= createPublicClient({ chain, batch: { multicall: { wait: 10 } }, transport: http(process.env.NEXT_PUBLIC_RPC_URL || undefined, { batch: { wait: 10 } }) }) as PublicClient);

/** The connected browser wallet's provider (the one chosen in the header's wallet picker). */
export async function walletProvider(): Promise<EIP1193Provider> {
  let rdns: string | null = null;
  try { rdns = localStorage.getItem("trenchers-browser-wallet"); } catch {}
  const w = rdns && rdns !== "1" ? await waitForWallet(rdns) : null;
  const p = w?.provider ?? (typeof window !== "undefined" ? (window as unknown as { ethereum?: EIP1193Provider }).ethereum : undefined);
  if (!p) throw new Error("No browser wallet found. Connect MetaMask, Phantom or Rabby first.");
  return p;
}

/** Makes sure the wallet is on the site's network, adding it if the wallet doesn't know it yet. */
async function ensureChain(p: EIP1193Provider) {
  const id = Number(await p.request({ method: "eth_chainId" }));
  if (id === chain.id) return;
  const hex = toHex(chain.id);
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch {
    await p.request({ method: "wallet_addEthereumChain", params: [{
      chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency,
      rpcUrls: [chain.rpcUrls.default.http[0]], blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
    }] });
  }
}

/** Plain-English reasons for the contracts' errors (shown instead of raw revert data). */
export const REASONS: Record<string, string> = {
  StarterLocked: "That's more than you can withdraw: the starter balance stays locked in the agent for 6 months.",
  NotHolder: "Only the wallet that holds this Trencher can do that.",
  AlreadyClaimed: "This Trencher is already awake.",
  Underfunded: "The Agent Starter Fund is waiting for its share of recent mints. Try again in a minute.",
  NotEligible: "House agents (#1 to #5) don't have a starter balance.",
  UnknownVersion: "That wallet version hasn't been offered.",
  NoWithdrawal: "Enter an amount to withdraw.",
};
export function reason(e: unknown): string {
  const t = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
  for (const [k, v] of Object.entries(REASONS)) if (t.includes(k)) return v;
  if (/user rejected|denied|rejected the request/i.test(t)) return "Cancelled in your wallet.";
  if (/insufficient funds/i.test(t)) return "Not enough ETH in your wallet for this, plus its network fee.";
  return t.split("\n")[0];
}

type Call = { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; value?: bigint };

/** Checks the call would succeed (so a failure is explained before the wallet opens), sends it, and waits. */
/** Gas limit and fees worked out here (with headroom), so the wallet doesn't have to estimate them itself
 *  over a slow connection and never sends a transaction priced too low to be picked up. */
export async function txParams(req: { account: Address; to: Address; data?: `0x${string}`; value?: bigint }) {
  const c = reader();
  const [gas, block, tip] = await Promise.all([
    c.estimateGas(req).catch(() => null),
    c.getBlock().catch(() => null),
    c.estimateMaxPriorityFeePerGas().catch(() => 0n),
  ]);
  const base = block?.baseFeePerGas ?? null;
  return {
    ...(gas ? { gas: (gas * 13n) / 10n } : {}),
    ...(base !== null ? { maxFeePerGas: base * 3n + tip, maxPriorityFeePerGas: tip } : {}),
  };
}
const receipt = (hash: Hash) => reader().waitForTransactionReceipt({ hash, pollingInterval: 1_000 });

export async function sendCall(from: Address, call: Call, onPhase?: (p: "sign" | "chain") => void): Promise<Hash> {
  const p = await walletProvider();
  await ensureChain(p);
  const { request } = await reader().simulateContract({ ...call, account: from } as never) as unknown as { request: { address: Address; abi: never; functionName: string; args?: readonly unknown[]; value?: bigint } };
  const data = encodeFunctionData({ abi: request.abi, functionName: request.functionName, args: request.args } as never);
  const extra = await txParams({ account: from, to: request.address, data, value: request.value });
  onPhase?.("sign");
  const wallet = createWalletClient({ chain, transport: custom(p) });
  const hash = await wallet.writeContract({ ...call, ...extra, account: from, chain } as never);
  onPhase?.("chain");
  const r = await receipt(hash);
  if (r.status !== "success") throw new Error("The transaction failed on-chain.");
  return hash;
}

export async function sendEth(from: Address, to: Address, value: bigint, onPhase?: (p: "sign" | "chain") => void): Promise<Hash> {
  const p = await walletProvider();
  await ensureChain(p);
  const extra = await txParams({ account: from, to, value });
  onPhase?.("sign");
  const hash = await createWalletClient({ chain, transport: custom(p) }).sendTransaction({ to, value, account: from, chain, ...extra });
  onPhase?.("chain");
  await receipt(hash);
  return hash;
}

const ownedKey = (holder: Address) => `trenchers:owned:${DEPLOYMENT?.nft}:${holder.toLowerCase()}`;
/** The last list found for this holder (shown instantly while the chain is checked again). */
export function cachedOwned(holder: Address): number[] | null {
  try { const v = localStorage.getItem(ownedKey(holder)); return v ? (JSON.parse(v) as number[]) : null; } catch { return null; }
}

/** Trenchers this address holds now: every Trencher ever sent to it, still owned by it. */
export async function ownedTrenchers(holder: Address): Promise<number[]> {
  if (!DEPLOYMENT) return [];
  const c = reader();
  const head = await c.getBlockNumber();
  const ids = new Set<number>();
  const STEP = 50_000n;
  const ranges: [bigint, bigint][] = [];
  for (let from = BigInt(DEPLOYMENT.startBlock); from <= head; from += STEP) ranges.push([from, from + STEP - 1n < head ? from + STEP - 1n : head]);
  const all = await Promise.all(ranges.map(([from, to]) => c.getLogs({ address: DEPLOYMENT!.nft, event: ABI.nft[2], args: { to: holder }, fromBlock: from, toBlock: to })));
  for (const logs of all) for (const l of logs) ids.add(Number(l.args.tokenId));
  const owners = await Promise.all([...ids].map((id) => c.readContract({ address: DEPLOYMENT!.nft, abi: ABI.nft, functionName: "ownerOf", args: [BigInt(id)] }).catch(() => null)));
  const out = [...ids].filter((_, i) => owners[i]?.toLowerCase() === holder.toLowerCase()).sort((a, b) => a - b);
  try { localStorage.setItem(ownedKey(holder), JSON.stringify(out)); } catch { /* private mode */ }
  return out;
}
