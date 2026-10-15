"use client";
// Launch page, section 10: deploy Trenchers Credit from the Deployer wallet, in order, one confirmation each.
import { useEffect, useState } from "react";
import { createWalletClient, formatEther, parseEther, type Abi, type Address, type Hash, type PublicClient, type TransactionReceipt } from "viem";
import { TextButton } from "@/components/TextButton";
import { TRENCHERS_TOKEN } from "@/lib/programmable";
import { MAINNET_ROLES as R } from "@/lib/mainnet/roles";
import { AGENT_REGISTRY, CREDIT_ART, CREDIT_LAUNCH as CL, LINES_ABI, POOL_ABI, linkedPoolBytecode, saveCreditAddrs } from "@/lib/credit";

type Dep = { timelock?: Address; calls?: Address; pool?: Address; seeded?: boolean; record?: Address; lines?: Address; block?: string; funded?: string };
const LS = "trenchers:credit-launch";

type Props = {
  sendTx: (label: string, fn: (w: ReturnType<typeof createWalletClient>, from: Address) => Promise<Hash>) => Promise<TransactionReceipt>;
  pub: () => PublicClient;
  chain: Parameters<ReturnType<typeof createWalletClient>["deployContract"]>[0]["chain"];
  account: Address | null;
  chainOk: boolean;
  explorer: string;
  errText: (e: unknown) => string;
};

