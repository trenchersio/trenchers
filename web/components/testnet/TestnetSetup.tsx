"use client";
import { useCallback, useEffect, useState } from "react";
import {
  createPublicClient, createWalletClient, custom, fallback, formatEther, http, keccak256, parseEther, toHex, zeroHash,
  type Abi, type Address, type EIP1193Provider, type Hash, type PublicClient, type WalletClient,
} from "viem";
import { robinhoodTestnet } from "viem/chains";
import artifacts from "@/lib/testnet/artifacts.json";
import { TESTNET_DEPLOYMENT } from "@/lib/testnet/deployment";
import { chooseAccount, revoke, waitForWallet, type InjectedWallet } from "@/lib/eip6963";
import { WalletPicker } from "@/components/WalletPicker";

/**
 * Testnet console: deploys the whole Trenchers system from the connected wallet, mints a test
 * collection into a stand-in shop, and lets any wallet buy, awaken and manage a Trencher.
 * Testnet runs at one tenth of mainnet prices (0.002 ETH, 0.001 ETH to the agent), same 50% split.
 */

type Name = keyof typeof artifacts;
const A = (n: Name) => artifacts[n].abi as Abi;
const chain = robinhoodTestnet;
const EXPLORER = chain.blockExplorers.default.url;
const PRICE = parseEther("0.002");
const CLAIM = parseEther("0.001");
const CANONICAL_REGISTRY = "0x000000006551c19487814612e58FE06813775758" as Address;
const PONS_ROUTER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948" as Address;
const META = "https://trenchers.io/testnet-meta/";
const STORE = "trenchers-testnet-deployment";

type Dep = {
  chainId: number; owner?: Address; registry?: Address; splitter?: Address; nft?: Address; sale?: Address;
  fund?: Address; config?: Address; impl?: Address; dist?: Address; done: string[];
};
type Log = { label: string; state: "wait" | "ok" | "err"; hash?: Hash; note?: string };

