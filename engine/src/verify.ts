import { readFileSync } from "node:fs";
import {
  createPublicClient, decodeAbiParameters, decodeErrorResult, defineChain, encodeDeployData, encodeFunctionData, formatEther, http, parseAbi, parseEther,
  zeroAddress, type Abi, type Address, type Hex, type PublicClient,
} from "viem";
import { FORWARDER_RUNTIME, REHEARSAL_RUNTIME } from "./livecheck-code";
import { findLiveCoins } from "./selfcheck";

/**
 * Verifies the Trenchers mainnet deployment, read-only (no transaction is ever sent):
 *  1. code: every contract's on-chain code is exactly what the audited source compiles to, built with
 *     the launch page's arguments (the creation code is run with eth_call and the result compared);
 *  2. settings: owners, wiring, seal, guardian, prices, metadata, pending changes;
 *  3. rehearsal: the whole launch played out on the live contracts in one eth_call (state overrides):
 *     the Safe opens awakening and the mint, a holder mints and awakens, the engine buys and sells real
 *     Pons coins (curve and Uniswap pool), a house agent trades and withdraws, pauses block trading,
 *     and the dev share reaches the Safe.
 */
export type Deployment = { chainId: number; startBlock: string; splitter: Address; nft: Address; fund: Address; config: Address; logic: Address; impl: Address; dist: Address; adapter: Address };
export type Roles = { safe: Address; deployer: Address; guardian: Address; engine: Address };
export type Launch = { mintPriceEth: string; starterEth: string; rescueDelay: number; baseUri: string; contractUri: string; registry: Address; ponsFactory: Address };

export const MAINNET_DEPLOYMENT: Deployment = {
  chainId: 4663, startBlock: "80212654",
  splitter: "0x30e18147b56c011a76379241aa5abda1d7467741", nft: "0xe4b9a60b78c90fca0dcb79d8f1cbca43ef33c83e",
  fund: "0x24bc32bbba4f4ff20b31402dea2bbc63db1579d9", config: "0xb9b1483e27f6742b83217c490991edf0f9b42d57",
  logic: "0xe51488ddf620da0de53465520dbf3d95dddfff4d", impl: "0x6e43c01f05d8bb00ce134ca52f410bd3ca0c821d",
  dist: "0x3926a801b52cf28c2cb0f5199cf7ec55f45ede1a", adapter: "0x229671b3464f7b01175d93dbc4ad71e02f05baef",
};
export const MAINNET_ROLES: Roles = {
  safe: "0xF928e1A70d0CBf092193D4E3FE4F68edfffe4b10", deployer: "0x447D8F97c39df3d6FCAB8a02A54986283e818210",
  guardian: "0xb5aF3f28393dCC2611671fcCB5AD3B6e57cEE9DD", engine: "0xe15fa7c18a86Df13A4C57224b02C0e639d709f2F",
};
export const MAINNET_LAUNCH: Launch = {
  mintPriceEth: "0.02", starterEth: "0.01", rescueDelay: 48 * 3600,
  baseUri: "https://trenchers.io/meta/", contractUri: "https://trenchers.io/meta/contract.json",
  registry: "0x000000006551c19487814612e58FE06813775758", ponsFactory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
};

type Art = { abi: Abi; bytecode: Hex };
const ART: Record<string, Art> = JSON.parse(readFileSync(new URL("./mainnet-artifacts.json", import.meta.url), "utf8"));
const REHEARSAL_ABI = parseAbi([
  "struct A { address nft; address fund; address splitter; address config; address impl; address adapter; address registry; address engine; address guardian; address deployer; address curveCoin; address poolCoin; }",
  "function run(A a) payable returns (uint256[] n, string uriBefore, string uriAfter)",
  "error Failed(string step, bytes reason)",
]);
const CALLER = "0x00000000000000000000000000000000ca11e701" as Address;
const allZero = (v: unknown): boolean => v === null || v === undefined || v === false || v === 0n || v === 0 || (typeof v === "string" && /^0x0*$/.test(v)) || (typeof v === "object" && Object.values(v as object).every(allZero));
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();

