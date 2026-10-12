"use client";
import { TRENCHERS_TOKEN } from "@/lib/programmable";
import { MAINNET_DEPLOYMENT } from "@/lib/mainnet/deployment";
import { TextButton } from "@/components/TextButton";
import { useCallback, useEffect, useState } from "react";
import {
  createPublicClient, createWalletClient, custom, encodeFunctionData, fallback, formatEther, http, parseAbi, parseEther, toHex, zeroHash,
  type Abi, type Address, type EIP1193Provider, type Hash, type PublicClient,
} from "viem";
import { robinhood } from "viem/chains";
import artifacts from "@/lib/mainnet/artifacts.json";
import v4art from "@/lib/v4builder/artifacts.json";
import { MAINNET_LAUNCH as L, MAINNET_ROLES as R } from "@/lib/mainnet/roles";
import { walletProvider } from "@/lib/chain";
import { keccak256 } from "viem";
import { useWallet } from "@/lib/wallet";

/**
 * Mainnet launch console (team only). Deploys every Trenchers contract from the Deployer wallet, in the
 * visitor's own browser wallet (no key ever leaves it), wires them up, seals the settings and hands
 * ownership to the team Safe. Resumable: if it stops halfway, it carries on where it left off.
 * The mint stays closed: the Safe opens awakening and the mint afterwards.
 */
type Name = keyof typeof artifacts;
/** Agent wallet version 4: Programmable's Module Mode factory on Robinhood Chain, $TRENCHERS, and the factory's ETH-funded launch. */
const PG_FACTORY = "0x18cab14c69d0fe6df4a96256318b51c51c98da3f" as Address;
const PG_LAUNCH_SELECTOR = "0x79082bf9" as `0x${string}`;
const A = (n: Name) => artifacts[n].abi as Abi;
const chain = robinhood;
const EXPLORER = "https://robin.etherscan.io";
const STORE = "trenchers-mainnet-launch";
/** The earlier coin launcher (Trenchers paid the fee; Pons recorded it as deployer). Superseded by agent wallet version 2. */
const OLD_COIN_LAUNCHER = "0x244400ad17266e276b61c186f79bb0074b91ddf2" as Address;
/** Robinhood Chain's official Uniswap v4 contracts, as pinned in v4builder/src/TrenchersInfraV1.sol. */
const V4 = {
  manager: "0x8366a39CC670B4001A1121B8F6A443A643e40951", managerHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  positions: "0x58daec3116aae6D93017bAAea7749052E8a04fA7", positionsHash: "0xc873e135dc9aaec88489cfbad146b4cb49d6a32e0d80326377784b7ba17670b2",
  router: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99", routerHash: "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3", permit2Hash: "0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca",
} as const;
const V4_MODULES: [string, string][] = [
  ["buyCooldown", "BuyCooldownFactoryV1"], ["buyWindow", "BuyWindowFactoryV1"], ["priceMoveGuard", "PriceMoveGuardFactoryV1"], ["growingBuyLimit", "GrowingBuyLimitFactoryV1"],
  ["launchWalletCap", "LaunchWalletCapFactoryV1"], ["buybackBurn", "BuybackBurnFactoryV1"], ["dipBuyback", "DipBuybackFactoryV1"], ["lpRewards", "LPRewardsFactoryV1"],
  ["fullRangeLp", "FullRangeLPFactoryV1"], ["buyerRewards", "BuyerRewardsFactoryV1"], ["nthBuyPot", "NthBuyPotFactoryV1"], ["kingOfTheHill", "KingOfTheHillFactoryV1"],
  ["hotPotato", "HotPotatoFactoryV1"], ["plague", "PlagueFactoryV1"], ["reactivePair", "ReactivePairFactoryV1"], ["entangled", "EntangledFactoryV1"],
];
const SAFE_ABI = parseAbi(["function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"]);
const OWNER_ABI = parseAbi(["function owner() view returns (address)"]);

type Dep = { done: string[]; startBlock?: string } & Partial<Record<"splitter" | "nft" | "fund" | "config" | "logic" | "impl" | "dist" | "adapter", Address>>;
type Check = { label: string; ok: boolean | null; note?: string };

const load = (): Dep => { try { return JSON.parse(localStorage.getItem(STORE) || "") as Dep; } catch { return { done: [] }; } };
const save = (d: Dep) => { try { localStorage.setItem(STORE, JSON.stringify(d)); } catch {} };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const errText = (e: unknown) => String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? e).split("\n")[0];