export function CreditLaunch({ sendTx, pub, chain, account, chainOk, explorer, errText }: Props) {
  const [d, setD] = useState<Dep>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [perEth, setPerEth] = useState("");
  const [fund, setFund] = useState("0.5");
  const [suggest, setSuggest] = useState<string | null>(null);

  useEffect(() => { try { const v = localStorage.getItem(LS); if (v) setD(JSON.parse(v)); } catch { /* */ } }, []);
  const save = (v: Dep) => {
    setD(v);
    try { localStorage.setItem(LS, JSON.stringify(v)); } catch { /* */ }
    if (v.pool && v.record && v.lines) saveCreditAddrs({ pool: v.pool, record: v.record, lines: v.lines, timelock: v.timelock, block: Number(v.block ?? 0) });
  };

  // A starting rate: twice the market value of the line, in $TRENCHERS (from the token's pool price, via the engine).
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${process.env.NEXT_PUBLIC_ENGINE_URL ?? "https://mainnet-production-c38a.up.railway.app"}/token?address=${TRENCHERS_TOKEN}`).then((x) => x.json());
        const supply = await pub().readContract({ address: TRENCHERS_TOKEN as Address, abi: [{ type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const, functionName: "totalSupply" });
        if (r?.ok && r.mcapEth > 0) {
          const perEthAtMarket = Number(formatEther(supply)) / r.mcapEth;
          setSuggest(String(Math.ceil((perEthAtMarket * 2) / 1000) * 1000));
        }
      } catch { /* no suggestion */ }
    })();
  }, [pub]);

  const run = async (f: () => Promise<Dep>) => {
    setBusy(true); setErr(null);
    try { save({ ...d, ...(await f()) }); } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  const deploy = async (label: string, abi: Abi, bytecode: `0x${string}`, args: unknown[], value?: bigint) => {
    const r = await sendTx(label, (w, from) => w.deployContract({ abi, bytecode, args, account: from, chain, ...(value ? { value } : {}) }));
    if (!r.contractAddress) throw new Error(`${label}: no contract address in the receipt.`);
    return r.contractAddress as Address;
  };
  const link = (a?: Address) => a ? <span className="mono"><a href={`${explorer}/address/${a}`} target="_blank" rel="noreferrer">{a}</a></span> : null;
  const off = busy || !account || !chainOk;
  const tokensPerEth = perEth ? parseEther(perEth) : 0n;

  const steps: { k: string; label: string; done: boolean; node: React.ReactNode }[] = [
    { k: "timelock", label: "1. Timelock (48 h, run by the team Safe)", done: !!d.timelock, node: d.timelock ? link(d.timelock)
      : <TextButton disabled={off} onClick={() => run(async () => ({ block: (await pub().getBlockNumber()).toString(), timelock: await deploy("Credit timelock", CREDIT_ART.CreditTimelock.abi, CREDIT_ART.CreditTimelock.bytecode, [R.safe]) }))}>Deploy timelock</TextButton> },
    { k: "calls", label: "2. Pool helper library", done: !!d.calls, node: d.calls ? link(d.calls)
      : <TextButton disabled={off || !d.timelock} onClick={() => run(async () => ({ calls: await deploy("Credit helper library", CREDIT_ART.CreditCalls.abi, CREDIT_ART.CreditCalls.bytecode, []) }))}>Deploy library</TextButton> },
    { k: "pool", label: "3. Credit pool (owner: the timelock, guardian: the Safe)", done: !!d.pool, node: d.pool ? link(d.pool)
      : <TextButton disabled={off || !d.calls} onClick={() => run(async () => ({ pool: await deploy("Credit pool", POOL_ABI, linkedPoolBytecode(d.calls!), [CL.weth, AGENT_REGISTRY, CL.buyback, d.timelock, R.safe, CL.params]) }))}>Deploy pool</TextButton> },
    { k: "seed", label: "4. Seed the pool (0.0001 ETH of dead shares)", done: !!d.seeded, node: d.seeded ? <span className="mono up">✓ seeded</span>
      : <TextButton disabled={off || !d.pool} onClick={() => run(async () => { await sendTx("Seed the pool", (w, from) => w.writeContract({ address: d.pool!, abi: POOL_ABI, functionName: "seed", value: CL.seed, account: from, chain })); return { seeded: true }; })}>Seed</TextButton> },
    { k: "record", label: "5. Credit record (scores and figures, read-only)", done: !!d.record, node: d.record ? link(d.record)
      : <TextButton disabled={off || !d.seeded} onClick={() => run(async () => ({ record: await deploy("Credit record", CREDIT_ART.CreditRecord.abi, CREDIT_ART.CreditRecord.bytecode, [d.pool]) }))}>Deploy record</TextButton> },
    { k: "lines", label: "6. Stake lines (stake $TRENCHERS, get an ETH line; its backing is a shared vault anyone can join)", done: !!d.lines, node: d.lines ? link(d.lines) : (
      <span className="launch-inline">
        <input className="tn-input mono" placeholder={suggest ? `${Number(suggest).toLocaleString()} (2× market)` : "$TRENCHERS per 1 ETH of line"} value={perEth} onChange={(e) => setPerEth(e.target.value.replace(/[^\d.]/g, ""))} style={{ width: 240 }} />
        {suggest && !perEth && <button type="button" className="tbtn" onClick={() => setPerEth(suggest)}>Use {Number(suggest).toLocaleString()}</button>}
        <TextButton disabled={off || !d.record || tokensPerEth === 0n} onClick={() => run(async () => ({ lines: await deploy("Stake lines", LINES_ABI, CREDIT_ART.TrenchersStakeLines.bytecode, [d.pool, TRENCHERS_TOKEN, d.timelock, R.safe, tokensPerEth, CL.lines.maxLine, CL.lines.maxTerm, CL.lines.weeklyCap, CL.lines.uri]) }))}>Deploy stake lines</TextButton>
      </span>) },
    { k: "fund", label: "7. Back the lines (optional): you can add the first backing now, or let anyone add it from /credit; the first backing must be at least 0.01 ETH", done: !!d.funded, node: d.funded ? <span className="mono up">✓ {d.funded} ETH backing</span> : (
      <span className="launch-inline">
        <input className="tn-input mono" value={fund} onChange={(e) => setFund(e.target.value.replace(/[^\d.]/g, ""))} style={{ width: 110 }} /> <span className="mono">ETH</span>
        <TextButton disabled={off || !d.lines || !(Number(fund) >= 0.01)} onClick={() => run(async () => { await sendTx("Back the lines", (w, from) => w.writeContract({ address: d.lines!, abi: LINES_ABI, functionName: "fund", value: parseEther(fund), account: from, chain })); return { funded: fund }; })}>Back the lines</TextButton>
      </span>) },
  ];

  const env = d.pool && d.record && d.lines ? [`CREDIT_POOL=${d.pool}`, `CREDIT_RECORD=${d.record}`, `CREDIT_LINES=${d.lines}`, `CREDIT_TIMELOCK=${d.timelock}`, `CREDIT_START_BLOCK=${d.block}`].join("\n") : "";
  return (
    <section className="tn-card">
      <h2>10 · Trenchers Credit</h2>
      <p>
        The fifth part, behind <span className="mono">/credit</span>: an ETH <b>credit pool</b> for ERC-8004 agents, a read-only <b>credit record</b>,
        and <b>stake lines</b>, which open an ETH line for anyone who stakes $TRENCHERS behind their agent. The ETH behind the lines is a
        shared vault owned by whoever backs it: anyone can add backing from <span className="mono">/credit</span>, and only they can take it out.
        Every setting is owned by a <b>48-hour timelock</b> that only the team Safe can drive; the Safe is also the guardian (it can stop new loans
        for up to 14 days, never exits). Neither can move lenders&apos; ETH or the backing. A quarter of every loan fee is sent to the buyback wallet ({CL.buyback.slice(0, 6)}…{CL.buyback.slice(-4)}). Deploy in order from the
        Deployer wallet.
      </p>
      <ol className="launch-safe">{steps.map((s) => <li key={s.k}><b>{s.label}</b>{s.node}</li>)}</ol>
      {err && <p className="notice">{err}</p>}
      {env && (<>
        <p><b>Then</b> (step 7 can wait) send these addresses to be filled into the site, so <span className="mono">/credit</span> goes live for everyone (until then it shows a preview).</p>
        <pre className="mono launch-env">{env}</pre>
        <button type="button" className="tbtn" onClick={() => navigator.clipboard.writeText(env)}>Copy</button>
      </>)}
    </section>
  );
}