const WALLET_KEY = "trenchers-wallet-rdns";
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const errText = (e: unknown) => {
  const x = e as { shortMessage?: string; message?: string };
  return (x.shortMessage ?? x.message ?? String(e)).split("\n")[0];
};
/** Plain-English reasons for the contracts' custom errors, shown before the wallet even opens. */
const REASONS: Record<string, string> = {
  SoldOut: "The shop is empty: nothing left to buy. Mint more Trenchers into the shop with the team wallet (step 1).",
  WrongPrice: "The price doesn't match: a test Trencher costs exactly 0.002 ETH.",
  TreasuryCannotClaim: "The shop wallet can't awaken Trenchers. Use your buyer wallet.",
  NotHolder: "Only the wallet that owns this Trencher can do that. Switch to that wallet in MetaMask.",
  AlreadyClaimed: "This Trencher is already awake.",
  Underfunded: "The starter fund doesn't hold enough ETH yet. Buy a Trencher first: half of the price funds it.",
  NotOpen: "Awakening isn't open yet: the setup didn't finish. Continue the setup in step 1 with the team wallet.",
  NotEligible: "House agents (#1 to #5) don't have a starter balance to claim.",
  StarterLocked: "That amount includes the locked starter balance. You can only withdraw what you deposited yourself.",
  TooEarly: "Not yet: a withdrawal can be completed 10 minutes after the request.",
  NoWithdrawal: "Request a withdrawal first, then wait 10 minutes.",
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
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ supply: bigint; available: bigint; fund: bigint; validator: Address } | null>(null);
  const [mintCount, setMintCount] = useState("95");
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
    const hash = await fn(wallet, account);
    patchLast({ hash });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") { patchLast({ state: "err", note: "reverted" }); throw new Error(`${label} failed on-chain.`); }
    patchLast({ state: "ok" });
    return r;
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
    catch (e) { throw new Error(reason(e)); }
    return sendTx(label, (w, from) => w.writeContract({ address, abi: A(name), functionName, args, account: from, chain, value }));
  };
  const send = (label: string, to: Address, value: bigint) =>
    sendTx(label, (w, from) => w.sendTransaction({ to, value, account: from, chain }));
  const read = async <T,>(address: Address, name: Name, functionName: string, args: unknown[] = []) =>
    (await clients().pub.readContract({ address, abi: A(name), functionName, args })) as T;

  // ---------------------------------------------------------------- deploy
  const STEPS: { key: string; label: string; run: (d: Dep, me: Address) => Promise<Partial<Dep>> }[] = [
    { key: "registry", label: "Agent wallet registry (ERC-6551)", run: async () => {
      const code = await clients().pub.getCode({ address: CANONICAL_REGISTRY });
      if (code && code !== "0x") { pushLog({ label: "Agent wallet registry: already on this network", state: "ok" }); return { registry: CANONICAL_REGISTRY }; }
      return { registry: await deploy("Agent wallet registry (ERC-6551)", "MockERC6551Registry", []) };
    } },
    { key: "splitter", label: "Revenue splitter", run: async (_d, me) => ({ splitter: await deploy("Revenue splitter", "RevenueSplitter", [me, me, BigInt(Math.floor(Date.now() / 1000))]) }) },
    { key: "nft", label: "Trenchers NFT", run: async (d, me) => ({ nft: await deploy("Trenchers NFT", "TrenchersNFT", [d.splitter, me, "", `${META}contract.json`]) }) },
    { key: "sale", label: "Test shop (0.002 ETH)", run: async (d) => ({ sale: await deploy("Test shop (0.002 ETH)", "TestnetSale", [d.nft, d.splitter, PRICE]) }) },
    { key: "fund", label: "Agent Starter Fund (0.001 ETH)", run: async (d, me) => ({ fund: await deploy("Agent Starter Fund (0.001 ETH)", "AgentStarterFund", [me, d.nft, d.registry, d.sale, CLAIM]) }) },
    { key: "config", label: "Agent settings", run: async (_d, me) => ({ config: await deploy("Agent settings", "AgentConfig", [me]) }) },
    { key: "impl", label: "Agent wallet", run: async (d) => ({ impl: await deploy("Agent wallet", "TrenchersAgentAccount", [d.config]) }) },
    { key: "dist", label: "Fee distributor", run: async (d, me) => ({ dist: await deploy("Fee distributor", "AgentFeeDistributor", [me, d.registry, d.nft]) }) },
    { key: "cfgFund", label: "Link settings to the starter fund", run: async (d) => { await write("Link settings to the starter fund", d.config!, "AgentConfig", "propose", [3, d.fund]); return {}; } },
    { key: "nftFund", label: "Link NFT to the starter fund (grey / colour)", run: async (d) => { await write("Link NFT to the starter fund (grey / colour)", d.nft!, "TrenchersNFT", "setStarterFund", [d.fund]); return {}; } },
    { key: "fundAcct", label: "Open awakening", run: async (d) => { await write("Open awakening", d.fund!, "AgentStarterFund", "setAccount", [d.impl, zeroHash]); return {}; } },
    { key: "distAcct", label: "Link fee distributor to agent wallets", run: async (d) => { await write("Link fee distributor to agent wallets", d.dist!, "AgentFeeDistributor", "setAccount", [d.impl, zeroHash]); return {}; } },
    { key: "seller", label: "Count shop sales as first sales", run: async (d) => { await write("Count shop sales as first sales", d.splitter!, "RevenueSplitter", "setPrimarySeller", [d.sale]); return {}; } },
    { key: "starterDest", label: "Send the 50% to the starter fund", run: async (d) => { await write("Send the 50% to the starter fund", d.splitter!, "RevenueSplitter", "proposeDestination", [3, d.fund]); return {}; } },
    { key: "baseUri", label: "Point the NFT at trenchers.io metadata", run: async (d) => { await write("Point the NFT at trenchers.io metadata", d.nft!, "TrenchersNFT", "setBaseURI", [META]); return {}; } },
    { key: "noValidator", label: "Allow the test shop to transfer (testnet only)", run: async (d) => {
      const v = await read<Address>(d.nft!, "TrenchersNFT", "getTransferValidator");
      if (v !== ZERO) await write("Allow the test shop to transfer (testnet only)", d.nft!, "TrenchersNFT", "setTransferValidator", [ZERO]);
      return {};
    } },
  ];
  // "noValidator" was added later: older deployments count as deployed and get a fix-up button instead.
  const deployed = dep.done.includes("all") || STEPS.filter((s) => s.key !== "noValidator").every((s) => dep.done.includes(s.key));
  const ready = deployed && !!dep.nft && !!dep.sale && !!dep.fund;

  const runDeploy = async () => {
    if (!account) return;
    setBusy(true); setError(null);
    let d: Dep = dep.owner && dep.owner.toLowerCase() !== account.toLowerCase() && !deployed ? { chainId: chain.id, done: [] } : { ...dep };
    d.owner ??= account;
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

  const mint = async () => {
    if (!dep.nft || !dep.sale) return;
    setBusy(true); setError(null);
    try {
      const n = Math.max(1, Math.min(200, Number(mintCount) || 0));
      await write(`Mint ${n} Trenchers into the shop`, dep.nft, "TrenchersNFT", "ownerMint", [dep.sale, BigInt(n)]);
    } catch (e) { setError(reason(e)); patchLast({ state: "err" }); }
    setBusy(false); setTick((t) => t + 1); refreshAccount();
  };

  const fixValidator = async () => {
    if (!dep.nft) return;
    setBusy(true); setError(null);
    try { await write("Allow the test shop to transfer (testnet only)", dep.nft, "TrenchersNFT", "setTransferValidator", [ZERO]); }
    catch (e) { setError(reason(e)); patchLast({ state: "err" }); }
    setBusy(false); setTick((t) => t + 1);
  };

  const buy = async () => {
    if (!dep.sale) return;
    setBusy(true); setError(null);
    try { await write("Buy a Trencher (0.002 ETH)", dep.sale, "TestnetSale", "buy", [], PRICE); }
    catch (e) { setError(reason(e)); patchLast({ state: "err" }); }
    setBusy(false); setTick((t) => t + 1); refreshAccount();
  };

  // ---------------------------------------------------------------- reads
  useEffect(() => {
    if (!chainOk || !ready) { setStats(null); return; }
    let live = true;
    (async () => {
      try {
        const [supply, available] = await Promise.all([read<bigint>(dep.nft!, "TrenchersNFT", "totalSupply"), read<bigint>(dep.sale!, "TestnetSale", "available")]);
        const fund = await clients().pub.getBalance({ address: dep.fund! });
        const validator = await read<Address>(dep.nft!, "TrenchersNFT", "getTransferValidator");
        if (live) setStats({ supply, available, fund, validator });
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
  }, [chainOk, ready, account, tick, dep.nft, dep.sale, dep.fund]);

  const code = JSON.stringify({ chainId: dep.chainId, owner: dep.owner, registry: dep.registry, splitter: dep.splitter, nft: dep.nft, sale: dep.sale, fund: dep.fund, config: dep.config, impl: dep.impl, dist: dep.dist });
  const isOwner = !!account && !!dep.owner && account.toLowerCase() === dep.owner.toLowerCase();

  const loadPasted = () => {
    try {
      const d = JSON.parse(paste);
      if (d.chainId !== chain.id || !d.nft || !d.sale || !d.fund) throw new Error("That doesn't look like a Trenchers testnet deployment code.");
      const nd: Dep = { ...d, done: ["all"] }; setDep(nd); saveDep(nd); setPaste(""); setTick((t) => t + 1);
    } catch (e) { setError(reason(e)); }
  };

  return (
    <div className="tn">
      <header className="tn-head">
        <span className="mono eyebrow">Testnet · Robinhood Chain</span>
        <h1>Try Trenchers on testnet</h1>
        <p>Everything here runs on Robinhood Chain testnet with free test ETH, at one tenth of the real prices: a Trencher costs <b>0.002 ETH</b> and <b>0.001 ETH</b> goes into its agent wallet when you awaken it. Same 50/50 split as mainnet.</p>
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
            <p className="tn-done">✓ Deployed{dep.owner ? <> by <span className="mono">{short(dep.owner)}</span></> : null}. {stats && <>Minted <b>{stats.supply.toString()}</b> (5 house agents + {(stats.supply - 5n).toString()} for sale), <b>{stats.available.toString()}</b> left in the shop, starter fund holds <b>{Number(formatEther(stats.fund)).toFixed(5)} ETH</b>.</>}</p>
            {stats && stats.validator !== ZERO && (
              <div className="tn-fix">
                <p><b>One more step:</b> Limit Break&apos;s marketplace transfer rules are switched on, and they stop the test shop from handing out Trenchers. Switch them off for testnet (on mainnet they stay on, so OpenSea enforces the 5% royalty).</p>
                {isOwner ? <button type="button" className="tn-btn tn-primary" onClick={fixValidator} disabled={busy}>Allow the test shop to transfer</button> : <span className="tn-hint">Switch to the team wallet to do this.</span>}
              </div>
            )}
            {isOwner && (
              <div className="tn-row">
                <label className="mono tn-lbl">Mint into the shop<input className="tn-in" value={mintCount} onChange={(e) => setMintCount(e.target.value)} inputMode="numeric" /></label>
                <button type="button" className="tn-btn" onClick={mint} disabled={busy}>Mint</button>
                <span className="tn-hint">Up to 200 per click, 2,000 in total.</span>
              </div>
            )}
            <details className="tn-details"><summary className="mono">Deployment code (send this to the team)</summary>
              <textarea className="tn-code mono" readOnly value={code} onFocus={(e) => e.currentTarget.select()} />
              <ul className="tn-addrs mono">
                {(["nft", "sale", "fund", "splitter", "config", "impl", "dist", "registry"] as const).map((k) => dep[k] && <li key={k}>{k}: <a href={`${EXPLORER}/address/${dep[k]}`} target="_blank" rel="noreferrer">{dep[k]}</a></li>)}
              </ul>
            </details>
          </>
        ) : (
          <>
            <p>Puts every Trenchers contract on the testnet from your wallet: the NFT, the revenue split, the Agent Starter Fund, the agent wallet, the fee distributor and a test shop that stands in for OpenSea. Your wallet asks you to confirm about 15 times; it costs a tiny bit of test ETH. If it stops halfway, click again and it carries on where it left off.</p>
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
        <h2><span className="tn-n mono">2</span>Buy a Trencher <small className="mono">buyer wallet</small></h2>
        <p>Switch MetaMask to your second wallet, then buy. The shop sends the next Trencher to you; half the price goes straight into the Agent Starter Fund, waiting for your agent.</p>
        <div className="tn-row">
          <button type="button" className="tn-btn tn-primary" onClick={buy} disabled={busy || !ready || !chainOk || isOwner || stats?.available === 0n}>Buy for 0.002 ETH</button>
          {stats && <span className="tn-hint">{stats.available === 0n ? "The shop is empty: mint Trenchers into it with the team wallet first (step 1)." : `${stats.available.toString()} left in the shop.`}</span>}
          {isOwner && <span className="tn-hint">This is the team wallet. Switch to your buyer wallet to buy (the team wallet can&apos;t claim starter ETH).</span>}
        </div>
      </section>

      <section className={`tn-card${!ready || !chainOk ? " tn-off" : ""}`}>
        <h2><span className="tn-n mono">3</span>Your Trenchers</h2>
        {mine === null ? <p className="tn-hint">Connect a wallet to see your Trenchers.</p> : mine.length === 0 ? <p className="tn-hint">This wallet has no Trenchers yet. Buy one above.</p> : (
          <div className="tn-grid">
            {mine.map((id) => <TokenCard key={`${id}-${tick}`} id={id} dep={dep} account={account!} write={write} send={send} read={read} getBalance={(a) => clients().pub.getBalance({ address: a })} onDone={() => { setTick((t) => t + 1); refreshAccount(); }} setError={setError} busy={busy} setBusy={setBusy} pons={pons} />)}
          </div>
        )}
      </section>

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

function TokenCard({ id, dep, account, write, send, read, getBalance, onDone, setError, busy, setBusy, pons }: {
  id: number; dep: Dep; account: Address; write: WriteFn; send: (label: string, to: Address, value: bigint) => Promise<unknown>; read: ReadFn; getBalance: (a: Address) => Promise<bigint>;
  onDone: () => void; setError: (s: string | null) => void; busy: boolean; setBusy: (b: boolean) => void; pons: boolean | null;
}) {
  const [s, setS] = useState<{ awake: boolean; wallet?: Address; bal?: bigint; locked?: bigint; free?: bigint; rules?: bigint; wd?: { amount: bigint; readyAt: bigint } } | null>(null);
  const [dep_, setDepAmt] = useState("0.001");
  const [wdAmt, setWdAmt] = useState("");
  const [rule, setRule] = useState("Only new launches with more than 3 ETH liquidity. Take profit at 40%, stop loss 20%.");
  const house = id <= 5;

  useEffect(() => {
    (async () => {
      try {
        const awake = house || (await read<boolean>(dep.fund!, "AgentStarterFund", "claimed", [BigInt(id)]));
        if (!awake) { setS({ awake }); return; }
        const wallet = await read<Address>(dep.fund!, "AgentStarterFund", "agentWallet", [BigInt(id)]);
        const bal = await getBalance(wallet);
        let locked = 0n, free = bal, rules = 0n, wd: { amount: bigint; readyAt: bigint } | undefined;
        try {
          locked = await read<bigint>(wallet, "TrenchersAgentAccount", "lockedNow");
          free = await read<bigint>(wallet, "TrenchersAgentAccount", "withdrawable");
          rules = await read<bigint>(wallet, "TrenchersAgentAccount", "ruleVersion");
          const w = await read<readonly [Address, bigint, bigint]>(wallet, "TrenchersAgentAccount", "withdrawal");
          if (w[1] > 0n) wd = { amount: w[1], readyAt: w[2] };
        } catch { /* house agents may not have a wallet yet */ }
        setS({ awake, wallet, bal, locked, free, rules, wd });
      } catch (e) { setError(reason(e)); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(reason(e)); }
    setBusy(false); onDone();
  };
  const awaken = () => act(() => write(`Awaken Trencher #${id} (+0.001 ETH)`, dep.fund!, "AgentStarterFund", "claim", [BigInt(id)]));
  const deposit = () => act(async () => {
    const v = parseEther(dep_ || "0");
    await send(`Deposit into #${id}`, s!.wallet!, v);
  });
  const requestWd = () => act(() => write(`Request withdrawal from #${id}`, s!.wallet!, "TrenchersAgentAccount", "requestWithdrawal", [parseEther(wdAmt || "0")]));
  const doWd = () => act(() => write(`Withdraw from #${id}`, s!.wallet!, "TrenchersAgentAccount", "withdraw"));
  const applyRule = () => act(() => write(`Apply rule to #${id}`, s!.wallet!, "TrenchersAgentAccount", "setPolicy", [parseEther("0.0005"), parseEther("0.002"), true, keccak256(toHex(rule)), ""]));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const fmt = (v?: bigint) => (v === undefined ? "…" : Number(formatEther(v)).toFixed(5));

  return (
    <article className="tn-tok">
      <img src={`/testnet-meta/img/${s?.awake ? "awake" : "dormant"}/${id}.svg`} alt={`Trencher #${id}`} width={160} height={160} />
      <div className="tn-tok-body">
        <h3>Trencher #{id} <span className={`mono tn-badge${s?.awake ? " on" : ""}`}>{house ? "House agent" : s ? (s.awake ? "Awake" : "Dormant · 0.001 claimable") : "…"}</span></h3>
        {s && !s.awake && (
          <>
            <p>Grey for now: its 0.001 ETH starter balance is waiting. Awaken it to create its agent wallet, move the 0.001 ETH in and turn it to full colour.</p>
            <button type="button" className="tn-btn tn-primary" onClick={awaken} disabled={busy}>Awaken · claim 0.001 ETH</button>
          </>
        )}
        {s?.awake && s.wallet && (
          <>
            <p className="mono tn-small">Agent wallet <a href={`${EXPLORER}/address/${s.wallet}`} target="_blank" rel="noreferrer">{short(s.wallet)} ↗</a></p>
            <dl className="tn-kv mono">
              <div><dt>Balance</dt><dd>{fmt(s.bal)} ETH</dd></div>
              <div><dt>Locked starter</dt><dd>{fmt(s.locked)} ETH</dd></div>
              <div><dt>Withdrawable</dt><dd>{fmt(s.free)} ETH</dd></div>
              <div><dt>Rule version</dt><dd>{s.rules?.toString() ?? "0"}</dd></div>
            </dl>
            <div className="tn-row"><input className="tn-in" value={dep_} onChange={(e) => setDepAmt(e.target.value)} inputMode="decimal" /><button type="button" className="tn-btn" onClick={deposit} disabled={busy}>Deposit ETH</button></div>
            {s.wd ? (
              <div className="tn-row">
                <span className="tn-hint">Withdrawal of {fmt(s.wd.amount)} ETH requested{s.wd.readyAt > now ? `, ready in ${Math.ceil(Number(s.wd.readyAt - now) / 60)} min` : ", ready now"}.</span>
                <button type="button" className="tn-btn" onClick={doWd} disabled={busy || s.wd.readyAt > now}>Withdraw</button>
              </div>
            ) : (
              <div className="tn-row"><input className="tn-in" value={wdAmt} onChange={(e) => setWdAmt(e.target.value)} placeholder={fmt(s.free)} inputMode="decimal" /><button type="button" className="tn-btn" onClick={requestWd} disabled={busy}>Request withdrawal</button><span className="tn-hint">Step 1 of 2: then wait 10 minutes.</span></div>
            )}
            <label className="mono tn-lbl tn-col">Talk to your agent (saved on-chain as a rule)<textarea className="tn-in tn-area" value={rule} onChange={(e) => setRule(e.target.value)} /></label>
            <div className="tn-row"><button type="button" className="tn-btn" onClick={applyRule} disabled={busy || !rule.trim()}>Apply rule</button><span className="tn-hint">Sets limits of 0.0005 ETH per trade, 0.002 ETH per day.</span></div>
            <p className="tn-hint">Coin launch: {pons === null ? "checking Pons on testnet…" : pons ? "Pons found on testnet; launch wiring comes next." : "Pons isn't on Robinhood testnet, so coin launches can only be tested on mainnet."}</p>
          </>
        )}
      </div>
    </article>
  );
}
