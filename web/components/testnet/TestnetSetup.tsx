"use client";
import { useCallback, useEffect, useState } from "react";
import {
  createPublicClient, createWalletClient, custom, fallback, formatEther, http, parseAbi, keccak256, parseEther, toHex, zeroHash,
  type Abi, type Address, type EIP1193Provider, type Hash, type PublicClient, type WalletClient,
} from "viem";
import { robinhoodTestnet } from "viem/chains";
import artifacts from "@/lib/testnet/artifacts.json";
import { TESTNET_DEPLOYMENT } from "@/lib/testnet/deployment";
import { chooseAccount, revoke, waitForWallet, type InjectedWallet } from "@/lib/eip6963";
import { WalletPicker } from "@/components/WalletPicker";
import { STRATEGIES } from "@/lib/strategies";

/**
 * Testnet console: deploys the whole Trenchers system from the connected wallet, mints a test
 * collection into a stand-in shop, and lets any wallet buy, awaken and manage a Trencher.
 * Testnet runs at one hundredth of mainnet prices (0.0002 ETH, 0.0001 ETH to the agent), same 50% split.
 * The page reads the actual price from the deployed contract, so older test deployments keep working.
 */

type Name = keyof typeof artifacts;
const A = (n: Name) => artifacts[n].abi as Abi;
const chain = robinhoodTestnet;
const EXPLORER = chain.blockExplorers.default.url;
const PRICE = parseEther("0.0002");
const CLAIM = parseEther("0.0001");
const eth = (v: bigint) => Number(formatEther(v)).toString();
/** Testnet safety-net delay: 10 minutes so a full rescue can be tried today (48 hours on mainnet). */
const RESCUE_DELAY = 600;
const CANONICAL_REGISTRY = "0x000000006551c19487814612e58FE06813775758" as Address;
const PONS_ROUTER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948" as Address;
const META = "https://trenchers.io/testnet-meta/";
const STORE = "trenchers-testnet-deployment";

type Dep = {
  chainId: number; version?: number; owner?: Address; registry?: Address; splitter?: Address; nft?: Address;
  fund?: Address; config?: Address; impl?: Address; dist?: Address; launchpad?: Address; adapter?: Address; startBlock?: string; done: string[];
};
type Log = { label: string; state: "wait" | "ok" | "err"; hash?: Hash; note?: string };

const WALLET_KEY = "trenchers-wallet-rdns";
/** Bumped when the contracts change in a way the page relies on (5 = adds the safety net: timelocked rescue, sweeps). */
const CONTRACTS_VERSION = 5;
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const errText = (e: unknown) => {
  const x = e as { shortMessage?: string; message?: string };
  return (x.shortMessage ?? x.message ?? String(e)).split("\n")[0];
};
/** Plain-English reasons for the contracts' custom errors, shown before the wallet even opens. */
const REASONS: Record<string, string> = {
  SoldOut: "All Trenchers have been minted.",
  MintClosed: "The mint isn't open yet. The team wallet opens it in step 1.",
  TooMany: "You can mint up to 10 at a time.",
  WrongPrice: "The price doesn't match the mint price. Refresh the page and try again.",
  NotHolder: "Only the wallet that owns this Trencher can do that. Switch to that wallet in MetaMask.",
  AlreadyClaimed: "This Trencher is already awake.",
  Underfunded: "The starter fund doesn't hold enough ETH yet. Buy a Trencher first: half of the price funds it.",
  NotOpen: "Awakening isn't open yet: the setup didn't finish. Continue the setup in step 1 with the team wallet.",
  NotEligible: "House agents (#1 to #5) don't have a starter balance to claim.",
  StarterLocked: "That's more than you can withdraw: the starter balance from awakening is locked in the agent for 6 months. Everything above it can be withdrawn at once.",
  NoWithdrawal: "Enter an amount to withdraw.",
  OwnableUnauthorizedAccount: "Only the team wallet that deployed the contracts can do that.",
  ZeroQuantity: "Enter how many to mint (at least 1).",
};
export function reason(e: unknown): string {
  let cur = e as { name?: string; data?: { errorName?: string }; cause?: unknown; shortMessage?: string; message?: string; walk?: unknown } | undefined;
  for (let i = 0; cur && i < 8; i++) {
    const n = cur.data?.errorName;
    if (n) return REASONS[n] ?? (/transfer|validator|operator/i.test(n) ? "The NFT's transfer rules blocked this transfer. Send me this error name: " + n : `The contract refused: ${n}.`);
    cur = cur.cause as typeof cur;
  }
  const t = errText(e);
  if (/insufficient funds/i.test(t)) return "Not enough test ETH in this wallet for this transaction plus its fee.";
  if (/user rejected|denied/i.test(t)) return "Cancelled in the wallet.";
  return t;
}

const loadDep = (): Dep => {
  if (TESTNET_DEPLOYMENT) return { ...TESTNET_DEPLOYMENT, done: ["all"] } as Dep;
  try { const d = JSON.parse(localStorage.getItem(STORE) || "null"); if (d?.chainId === chain.id) return d; } catch {}
  return { chainId: chain.id, done: [] };
};
const saveDep = (d: Dep) => { try { localStorage.setItem(STORE, JSON.stringify(d)); } catch {} };