export function MainnetLaunch() {
  const w = useWallet();
  const [prov, setProv] = useState<EIP1193Provider | null>(null);
  const [account, setAccount] = useState<Address | null>(null);
  const [walletV2, setWalletV2] = useState<Address | null>(null);
  const [walletV4, setWalletV4] = useState<Address | null>(null);
  const [v4Paste, setV4Paste] = useState("");
  const [v4Err, setV4Err] = useState<string | null>(null);
  /** Accept an already deployed version 4 (e.g. the page lost track of it): it must report version 4 and the right settings. */
  const applyDeployedV4 = async (addr: string) => {
    setV4Err(null);
    try {
      if (!/^0x[0-9a-fA-F]{40}$/.test(addr.trim())) throw new Error("Paste the contract address (0x…).");
      const a = addr.trim() as Address, c = pub();
      const abi = A("TrenchersAgentAccountV4");
      const [ver, cfg, fund, fac, tok] = await Promise.all(["VERSION", "config", "starterFund", "programmableFactory", "trenchersToken"].map((f) =>
        c.readContract({ address: a, abi, functionName: f }).catch(() => null)));
      if (Number(ver) !== 4) throw new Error("That address isn't agent wallet version 4.");
      if (String(cfg).toLowerCase() !== MAINNET_DEPLOYMENT.config.toLowerCase() || String(fund).toLowerCase() !== MAINNET_DEPLOYMENT.fund.toLowerCase()
        || String(fac).toLowerCase() !== PG_FACTORY.toLowerCase() || String(tok).toLowerCase() !== TRENCHERS_TOKEN.toLowerCase()) throw new Error("That version 4 was built with different settings. Deploy a new one.");
      setWalletV4(a); try { localStorage.setItem("trenchers:walletV4", a); } catch { /* */ }
    } catch (e) { setV4Err(errText(e)); }
  };
  useEffect(() => { try { const v = localStorage.getItem("trenchers:walletV4"); if (v) setWalletV4(v as Address); } catch { /* */ } }, []);
  // Trenchers Inference Markets: the burn-only desk, the ETH router and the P2P market (no owner, no Safe steps).
  const [inf, setInf] = useState<{ desk?: Address; router?: Address; otc?: Address; block?: string }>({});
  const [infErr, setInfErr] = useState<string | null>(null);
  useEffect(() => { try { const v = localStorage.getItem("trenchers:inference"); if (v) setInf(JSON.parse(v)); } catch { /* */ } }, []);
  const saveInf = (v: typeof inf) => { setInf(v); try { localStorage.setItem("trenchers:inference", JSON.stringify(v)); } catch { /* */ } };
  // Trenchers V4 Builder: hook deployer, launch factory and the 16 module factories (no owner anywhere).
  const [vb, setVb] = useState<{ hookDeployer?: Address; factory?: Address; block?: string; modules?: Record<string, Address> }>({});
  const [vbErr, setVbErr] = useState<string | null>(null);
  useEffect(() => { try { const v = localStorage.getItem("trenchers:v4builder"); if (v) setVb(JSON.parse(v)); } catch { /* */ } }, []);
  const saveVb = (v: typeof vb) => { setVb(v); try { localStorage.setItem("trenchers:v4builder", JSON.stringify(v)); } catch { /* */ } };
  const [oldBal, setOldBal] = useState<bigint | null>(null);
  useEffect(() => {
    try { const v = localStorage.getItem("trenchers:walletV3b"); if (v) setWalletV2(v as Address); } catch { /* */ }
    // Already deployed and proposed? Then the agent settings know it.
    pub().readContract({ address: MAINNET_DEPLOYMENT.config, abi: A("AgentConfig"), functionName: "pending", args: [4] })
      .then(async (p) => {
        const v = (p as readonly [Address, bigint])[0];
        if (!v || /^0x0+$/.test(v)) return;
        // The current version 3 (with deposits that never lock); an earlier version 3 proposal is replaced by deploying this one.
        const ok = await pub().readContract({ address: v, abi: parseAbi(["function deposited() view returns (uint256)"]), functionName: "deposited" }).then(() => true).catch(() => false);
        if (ok) setWalletV2(v);
      }).catch(() => {});
    pub().getBalance({ address: OLD_COIN_LAUNCHER }).then(setOldBal).catch(() => {});
  }, []);
  const oldWithdraw = encodeFunctionData({ abi: A("AgentCoinLauncher"), functionName: "withdraw", args: [R.safe, oldBal ?? 0n] });
  const [chainOk, setChainOk] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [dep, setDep] = useState<Dep>({ done: [] });
  const [checks, setChecks] = useState<Check[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ label: string; state: "wait" | "ok" | "err"; hash?: Hash; note?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [owners, setOwners] = useState<Record<string, string> | null>(null);

  useEffect(() => { setDep(load()); }, []);
  // The wallet connected in the site header (MetaMask, Rabby, Phantom…).
  useEffect(() => {
    if (!w.address || w.kind !== "wallet") { setProv(null); setAccount(null); return; }
    walletProvider().then(setProv).catch((e) => setError(errText(e)));
  }, [w.address, w.kind]);

  const pub = useCallback(() => createPublicClient({ chain, transport: prov ? fallback([custom(prov), http()]) : http() }) as PublicClient, [prov]);

  const refresh = useCallback(async () => {
    if (!prov) return;
    const accs = (await prov.request({ method: "eth_accounts" })) as Address[];
    const id = Number(await prov.request({ method: "eth_chainId" }));
    setAccount(accs[0] ?? null); setChainOk(id === chain.id);
    if (accs[0] && id === chain.id) setBalance(await pub().getBalance({ address: accs[0] }).catch(() => null));
  }, [prov, pub]);
  useEffect(() => {
    refresh();
    if (!prov) return;
    const on = () => refresh();
    prov.on?.("accountsChanged", on as never); prov.on?.("chainChanged", on as never);
    return () => { prov.removeListener?.("accountsChanged", on as never); prov.removeListener?.("chainChanged", on as never); };
  }, [prov, refresh]);

  // Preflight: everything the launch depends on, read from the chain.
  useEffect(() => {
    if (!chainOk) return;
    (async () => {
      const c = pub();
      const code = async (a: Address) => { const x = await c.getCode({ address: a }).catch(() => undefined); return !!x && x !== "0x"; };
      const out: Check[] = [];
      try {
        const [th, ow] = await Promise.all([c.readContract({ address: R.safe, abi: SAFE_ABI, functionName: "getThreshold" }), c.readContract({ address: R.safe, abi: SAFE_ABI, functionName: "getOwners" })]);
        out.push({ label: "Team Safe exists on Robinhood Chain", ok: true, note: `${th} of ${ow.length} signatures` }); // signer addresses are never shown
      } catch { out.push({ label: "Team Safe exists on Robinhood Chain", ok: false, note: `No Safe found at ${R.safe}` }); }
      out.push({ label: "ERC-6551 registry (agent wallets)", ok: await code(L.registry) });
      out.push({ label: "Pons V2 launchpad", ok: await code(L.ponsFactory) });
      out.push({ label: "Limit Break royalty validator", ok: await code(L.lbValidator), note: "optional: transfers work without it" });
      setChecks(out);
    })();
  }, [chainOk, pub]);

  const switchNetwork = async (p?: EIP1193Provider) => {
    const t = p ?? prov; if (!t) return;
    const hex = toHex(chain.id);
    try { await t.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
    catch {
      await t.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: "Robinhood Chain", nativeCurrency: chain.nativeCurrency, rpcUrls: [chain.rpcUrls.default.http[0]], blockExplorerUrls: [EXPLORER] }] }).catch((e) => setError(errText(e)));
    }
    await refresh();
  };

  // ---------------------------------------------------------------- transactions
  const push = (label: string) => setLog((l) => [...l, { label, state: "wait" }]);
  const patch = (p: Partial<(typeof log)[number]>) => setLog((l) => l.map((x, i) => (i === l.length - 1 ? { ...x, ...p } : x)));
  const sendTx = async (label: string, fn: (w: ReturnType<typeof createWalletClient>, from: Address) => Promise<Hash>) => {
    if (!prov || !account) throw new Error("Connect the Deployer wallet first.");
    push(label);
    const w = createWalletClient({ chain, transport: custom(prov) });
    const hash = await fn(w, account).catch((e) => { patch({ state: "err", note: errText(e) }); throw e; });
    patch({ hash });
    const r = await pub().waitForTransactionReceipt({ hash });
    if (r.status !== "success") { patch({ state: "err", note: "failed on-chain" }); throw new Error(`${label} failed on-chain.`); }
    patch({ state: "ok" });
    return r;
  };
  const deploy = async (label: string, name: Name, args: unknown[]) => {
    const r = await sendTx(label, (w, from) => w.deployContract({ abi: A(name), bytecode: artifacts[name].bytecode as `0x${string}`, args, account: from, chain }));
    if (!r.contractAddress) throw new Error(`${label}: no contract address in the receipt.`);
    return r.contractAddress;
  };
  const write = async (label: string, address: Address, name: Name, functionName: string, args: unknown[] = []) => {
    await pub().simulateContract({ address, abi: A(name), functionName, args, account: account! }).catch((e) => { throw new Error(`${label}: ${errText(e)}`); });
    return sendTx(label, (w, from) => w.writeContract({ address, abi: A(name), functionName, args, account: from, chain }));
  };

  const STEPS: { key: string; label: string; run: (d: Dep, me: Address) => Promise<Partial<Dep>> }[] = [
    { key: "splitter", label: "Revenue splitter (dev share to the Safe)", run: async (_d, me) => ({ startBlock: (await pub().getBlockNumber()).toString(), splitter: await deploy("Revenue splitter", "RevenueSplitter", [me, R.safe, BigInt(Math.floor(Date.now() / 1000))]) }) },
    { key: "nft", label: "Trenchers NFT (house agents #1–5 to the Deployer)", run: async (d) => ({ nft: await deploy("Trenchers NFT", "TrenchersNFT", [d.splitter, R.deployer, L.contractUri, L.contractUri, parseEther(L.mintPriceEth)]) }) },
    { key: "fund", label: "Agent Starter Fund (owned by the Safe)", run: async (d) => ({ fund: await deploy("Agent Starter Fund", "AgentStarterFund", [R.safe, d.nft, L.registry, parseEther(L.starterEth), BigInt(L.rescueDelay)]) }) },
    { key: "config", label: "Agent settings", run: async (_d, me) => ({ config: await deploy("Agent settings", "AgentConfig", [me]) }) },
    { key: "logic", label: "Agent wallet code", run: async (d) => ({ logic: await deploy("Agent wallet code", "TrenchersAgentAccount", [d.config, d.fund]) }) },
    { key: "cfgLogic", label: "Record the original agent wallet code", run: async (d) => { await write("Record the original agent wallet code", d.config!, "AgentConfig", "propose", [4, d.logic]); return {}; } },
    { key: "impl", label: "Agent wallet (fixed to the original code)", run: async (d) => ({ impl: await deploy("Agent wallet", "TrenchersAgentWallet", [d.config]) }) },
    { key: "dist", label: "Fee distributor", run: async (d, me) => ({ dist: await deploy("Fee distributor", "AgentFeeDistributor", [me, L.registry, d.nft, BigInt(L.rescueDelay)]) }) },
    { key: "cfgFund", label: "Link settings to the starter fund", run: async (d) => { await write("Link settings to the starter fund", d.config!, "AgentConfig", "propose", [3, d.fund]); return {}; } },
    { key: "nftFund", label: "Link NFT to the starter fund (dormant / awake art)", run: async (d) => { await write("Link NFT to the starter fund", d.nft!, "TrenchersNFT", "setStarterFund", [d.fund]); return {}; } },
    { key: "baseUri", label: "Point the NFT at trenchers.io metadata", run: async (d) => { await write("Point the NFT at trenchers.io metadata", d.nft!, "TrenchersNFT", "setBaseURI", [L.baseUri]); return {}; } },
    { key: "cfgEngine", label: "Set the engine wallet", run: async (d) => { await write("Set the engine wallet", d.config!, "AgentConfig", "propose", [0, R.engine]); return {}; } },
    { key: "guardian", label: "Set the guardian (emergency stop)", run: async (d) => { await write("Set the guardian", d.config!, "AgentConfig", "setGuardian", [R.guardian]); return {}; } },
    { key: "adapter", label: "Trading route (Pons + Uniswap)", run: async () => ({ adapter: await deploy("Trading route", "PonsAdapter", [L.ponsFactory, R.safe]) }) },
    { key: "cfgRouter", label: "Let agents trade through it", run: async (d) => { await write("Let agents trade through it", d.config!, "AgentConfig", "propose", [1, d.adapter]); return {}; } },
    { key: "distAcct", label: "Link fee distributor to agent wallets", run: async (d) => { await write("Link fee distributor to agent wallets", d.dist!, "AgentFeeDistributor", "setAccount", [d.impl, zeroHash]); return {}; } },
    { key: "seller", label: "Count mints as first sales", run: async (d) => { await write("Count mints as first sales", d.splitter!, "RevenueSplitter", "setPrimarySeller", [d.nft]); return {}; } },
    { key: "starterDest", label: "Send 51% of each mint to the starter fund", run: async (d) => { await write("Send 51% of each mint to the starter fund", d.splitter!, "RevenueSplitter", "proposeDestination", [3, d.fund]); return {}; } },
    { key: "seal", label: "Seal the settings (48-hour notice from now on)", run: async (d) => { await write("Seal the settings", d.config!, "AgentConfig", "seal"); return {}; } },
    { key: "ownSplitter", label: "Hand the splitter to the Safe", run: async (d) => { await write("Hand the splitter to the Safe", d.splitter!, "RevenueSplitter", "transferOwnership", [R.safe]); return {}; } },
    { key: "ownNft", label: "Hand the NFT to the Safe", run: async (d) => { await write("Hand the NFT to the Safe", d.nft!, "TrenchersNFT", "transferOwnership", [R.safe]); return {}; } },
    { key: "ownConfig", label: "Hand the settings to the Safe", run: async (d) => { await write("Hand the settings to the Safe", d.config!, "AgentConfig", "transferOwnership", [R.safe]); return {}; } },
    { key: "ownDist", label: "Hand the fee distributor to the Safe", run: async (d) => { await write("Hand the fee distributor to the Safe", d.dist!, "AgentFeeDistributor", "transferOwnership", [R.safe]); return {}; } },
  ];
  const finished = STEPS.every((s) => dep.done.includes(s.key));

  const run = async () => {
    setBusy(true); setError(null);
    let d = { ...dep };
    try {
      for (const s of STEPS) {
        if (d.done.includes(s.key)) continue;
        const add = await s.run(d, account!);
        d = { ...d, ...add, done: [...d.done, s.key] };
        setDep(d); save(d);
      }
    } catch (e) { setError(errText(e)); }
    setBusy(false);
  };

  // After the run: every contract's owner must be the Safe.
  useEffect(() => {
    if (!finished || !chainOk) return;
    (async () => {
      const c = pub(); const o: Record<string, string> = {};
      for (const k of ["splitter", "nft", "fund", "config", "dist"] as const) o[k] = await c.readContract({ address: dep[k]!, abi: OWNER_ABI, functionName: "owner" }).catch(() => "?");
      setOwners(o);
    })();
  }, [finished, chainOk, dep, pub]);

  const isDeployer = account?.toLowerCase() === R.deployer.toLowerCase();
  const preflightOk = checks.length > 0 && checks.filter((c) => !c.note?.startsWith("optional")).every((c) => c.ok);
  const code = JSON.stringify({ chainId: chain.id, ...Object.fromEntries(Object.entries(dep).filter(([k]) => k !== "done")) });
  const safeCalls = finished ? [
    { what: "Open awakening (agents can claim their 0.01 ETH)", to: dep.fund!, data: encodeFunctionData({ abi: A("AgentStarterFund"), functionName: "setAccount", args: [dep.impl, zeroHash] }) },
    { what: "Open the mint (0.02 ETH on trenchers.io)", to: dep.nft!, data: encodeFunctionData({ abi: A("TrenchersNFT"), functionName: "setMintOpen", args: [true] }) },
  ] : [];

  return (
    <div className="tn launch">
      <header className="tn-head">
        <p className="eyebrow">Team only · Robinhood Chain mainnet</p>
        <h1>Mainnet launch</h1>
        <p className="tn-sub">Deploys every Trenchers contract from the Deployer wallet, in your own browser wallet, wires them up and hands ownership to the team Safe. The mint stays closed until the Safe opens it.</p>
      </header>

      <section className="tn-card">
        <h2>1 · Launch settings</h2>
        <dl className="tn-kv mono launch-kv">
          <div><dt>Team Safe (owner, dev share)</dt><dd><a href={`${EXPLORER}/address/${R.safe}`} target="_blank" rel="noreferrer">{R.safe}</a></dd></div>
          <div><dt>Deployer (house agents #1–5)</dt><dd>{R.deployer}</dd></div>
          <div><dt>Guardian (emergency stop)</dt><dd>{R.guardian}</dd></div>
          <div><dt>Engine wallet</dt><dd>{R.engine}</dd></div>
          <div><dt>Mint price · starter</dt><dd>{L.mintPriceEth} ETH · {L.starterEth} ETH per agent</dd></div>
          <div><dt>Safety-net delay</dt><dd>48 hours</dd></div>
          <div><dt>Metadata</dt><dd>{L.baseUri}</dd></div>
        </dl>
      </section>

      <section className="tn-card">
        <h2>2 · Connect the Deployer wallet</h2>
        {!account ? (
          <div className="tn-row"><button type="button" className="tn-btn tn-primary" onClick={w.openModal}>Connect wallet</button><span className="tn-hint">Choose the Deployer account in your wallet.</span></div>
        ) : (
          <>
            <p className="mono">Connected: {account} {isDeployer ? <span className="up">✓ Deployer</span> : <span className="down">✕ not the Deployer: switch accounts in your wallet</span>}</p>
            {!chainOk && <div className="tn-row"><button type="button" className="tn-btn tn-primary" onClick={() => switchNetwork()}>Switch to Robinhood Chain</button></div>}
            {chainOk && <p className="mono tn-small">Balance {balance === null ? "…" : `${Number(formatEther(balance)).toFixed(5)} ETH`}{balance !== null && balance < parseEther("0.005") ? <span className="down"> · add at least 0.005 ETH for the deployment fees</span> : null}</p>}
          </>
        )}
      </section>

      {chainOk && (
        <section className="tn-card">
          <h2>3 · Checks</h2>
          <ul className="launch-checks">
            {checks.length === 0 && <li className="mono">Checking…</li>}
            {checks.map((c) => <li key={c.label}><span className={c.ok ? "up" : c.note?.startsWith("optional") ? "" : "down"}>{c.ok ? "✓" : c.note?.startsWith("optional") ? "–" : "✕"}</span> {c.label}{c.note && <small className="mono"> · {c.note}</small>}</li>)}
          </ul>
        </section>
      )}

      {chainOk && isDeployer && (
        <section className="tn-card">
          <h2>4 · Deploy</h2>
          <p>About {STEPS.length} confirmations in your wallet. If anything stops it halfway, click again: it carries on where it left off.</p>
          <ol className="launch-steps mono">
            {STEPS.map((s) => <li key={s.key} className={dep.done.includes(s.key) ? "done" : ""}>{dep.done.includes(s.key) ? "✓" : "○"} {s.label}</li>)}
          </ol>
          {!finished && <div className="tn-row"><button type="button" className="tn-btn tn-primary" onClick={run} disabled={busy || !preflightOk}>{busy ? "Deploying…" : dep.done.length ? `Continue (${dep.done.length}/${STEPS.length} done)` : "Deploy to mainnet"}</button>{!preflightOk && <span className="tn-hint">Waiting for the checks above.</span>}</div>}
          {error && <p className="notice">{error}</p>}
          {log.length > 0 && (
            <ul className="tn-log mono">
              {log.map((l, i) => <li key={i}>{l.state === "ok" ? "✓" : l.state === "err" ? "✕" : "…"} {l.label}{l.hash && <> · <a href={`${EXPLORER}/tx/${l.hash}`} target="_blank" rel="noreferrer">tx ↗</a></>}{l.note && <span className="down"> · {l.note}</span>}</li>)}
            </ul>
          )}
        </section>
      )}

      {finished && (
        <section className="tn-card">
          <h2>5 · Done: hand over to the Safe</h2>
          <ul className="launch-checks">
            {owners && Object.entries(owners).map(([k, o]) => <li key={k}><span className={o.toLowerCase() === R.safe.toLowerCase() ? "up" : "down"}>{o.toLowerCase() === R.safe.toLowerCase() ? "✓" : "✕"}</span> {k} owned by {o.toLowerCase() === R.safe.toLowerCase() ? "the Safe" : o}</li>)}
          </ul>
          <p>In the Safe app (app.safe.global → New transaction → Transaction Builder → enter address and choose "Custom data"), make these two transactions, each signed by both signers:</p>
          <ol className="launch-safe">
            {safeCalls.map((c) => (
              <li key={c.what}><b>{c.what}</b>
                <span className="mono">To: {c.to} <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(c.to)}>Copy</button></span>
                <span className="mono">Data: {short(c.data)} <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(c.data)}>Copy</button></span>
                <span className="mono">Value: 0</span>
              </li>
            ))}
          </ol>
          <p>Then send the team the deployment code below, so the site, the engine and the live Arena switch to mainnet.</p>
          <textarea className="tn-code mono" readOnly value={code} onFocus={(e) => e.currentTarget.select()} />
        </section>
      )}

      <section className="tn-card">
        <h2>6 · Agent coins: deployed by the agent wallet itself (version 3)</h2>
        <p>Agent wallet version 3 lets each agent launch its own coin by calling Pons directly (version 3 works with any Pons launch format and checks Pons's record after the launch; only the starter is ever locked, so the holder's own deposits stay withdrawable even after trading losses. If an earlier version 3 was proposed, deploy this one and propose it: it replaces the earlier proposal), so Pons records the <b>agent wallet as the coin&apos;s deployer and creator</b>. The Pons launch fee (0.0005 ETH) comes out of the agent&apos;s starter balance, and the agent can collect its coin&apos;s creator fees at any time, also during the 6-month lock. Holders switch their agent to version 3 with one click on its profile (nothing changes unless they do).</p>
        <p><b>Step 1.</b> Deploy agent wallet version 3 from the Deployer wallet.</p>
        {walletV2 ? (
          <>
            <p className="mono">Agent wallet version 3: <a href={`${EXPLORER}/address/${walletV2}`} target="_blank" rel="noreferrer">{walletV2}</a> <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(walletV2)}>Copy</button></p>
            <p><b>Step 2.</b> In the Safe, send these to the agent settings contract (each: To, Data, Value 0). Offering version 3 starts a new 48-hour notice. If coin launches are already switched on (Pons as launcher), skip the two coin-launch lines.</p>
            <ol className="launch-safe">
              {[
                { what: "Now: offer agent wallet version 3", data: encodeFunctionData({ abi: A("AgentConfig"), functionName: "propose", args: [4, walletV2] }) },
                { what: "Now (only if not done yet): coin launches go straight to Pons", data: encodeFunctionData({ abi: A("AgentConfig"), functionName: "propose", args: [2, L.ponsFactory] }) },
                { what: "After 48 hours: switch on version 3", data: encodeFunctionData({ abi: A("AgentConfig"), functionName: "execute", args: [4] }) },
                { what: "After 48 hours (only if not done yet): switch on coin launches", data: encodeFunctionData({ abi: A("AgentConfig"), functionName: "execute", args: [2] }) },
              ].map((c) => (
                <li key={c.what}><b>{c.what}</b>
                  <span className="mono">To: {MAINNET_DEPLOYMENT.config} <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(MAINNET_DEPLOYMENT.config)}>Copy</button></span>
                  <span className="mono">Data: {short(c.data)} <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(c.data)}>Copy</button></span>
                  <span className="mono">Value: 0</span>
                </li>
              ))}
            </ol>
            <p><b>Any time:</b> take the launch-fee money back from the old coin launcher (it&apos;s no longer needed).</p>
            <ol className="launch-safe">
              <li><b>Withdraw it to the Safe</b>
                <span className="mono">To: {OLD_COIN_LAUNCHER} <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(OLD_COIN_LAUNCHER)}>Copy</button></span>
                <span className="mono">Data: {short(oldWithdraw)} <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(oldWithdraw)}>Copy</button></span>
                <span className="mono">Value: 0 · takes back {oldBal === null ? "…" : formatEther(oldBal)} ETH</span>
              </li>
            </ol>
          </>
        ) : (
          <TextButton onClick={async () => {
            setBusy(true); setError(null);
            try { const a = await deploy("Agent wallet version 3", "TrenchersAgentAccountV3", [MAINNET_DEPLOYMENT.config, MAINNET_DEPLOYMENT.fund]); setWalletV2(a); try { localStorage.setItem("trenchers:walletV3b", a); } catch { /* */ } }
            catch (e) { setError(errText(e)); }
            setBusy(false);
          }} disabled={busy || !isDeployer || !chainOk}>Deploy agent wallet version 3</TextButton>
        )}
      </section>

      <section className="tn-card">
        <h2>7 · Agent coins on Programmable (agent wallet version 4)</h2>
        <p>Version 4 is version 3 plus one thing: the agent wallet can launch its own coin on <b>Programmable</b> (Module Mode), paired with <b>$TRENCHERS</b>, with any of Programmable&apos;s modules. The agent wallet itself is the coin&apos;s creator; its creator fees ($TRENCHERS) are collected through it and sent to the holder. The first buy is paid from the agent&apos;s free balance, never the locked starter. The wallet only accepts Programmable&apos;s launch factory {PG_FACTORY} and checks the coin&apos;s record afterwards (creator = the agent wallet, pair = $TRENCHERS). Holders switch with one click on their agent&apos;s profile; nothing changes unless they do.</p>
        <p><b>Step 1.</b> Deploy agent wallet version 4 from the Deployer wallet.</p>
        {walletV4 ? (
          <>
            <p className="mono">Agent wallet version 4: <a href={`${EXPLORER}/address/${walletV4}`} target="_blank" rel="noreferrer">{walletV4}</a> <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(walletV4)}>Copy</button></p>
            <p><b>Step 2.</b> In the Safe, send these to the agent settings contract (each: To, Data, Value 0). Offering version 4 starts a 48-hour notice; after that it shows to holders.</p>
            <ol className="launch-safe">
              {[
                { what: "Now: offer agent wallet version 4", data: encodeFunctionData({ abi: A("AgentConfig"), functionName: "propose", args: [4, walletV4] }) },
                { what: "After 48 hours: switch on version 4", data: encodeFunctionData({ abi: A("AgentConfig"), functionName: "execute", args: [4] }) },
              ].map((c) => (
                <li key={c.what}><b>{c.what}</b>
                  <span className="mono">To: {MAINNET_DEPLOYMENT.config} <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(MAINNET_DEPLOYMENT.config)}>Copy</button></span>
                  <span className="mono">Data: {short(c.data)} <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(c.data)}>Copy</button></span>
                  <span className="mono">Value: 0</span>
                </li>
              ))}
            </ol>
          </>
        ) : (<>
          <TextButton onClick={async () => {
            setBusy(true); setError(null); setV4Err(null);
            try { const a = await deploy("Agent wallet version 4", "TrenchersAgentAccountV4", [MAINNET_DEPLOYMENT.config, MAINNET_DEPLOYMENT.fund, PG_FACTORY, TRENCHERS_TOKEN, PG_LAUNCH_SELECTOR]); setWalletV4(a); try { localStorage.setItem("trenchers:walletV4", a); } catch { /* */ } }
            catch (e) { setV4Err(errText(e)); }
            setBusy(false);
          }} disabled={busy || !isDeployer || !chainOk}>Deploy agent wallet version 4</TextButton>
          {!isDeployer && <p className="muted-note">Connect the Deployer wallet ({R.deployer}) on Robinhood Chain to deploy.</p>}
          {isDeployer && !chainOk && <p className="muted-note">Switch your wallet to Robinhood Chain to deploy.</p>}
          {v4Err && <p className="notice">{v4Err}</p>}
          <p className="muted-note">Already deployed it (your wallet confirmed it, but the Safe steps didn&apos;t appear)? Paste its address from the explorer:</p>
          <p className="mono">
            <input className="tn-input" placeholder="0x… version 4 contract" value={v4Paste} onChange={(e) => setV4Paste(e.target.value)} style={{ width: "min(420px, 100%)" }} />{" "}
            <button type="button" className="tbtn" onClick={() => applyDeployedV4(v4Paste)}>Use this contract</button>
          </p>
        </>)}
      </section>
      <section className="tn-card">
        <h2>8 · Trenchers Inference Markets</h2>
        <p>Three small contracts with <b>no owner</b> (nothing to hand to the Safe): the <b>Inference desk</b>, where $TRENCHERS is paid for credit and which can only ever send it to the dead address; the <b>Inference router</b>, which turns ETH into $TRENCHERS through the Trenchers Pons adapter and delivers it to the desk in one transaction; and the <b>P2P market</b>, an escrowed order book for $TRENCHERS and agent coins against ETH, with no fee. Deploy them in this order from the Deployer wallet.</p>
        <ol className="launch-safe">
          {([
            ["desk", "Inference desk", "InferenceDesk", () => [TRENCHERS_TOKEN]],
            ["router", "Inference router", "InferenceRouter", (v: typeof inf) => [MAINNET_DEPLOYMENT.adapter, TRENCHERS_TOKEN, v.desk]],
            ["otc", "P2P market", "TrenchersOTC", () => []],
          ] as [keyof typeof inf, string, Name, (v: typeof inf) => unknown[]][]).map(([k, label, name, args], i) => (
            <li key={k}><b>{i + 1}. {label}</b>
              {inf[k] ? <span className="mono"><a href={`${EXPLORER}/address/${inf[k]}`} target="_blank" rel="noreferrer">{inf[k]}</a> <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(String(inf[k]))}>Copy</button></span>
                : <TextButton onClick={async () => {
                    setBusy(true); setInfErr(null);
                    try {
                      const block = inf.block ?? (await pub().getBlockNumber()).toString();
                      // the router buys through whatever route agents trade through today (AgentConfig.router)
                      const route = k === "router" ? await pub().readContract({ address: MAINNET_DEPLOYMENT.config as Address, abi: parseAbi(["function router() view returns (address)"]), functionName: "router" }).catch(() => MAINNET_DEPLOYMENT.adapter) : null;
                      const a = await deploy(label, name, route ? [route, TRENCHERS_TOKEN, inf.desk] : args(inf));
                      saveInf({ ...inf, block, [k]: a });
                    } catch (e) { setInfErr(errText(e)); }
                    setBusy(false);
                  }} disabled={busy || !isDeployer || !chainOk || (k === "router" && !inf.desk)}>Deploy {label.toLowerCase()}</TextButton>}
            </li>
          ))}
        </ol>
        {infErr && <p className="notice">{infErr}</p>}
        {inf.desk && inf.router && inf.otc && (<>
          <p><b>Then</b> add these variables to the <b>Mainnet</b> service on Railway (Variables tab), add a volume mounted at <span className="mono">/data</span>, and redeploy:</p>
          <pre className="mono launch-env">{[`ICM_DESK=${inf.desk}`, `ICM_ROUTER=${inf.router}`, `ICM_OTC=${inf.otc}`, `ICM_START_BLOCK=${inf.block}`, "ICM_FILE=/data/icm.log", "ICM_TOKENS_PER_USD=<whole $TRENCHERS per $1 of credit>", "ICM_MARGIN_BPS=<your margin in basis points, kept private>", "OPENROUTER_API_KEY=<your OpenRouter key>", "ICM_ADMIN_TOKEN=<a long random password>"].join("\n")}</pre>
          <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText([`ICM_DESK=${inf.desk}`, `ICM_ROUTER=${inf.router}`, `ICM_OTC=${inf.otc}`, `ICM_START_BLOCK=${inf.block}`, "ICM_FILE=/data/icm.log"].join("\n"))}>Copy the first five</button>
        </>)}
      </section>
      <section className="tn-card">
        <h2>9 · Trenchers V4 Builder</h2>
        <p>The launch system behind <span className="mono">/builder</span>: a <b>hook deployer</b>, the <b>launch factory</b> (pinned to Robinhood Chain&apos;s official Uniswap v4 contracts and WETH, checked by code hash) and <b>16 module factories</b>. None of them has an owner, so there is nothing to hand to the Safe. Any wallet can deploy them; the Deployer wallet is fine. The 0.3% fee on every trade is fixed in the code to the Trenchers buyback wallet.</p>
        <ol className="launch-safe">
          <li><b>1. Hook deployer</b>
            {vb.hookDeployer ? <span className="mono"><a href={`${EXPLORER}/address/${vb.hookDeployer}`} target="_blank" rel="noreferrer">{vb.hookDeployer}</a></span>
              : <TextButton onClick={async () => {
                  setBusy(true); setVbErr(null);
                  try {
                    const block = (await pub().getBlockNumber()).toString();
                    const r = await sendTx("V4 Builder hook deployer", (w, from) => w.deployContract({ abi: v4art.FoundationHookDeployerV2.abi as Abi, bytecode: v4art.FoundationHookDeployerV2.bytecode as `0x${string}`, account: from, chain }));
                    saveVb({ ...vb, block, hookDeployer: r.contractAddress! });
                  } catch (e) { setVbErr(errText(e)); }
                  setBusy(false);
                }} disabled={busy || !account || !chainOk}>Deploy hook deployer</TextButton>}
          </li>
          <li><b>2. Launch factory</b>
            {vb.factory ? <span className="mono"><a href={`${EXPLORER}/address/${vb.factory}`} target="_blank" rel="noreferrer">{vb.factory}</a></span>
              : <TextButton onClick={async () => {
                  setBusy(true); setVbErr(null);
                  try {
                    const code = await pub().getCode({ address: vb.hookDeployer! });
                    if (!code || code === "0x") throw new Error("The hook deployer isn't on-chain yet. Wait a few seconds and try again.");
                    const hashes = [V4.managerHash, V4.positionsHash, V4.routerHash, V4.permit2Hash, keccak256(code)];
                    const r = await sendTx("V4 Builder launch factory", (w, from) => w.deployContract({ abi: v4art.FoundationFactoryV3Native.abi as Abi, bytecode: v4art.FoundationFactoryV3Native.bytecode as `0x${string}`, args: [V4.manager, V4.positions, V4.router, V4.permit2, vb.hookDeployer, hashes], account: from, chain }));
                    saveVb({ ...vb, factory: r.contractAddress! });
                  } catch (e) { setVbErr(errText(e)); }
                  setBusy(false);
                }} disabled={busy || !account || !chainOk || !vb.hookDeployer}>Deploy launch factory</TextButton>}
          </li>
          <li><b>3. Module factories</b> <span className="mono">{Object.keys(vb.modules ?? {}).length}/{V4_MODULES.length}</span>
            {Object.keys(vb.modules ?? {}).length < V4_MODULES.length && <TextButton onClick={async () => {
                setBusy(true); setVbErr(null);
                let cur = { ...vb, modules: { ...(vb.modules ?? {}) } };
                try {
                  for (const [key, name] of V4_MODULES) {
                    if (cur.modules[key]) continue;
                    const art = v4art[name as keyof typeof v4art] as { abi: unknown; bytecode: string };
                    const r = await sendTx(`Module factory: ${key}`, (w, from) => w.deployContract({ abi: art.abi as Abi, bytecode: art.bytecode as `0x${string}`, account: from, chain }));
                    cur = { ...cur, modules: { ...cur.modules, [key]: r.contractAddress! } };
                    saveVb(cur);
                  }
                } catch (e) { setVbErr(errText(e)); }
                setBusy(false);
              }} disabled={busy || !account || !chainOk || !vb.factory}>{Object.keys(vb.modules ?? {}).length ? "Deploy the rest" : "Deploy all 16 (one confirmation each)"}</TextButton>}
          </li>
        </ol>
        {vbErr && <p className="notice">{vbErr}</p>}
        {vb.factory && vb.hookDeployer && Object.keys(vb.modules ?? {}).length === V4_MODULES.length && (() => {
          const env = [`V4_FACTORY=${vb.factory}`, `V4_HOOK_DEPLOYER=${vb.hookDeployer}`, `V4_MODULES=${JSON.stringify(vb.modules)}`, `V4_START_BLOCK=${vb.block}`].join("\n");
          return (<>
            <p><b>Then</b> add these variables to the <b>Mainnet</b> service on Railway (Variables tab) and redeploy. The builder page opens for launches as soon as the engine reports them.</p>
            <pre className="mono launch-env">{env}</pre>
            <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(env)}>Copy all four</button>
          </>);
        })()}
      </section>
    </div>
  );
}
