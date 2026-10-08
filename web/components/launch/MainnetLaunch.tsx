"use client";
import { MAINNET_DEPLOYMENT } from "@/lib/mainnet/deployment";
import { TextButton } from "@/components/TextButton";
import { useCallback, useEffect, useState } from "react";
import {
  createPublicClient, createWalletClient, custom, encodeFunctionData, fallback, formatEther, http, parseAbi, parseEther, toHex, zeroHash,
  type Abi, type Address, type EIP1193Provider, type Hash, type PublicClient,
} from "viem";
import { robinhood } from "viem/chains";
import artifacts from "@/lib/mainnet/artifacts.json";
import { MAINNET_LAUNCH as L, MAINNET_ROLES as R } from "@/lib/mainnet/roles";
import { walletProvider } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";

/**
 * Mainnet launch console (team only). Deploys every Trenchers contract from the Deployer wallet, in the
 * visitor's own browser wallet (no key ever leaves it), wires them up, seals the settings and hands
 * ownership to the team Safe. Resumable: if it stops halfway, it carries on where it left off.
 * The mint stays closed: the Safe opens awakening and the mint afterwards.
 */
type Name = keyof typeof artifacts;
const A = (n: Name) => artifacts[n].abi as Abi;
const chain = robinhood;
const EXPLORER = "https://robin.etherscan.io";
const STORE = "trenchers-mainnet-launch";
/** The earlier coin launcher (Trenchers paid the fee; Pons recorded it as deployer). Superseded by agent wallet version 2. */
const OLD_COIN_LAUNCHER = "0x244400ad17266e276b61c186f79bb0074b91ddf2" as Address;
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
  const [oldBal, setOldBal] = useState<bigint | null>(null);
  useEffect(() => {
    try { const v = localStorage.getItem("trenchers:walletV3"); if (v) setWalletV2(v as Address); } catch { /* */ }
    // Already deployed and proposed? Then the agent settings know it.
    pub().readContract({ address: MAINNET_DEPLOYMENT.config, abi: A("AgentConfig"), functionName: "pending", args: [4] })
      .then(async (p) => {
        const v = (p as readonly [Address, bigint])[0];
        if (!v || /^0x0+$/.test(v)) return;
        const n = await pub().readContract({ address: v, abi: parseAbi(["function VERSION() view returns (uint256)"]), functionName: "VERSION" }).catch(() => 0n);
        if (n === 3n) setWalletV2(v);
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
        out.push({ label: "Team Safe exists on Robinhood Chain", ok: true, note: `${th} of ${ow.length} signatures: ${ow.map(short).join(", ")}` });
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
        <p>Agent wallet version 3 lets each agent launch its own coin by calling Pons directly (version 2 used a launch format the live Pons factory doesn't accept; version 3 works with any format and checks Pons's record after the launch), so Pons records the <b>agent wallet as the coin&apos;s deployer and creator</b>. The Pons launch fee (0.0005 ETH) comes out of the agent&apos;s starter balance, and the agent can collect its coin&apos;s creator fees at any time, also during the 6-month lock. Holders switch their agent to version 3 with one click on its profile (nothing changes unless they do).</p>
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
            try { const a = await deploy("Agent wallet version 3", "TrenchersAgentAccountV3", [MAINNET_DEPLOYMENT.config, MAINNET_DEPLOYMENT.fund]); setWalletV2(a); try { localStorage.setItem("trenchers:walletV3", a); } catch { /* */ } }
            catch (e) { setError(errText(e)); }
            setBusy(false);
          }} disabled={busy || !isDeployer || !chainOk}>Deploy agent wallet version 3</TextButton>
        )}
      </section>
    </div>
  );
}
