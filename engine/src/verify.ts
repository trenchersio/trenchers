import { readFileSync } from "node:fs";
import { transport, urls } from "./rpc";
import {
  createPublicClient, decodeAbiParameters, decodeErrorResult, defineChain, encodeDeployData, encodeFunctionData, formatEther, http, parseAbi, parseEther,
  zeroAddress, zeroHash, keccak256, encodeAbiParameters, pad, toHex, type Abi, type Address, type Hex, type PublicClient,
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
/** Earlier builds of agent wallet version 3 (so /verify can say exactly which one was offered). */
const V3_HISTORY: Record<string, { abi: Art["abi"]; bytecode: `0x${string}` }> = JSON.parse(readFileSync(new URL("./v3-history.json", import.meta.url), "utf8"));
const V3_LABEL: Record<string, string> = {
  a63f1a2: "an early build of version 3 (format-independent launch; no fee collection for coins launched on the original code, no deposit protection)",
  c56efb7: "an earlier build of version 3 (launch and fee collection work, but a holder's deposits can still end up locked after trading losses)",
};
const REHEARSAL_ABI = parseAbi([
  "struct A { address nft; address fund; address splitter; address config; address impl; address adapter; address registry; address engine; address guardian; address deployer; address curveCoin; address poolCoin; }",
  "function run(A a) payable returns (uint256[] n, string uriBefore, string uriAfter)",
  "error Failed(string step, bytes reason)",
]);
const CALLER = "0x00000000000000000000000000000000ca11e701" as Address;
const allZero = (v: unknown): boolean => v === null || v === undefined || v === false || v === 0n || v === 0 || (typeof v === "string" && /^0x0*$/.test(v)) || (typeof v === "object" && Object.values(v as object).every(allZero));
const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();

export async function verifyDeployment(rpc: string, d: Deployment = MAINNET_DEPLOYMENT, R: Roles = MAINNET_ROLES, L: Launch = MAINNET_LAUNCH, opts: { coins?: { curve?: Address; pool?: Address }; walletV2?: Address } = {}) {
  const chain = defineChain({ id: d.chainId, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [urls(rpc)[0]] } } });
  const c = createPublicClient({ chain, transport: transport(urls(rpc)) }) as PublicClient;
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
      let built = r.data ?? "0x";
      // The wallet records the agent code that was live when it was deployed (the original), so rebuild it with that.
      if (key === "impl") {
        const now = await read<Address>(d.config, "AgentConfig", "accountLogic").catch(() => null);
        if (now) built = built.toLowerCase().split(now.slice(2).toLowerCase()).join(d.logic.slice(2).toLowerCase()) as `0x${string}`;
      }
      const ok = same(built, onchain);
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
  // (agent wallet code: the original, or version 2 once it is switched on; checked below)
  await expect("settings: guardian", () => read(d.config, "AgentConfig", "guardian"), R.guardian);
  await expect("settings: sealed (48h notice for any change)", () => read(d.config, "AgentConfig", "isSealed"), true);
  await expect("settings: not paused", () => read(d.config, "AgentConfig", "paused"), false);
  await expect("settings: 48h notice", () => read(d.config, "AgentConfig", "TIMELOCK"), 172800n);
  // ---- Agent coins: the agent wallet launches its coin itself, straight on the Pons factory (keys 2 and 4).
  // Version 3 (current) builds nothing itself: it sends the launch call the site prepares and checks Pons's record.
  const [pendingLogic, logicEta] = await read<[Address, bigint]>(d.config, "AgentConfig", "pending", [4]).catch(() => [zeroAddress, 0n] as [Address, bigint]);
  const liveLogic = await read<Address>(d.config, "AgentConfig", "accountLogic").catch(() => zeroAddress);
  const versions = await read<bigint>(d.config, "AgentConfig", "accountLogicVersions").catch(() => 0n);
  const runtime = (name: string) => c.call({ account: R.deployer, data: encodeDeployData({ abi: ART[name].abi, bytecode: ART[name].bytecode, args: [d.config, d.fund] }) }).then((r) => r.data ?? null).catch(() => null);
  const [v2Runtime, v3Runtime] = await Promise.all([runtime("TrenchersAgentAccountV2"), runtime("TrenchersAgentAccountV3")]);
  const offered = opts.walletV2 ?? (!same(pendingLogic, zeroAddress) ? pendingLogic : !same(liveLogic, d.logic) && !same(liveLogic, zeroAddress) ? liveLogic : null);
  checks.push({ what: "settings: agent wallet code versions offered", ok: versions >= 1n && versions <= 3n, value: String(versions) });
  let newIsV3 = false;
  if (offered) {
    const onchain = await c.getCode({ address: offered });
    newIsV3 = !!v3Runtime && same(v3Runtime, onchain);
    const isV2 = !!v2Runtime && same(v2Runtime, onchain);
    let earlier: string | null = null;
    if (!newIsV3 && !isV2) for (const [commit, b] of Object.entries(V3_HISTORY)) {
      const r = await c.call({ account: R.deployer, data: encodeDeployData({ abi: b.abi, bytecode: b.bytecode, args: [d.config, d.fund] }) }).then((x) => x.data ?? null).catch(() => null);
      if (r && same(r, onchain)) { earlier = commit; break; }
    }
    if (earlier) {
      checks.push({ what: "newest agent wallet version: code is the current TrenchersAgentAccountV3", ok: false, value: `${offered} · ${V3_LABEL[earlier] ?? `an earlier build (${earlier})`}. Deploy the current version 3 from the launch page and offer that one instead.` });
      problems.push(`agent wallet code ${offered} is ${V3_LABEL[earlier] ?? "an earlier build of version 3"}`);
    } else checks.push({ what: "newest agent wallet version: code is TrenchersAgentAccountV3 (or V2) for these settings", ok: newIsV3 || isV2, value: `${offered} · ${newIsV3 ? "version 3" : isV2 ? "version 2 (launch format may not match the live factory: offer version 3)" : "unknown code"}` });
    if (!newIsV3 && !isV2 && !earlier) problems.push(`agent wallet code ${offered} is not the expected version 2 or 3`);
    checks.push({ what: same(pendingLogic, offered) ? "newest agent wallet version: proposed, can be switched on at" : "newest agent wallet version: offered to holders", ok: true, value: same(pendingLogic, offered) ? new Date(Number(logicEta) * 1000).toISOString() : "yes" });
  } else checks.push({ what: "agent wallet version 3: not deployed yet", ok: true, value: "—" });

  const [pendingLauncher, launcherEta] = await read<[Address, bigint]>(d.config, "AgentConfig", "pending", [2]).catch(() => [zeroAddress, 0n] as [Address, bigint]);
  const liveLauncher = await read<Address>(d.config, "AgentConfig", "launcher").catch(() => zeroAddress);
  const PF = parseAbi(["function launchFee() view returns (uint256)", "function launchEnabled() view returns (bool)", "function feeEscrow() view returns (address)"]);
  const [fee, enabled, escrow] = await Promise.all([
    c.readContract({ address: L.ponsFactory, abi: PF, functionName: "launchFee" }).catch(() => null),
    c.readContract({ address: L.ponsFactory, abi: PF, functionName: "launchEnabled" }).catch(() => null),
    c.readContract({ address: L.ponsFactory, abi: PF, functionName: "feeEscrow" }).catch(() => null),
  ]);
  checks.push({ what: "agent coins: launcher is the Pons factory itself", ok: true, value: same(liveLauncher, L.ponsFactory) ? "live" : same(pendingLauncher, L.ponsFactory) ? `proposed, can be switched on at ${new Date(Number(launcherEta) * 1000).toISOString()}` : "not proposed yet" });
  for (const [k, v] of [["live", liveLauncher], ["pending", pendingLauncher]] as const) {
    if (!same(v, zeroAddress) && !same(v, L.ponsFactory)) problems.push(`coin launcher (${k}) is ${v}, not the Pons factory: propose ${L.ponsFactory} for key 2`);
  }
  checks.push({ what: "agent coins: Pons launch fee within what the starter may pay (0.002 ETH)", ok: fee !== null && fee <= parseEther("0.002"), value: fee === null ? "?" : `${formatEther(fee)} ETH` });
  checks.push({ what: "agent coins: launches open on Pons", ok: enabled === true, value: String(enabled) });
  checks.push({ what: "agent coins: Pons fee escrow (where creator fees are collected)", ok: !!escrow && !same(escrow, zeroAddress), value: String(escrow) });

  // Which launch format does the live Pons factory accept? Then a full rehearsal: house agent #1's wallet on version 3
  // launches with that format (one eth_call, nothing sent; settings and the wallet's version set by state overrides).
  const wallet1 = await read<Address>(d.fund, "AgentStarterFund", "agentWallet", [1n]);
  const holder1 = await read<Address>(d.nft, "TrenchersNFT", "ownerOf", [1n]);
  const SOC = "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }";
  const BASE = "string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics";
  const launchData = (withSalt: boolean, to: Address) => encodeFunctionData({
    abi: parseAbi([SOC, `struct TokenParams { ${BASE}${withSalt ? "; bytes32 salt" : ""}; }`, "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)"]),
    functionName: "launchToken",
    args: [{ name: "Rehearsal", symbol: "RHSL", logo: "", description: "", socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" }, creatorFeeRecipient: to, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: zeroHash, ...(withSalt ? { salt: keccak256(toHex(`trenchers-check-${Date.now()}`)) } : {}) } as never, 0n, zeroAddress],
  });
  const revertData = (e: unknown) => { for (let x: unknown = e; x; x = (x as { cause?: unknown }).cause) { const dd = (x as { data?: unknown }).data; if (typeof dd === "string") return dd; if (dd && typeof (dd as { data?: unknown }).data === "string") return (dd as { data: string }).data; } return undefined; };
  const fmt: Record<string, string> = {};
  let accepted: boolean | null = null;
  for (const withSalt of [true, false]) {
    try {
      await c.call({ account: wallet1, to: L.ponsFactory, value: fee ?? 0n, data: launchData(withSalt, wallet1), stateOverride: [{ address: wallet1, balance: parseEther("1") }] });
      fmt[withSalt ? "with salt" : "without salt"] = "accepted"; if (accepted === null) accepted = withSalt;
    } catch (e) { const dd = revertData(e); fmt[withSalt ? "with salt" : "without salt"] = `refused${dd && dd !== "0x" ? ` (${dd.slice(0, 10)})` : " (no reason: not a function of this factory)"}`; }
  }
  checks.push({ what: "agent coins: launch format the live Pons factory accepts", ok: accepted !== null, value: JSON.stringify(fmt) });
  if (accepted === null) problems.push(`agent coins: the live Pons factory refused both launch formats ${JSON.stringify(fmt)}`);
  if (v3Runtime && accepted !== null) {
    const fake = (offered && newIsV3 ? offered : "0x0000000000000000000000000000000000c0ffee") as Address;
    const slot = (key: Hex | bigint, base: bigint) => keccak256(encodeAbiParameters([{ type: typeof key === "bigint" ? "uint256" : "address" }, { type: "uint256" }], [key as never, base]));
    const word = (v: Address | bigint) => pad(typeof v === "bigint" ? toHex(v) : v, { size: 32 });
    try {
      const r = await c.call({
        account: holder1, to: wallet1,
        data: encodeFunctionData({ abi: parseAbi(["function launchCoin(bytes data, uint256 fee) returns (address coin, address curve)"]), functionName: "launchCoin", args: [launchData(accepted, wallet1), fee ?? 0n] }),
        stateOverride: [
          ...(offered && newIsV3 ? [] : [{ address: fake, code: v3Runtime as Hex }]),
          { address: d.config, stateDiff: [{ slot: slot(2n, 1n), value: word(L.ponsFactory) }, { slot: slot(fake, 3n), value: word(1n) }] },
          { address: wallet1, balance: parseEther("0.01"), stateDiff: [{ slot: "0xb7b5a01d4aafd4bfc48752d90fbca5d48b765dd637cd324b455d0308dee35ef8", value: word(fake) }] },
          { address: holder1, balance: parseEther("1") },
        ],
      });
      const [coin] = decodeAbiParameters([{ type: "address" }, { type: "address" }], r.data!);
      checks.push({ what: "agent coins rehearsal: house agent #1's wallet (version 3) deploys a coin on the real Pons factory, as its deployer and creator", ok: !same(coin, zeroAddress), value: coin });
    } catch (e) {
      const m = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0];
      checks.push({ what: "agent coins rehearsal: house agent #1's wallet (version 3) deploys a coin on the real Pons factory, as its deployer and creator", ok: false, value: `${m} ${revertData(e)?.slice(0, 74) ?? ""}` });
      problems.push(`agent coins rehearsal: ${m}`);
    }
  }
  for (const k of [0, 1, 3]) await expect(`settings: no pending change for key ${k}`, () => read(d.config, "AgentConfig", "pending", [k]), allZero);
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
      // The revert data can sit a few levels down viem's error chain.
      let data: Hex | undefined;
      for (let x: unknown = e; x && !data; x = (x as { cause?: unknown }).cause) {
        const d = (x as { data?: unknown }).data;
        if (typeof d === "string" && d.startsWith("0x")) data = d as Hex;
        else if (d && typeof (d as { data?: unknown }).data === "string") data = (d as { data: Hex }).data;
      }
      let msg = (e as { shortMessage?: string }).shortMessage ?? (e as Error).message.split("\n")[0];
      if (data) try { const de = decodeErrorResult({ abi: REHEARSAL_ABI, data }); msg = `failed at "${(de.args as [string, Hex])[0]}" (reason ${(de.args as [string, Hex])[1]})`; } catch { msg = `${msg} (revert data ${data.slice(0, 74)})`; }
      // House agent #1 trades for real, so on a busy day it may have used its daily limit: the rehearsal can't buy then.
      if (/0xc4891db5/i.test(msg)) report.rehearsal = { skipped: "house agent #1 (used for the rehearsal) has reached today's trading limit; it runs again after 00:00 UTC. Not a problem with the contracts." };
      else { report.rehearsal = { error: msg }; problems.push(`rehearsal: ${msg}`); }
    }
  }
  report.ok = problems.length === 0;
  report.problems = problems;
  return report;
}