export function TestnetSetup() {
  const [account, setAccount] = useState<Address | null>(null);
  const [chainOk, setChainOk] = useState(false);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [dep, setDep] = useState<Dep>({ chainId: chain.id, done: [] });
  const [logs, setLogs] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<{ label: string; phase: "sign" | "chain" | "done" | "error"; note?: string } | null>(null);
  useEffect(() => {
    if (task?.phase !== "done" && task?.phase !== "error") return;
    const t = setTimeout(() => setTask(null), task.phase === "done" ? 2200 : 6000);
    return () => clearTimeout(t);
  }, [task]);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ supply: bigint; fund: bigint; open: boolean; price: bigint; claim: bigint } | null>(null);
  const [qty, setQty] = useState(1);
  const [mine, setMine] = useState<number[] | null>(null);
  const [pons, setPons] = useState<boolean | null>(null);
  const [paste, setPaste] = useState("");
  const [tick, setTick] = useState(0);
  const [wallet, setWallet] = useState<InjectedWallet | null>(null);
  const [picker, setPicker] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);
  const prov = wallet?.provider ?? null;

  useEffect(() => { setDep(loadDep()); }, []);

  const clients = useCallback((): { wallet: WalletClient; pub: PublicClient } => {
    if (!prov) throw new Error("Connect a wallet first.");
    return {
      wallet: createWalletClient({ chain, transport: custom(prov) }),
      pub: createPublicClient({ chain, transport: fallback([custom(prov), http()]) }) as PublicClient,
    };
  }, [prov]);

  const refreshAccount = useCallback(async () => {
    if (!prov) { setAccount(null); setChainOk(false); setBalance(null); return; }
    const accs = (await prov.request({ method: "eth_accounts" })) as Address[];
    const id = Number(await prov.request({ method: "eth_chainId" }));
    setAccount(accs[0] ?? null);
    setChainOk(id === chain.id);
    if (accs[0] && id === chain.id) setBalance(await clients().pub.getBalance({ address: accs[0] }).catch(() => null));
    else setBalance(null);
  }, [prov, clients]);

  // Reconnect quietly to the wallet used last time (no popup).
  useEffect(() => {
    let rdns: string | null = null;
    try { rdns = localStorage.getItem(WALLET_KEY); } catch {}
    if (!rdns) { setRestoring(false); return; }
    waitForWallet(rdns).then(async (w) => {
      if (w) {
        const accs = (await w.provider.request({ method: "eth_accounts" }).catch(() => [])) as Address[];
        if (accs.length) setWallet(w);
      }
      setRestoring(false);
    });
  }, []);

  useEffect(() => {
    if (!prov) { refreshAccount(); return; }
    refreshAccount();
    const onAcc = (a: unknown) => { if (Array.isArray(a) && a.length === 0) { disconnect(); return; } refreshAccount(); setTick((t) => t + 1); };
    const onChain = () => { refreshAccount(); setTick((t) => t + 1); };
    prov.on?.("accountsChanged", onAcc as never); prov.on?.("chainChanged", onChain as never);
    return () => { prov.removeListener?.("accountsChanged", onAcc as never); prov.removeListener?.("chainChanged", onChain as never); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prov]);

  const connectWith = async (w: InjectedWallet) => {
    setError(null); setPending(w.info.rdns);
    try {
      await w.provider.request({ method: "eth_requestAccounts" });
      try { localStorage.setItem(WALLET_KEY, w.info.rdns); } catch {}
      setWallet(w); setPicker(false);
      const id = Number(await w.provider.request({ method: "eth_chainId" }));
      if (id !== chain.id) await switchNetwork(w.provider);
    } catch (e) { setError(reason(e)); }
    setPending(null);
  };

  const disconnect = async () => {
    if (prov) await revoke(prov);
    try { localStorage.removeItem(WALLET_KEY); } catch {}
    setWallet(null); setAccount(null); setChainOk(false); setBalance(null); setMine(null);
  };

  const switchAccount = async () => {
    if (!prov) return;
    setError(null);
    try { await chooseAccount(prov); await refreshAccount(); setTick((t) => t + 1); } catch (e) { setError(reason(e)); }
  };

  const switchNetwork = async (target?: EIP1193Provider) => {
    setError(null);
    const p = target ?? prov; if (!p) return;
    const hex = toHex(chain.id);
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code === 4902 || code === -32603 || /unrecognized|not added|unknown chain/i.test(errText(e))) {
        try {
          await p.request({ method: "wallet_addEthereumChain", params: [{
            chainId: hex, chainName: "Robinhood Chain Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: [chain.rpcUrls.default.http[0]], blockExplorerUrls: [EXPLORER],
          }] });
        } catch (e2) { setError(errText(e2)); }
      } else setError(reason(e));
    }
    await refreshAccount();
  };

  // ---------------------------------------------------------------- transactions
  const pushLog = (l: Log) => setLogs((ls) => [...ls, l]);
  const patchLast = (p: Partial<Log>) => setLogs((ls) => ls.map((l, i) => (i === ls.length - 1 ? { ...l, ...p } : l)));

  const sendTx = async (label: string, fn: (w: WalletClient, from: Address) => Promise<Hash>) => {
    const { wallet, pub } = clients();
    if (!account) throw new Error("Connect your wallet first.");
    pushLog({ label, state: "wait" });
    setTask({ label, phase: "sign" });
    try {
      const hash = await fn(wallet, account);
      patchLast({ hash });
      setTask({ label, phase: "chain" });
      const r = await pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") { patchLast({ state: "err", note: "reverted" }); throw new Error(`${label} failed on-chain.`); }
      patchLast({ state: "ok" });
      setTask({ label, phase: "done" });
      return r;
    } catch (e) {
      setTask({ label, phase: "error", note: reason(e) });
      throw e;
    }
  };
  const deploy = async (label: string, name: Name, args: unknown[]) => {
    const r = await sendTx(label, (w, from) => w.deployContract({ abi: A(name), bytecode: artifacts[name].bytecode as `0x${string}`, args, account: from, chain }));
    if (!r.contractAddress) throw new Error(`${label}: no contract address in the receipt.`);
    return r.contractAddress;
  };
  const write = async (label: string, address: Address, name: Name, functionName: string, args: unknown[] = [], value?: bigint) => {
    if (!account) throw new Error("Connect your wallet first.");
    // Dry run first: if it would fail, say why in plain words instead of opening the wallet.
    try { await clients().pub.simulateContract({ address, abi: A(name), functionName, args, account, value }); }
    catch (e) { const why = reason(e); setTask({ label, phase: "error", note: why }); throw new Error(why); }
    return sendTx(label, (w, from) => w.writeContract({ address, abi: A(name), functionName, args, account: from, chain, value }));
  };
  const send = (label: string, to: Address, value: bigint) =>
    sendTx(label, (w, from) => w.sendTransaction({ to, value, account: from, chain }));
  const read = async <T,>(address: Address, name: Name, functionName: string, args: unknown[] = []) =>
    (await clients().pub.readContract({ address, abi: A(name), functionName, args })) as T;

  // ---------------------------------------------------------------- deploy
  const STEPS: { key: string; label: string; run: (d: Dep, me: Address) => Promise<Partial<Dep>> }[] = [
    { key: "registry", label: "Agent wallet registry (ERC-6551)", run: async () => {
      const startBlock = (await clients().pub.getBlockNumber()).toString();
      const code = await clients().pub.getCode({ address: CANONICAL_REGISTRY });
      if (code && code !== "0x") { pushLog({ label: "Agent wallet registry: already on this network", state: "ok" }); return { registry: CANONICAL_REGISTRY, startBlock }; }
      return { registry: await deploy("Agent wallet registry (ERC-6551)", "MockERC6551Registry", []), startBlock };
    } },
    { key: "splitter", label: "Revenue splitter", run: async (_d, me) => ({ splitter: await deploy("Revenue splitter", "RevenueSplitter", [me, me, BigInt(Math.floor(Date.now() / 1000))]) }) },
    { key: "nft", label: "Trenchers NFT", run: async (d, me) => ({ nft: await deploy("Trenchers NFT", "TrenchersNFT", [d.splitter, me, "", `${META}contract.json`, PRICE]) }) },
    { key: "fund", label: "Agent Starter Fund", run: async (d, me) => ({ fund: await deploy("Agent Starter Fund", "AgentStarterFund", [me, d.nft, d.registry, CLAIM, BigInt(RESCUE_DELAY)]) }) },
    { key: "config", label: "Agent settings", run: async (_d, me) => ({ config: await deploy("Agent settings", "AgentConfig", [me]) }) },
    { key: "impl", label: "Agent wallet", run: async (d) => ({ impl: await deploy("Agent wallet", "TrenchersAgentAccount", [d.config]) }) },
    { key: "dist", label: "Fee distributor", run: async (d, me) => ({ dist: await deploy("Fee distributor", "AgentFeeDistributor", [me, d.registry, d.nft, BigInt(RESCUE_DELAY)]) }) },
    { key: "cfgFund", label: "Link settings to the starter fund", run: async (d) => { await write("Link settings to the starter fund", d.config!, "AgentConfig", "propose", [3, d.fund]); return {}; } },
    { key: "nftFund", label: "Link NFT to the starter fund (grey / colour)", run: async (d) => { await write("Link NFT to the starter fund (grey / colour)", d.nft!, "TrenchersNFT", "setStarterFund", [d.fund]); return {}; } },
    { key: "fundAcct", label: "Open awakening", run: async (d) => { await write("Open awakening", d.fund!, "AgentStarterFund", "setAccount", [d.impl, zeroHash]); return {}; } },
    { key: "distAcct", label: "Link fee distributor to agent wallets", run: async (d) => { await write("Link fee distributor to agent wallets", d.dist!, "AgentFeeDistributor", "setAccount", [d.impl, zeroHash]); return {}; } },
    { key: "seller", label: "Count mints as first sales", run: async (d) => { await write("Count mints as first sales", d.splitter!, "RevenueSplitter", "setPrimarySeller", [d.nft]); return {}; } },
    { key: "starterDest", label: "Send the 50% to the starter fund", run: async (d) => { await write("Send the 50% to the starter fund", d.splitter!, "RevenueSplitter", "proposeDestination", [3, d.fund]); return {}; } },
    { key: "baseUri", label: "Point the NFT at trenchers.io metadata", run: async (d) => { await write("Point the NFT at trenchers.io metadata", d.nft!, "TrenchersNFT", "setBaseURI", [META]); return {}; } },
    { key: "openMint", label: "Open the mint", run: async (d) => { await write("Open the mint", d.nft!, "TrenchersNFT", "setMintOpen", [true]); return {}; } },
    // Trading: a test launchpad (Pons's testnet version isn't public) and the adapter agents trade through.
    { key: "launchpad", label: "Test coin launchpad", run: async () => ({ launchpad: await deploy("Test coin launchpad", "MockPonsFactory", []) }) },
    { key: "adapter", label: "Trading adapter", run: async (d, me) => ({ adapter: await deploy("Trading adapter", "PonsAdapter", [d.launchpad, me]) }) },
    { key: "cfgRouter", label: "Let agents trade through the adapter", run: async (d) => { await write("Let agents trade through the adapter", d.config!, "AgentConfig", "propose", [1, d.adapter]); return {}; } },
  ];
  const deployed = dep.done.includes("all") || STEPS.every((s) => dep.done.includes(s.key)) || ((dep.version ?? 1) < CONTRACTS_VERSION && dep.done.length > 10);
  const ready = deployed && !!dep.nft && !!dep.fund && (dep.version ?? 1) >= CONTRACTS_VERSION;

  const runDeploy = async () => {
    if (!account) return;
    setBusy(true); setError(null);
    let d: Dep = dep.owner && dep.owner.toLowerCase() !== account.toLowerCase() && !deployed ? { chainId: chain.id, done: [] } : { ...dep };
    d.owner ??= account;
    d.version ??= CONTRACTS_VERSION;
    try {
      for (const s of STEPS) {
        if (d.done.includes(s.key)) continue;
        const patch = await s.run(d, account);
        d = { ...d, ...patch, done: [...d.done, s.key] };
        setDep(d); saveDep(d);
      }
    } catch (e) { setError(reason(e)); patchLast({ state: "err" }); }
    setBusy(false); await refreshAccount(); setTick((t) => t + 1);
  };

  const getRule = async (wallet: Address, version: number) => {
    const key = `trenchers-rule-${wallet.toLowerCase()}-${version}`;
    try {
      const logs = await clients().pub.getContractEvents({ address: wallet, abi: A("TrenchersAgentAccount"), eventName: "RuleApplied", fromBlock: 0n });
      const hit = [...logs].reverse().find((l) => Number((l as unknown as { args: { version: number } }).args.version) === version);
      const uri = (hit as unknown as { args?: { ruleUri?: string } } | undefined)?.args?.ruleUri;
      if (uri) { try { localStorage.setItem(key, uri); } catch {} return uri; }
    } catch { /* fall back to the copy saved in this browser */ }
    try { return localStorage.getItem(key); } catch { return null; }
  };

  const resetDeployment = () => {
    const d: Dep = { chainId: chain.id, done: [] };
    setDep(d); saveDep(d); setStats(null); setMine(null); setLogs([]);
  };

  const toggleMint = async () => {
    if (!dep.nft || !stats) return;
    setBusy(true); setError(null);
    try { await write(stats.open ? "Pausing the mint" : "Opening the mint", dep.nft, "TrenchersNFT", "setMintOpen", [!stats.open]); }
    catch (e) { setError(reason(e)); }
    setBusy(false); setTick((t) => t + 1);
  };

  const mintNft = async () => {
    if (!dep.nft) return;
    setBusy(true); setError(null);
    try { await write(`Minting ${qty} Trencher${qty > 1 ? "s" : ""} (${Number(formatEther((stats?.price ?? PRICE) * BigInt(qty)))} ETH)`, dep.nft, "TrenchersNFT", "mint", [BigInt(qty)], (stats?.price ?? PRICE) * BigInt(qty)); }
    catch (e) { setError(reason(e)); }
    setBusy(false); setTick((t) => t + 1); refreshAccount();
  };

  // ---------------------------------------------------------------- reads
  useEffect(() => {
    if (!chainOk || !ready) { setStats(null); return; }
    let live = true;
    (async () => {
      try {
        const [supply, open] = await Promise.all([read<bigint>(dep.nft!, "TrenchersNFT", "totalSupply"), read<boolean>(dep.nft!, "TrenchersNFT", "mintOpen")]);
        const fund = await clients().pub.getBalance({ address: dep.fund! });
        const price = await read<bigint>(dep.nft!, "TrenchersNFT", "mintPrice").catch(() => PRICE);
        const claim = await read<bigint>(dep.fund!, "AgentStarterFund", "CLAIM").catch(() => CLAIM);
        if (live) setStats({ supply, fund, open, price, claim });
        if (account) {
          const ids = Array.from({ length: Number(supply) }, (_, i) => i + 1);
          const owners: (string | null)[] = [];
          for (let i = 0; i < ids.length; i += 25) {
            const chunk = ids.slice(i, i + 25);
            owners.push(...(await Promise.all(chunk.map((id) => read<Address>(dep.nft!, "TrenchersNFT", "ownerOf", [BigInt(id)]).catch(() => null)))));
          }
          if (live) setMine(ids.filter((_, i) => owners[i]?.toLowerCase() === account.toLowerCase()));
        }
        const code = await clients().pub.getCode({ address: PONS_ROUTER });
        if (live) setPons(!!code && code !== "0x");
      } catch (e) { if (live) setError(reason(e)); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainOk, ready, account, tick, dep.nft, dep.fund]);

  const code = JSON.stringify({ chainId: dep.chainId, owner: dep.owner, registry: dep.registry, splitter: dep.splitter, nft: dep.nft, fund: dep.fund, launchpad: dep.launchpad, adapter: dep.adapter, startBlock: dep.startBlock, config: dep.config, impl: dep.impl, dist: dep.dist });
  const isOwner = !!account && !!dep.owner && account.toLowerCase() === dep.owner.toLowerCase();

  const loadPasted = () => {
    try {
      const d = JSON.parse(paste);
      if (d.chainId !== chain.id || !d.nft || !d.fund) throw new Error("That doesn't look like a Trenchers testnet deployment code.");
      const nd: Dep = { ...d, done: ["all"] }; setDep(nd); saveDep(nd); setPaste(""); setTick((t) => t + 1);
    } catch (e) { setError(reason(e)); }
  };

  return (
    <div className="tn">
      <header className="tn-head">
        <span className="mono eyebrow">Testnet · Robinhood Chain</span>
        <h1>Try Trenchers on testnet</h1>
        <p>Everything here runs on Robinhood Chain testnet with free test ETH, at one hundredth of the real prices: a Trencher costs <b>0.0002 ETH</b> and <b>0.0001 ETH</b> goes into its agent wallet when you awaken it. Same 50/50 split as mainnet.</p>
      </header>

      <section className="tn-card">
        <h2><span className="tn-n mono">0</span>Your wallet</h2>
        {!account ? (
          <div className="tn-row">
            <button type="button" className="tn-btn tn-primary" onClick={() => setPicker(true)} disabled={restoring}>{restoring ? "Reconnecting…" : "Connect wallet"}</button>
            <span className="tn-hint">MetaMask, Phantom, Rabby or any browser wallet.</span>
          </div>
        ) : (
          <div className="tn-row">
            <span className="mono tn-acct">
              {wallet?.info.icon ? <img src={wallet.info.icon} alt="" width={18} height={18} /> : <i className={`dot${chainOk ? "" : " dot-demo"}`} />}
              {short(account)}{balance !== null && <> · {Number(formatEther(balance)).toFixed(5)} ETH</>}
            </span>
            {chainOk ? <span className="mono tn-ok">✓ Robinhood Chain Testnet</span> : <button type="button" className="tn-btn tn-primary" onClick={() => switchNetwork()}>Switch to Robinhood testnet</button>}
            <span className="tn-spacer" />
            <button type="button" className="tn-btn" onClick={switchAccount}>Switch account</button>
            <button type="button" className="tn-btn" onClick={disconnect}>Disconnect</button>
          </div>
        )}
      </section>

      <section className={`tn-card${!account || !chainOk ? " tn-off" : ""}`}>
        <h2><span className="tn-n mono">1</span>Set up the contracts <small className="mono">team wallet · once</small></h2>
        {deployed ? (
          <>
            {(dep.version ?? 1) < CONTRACTS_VERSION && !TESTNET_DEPLOYMENT && (
              <div className="tn-fix">
                <p><b>Newer contracts available.</b> This test deployment is from an older version. Start a fresh one with the team wallet to test the latest version (a few minutes, a little test ETH).</p>
                <button type="button" className="tn-btn" onClick={resetDeployment} disabled={busy}>Start a fresh test deployment</button>
              </div>
            )}
            {ready && <p className="tn-done">✓ Deployed{dep.owner ? <> by <span className="mono">{short(dep.owner)}</span></> : null}. {stats && <>Minted <b>{stats.supply.toString()}</b> of 2,000 (5 house agents included), starter fund holds <b>{Number(formatEther(stats.fund)).toFixed(5)} ETH</b>. Mint is <b>{stats.open ? "open" : "paused"}</b>.</>}</p>}
            {isOwner && stats && ready && (
              <div className="tn-row"><button type="button" className="tn-btn" onClick={toggleMint} disabled={busy}>{stats.open ? "Pause the mint" : "Open the mint"}</button></div>
            )}
            <details className="tn-details"><summary className="mono">Deployment code (send this to the team)</summary>
              <textarea className="tn-code mono" readOnly value={code} onFocus={(e) => e.currentTarget.select()} />
              <ul className="tn-addrs mono">
                {(["nft", "fund", "splitter", "config", "impl", "dist", "registry", "launchpad", "adapter"] as const).map((k) => dep[k] && <li key={k}>{k}: <a href={`${EXPLORER}/address/${dep[k]}`} target="_blank" rel="noreferrer">{dep[k]}</a></li>)}
              </ul>
            </details>
          </>
        ) : (
          <>
            <p>Puts every Trenchers contract on the testnet from your wallet: the NFT, the revenue split, the Agent Starter Fund, the agent wallet, and the fee distributor, then opens the mint. Your wallet asks you to confirm about 15 times; it costs a tiny bit of test ETH. If it stops halfway, click again and it carries on where it left off.</p>
            <div className="tn-row">
              <button type="button" className="tn-btn tn-primary" onClick={runDeploy} disabled={busy || !account || !chainOk}>{dep.done.length ? `Continue setup (${dep.done.length}/${STEPS.length} done)` : "Deploy"}</button>
            </div>
            <details className="tn-details"><summary className="mono">Already deployed on another device? Paste the deployment code</summary>
              <div className="tn-row"><input className="tn-in tn-wide mono" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder='{"chainId":46630,...}' /><button type="button" className="tn-btn" onClick={loadPasted}>Load</button></div>
            </details>
          </>
        )}
      </section>

      <section className={`tn-card${!ready || !chainOk ? " tn-off" : ""}`}>
        <h2><span className="tn-n mono">2</span>Mint a Trencher <small className="mono">buyer wallet</small></h2>
        <p>This is the mint people will use on trenchers.io. Switch to your second wallet, pick how many and mint. Half of what you pay goes straight into the Agent Starter Fund, waiting for your agent.</p>
        <div className="tn-mint">
          <div className="tn-qty">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="One less">−</button>
            <span className="mono">{qty}</span>
            <button type="button" onClick={() => setQty((q) => Math.min(10, q + 1))} disabled={qty >= 10} aria-label="One more">+</button>
          </div>
          <button type="button" className="tn-btn tn-primary tn-mint-btn" onClick={mintNft} disabled={busy || !ready || !chainOk || !stats?.open}>Mint {qty} for {Number(formatEther((stats?.price ?? PRICE) * BigInt(qty)))} ETH</button>
          {stats && <div className="tn-progress"><span className="mono">{stats.supply.toString()} / 2,000 minted</span><i style={{ width: `${Math.min(100, Number(stats.supply) / 20)}%` }} /></div>}
        </div>
        {stats && !stats.open && <p className="tn-hint">The mint is paused. The team wallet opens it in step 1.</p>}
      </section>

      <section className={`tn-card${!ready || !chainOk ? " tn-off" : ""}`}>
        <h2><span className="tn-n mono">3</span>Your Trenchers</h2>
        {mine === null ? <p className="tn-hint">Connect a wallet to see your Trenchers.</p> : mine.length === 0 ? <p className="tn-hint">This wallet has no Trenchers yet. Mint one above.</p> : (
          <div className="tn-grid">
            {mine.map((id) => <TokenCard key={id} tick={tick} id={id} dep={dep} account={account!} write={write} send={send} read={read} getBalance={(a) => clients().pub.getBalance({ address: a })} getRule={getRule} claim={stats?.claim ?? CLAIM} onDone={() => { setTick((t) => t + 1); refreshAccount(); }} setError={setError} busy={busy} setBusy={setBusy} pons={pons} />)}
          </div>
        )}
      </section>

      {task && (
        <div className={`tn-task tn-task-${task.phase}`} role="status" aria-live="polite">
          <div className="tn-task-ico">
            {task.phase === "sign" ? <span className="tn-task-wallet" /> : task.phase === "chain" ? <span className="tn-task-blocks"><i /><i /><i /></span> : task.phase === "done" ? <span className="tn-task-check">✓</span> : <span className="tn-task-x">!</span>}
          </div>
          <div className="tn-task-txt">
            <b>{task.label}</b>
            <span>{task.phase === "sign" ? "Confirm in your wallet…" : task.phase === "chain" ? "Processing on Robinhood Chain…" : task.phase === "done" ? "Done" : task.note}</span>
          </div>
          {task.phase === "chain" && <span className="tn-task-bar" />}
        </div>
      )}

      {picker && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !pending && setPicker(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tn-pick">
            <div className="modal-head"><h2 id="tn-pick">Choose a wallet</h2><button type="button" className="tbtn" onClick={() => setPicker(false)}>Close</button></div>
            <div className="modal-body">
              <WalletPicker onPick={connectWith} pending={pending} />
              {error && <p className="modal-error">{error}</p>}
            </div>
          </div>
        </div>
      )}

      {account && chainOk && ready && dep.adapter && <Trading dep={dep} account={account} isOwner={isOwner} read={read} write={write} tick={tick} onDone={() => setTick((t) => t + 1)} setError={setError} busy={busy} setBusy={setBusy} />}
      {account && chainOk && ready && isOwner && <SafetyNet dep={dep} account={account} read={read} write={write} getBalance={(a) => clients().pub.getBalance({ address: a })} chainTime={async () => Number((await clients().pub.getBlock()).timestamp)} tick={tick} onDone={() => { setTick((t) => t + 1); refreshAccount(); }} setError={setError} busy={busy} setBusy={setBusy} />}
      {account && chainOk && <Rescue account={account} clients={clients} sendTx={sendTx} setError={setError} />}

      {(logs.length > 0 || error) && (
        <section className="tn-card tn-log">
          <h2>Transactions</h2>
          {error && <p className="notice">{error}</p>}
          <ol className="mono">
            {logs.map((l, i) => (
              <li key={i} className={`tn-l-${l.state}`}>
                <span>{l.state === "ok" ? "✓" : l.state === "err" ? "✕" : <span className="spin" />}</span> {l.label}
                {l.hash && <a href={`${EXPLORER}/tx/${l.hash}`} target="_blank" rel="noreferrer">{short(l.hash)} ↗</a>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

type WriteFn = (label: string, address: Address, name: Name, functionName: string, args?: unknown[], value?: bigint) => Promise<unknown>;
type ReadFn = <T>(address: Address, name: Name, functionName: string, args?: unknown[]) => Promise<T>;

const TEMPLATES = STRATEGIES.filter((x) => x.name !== "Custom").map((x) => ({ name: x.name, text: `${x.trigger}. ${x.exit}.` }));
const LOCK_DAYS = 180;

function TokenCard({ id, tick, dep, account, write, send, read, getBalance, getRule, claim, onDone, setError, busy, setBusy, pons }: {
  id: number; tick: number; dep: Dep; account: Address; write: WriteFn; send: (label: string, to: Address, value: bigint) => Promise<unknown>; read: ReadFn;
  getBalance: (a: Address) => Promise<bigint>; getRule: (wallet: Address, version: number) => Promise<string | null>; claim: bigint;
  onDone: () => void; setError: (s: string | null) => void; busy: boolean; setBusy: (b: boolean) => void; pons: boolean | null;
}) {
  type St = { awake: boolean; deployed?: boolean; wallet?: Address; bal?: bigint; locked?: bigint; free?: bigint; rules?: number; lockedAt?: bigint; ruleText?: string | null };
  const [s, setS] = useState<St | null>(null);
  const [depAmt, setDepAmt] = useState("0.0001");
  const [wdAmt, setWdAmt] = useState("");
  const [rule, setRule] = useState("");
  const house = id <= 5;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const awake = house || (await read<boolean>(dep.fund!, "AgentStarterFund", "claimed", [BigInt(id)]));
        if (!awake) { if (live) setS({ awake }); return; }
        const wallet = await read<Address>(dep.fund!, "AgentStarterFund", "agentWallet", [BigInt(id)]);
        const bal = await getBalance(wallet);
        const next: St = { awake, deployed: true, wallet, bal, locked: 0n, free: bal, rules: 0, lockedAt: 0n };
        try {
          next.locked = await read<bigint>(wallet, "TrenchersAgentAccount", "lockedNow");
          next.free = await read<bigint>(wallet, "TrenchersAgentAccount", "withdrawable");
          next.rules = Number(await read<number>(wallet, "TrenchersAgentAccount", "ruleVersion"));
          next.lockedAt = await read<bigint>(wallet, "TrenchersAgentAccount", "starterLockedAt");
          if (next.rules > 0) next.ruleText = await getRule(wallet, next.rules);
        } catch { next.deployed = false; /* house agents get their wallet created on request */ }
        if (live) setS(next);
      } catch (e) { if (live) setError(reason(e)); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tick]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(reason(e)); }
    setBusy(false); onDone();
  };
  const awaken = () => act(async () => {
    // If the fund is short because a mint's starter share is still waiting in the splitter, move it first.
    const fundBal = await getBalance(dep.fund!);
    if (fundBal < claim && dep.splitter) {
      const owed = await read<bigint>(dep.splitter, "RevenueSplitter", "owed", [3]);
      if (owed > 0n) await write("Moving the starter share into the fund", dep.splitter, "RevenueSplitter", "release", [3]);
    }
    await write(`Awakening Trencher #${id}`, dep.fund!, "AgentStarterFund", "claim", [BigInt(id)]);
  });
  const deposit = () => act(() => send(`Depositing ${depAmt} ETH into #${id}`, s!.wallet!, parseEther(depAmt || "0")));
  const withdraw = () => act(async () => {
    const v = parseEther(wdAmt || "0");
    if (s?.free !== undefined && v > s.free) throw new Error(REASONS.StarterLocked);
    await write(`Withdrawing ${wdAmt} ETH from #${id}`, s!.wallet!, "TrenchersAgentAccount", "withdraw", [v]);
    setWdAmt("");
  });
  const applyRule = () => act(async () => {
    const text = rule.trim().slice(0, 500);
    try { localStorage.setItem(`trenchers-rule-${s!.wallet!.toLowerCase()}-${(s!.rules ?? 0) + 1}`, text); } catch {}
    await write(`Applying rule v${(s!.rules ?? 0) + 1} to #${id}`, s!.wallet!, "TrenchersAgentAccount", "setPolicy", [claim / 2n, claim * 2n, true, keccak256(toHex(text)), text]);
    setRule("");
  });
  const fmt = (v?: bigint) => (v === undefined ? "…" : Number(formatEther(v)).toFixed(6));
  const unlock = s?.lockedAt ? new Date((Number(s.lockedAt) + LOCK_DAYS * 86400) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  const tplName = s?.ruleText ? TEMPLATES.find((t) => t.text === s.ruleText)?.name : undefined;

  return (
    <article className="tn-tok">
      <img src={`/testnet-meta/img/${s?.awake ? "awake" : "dormant"}/${id}.svg`} alt={`Trencher #${id}`} width={160} height={160} className={s ? "" : "tn-img-wait"} />
      <div className="tn-tok-body">
        <h3>Trencher #{id} <span className={`mono tn-badge${s?.awake ? " on" : ""}`}>{house ? "House agent" : s ? (s.awake ? "Awake" : `Dormant · ${eth(claim)} claimable`) : "…"}</span></h3>
        {s && !s.awake && (
          <>
            <p>Grey for now: its {eth(claim)} ETH starter balance is waiting. Awaken it to create its agent wallet, move the {eth(claim)} ETH in and turn it to full colour.</p>
            <div className="tn-row"><button type="button" className="tn-btn tn-primary" onClick={awaken} disabled={busy}>Awaken · claim {eth(claim)} ETH</button></div>
          </>
        )}
        {s?.awake && s.wallet && s.deployed === false && (
          <>
            <p>House agents have no starter balance, so they are never awakened. Create this agent&apos;s wallet to fund it and give it a strategy.</p>
            <div className="tn-row"><button type="button" className="tn-btn tn-primary" disabled={busy} onClick={() => act(() => write(`Creating the agent wallet for #${id}`, dep.registry!, "MockERC6551Registry", "createAccount", [dep.impl, zeroHash, BigInt(chain.id), dep.nft, BigInt(id)]))}>Create agent wallet</button></div>
          </>
        )}
        {s?.awake && s.wallet && s.deployed !== false && (
          <>
            <p className="mono tn-small">Agent wallet <a href={`${EXPLORER}/address/${s.wallet}`} target="_blank" rel="noreferrer">{short(s.wallet)} ↗</a></p>
            <dl className="tn-kv mono">
              <div><dt>Balance</dt><dd>{fmt(s.bal)} ETH</dd></div>
              <div><dt>Locked starter</dt><dd>{fmt(s.locked)} ETH</dd></div>
              <div><dt>Withdrawable now</dt><dd>{fmt(s.free)} ETH</dd></div>
              <div><dt>Rule</dt><dd>{s.rules ? `v${s.rules}` : "none yet"}</dd></div>
            </dl>

            <div className="tn-rule">
              <span className="mono tn-rule-k">{s.rules ? `Current strategy · rule v${s.rules}${tplName ? ` · ${tplName}` : ""}` : "Current strategy"}</span>
              <p>{s.rules ? (s.ruleText ?? "Rule applied (its text was not saved by this older version).") : "No rule yet. Pick a house strategy below or write your own."}</p>
            </div>

            <div className="tn-sub">
              <span className="mono tn-lbl">Talk to your agent</span>
              <div className="tn-tpls">
                {TEMPLATES.map((t) => <button key={t.name} type="button" className={`tn-tpl${rule === t.text ? " on" : ""}`} onClick={() => setRule(t.text)}><b>{t.name}</b><small>{t.text}</small></button>)}
              </div>
              <textarea className="tn-in tn-area" value={rule} onChange={(e) => setRule(e.target.value)} placeholder="Or write your own, e.g. Only new launches with more than 3 ETH liquidity. Take profit at 40%, stop loss 20%." />
              <div className="tn-row"><button type="button" className="tn-btn tn-primary" onClick={applyRule} disabled={busy || !rule.trim()}>Apply rule</button><span className="tn-hint">Saved on-chain as rule v{(s.rules ?? 0) + 1}, with limits of {eth(claim / 2n)} ETH per trade and {eth(claim * 2n)} ETH per day.</span></div>
            </div>

            <div className="tn-sub">
              <span className="mono tn-lbl">Deposit</span>
              <div className="tn-row"><input className="tn-in" value={depAmt} onChange={(e) => setDepAmt(e.target.value)} inputMode="decimal" /><button type="button" className="tn-btn" onClick={deposit} disabled={busy}>Deposit ETH</button></div>
            </div>

            <div className="tn-sub">
              <span className="mono tn-lbl">Withdraw · instant</span>
              <div className="tn-row">
                <input className="tn-in" value={wdAmt} onChange={(e) => setWdAmt(e.target.value)} placeholder="0.0" inputMode="decimal" />
                <button type="button" className="tn-btn tn-ghost" onClick={() => setWdAmt(formatEther(s.free ?? 0n))} disabled={busy || !s.free}>Max {fmt(s.free)}</button>
                <button type="button" className="tn-btn" onClick={withdraw} disabled={busy || !wdAmt || !s.free}>Withdraw</button>
              </div>
              {(s.locked ?? 0n) > 0n && (
                <p className="tn-lock">🔒 <b>{fmt(s.locked)} ETH is locked</b>: only the starter balance from awakening, for 6 months{unlock ? <> (until <b>{unlock}</b>)</> : null}. The agent can still use it for trades and its coin launch. Everything else in this wallet (your deposits and any profits) can be withdrawn instantly.</p>
              )}
            </div>

            <p className="tn-hint">Coin launch: not connected on testnet yet; it comes with the next build step.</p>
          </>
        )}
      </div>
    </article>
  );
}

/** Old test agent wallets (first testnet version) used a two-step, 10-minute withdrawal. This finds them and gets the deposits back. */
const OLD_ABI = parseAbi([
  "function withdrawable() view returns (uint256)",
  "function withdrawal() view returns (address requestedBy, uint128 amount, uint64 readyAt)",
  "function requestWithdrawal(uint128 amount)",
  "function withdraw()",
  "function owner() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function agentWallet(uint256) view returns (address)",
]);
/** First-version test deployments on Robinhood testnet (NFT, starter fund). */
const OLD_DEPLOYMENTS: { nft: Address; fund: Address }[] = [
  { nft: "0x5Ee3841dB960D0cd67Fffd67d69738f5AcAAab31", fund: "0xe4532032Ed78dE5270bbe29aB8522315AD91Cdb9" },
];
type OldWallet = { id: number; wallet: Address; bal: bigint; free: bigint; req: bigint; readyAt: number };

function Rescue({ account, clients, sendTx, setError }: {
  account: Address;
  clients: () => { wallet: WalletClient; pub: PublicClient };
  sendTx: (label: string, fn: (w: WalletClient, from: Address) => Promise<Hash>) => Promise<unknown>;
  setError: (s: string | null) => void;
}) {
  const [list, setList] = useState<OldWallet[] | null>(null);
  const [now, setNow] = useState(Date.now());
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const pub = clients().pub;
      const found: OldWallet[] = [];
      for (const d of OLD_DEPLOYMENTS) {
        try {
          const supply = Number(await pub.readContract({ address: d.nft, abi: OLD_ABI, functionName: "totalSupply" }));
          for (let id = 6; id <= supply; id++) {
            const owner = await pub.readContract({ address: d.nft, abi: OLD_ABI, functionName: "ownerOf", args: [BigInt(id)] }).catch(() => null);
            if (owner?.toLowerCase() !== account.toLowerCase()) continue;
            const wallet = await pub.readContract({ address: d.fund, abi: OLD_ABI, functionName: "agentWallet", args: [BigInt(id)] });
            const code = await pub.getCode({ address: wallet });
            if (!code || code === "0x") continue;
            const [bal, free, w] = await Promise.all([
              pub.getBalance({ address: wallet }),
              pub.readContract({ address: wallet, abi: OLD_ABI, functionName: "withdrawable" }),
              pub.readContract({ address: wallet, abi: OLD_ABI, functionName: "withdrawal" }),
            ]);
            found.push({ id, wallet, bal, free, req: w[1], readyAt: Number(w[2]) * 1000 });
          }
        } catch { /* not on this network */ }
      }
      if (live) setList(found);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, tick]);

  if (!list || list.length === 0) return null;
  const request = async (o: OldWallet) => {
    try { await sendTx(`Requesting ${Number(formatEther(o.free))} ETH from old Trencher #${o.id}`, (w, from) => w.writeContract({ address: o.wallet, abi: OLD_ABI, functionName: "requestWithdrawal", args: [o.free], account: from, chain })); }
    catch (e) { setError(reason(e)); }
    setTick((t) => t + 1);
  };
  const withdraw = async (o: OldWallet) => {
    try { await sendTx(`Withdrawing ${Number(formatEther(o.req))} ETH from old Trencher #${o.id}`, (w, from) => w.writeContract({ address: o.wallet, abi: OLD_ABI, functionName: "withdraw", account: from, chain })); }
    catch (e) { setError(reason(e)); }
    setTick((t) => t + 1);
  };

  return (
    <section className="tn-card">
      <h2>Your Trenchers from the first test version</h2>
      <p>These used a two-step withdrawal: request, wait 10 minutes, withdraw (the new version is instant). Your deposits come back; the starter balance stays locked.</p>
      {list.map((o) => {
        const wait = Math.max(0, Math.ceil((o.readyAt - now) / 1000));
        const ready = o.req > 0n && o.req <= o.free;
        return (
          <div key={o.wallet} className="tn-oldw">
            <p className="mono tn-small">Old Trencher #{o.id} · agent wallet <a href={`${EXPLORER}/address/${o.wallet}`} target="_blank" rel="noreferrer">{short(o.wallet)} ↗</a> · balance {Number(formatEther(o.bal))} ETH · you can get back <b>{Number(formatEther(o.free))} ETH</b></p>
            {o.free === 0n ? <p className="tn-hint">Nothing left to withdraw: only the locked starter balance remains.</p> : ready ? (
              <div className="tn-row"><button type="button" className="tn-btn tn-primary" onClick={() => withdraw(o)} disabled={wait > 0}>{wait > 0 ? `Withdraw in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}` : `Step 2: withdraw ${Number(formatEther(o.req))} ETH`}</button>{wait > 0 && <span className="tn-hint">You can leave this page open; the button unlocks by itself.</span>}</div>
            ) : (
              <div className="tn-row"><button type="button" className="tn-btn tn-primary" onClick={() => request(o)}>Step 1: request {Number(formatEther(o.free))} ETH</button><span className="tn-hint">Then wait 10 minutes; this button turns into Withdraw.</span></div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** The team wallet's view of every contract that holds money, with the ways to get it out. */
function SafetyNet({ dep, account, read, write, getBalance, chainTime, tick, onDone, setError, busy, setBusy }: {
  dep: Dep; account: Address; read: ReadFn; write: WriteFn; getBalance: (a: Address) => Promise<bigint>; chainTime: () => Promise<number>; tick: number;
  onDone: () => void; setError: (s: string | null) => void; busy: boolean; setBusy: (b: boolean) => void;
}) {
  type S = { fund: bigint; fundTo: Address; fundEta: number; fundDelay: number; fundShut: boolean; split: bigint; owed: bigint[]; dest: Address[]; unacc: bigint; nft: bigint; dist: bigint };
  const [s, setS] = useState<S | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [skew, setSkew] = useState(0); // chain time minus this computer's clock
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    (async () => {
      try {
        const [fund, fundTo, fundEta, fundDelay, fundShut, split, nft, dist] = await Promise.all([
          getBalance(dep.fund!), read<Address>(dep.fund!, "AgentStarterFund", "rescueTo"), read<bigint>(dep.fund!, "AgentStarterFund", "rescueEta"),
          read<bigint>(dep.fund!, "AgentStarterFund", "rescueDelay"), read<boolean>(dep.fund!, "AgentStarterFund", "shutdown"),
          getBalance(dep.splitter!), getBalance(dep.nft!), dep.dist ? getBalance(dep.dist) : Promise.resolve(0n),
        ]);
        const owed = await Promise.all([0, 1, 2, 3].map((b) => read<bigint>(dep.splitter!, "RevenueSplitter", "owed", [b])));
        const destAddrs = await Promise.all([0, 1, 2, 3].map((b) => read<Address>(dep.splitter!, "RevenueSplitter", "destination", [b])));
        const unacc = await read<bigint>(dep.splitter!, "RevenueSplitter", "unaccounted").catch(() => 0n);
        const ct = await chainTime().catch(() => Date.now() / 1000);
        setSkew(ct * 1000 - Date.now());
        setS({ fund, fundTo, fundEta: Number(fundEta) * 1000, fundDelay: Number(fundDelay), fundShut, split, owed, dest: destAddrs, unacc, nft, dist });
      } catch { setS(null); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, dep.fund]);
  if (!s) return null;
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(reason(e)); } setBusy(false); onDone(); };
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
  const pending = s.fundTo && s.fundTo !== ZERO_ADDR;
  const wait = Math.max(0, Math.ceil((s.fundEta - (clock + skew)) / 1000));
  const BUCKETS = ["Buybacks", "Development", "Prize pool", "Starter fund (in transit)"];
  const f = (v: bigint) => `${Number(formatEther(v))} ETH`;
  const delayText = s.fundDelay >= 3600 ? `${s.fundDelay / 3600} hours` : `${s.fundDelay / 60} minutes`;

  return (
    <section className="tn-card tn-safety">
      <h2>Safety net <small className="mono">team wallet only</small></h2>
      <p>Every contract that can hold money, and how you get it out. Pooled money (the starter fund) can only move after a public, on-chain delay of <b>{delayText}</b> ({"48 hours"} on mainnet), so nobody can drain it silently. Agent wallets belong to whoever holds the NFT: they withdraw themselves, and for the house agents that is your team wallet.</p>

      <div className="tn-safe-row">
        <div><b>Agent Starter Fund</b><span className="mono tn-small">{f(s.fund)}{s.fundShut ? " · shut down" : ""}</span></div>
        {s.fundShut ? <span className="tn-hint">Rescued and shut down.</span> : !pending ? (
          <button type="button" className="tn-btn" onClick={() => act(() => write("Proposing a rescue of the starter fund to your wallet", dep.fund!, "AgentStarterFund", "proposeRescue", [account]))} disabled={busy}>Rescue to my wallet…</button>
        ) : (
          <div className="tn-row">
            <button type="button" className="tn-btn tn-primary" onClick={() => act(() => write("Rescuing the starter fund", dep.fund!, "AgentStarterFund", "executeRescue", [[]]))} disabled={busy || wait > 0}>{wait > 0 ? `Rescue possible in ${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}` : `Rescue ${f(s.fund)} now`}</button>
            <button type="button" className="tn-btn" onClick={() => act(() => write("Cancelling the rescue", dep.fund!, "AgentStarterFund", "cancelRescue"))} disabled={busy}>Cancel</button>
          </div>
        )}
      </div>
      {pending && !s.fundShut && <p className="tn-hint">Rescue announced to {short(s.fundTo)}. Executing it moves all the fund&apos;s ETH there and permanently stops new awakenings.</p>}

      <div className="tn-safe-row">
        <div><b>Revenue splitter</b><span className="mono tn-small">{f(s.split)}</span></div>
        {s.unacc > 0n && <button type="button" className="tn-btn" onClick={() => act(() => write("Sweeping stray ETH from the splitter", dep.splitter!, "RevenueSplitter", "rescueUnaccounted", [account]))} disabled={busy}>Sweep stray {f(s.unacc)}</button>}
      </div>
      <ul className="tn-buckets mono">
        {BUCKETS.map((name, b) => (
          <li key={name}>
            <span>{name}: {f(s.owed[b])}</span>
            <span className="tn-hint">{s.dest[b] === ZERO_ADDR ? "no destination yet" : `→ ${short(s.dest[b])}`}</span>
            {s.owed[b] > 0n && (s.dest[b] === ZERO_ADDR ? (
              <button type="button" className="tn-btn tn-ghost" onClick={() => act(() => write(`Sending ${name} to your wallet`, dep.splitter!, "RevenueSplitter", "proposeDestination", [b, account]))} disabled={busy}>Send to my wallet</button>
            ) : (
              <button type="button" className="tn-btn tn-ghost" onClick={() => act(() => write(`Releasing ${name}`, dep.splitter!, "RevenueSplitter", "release", [b]))} disabled={busy}>Release</button>
            ))}
          </li>
        ))}
      </ul>

      <div className="tn-safe-row">
        <div><b>NFT contract</b><span className="mono tn-small">{f(s.nft)} (should always be 0)</span></div>
        {s.nft > 0n && <button type="button" className="tn-btn" onClick={() => act(() => write("Sweeping ETH from the NFT contract", dep.nft!, "TrenchersNFT", "sweep", ["0x0000000000000000000000000000000000000000", account]))} disabled={busy}>Sweep to my wallet</button>}
      </div>
      {dep.dist && <div className="tn-safe-row"><div><b>Fee distributor</b><span className="mono tn-small">{f(s.dist)}</span></div></div>}
    </section>
  );
}

/** Engine wallet, Railway settings and the test launchpad. */
function Trading({ dep, account, isOwner, read, write, tick, onDone, setError, busy, setBusy }: {
  dep: Dep; account: Address; isOwner: boolean; read: ReadFn; write: WriteFn; tick: number;
  onDone: () => void; setError: (s: string | null) => void; busy: boolean; setBusy: (b: boolean) => void;
}) {
  const [engine, setEngine] = useState<Address | null>(null);
  const [engineIn, setEngineIn] = useState("");
  const [coin, setCoin] = useState("TEST");
  const [copied, setCopied] = useState(false);
  useEffect(() => { read<Address>(dep.config!, "AgentConfig", "engine").then(setEngine).catch(() => setEngine(null)); }, [tick, dep.config, read]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(reason(e)); } setBusy(false); onDone(); };
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
  const hasEngine = engine && engine !== ZERO_ADDR;
  const env = [
    "CHAIN_ID=46630",
    `RPC_URL=${chain.rpcUrls.default.http[0]}`,
    `NFT_ADDRESS=${dep.nft}`,
    `FUND_ADDRESS=${dep.fund}`,
    `ADAPTER_ADDRESS=${dep.adapter}`,
    `PONS_FACTORY=${dep.launchpad}`,
    ...(dep.startBlock ? [`START_BLOCK=${dep.startBlock}`] : []),
    "ENGINE_KEY=paste the engine wallet's private key here, in Railway only",
  ].join("\n");

  return (
    <section className="tn-card">
      <h2><span className="tn-n mono">4</span>Trading engine</h2>
      <p>The engine follows every awakened agent and trades its current rule. On testnet it trades coins from the test launchpad below (Pons&apos;s testnet version isn&apos;t public); on mainnet it trades real Pons coins.</p>

      <div className="tn-safe-row">
        <div><b>Engine wallet</b><span className="mono tn-small">{hasEngine ? short(engine!) : "not set yet"}</span></div>
        {isOwner && !hasEngine && (
          <div className="tn-row">
            <input className="tn-in tn-wide mono" value={engineIn} onChange={(e) => setEngineIn(e.target.value)} placeholder="0x… address of your new engine wallet" />
            <button type="button" className="tn-btn tn-primary" onClick={() => act(() => write("Setting the engine wallet", dep.config!, "AgentConfig", "propose", [0, engineIn.trim()]))} disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(engineIn.trim())}>Set engine wallet</button>
          </div>
        )}
      </div>
      {isOwner && !hasEngine && <p className="tn-hint">Make a new MetaMask account just for the engine and paste its address (not its key). It only pays gas and can only trade inside agent wallets, within each holder&apos;s limits.</p>}

      {isOwner && hasEngine && (
        <>
          <p><b>Railway settings for the engine service</b>: copy these into the service&apos;s Variables (Raw Editor), then replace the last line with the engine wallet&apos;s private key yourself.</p>
          <textarea className="tn-code mono" readOnly value={env} rows={7} onFocus={(e) => e.currentTarget.select()} />
          <div className="tn-row"><button type="button" className="tn-btn" onClick={() => { navigator.clipboard?.writeText(env); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy settings"}</button></div>
        </>
      )}

      <div className="tn-safe-row">
        <div><b>Test coin launchpad</b><span className="mono tn-small">Launch a coin; agents with a matching rule trade it.</span></div>
        <div className="tn-row">
          <input className="tn-in mono" value={coin} onChange={(e) => setCoin(e.target.value.toUpperCase().slice(0, 12))} />
          <button type="button" className="tn-btn" onClick={() => act(() => write(`Launching $${coin}`, dep.launchpad!, "MockPonsFactory", "launch", [coin || "TEST", parseEther("1")]))} disabled={busy || !coin}>Launch test coin</button>
        </div>
      </div>
      <p className="tn-hint">Tip: give an agent the rule &quot;Buy every new Pons launch, sell after 1 minute&quot;, launch a coin here, and watch the agent buy about 6 seconds later and sell a minute after that.</p>
    </section>
  );
}