export async function verifyDeployment(rpc: string, d: Deployment = MAINNET_DEPLOYMENT, R: Roles = MAINNET_ROLES, L: Launch = MAINNET_LAUNCH, opts: { coins?: { curve?: Address; pool?: Address } } = {}) {
  const chain = defineChain({ id: d.chainId, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
  const c = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
  const problems: string[] = [];
  const report: Record<string, unknown> = { at: new Date().toISOString(), chainId: await c.getChainId(), deployment: d };
  if (report.chainId !== d.chainId) problems.push(`RPC is chain ${report.chainId}, expected ${d.chainId}`);
  const read = <T = unknown>(address: Address, name: string, functionName: string, args: unknown[] = []) =>
    c.readContract({ address, abi: ART[name].abi, functionName, args }) as Promise<T>;

  // ---------------------------------------------------------------- 1. code
  const vestStart = await read<bigint>(d.splitter, "RevenueSplitter", "vestStart").catch(() => 0n);
  const builds: [keyof Deployment, string, unknown[]][] = [
    ["splitter", "RevenueSplitter", [R.deployer, R.safe, vestStart]],
    ["nft", "TrenchersNFT", [d.splitter, R.deployer, L.contractUri, L.contractUri, parseEther(L.mintPriceEth)]],
    ["fund", "AgentStarterFund", [R.safe, d.nft, L.registry, parseEther(L.starterEth), BigInt(L.rescueDelay)]],
    ["config", "AgentConfig", [R.deployer]],
    ["logic", "TrenchersAgentAccount", [d.config, d.fund]],
    ["impl", "TrenchersAgentWallet", [d.config]],
    ["dist", "AgentFeeDistributor", [R.deployer, L.registry, d.nft, BigInt(L.rescueDelay)]],
    ["adapter", "PonsAdapter", [L.ponsFactory, R.safe]],
  ];
  const code: Record<string, string> = {};
  for (const [key, name, args] of builds) {
    const onchain = await c.getCode({ address: d[key] as Address });
    if (!onchain || onchain === "0x") { code[key] = "NO CODE"; problems.push(`${key}: no contract at ${d[key]}`); continue; }
    try {
      const r = await c.call({ account: R.deployer, data: encodeDeployData({ abi: ART[name].abi, bytecode: ART[name].bytecode, args }) });
      const ok = same(r.data, onchain);
      code[key] = ok ? `matches ${name} (${(onchain.length - 2) / 2} bytes)` : `DIFFERENT from ${name}`;
      if (!ok) problems.push(`${key}: on-chain code is not the expected ${name}`);
    } catch (e) { code[key] = `could not rebuild: ${(e as Error).message.split("\n")[0]}`; problems.push(`${key}: could not rebuild the expected code`); }
  }
  report.code = code;

  // ---------------------------------------------------------------- 2. settings
  const checks: { what: string; ok: boolean; value: string; expected?: string }[] = [];
  const expect = async (what: string, get: () => Promise<unknown>, want: unknown) => {
    let v: unknown;
    try { v = await get(); } catch (e) { v = `error: ${(e as Error).message.split("\n")[0]}`; }
    const ok = typeof want === "function" ? (want as (x: unknown) => boolean)(v) : same(v, want);
    const show = (x: unknown) => (typeof x === "bigint" ? x.toString() : typeof x === "object" ? JSON.stringify(x, (_k, y) => (typeof y === "bigint" ? y.toString() : y)) : String(x));
    checks.push({ what, ok, value: show(v), ...(typeof want === "function" ? {} : { expected: show(want) }) });
    if (!ok) problems.push(`${what}: is ${show(v)}${typeof want === "function" ? "" : `, expected ${show(want)}`}`);
  };
  for (const [k, n] of [["splitter", "RevenueSplitter"], ["nft", "TrenchersNFT"], ["fund", "AgentStarterFund"], ["config", "AgentConfig"], ["dist", "AgentFeeDistributor"], ["adapter", "PonsAdapter"]] as const)
    await expect(`${k} is owned by the Safe`, () => read(d[k], n, "owner"), R.safe);
  // the agent settings
  await expect("settings: engine wallet", () => read(d.config, "AgentConfig", "engine"), R.engine);
  await expect("settings: trading route", () => read(d.config, "AgentConfig", "router"), d.adapter);
  await expect("settings: starter fund", () => read(d.config, "AgentConfig", "starterFund"), d.fund);
  await expect("settings: agent wallet code", () => read(d.config, "AgentConfig", "accountLogic"), d.logic);
  await expect("settings: one wallet code version so far", () => read(d.config, "AgentConfig", "accountLogicVersions"), 1n);
  await expect("settings: no coin launcher yet", () => read(d.config, "AgentConfig", "launcher"), zeroAddress);
  await expect("settings: guardian", () => read(d.config, "AgentConfig", "guardian"), R.guardian);
  await expect("settings: sealed (48h notice for any change)", () => read(d.config, "AgentConfig", "isSealed"), true);
  await expect("settings: not paused", () => read(d.config, "AgentConfig", "paused"), false);
  await expect("settings: 48h notice", () => read(d.config, "AgentConfig", "TIMELOCK"), 172800n);
  for (let k = 0; k <= 4; k++) await expect(`settings: no pending change for key ${k}`, () => read(d.config, "AgentConfig", "pending", [k]), allZero);
  // the agent wallet
  await expect("agent wallet: original code", () => read(d.impl, "TrenchersAgentWallet", "ORIGINAL_VERSION"), d.logic);
  await expect("agent wallet: runs the original code", () => read(d.impl, "TrenchersAgentWallet", "agentLogic"), d.logic);
  await expect("agent wallet code: settings", () => read(d.logic, "TrenchersAgentAccount", "config"), d.config);
  await expect("agent wallet code: starter fund", () => read(d.logic, "TrenchersAgentAccount", "starterFund"), d.fund);
  // the NFT
  await expect("NFT: name", () => read(d.nft, "TrenchersNFT", "name"), "Trenchers");
  await expect("NFT: mint price 0.02 ETH", () => read(d.nft, "TrenchersNFT", "mintPrice"), parseEther(L.mintPriceEth));
  await expect("NFT: mint open?", () => read(d.nft, "TrenchersNFT", "mintOpen"), (v: unknown) => typeof v === "boolean");
  await expect("NFT: minted so far (5 house agents + sales)", () => read(d.nft, "TrenchersNFT", "totalSupply"), (v: unknown) => typeof v === "bigint" && v >= 5n);
  for (let id = 1; id <= 5; id++) await expect(`NFT: house agent #${id} held by the Deployer`, () => read(d.nft, "TrenchersNFT", "ownerOf", [BigInt(id)]), R.deployer);
  await expect("NFT: max supply", () => read(d.nft, "TrenchersNFT", "maxSupply"), 2000n);
  await expect("NFT: splitter", () => read(d.nft, "TrenchersNFT", "splitter"), d.splitter);
  await expect("NFT: starter fund (dormant/awake art)", () => read(d.nft, "TrenchersNFT", "starterFund"), d.fund);
  await expect("NFT: metadata link (house agents are always awake)", () => read(d.nft, "TrenchersNFT", "tokenURI", [1n]), (v: unknown) => [L.baseUri, L.baseUri.replace("://", "://www.")].some((b) => v === `${b}awake/1.json`));
  await expect("NFT: collection info", () => read(d.nft, "TrenchersNFT", "contractURI"), (v: unknown) => v === L.contractUri || v === L.contractUri.replace("://", "://www."));
  await expect("NFT: 5% royalty to the splitter", () => read(d.nft, "TrenchersNFT", "royaltyInfo", [1n, 10_000n]), (v: unknown) => { const [to, amt] = v as [Address, bigint]; return same(to, d.splitter) && amt === 500n; });
  await expect("NFT: metadata not frozen (art can still be updated)", () => read(d.nft, "TrenchersNFT", "metadataFrozen"), false);
  // the money
  await expect("splitter: mints count as first sales", () => read(d.splitter, "RevenueSplitter", "primarySeller"), d.nft);
  await expect("splitter: 51% goes to the starter fund", () => read(d.splitter, "RevenueSplitter", "destination", [3]), d.fund);
  await expect("splitter: dev share goes to the Safe", () => read(d.splitter, "RevenueSplitter", "destination", [1]), R.safe);
  await expect("splitter: 51% starter share", () => read(d.splitter, "RevenueSplitter", "PRIMARY_STARTER_BPS"), 5100n);
  await expect("starter fund: 0.01 ETH per agent", () => read(d.fund, "AgentStarterFund", "CLAIM"), parseEther(L.starterEth));
  await expect("starter fund: awakening (closed, or open with the agent wallet code)", () => read(d.fund, "AgentStarterFund", "accountImplementation"), (v: unknown) => same(v, zeroAddress) || same(v, d.impl));
  await expect("starter fund: NFT", () => read(d.fund, "AgentStarterFund", "nft"), d.nft);
  await expect("starter fund: ERC-6551 registry", () => read(d.fund, "AgentStarterFund", "registry"), L.registry);
  await expect("starter fund: 48h safety-net delay", () => read(d.fund, "AgentStarterFund", "rescueDelay"), BigInt(L.rescueDelay));
  await expect("starter fund: no rescue pending", () => read(d.fund, "AgentStarterFund", "rescueEta"), 0n);
  await expect("fee distributor: linked to agent wallets", () => read(d.dist, "AgentFeeDistributor", "accountImplementation"), d.impl);
  await expect("fee distributor: 48h safety-net delay", () => read(d.dist, "AgentFeeDistributor", "rescueDelay"), BigInt(L.rescueDelay));
  await expect("trading route: Pons V2 factory", () => read(d.adapter, "PonsAdapter", "factory"), L.ponsFactory);
  const balances: Record<string, string> = {};
  for (const [k, a] of [["deployer", R.deployer], ["safe", R.safe], ["engine", R.engine], ["splitter", d.splitter], ["fund", d.fund]] as const) balances[k] = formatEther(await c.getBalance({ address: a as Address }));
  report.balances = balances;
  report.settings = checks;

  // ---------------------------------------------------------------- 3. rehearsal
  const coins = opts.coins ?? await findLiveCoins(c);
  report.coins = coins;
  if (!coins.curve) problems.push("rehearsal: no live curve coin found to trade");
  else {
    const args = { nft: d.nft, fund: d.fund, splitter: d.splitter, config: d.config, impl: d.impl, adapter: d.adapter, registry: L.registry, engine: R.engine, guardian: R.guardian, deployer: R.deployer, curveCoin: coins.curve, poolCoin: coins.pool ?? zeroAddress };
    try {
      const r = await c.call({
        account: CALLER, to: R.safe, value: parseEther("1"),
        data: encodeFunctionData({ abi: REHEARSAL_ABI, functionName: "run", args: [args] }),
        stateOverride: [
          { address: R.safe, code: REHEARSAL_RUNTIME as Hex },
          { address: R.engine, code: FORWARDER_RUNTIME as Hex },
          { address: R.guardian, code: FORWARDER_RUNTIME as Hex },
          { address: R.deployer, code: FORWARDER_RUNTIME as Hex },
          { address: CALLER, balance: parseEther("10") },
        ],
      });
      const [n, uriBefore, uriAfter] = decodeAbiParameters([{ type: "uint256[]" }, { type: "string" }, { type: "string" }], r.data!);
      const E = (x: bigint) => formatEther(x);
      const steps = [
        { step: "Safe opens awakening and the mint", ok: true },
        { step: `holder mints #${n[0]} for ${L.mintPriceEth} ETH; ${E(n[13])} ETH (51%) reaches the starter fund`, ok: n[13] === parseEther(L.mintPriceEth) * 51n / 100n },
        { step: `metadata switches dormant → awake (${uriBefore} → ${uriAfter})`, ok: /\/meta\/dormant\/\d+\.json$/.test(uriBefore) && uriAfter === uriBefore.replace("/dormant/", "/awake/") },
        { step: `awakening puts ${E(n[1])} ETH in the agent wallet, ${E(n[2])} locked`, ok: n[1] === parseEther(L.starterEth) && n[2] === parseEther(L.starterEth) },
        { step: `engine buys a live curve coin (${n[3]} units) and sells it all; agent holds ${E(n[4])} ETH`, ok: n[3] > 0n && n[4] > 0n },
        { step: coins.pool ? `engine buys a graduated coin on its Uniswap pool (${n[5]} units) and sells it all; agent holds ${E(n[6])} ETH` : "no graduated coin found to test (curve trading verified)", ok: !coins.pool || (n[5] > 0n && n[6] > 0n) },
        { step: `holder withdraws ${E(n[7])} ETH above the locked starter`, ok: n[7] > 0n },
        { step: "holder's own pause blocks the engine", ok: n[8] === 1n },
        { step: `house agent #1 trades (${n[9]} units) and the Deployer withdraws ${E(n[10])} ETH`, ok: n[9] > 0n && n[10] > 0n },
        { step: `dev share released to the Safe: ${E(n[11])} ETH`, ok: n[11] > 0n },
        { step: "guardian emergency stop blocks the engine", ok: n[12] === 1n },
      ];
      report.rehearsal = steps;
      for (const s of steps) if (!s.ok) problems.push(`rehearsal: ${s.step}`);
    } catch (e) {
      const data = (e as { data?: Hex; cause?: { data?: Hex } }).cause?.data ?? (e as { data?: Hex }).data;
      let msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0];
      if (data) try { const de = decodeErrorResult({ abi: REHEARSAL_ABI, data }); msg = `failed at "${(de.args as [string, Hex])[0]}" (reason ${(de.args as [string, Hex])[1]})`; } catch { /* keep */ }
      report.rehearsal = { error: msg };
      problems.push(`rehearsal: ${msg}`);
    }
  }
  report.ok = problems.length === 0;
  report.problems = problems;
  return report;
}
