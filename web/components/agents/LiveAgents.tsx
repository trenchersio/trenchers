"use client";
import { useCallback, useEffect, useState } from "react";
import { formatEther, keccak256, parseEther, toHex, zeroHash, type Address } from "viem";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { PnlCardButton } from "@/components/PnlCard";
import { AgentLinks } from "@/components/AgentLinks";
import { TextButton } from "@/components/TextButton";
import { GuideFlow } from "./GuideFlow";
import { CoinLaunch } from "./CoinLaunch";
import { Fold } from "@/components/Fold";
import { SectionNav } from "@/components/SectionNav";
import { cardFromLive, tradeCard } from "@/components/arena/LiveArena";
import { ABI, DEPLOYMENT, cachedOwned, ownedTrenchers, reader, reason, sendCall, sendEth } from "@/lib/chain";
import { ENGINE_URL, OPENSEA_URL, ROUTES, chain, openseaItem } from "@/lib/constants";
import { createPortal } from "react-dom";
import { MintPanel } from "@/components/MintPanel";
import { Loader } from "@/components/Loader";
import { LiveArena } from "@/components/arena/LiveArena";
import { describe, parse, type CustomRule } from "@/lib/custom-strategy";
import { STRATEGIES } from "@/lib/strategies";
import { short, useWallet } from "@/lib/wallet";
import type { ChatMsg } from "@/lib/agents-store";

/**
 * NFT / Agent Profile on the live contracts: everything a holder does with their Trenchers, on the
 * main site. Awaken, talk to the agent and apply rules, set limits, pause, deposit, withdraw, and
 * make a PnL card. Trades and returns come from the trading engine.
 */
type Agent = {
  id: number; awake: boolean; house: boolean; wallet?: Address; deployed?: boolean;
  bal?: bigint; locked?: bigint; free?: bigint; lockedAt?: bigint;
  ruleVersion?: number; ruleText?: string | null; live?: boolean; perTrade?: bigint; dailyCap?: bigint; setBy?: Address; owner?: Address;
  version?: Address; original?: Address; offered?: Address; offers?: number;
};
type EngineAgent = Parameters<typeof cardFromLive>[0];
type Task = { label: string; phase: "check" | "sign" | "chain" | "done" | "error"; note?: string };

const TEMPLATES = STRATEGIES.filter((s) => s.name !== "Custom").map((s) => ({ name: s.name, text: `${s.trigger}. ${s.exit}.`, house: s.houseAgent }));
const LOCK_DAYS = 180;
const NAV = [
  { id: "overview", label: "Overview" }, { id: "funding", label: "Funding" }, { id: "guide", label: "Train" },
  { id: "trades", label: "Trades" }, { id: "track", label: "Track all" },
];
const EXPLORER = chain.blockExplorers?.default.url ?? "";
const fmt = (v?: bigint, d = 5) => (v === undefined ? "…" : Number(formatEther(v)).toFixed(d).replace(/\.?0+$/, "") || "0");
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const ago = (s: number) => (s < 60 ? `${Math.max(0, Math.floor(s))}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`);

async function loadAgent(id: number): Promise<Agent> {
  const d = DEPLOYMENT!, c = reader();
  const house = id <= 5;
  const awake = house || (await c.readContract({ address: d.fund, abi: ABI.fund, functionName: "claimed", args: [BigInt(id)] }));
  if (!awake) return { id, awake, house };
  const wallet = await c.readContract({ address: d.fund, abi: ABI.fund, functionName: "agentWallet", args: [BigInt(id)] });
  const code = await c.getCode({ address: wallet });
  if (!code || code === "0x") return { id, awake, house, wallet, deployed: false };
  const a = { address: wallet, abi: ABI.agent } as const;
  const [bal, locked, free, ruleVersion, lockedAt, pol, owner] = await Promise.all([
    c.getBalance({ address: wallet }),
    c.readContract({ ...a, functionName: "lockedNow" }), c.readContract({ ...a, functionName: "withdrawable" }),
    c.readContract({ ...a, functionName: "ruleVersion" }), c.readContract({ ...a, functionName: "starterLockedAt" }),
    c.readContract({ ...a, functionName: "policy" }), c.readContract({ ...a, functionName: "owner" }),
  ]);
  const out: Agent = { id, awake, house, wallet, deployed: true, bal, locked, free, lockedAt, ruleVersion: Number(ruleVersion),
    perTrade: pol[0], dailyCap: pol[1], live: pol[2], setBy: pol[3], owner };
  const ruleText = out.ruleVersion
    ? c.getContractEvents({ address: wallet, abi: ABI.agent, eventName: "RuleApplied", fromBlock: BigInt(d.startBlock) }).catch(() => []).then((logs) => {
        const hit = [...logs].reverse().find((l) => Number((l.args as { version?: number }).version) === out.ruleVersion);
        out.ruleText = ((hit?.args as { ruleUri?: string } | undefined)?.ruleUri) || null;
      })
    : Promise.resolve();
  try {
    const [version, original, offered, offers] = await Promise.all([ruleText,
      c.readContract({ ...a, functionName: "agentLogic" }), c.readContract({ ...a, functionName: "ORIGINAL_VERSION" }),
      c.readContract({ address: d.config, abi: ABI.config, functionName: "accountLogic" }), c.readContract({ address: d.config, abi: ABI.config, functionName: "accountLogicVersions" }),
    ]).then(([, ...rest]) => rest);
    Object.assign(out, { version, original, offered, offers: Number(offers) });
  } catch { await ruleText; /* older wallet without versions */ }
  return out;
}

/** The agents as last seen in this browser, shown instantly on the next visit while the chain is read again. */
const agentsKey = (me: string) => `trenchers:agents:${DEPLOYMENT?.nft}:${me.toLowerCase()}`;
function cachedAgents(me: string): Record<number, Agent> {
  try {
    const v = localStorage.getItem(agentsKey(me));
    return v ? JSON.parse(v, (_k, x) => (typeof x === "string" && /^\d+n$/.test(x) ? BigInt(x.slice(0, -1)) : x)) : {};
  } catch { return {}; }
}
function saveAgents(me: string, agents: Record<number, Agent>) {
  try { localStorage.setItem(agentsKey(me), JSON.stringify(agents, (_k, x) => (typeof x === "bigint" ? `${x}n` : x))); } catch { /* private mode */ }
}

export function LiveAgents() {
  const w = useWallet();
  const me = w.address as Address;
  const [ids, setIds] = useState<number[] | null>(null);
  const [agents, setAgents] = useState<Record<number, Agent>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [engine, setEngine] = useState<{ agents: EngineAgent[] } | null>(null);
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claim, setClaim] = useState<bigint>(0n);

  const refresh = useCallback(async (only?: number) => {
    try {
      const list = only ? ids ?? [] : await ownedTrenchers(me);
      if (!only) { setIds(list); setSelected((s) => (s && list.includes(s) ? s : list[0] ?? null)); }
      const targets = only ? [only] : list;
      // Each agent appears as soon as it's read, instead of waiting for all of them.
      await Promise.all(targets.map((id) => loadAgent(id).then((a) => setAgents((prev) => ({ ...prev, [a.id]: a })))));
      setError(null);
    } catch (e) { setError(reason(e)); if (!only) setIds((x) => x ?? []); }
  }, [me, ids]);

  useEffect(() => {
    setAgents(cachedAgents(me));
    // Show the Trenchers found last time straight away (and start reading them), then check the chain again.
    const cached = cachedOwned(me);
    setIds(cached);
    if (cached?.length) { setSelected((s) => (s && cached.includes(s) ? s : cached[0])); cached.forEach((id) => loadAgent(id).then((a) => setAgents((prev) => ({ ...prev, [a.id]: a }))).catch(() => {})); }
    refresh();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [me]);
  const [buying, setBuying] = useState(false);
  useEffect(() => { if (Object.keys(agents).length) saveAgents(me, agents); }, [agents, me]);
  useEffect(() => { reader().readContract({ address: DEPLOYMENT!.fund, abi: ABI.fund, functionName: "CLAIM" }).then(setClaim).catch(() => {}); }, []);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${ENGINE_URL}/arena`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (alive && j.agents) setEngine(j); }).catch(() => {});
    load(); const iv = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  useEffect(() => {
    if (task?.phase !== "done" && task?.phase !== "error") return;
    const t = setTimeout(() => setTask(null), task.phase === "done" ? 2500 : 7000);
    return () => clearTimeout(t);
  }, [task]);

  /** Runs one transaction with a visible task: checking → confirm in wallet → on-chain → done. */
  const run = async (label: string, fn: (phase: (p: "sign" | "chain") => void) => Promise<unknown>, refreshId?: number) => {
    setTask({ label, phase: "check" }); setError(null);
    try {
      await fn((p) => setTask({ label, phase: p }));
      setTask({ label, phase: "done" });
      await refresh(refreshId);
      return true;
    } catch (e) { setTask({ label, phase: "error", note: reason(e) }); return false; }
  };

  if (ids === null) return <Loader label="Finding your Trenchers" sub={`Reading ${short(me)} on ${chain.name}`} />;

  const base = selected ? agents[selected] : null;
  const busy = !!task && task.phase !== "done" && task.phase !== "error";
  const live = base ? engine?.agents.find((x) => x.id === base.id) ?? null : null;
  // If the chain's history couldn't be read for the rule text, the engine knows the current rule too.
  const sel = base && !base.ruleText && live?.rule ? { ...base, ruleText: live.rule } : base;

  return (
    <div className="ap live-ap">
      <header className="ap-top">
        <div>
          <p className="eyebrow">NFT / Agent Profile</p>
          <h1>Your agents</h1>
          <p className="ap-sub">Awaken, fund and guide each Trencher. The NFT is the agent&apos;s identity: its wallet, rules and track record all stay with it.</p>
        </div>
        <div className="ap-wallet mono"><span className="dot" />{short(me)}<span className="sample live-badge">{chain.testnet ? "Live · testnet" : "Live"}</span></div>
      </header>

      {error && <p className="notice">{error}</p>}

      {ids.length === 0 ? (
        <div className="connect-gate live-empty-gate">
          <h2>No Trenchers in this wallet yet</h2>
          <p className="lede">Mint one on trenchers.io (it gets its own agent wallet and starter balance), or buy one on OpenSea. If you hold Trenchers in another wallet, switch to it in your wallet app.</p>
          <div className="actions"><TextButton href={ROUTES.mint}>Mint a Trencher</TextButton>{OPENSEA_URL && <TextButton href={OPENSEA_URL} external>OpenSea</TextButton>}</div>
        </div>
      ) : (
        <div className="ap-roster" role="tablist" aria-label="Your Trenchers">
          {ids.map((id) => {
            const a = agents[id];
            return (
              <button key={id} type="button" role="tab" aria-selected={id === selected} className={`ap-card${id === selected ? " on" : ""}`} onClick={() => setSelected(id)}>
                <ArtCanvas id={id} size={56} className={`ap-card-art${a && !a.awake ? " is-dormant" : ""}`} />
                <span className="ap-card-text">
                  <b>Trencher #{id}</b>
                  <span className={`status mono ${!a ? "" : !a.awake ? "status-ready" : a.live && a.setBy === a.owner ? "status-live" : ""}`}>{!a ? "…" : !a.awake ? "Dormant" : a.house && !a.deployed ? "House agent" : a.live && a.setBy === a.owner ? "Trading" : "Awake"}</span>
                </span>
                <span className="mono ap-card-bal">{a?.bal !== undefined ? `${fmt(a.bal, 4)} ETH` : ""}</span>
              </button>
            );
          })}
          <button type="button" className="ap-card ap-card-buy" onClick={() => setBuying(true)}>
            <span className="ap-buy-plus" aria-hidden="true">+</span>
            <span className="ap-card-text"><b>Get another</b><span className="mono ap-buy-sub">Mint or buy on OpenSea</span></span>
          </button>
        </div>
      )}
      {buying && <BuyModal onClose={() => { setBuying(false); refresh(); }} />}

      {task && (
        <div className={`txbox mono live-task live-task-${task.phase}`} role="status">
          <p>{task.phase === "done" ? "✓" : task.phase === "error" ? "✕" : <span className="spin" />} {task.label}</p>
          <p className="txbox-note">{task.phase === "check" ? "Checking it will go through…" : task.phase === "sign" ? "Confirm in your wallet. Its window can open behind the browser, and some wallets take a minute to show it: if it says queued, open it and confirm." : task.phase === "chain" ? "Waiting for the network. This can take up to a minute while your wallet catches up." : task.phase === "done" ? "Done." : task.note}</p>
        </div>
      )}

      {sel?.deployed && <SectionNav key={`nav-${sel.id}`} items={NAV} />}
      {sel && <Profile key={sel.id} a={sel} me={me} claim={claim} live={live} engineCount={engine?.agents.length ?? 0} busy={busy} run={run} />}

      {ids.length > 0 && (
        <Fold id="track" title="Track your agents" sub="Their trading, live: value, positions, trades and rank">
          <LiveArena only={ids} />
        </Fold>
      )}
    </div>
  );
}

function Profile({ a, me, claim, live, engineCount, busy, run }: {
  a: Agent; me: Address; claim: bigint; live: EngineAgent | null; engineCount: number; busy: boolean;
  run: (label: string, fn: (phase: (p: "sign" | "chain") => void) => Promise<unknown>, refreshId?: number) => Promise<boolean>;
}) {
  const d = DEPLOYMENT!;
  const chatKey = `trenchers-chat-${me.toLowerCase()}-${a.id}`;
  const [chat, setChat] = useState<ChatMsg[]>(() => { try { return JSON.parse(localStorage.getItem(chatKey) || "[]"); } catch { return []; } });
  const saveChat = (c: ChatMsg[]) => { setChat(c); try { localStorage.setItem(chatKey, JSON.stringify(c.slice(-60))); } catch {} };
  const [perTrade, setPerTrade] = useState("");
  const [daily, setDaily] = useState("");
  const [dep, setDep] = useState("");
  const [wd, setWd] = useState("");
  useEffect(() => {
    setPerTrade(fmt(a.perTrade || claim / 2n, 6));
    setDaily(fmt(a.dailyCap || claim * 2n, 6));
    setDep(fmt(claim, 6));
  }, [a.perTrade, a.dailyCap, claim]);

  const trading = !!a.live && !!a.setBy && a.setBy === a.owner;
  const unlock = a.lockedAt ? new Date((Number(a.lockedAt) + LOCK_DAYS * 86400) * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  const tpl = a.ruleText ? TEMPLATES.find((t) => t.text === a.ruleText)?.name : undefined;
  const currentRule: CustomRule | null = a.ruleText ? parse(a.ruleText).rule : null;
  const upgrade = !!a.offers && a.offers > 1 && !!a.offered && a.version?.toLowerCase() !== a.offered.toLowerCase();
  const onCustom = !!a.version && !!a.original && a.version.toLowerCase() !== a.original.toLowerCase();
  const now = Date.now() / 1000;

  const limits = () => {
    const p = parseEther(perTrade || "0"), dc = parseEther(daily || "0");
    if (p <= 0n || dc <= 0n) throw new Error("Set both limits above zero.");
    if (dc < p) throw new Error("The daily limit can't be lower than the per-trade limit.");
    return [p, dc] as const;
  };
  const applyText = (text: string, label: string) => run(label, async (ph) => {
    const [p, dc] = limits();
    // Applying a rule never switches trading on by itself: that's the separate Start trading step.
    await sendCall(me, { address: a.wallet!, abi: ABI.agent, functionName: "setPolicy", args: [p, dc, trading, keccak256(toHex(text)), text] }, ph);
  }, a.id);
  const applyRule = async (rule: CustomRule, c: ChatMsg[]) => {
    const ok = await applyText(describe(rule), `Applying rule v${(a.ruleVersion ?? 0) + 1} to Trencher #${a.id}`);
    saveChat(ok ? c : c.map((m) => (m.rule === rule ? { ...m, status: "proposed" as const } : m)));
  };
  const saveLimits = () => run(`Updating #${a.id}'s limits`, async (ph) => {
    const [p, dc] = limits();
    await sendCall(me, { address: a.wallet!, abi: ABI.agent, functionName: "setPolicy", args: [p, dc, trading, zeroHash, ""] }, ph);
  }, a.id);
  const setTrading = (on: boolean) => run(on ? `Switching trading on for #${a.id}` : `Pausing #${a.id}`, async (ph) => {
    if (on) { const [p, dc] = limits(); await sendCall(me, { address: a.wallet!, abi: ABI.agent, functionName: "setPolicy", args: [p, dc, true, zeroHash, ""] }, ph); }
    else await sendCall(me, { address: a.wallet!, abi: ABI.agent, functionName: "pause" }, ph);
  }, a.id);
  const awaken = () => run(`Awakening Trencher #${a.id}`, async (ph) => {
    const c = reader();
    // If the fund is short because a mint's starter share is still in the splitter, move it first.
    const fundBal = await c.getBalance({ address: d.fund });
    if (fundBal < claim) {
      const owed = await c.readContract({ address: d.splitter, abi: ABI.splitter, functionName: "owed", args: [3] });
      if (owed > 0n) await sendCall(me, { address: d.splitter, abi: ABI.splitter, functionName: "release", args: [3] }, ph);
    }
    await sendCall(me, { address: d.fund, abi: ABI.fund, functionName: "claim", args: [BigInt(a.id)] }, ph);
  }, a.id);
  const createWallet = () => run(`Creating the agent wallet for #${a.id}`, (ph) =>
    sendCall(me, { address: d.registry, abi: ABI.registry, functionName: "createAccount", args: [d.impl, zeroHash, BigInt(chain.id), d.nft, BigInt(a.id)] }, ph), a.id);
  const deposit = () => run(`Depositing ${dep} ETH into #${a.id}`, (ph) => sendEth(me, a.wallet!, parseEther(dep || "0"), ph), a.id);
  const withdraw = () => run(`Withdrawing ${wd} ETH from #${a.id}`, async (ph) => {
    const v = parseEther(wd || "0");
    if (a.free !== undefined && v > a.free) throw new Error("StarterLocked");
    await sendCall(me, { address: a.wallet!, abi: ABI.agent, functionName: "withdraw", args: [v] }, ph);
    setWd("");
  }, a.id);
  const setVersion = (v: Address, label: string) => run(label, (ph) => sendCall(me, { address: a.wallet!, abi: ABI.agent, functionName: "setAgentVersion", args: [v] }, ph), a.id);

  const card = live ? cardFromLive(live, engineCount) : {
    id: a.id, returnPct: 0, pnlEth: 0, balanceEth: Number(formatEther(a.bal ?? 0n)), biggest: null, period: "This week",
    strategy: a.ruleVersion ? `Trained · rule v${a.ruleVersion}` : "No rule yet",
  };

  return (
    <div className="ap-main">
      <section className="ap-hero" id="sec-overview">
        <div className={`ap-art${a.awake ? "" : " is-dormant"}`}><ArtCanvas id={a.id} size={208} />{!a.awake && <span className="mono ap-art-tag">{fmt(claim)} ETH claimable</span>}</div>
        <div className="ap-id">
          <span className="mono ap-kick">Your agent</span>
          <h2>Trencher #{a.id}</h2>
          <div className="ap-chips">
            <span className={`status mono ${a.awake ? "status-live" : "status-ready"}`}>{a.awake ? "Awake" : "Dormant"}</span>
            {a.deployed && <span className="ap-chip mono">{trading ? "Trading" : "Paused"}</span>}
            {!!a.ruleVersion && <span className="ap-chip mono chip-rule">{tpl ? `Template · ${tpl}` : `Trained · rule v${a.ruleVersion}`}</span>}
            {a.house && <span className="ap-chip mono">House agent</span>}
          </div>
          {a.wallet && a.deployed ? (
            <p className="mono ap-wallet-line">Agent wallet <a href={`${EXPLORER}/address/${a.wallet}`} target="_blank" rel="noreferrer">{short(a.wallet)} ↗</a> · {chain.name}</p>
          ) : !a.awake ? (
            <p className="ap-wallet-line">Dormant: awaken it to give it its own wallet and its {fmt(claim)} ETH starter balance.</p>
          ) : null}
          <div className="agent-actions">{a.deployed && <PnlCardButton data={card} />}{a.deployed && <AgentLinks wallet={a.wallet} />}<span className="agent-links"><a className="tbtn" href={openseaItem(a.id)} target="_blank" rel="noreferrer">OpenSea ↗</a></span></div>
          {a.deployed && (
            <dl className="ap-kpis">
              <div><dt className="mono">Balance</dt><dd className="mono">{fmt(a.bal)} <small>ETH</small></dd>{(a.locked ?? 0n) > 0n && <span className="mono kpi-note">{fmt(a.locked)} starter, locked{unlock ? ` until ${unlock}` : ""}</span>}</div>
              <div><dt className="mono">Withdrawable</dt><dd className="mono">{fmt(a.free)} <small>ETH</small></dd><span className="mono kpi-note">instantly</span></div>
              <div><dt className="mono">This week</dt><dd className={`mono ${live ? (live.pnlPct >= 0 ? "up" : "down") : ""}`}>{live ? signed(live.pnlPct) : "—"}</dd><span className="mono kpi-note">{live ? `${live.trades} trades · rank ${live.rank} of ${engineCount}` : "no trades yet"}</span></div>
              <div><dt className="mono">Trading</dt><dd className="mono">{trading ? <span className="up">On</span> : "Paused"}</dd><span className="mono kpi-note">{a.ruleVersion ? `rule v${a.ruleVersion}` : "no rule yet"}</span></div>
            </dl>
          )}
        </div>
      </section>

      {!a.awake && (
        <section className="panel-card">
          <h3>Awaken Trencher #{a.id}</h3>
          <p>One transaction creates your Trencher&apos;s own agent wallet and moves the <b>{fmt(claim)} ETH</b> set aside from its mint into it. The art turns from grey to full colour.</p>
          <p className="muted-note">The starter balance stays locked in the agent for 6 months: it can trade with it, but you can&apos;t withdraw it until then. Anything you deposit yourself is withdrawable at any time.</p>
          <TextButton onClick={awaken} disabled={busy}>{`Awaken · claim ${fmt(claim)} ETH`}</TextButton>
        </section>
      )}

      {a.awake && a.deployed === false && (
        <section className="panel-card">
          <h3>Create this agent&apos;s wallet</h3>
          <p>House agents have no starter balance, so they aren&apos;t awakened. Create the agent wallet to fund it and give it a strategy.</p>
          <TextButton onClick={createWallet} disabled={busy}>Create agent wallet</TextButton>
        </section>
      )}

      {a.deployed && (<>
        {upgrade && (
          <section className="panel-card tn-upgrade-like">
            <h3>A new version of the agent wallet is available</h3>
            <p>Version 2 lets your agent deploy its own coin itself (the agent wallet becomes the coin&apos;s creator on Pons) and collect its creator fees at any time. It was announced 48 hours in advance, and your wallet doesn&apos;t change unless you choose to. Switching keeps the same address, balance, rules and track record, and you can switch back any time.</p>
            <div className="actions">
              <TextButton onClick={() => setVersion(a.offered!, `Switching #${a.id} to agent wallet version 2`)} disabled={busy}>Switch to version 2</TextButton>
              <TextButton href={`${EXPLORER}/address/${a.offered}#code`} external>View the new code</TextButton>
            </div>
          </section>
        )}





        <Fold id="funding" title="Funding" sub="Its balance, deposits and withdrawals, and its own coin">
          <div className="fold-stack">
            <section className="panel-card">
              <h3>Balance</h3>
              <div className="live-funds">
                <div>
                  <span className="mono live-lbl">Deposit</span>
                  <div className="live-row-in">
                    <span className="gf-limit-in"><input className="mono" inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} disabled={busy} aria-label="Deposit amount (ETH)" /><em className="mono">ETH</em></span>
                    <button type="button" className="gf-btn go" onClick={deposit} disabled={busy || !dep}>Deposit</button>
                  </div>
                </div>
                <div>
                  <span className="mono live-lbl">Withdraw · instant · {fmt(a.free)} ETH available</span>
                  <div className="live-row-in">
                    <span className="gf-limit-in"><input className="mono" inputMode="decimal" value={wd} placeholder="0.0" onChange={(e) => setWd(e.target.value)} disabled={busy} aria-label="Withdraw amount (ETH)" /><button type="button" className="live-max mono" onClick={() => setWd(formatEther(a.free ?? 0n))} disabled={busy || !a.free}>Max</button></span>
                    <button type="button" className="gf-btn ghost" onClick={withdraw} disabled={busy || !wd || !a.free}>Withdraw</button>
                  </div>
                </div>
              </div>
              {(a.locked ?? 0n) > 0n && <p className="live-lock">🔒 <b>{fmt(a.locked)} ETH is locked</b>: only the starter balance from awakening, for 6 months{unlock ? <> (until <b>{unlock}</b>)</> : null}. The agent can still trade with it. Your own deposits and any profits can be withdrawn instantly.</p>}
            </section>
            <CoinLaunch id={a.id} wallet={a.wallet!} me={me} bal={a.bal ?? 0n} busy={busy} run={run} />
          </div>
        </Fold>

        <Fold id="guide" title="Train your agent" sub="Strategy, limits, start or pause">
        <GuideFlow
          id={a.id} busy={busy}
          rule={a.ruleVersion ? { label: `Current rule · v${a.ruleVersion}${tpl ? ` · ${tpl}` : ""}`, text: a.ruleText ?? "Rule applied." } : null}
          warning={live?.ruleWarning}
          chat={{ rule: currentRule, msgs: chat, onChat: saveChat, onApply: applyRule,
            context: live ? `${live.trades} trades this week, ${live.pnlPct >= 0 ? "+" : ""}${live.pnlPct.toFixed(1)}% this week, win rate ${live.closed ? Math.round((live.wins / live.closed) * 100) : 0}%${live.biggest ? `, biggest trade ${live.biggest.pct.toFixed(0)}% on $${live.biggest.symbol}` : ""}, balance ${live.nav.toFixed(4)} ETH` : undefined }}
          templates={TEMPLATES}
          activeTemplate={tpl}
          onTemplate={(t) => applyText(t.text, `Applying ${t.name} to Trencher #${a.id}`)}
          limits={[
            { id: "pt", label: "Max per trade", unit: "ETH", value: perTrade, onChange: setPerTrade },
            { id: "pd", label: "Max per day", unit: "ETH", value: daily, onChange: setDaily },
          ]}
          onSaveLimits={saveLimits}
          trading={trading}
          onStart={() => setTrading(true)}
          onPause={() => setTrading(false)}
          arenaHref="/arena#live"
        />
        </Fold>

        <Fold id="trades" title="Trades" sub="Everything it bought and sold">
        <section className="panel-card">
          <h3>Trades</h3>
          {live?.recent.length ? (
            <ol className="trades mono">
              {live.recent.map((t) => (
                <li key={`${t.tx}-${t.side}`}>
                  <span className="t-ago">{ago(now - t.time)}</span>
                  <b className={t.side === "buy" ? "up" : "down"}>{t.side.toUpperCase()}</b>
                  <span className="t-sym">${t.symbol ?? t.token.slice(2, 8)}</span>
                  <span className="t-eth"><a href={`${EXPLORER}/tx/${t.tx}`} target="_blank" rel="noreferrer">{Number(t.eth).toFixed(5)} ETH ↗</a></span>
                  <span className={`t-pnl ${t.pnlPct === undefined ? "" : t.pnlPct >= 0 ? "up" : "down"}`}>{t.pnlPct === undefined ? "" : signed(t.pnlPct)}</span>
                  <span className="t-card">{t.side === "sell" && t.pnlPct !== undefined && <PnlCardButton data={tradeCard(card, t)} label="Card" />}</span>
                </li>
              ))}
            </ol>
          ) : <p className="empty">No trades yet. Every sell gets its own shareable PnL card here. Once it has a rule and trading is on, its trades show up here and in the <a href="/arena#live">live Arena</a>.</p>}
        </section>
        </Fold>

        {onCustom && (
          <p className="muted-note live-version">This wallet runs a newer version you opted in to. <button type="button" className="tbtn" onClick={() => setVersion(a.original!, `Switching #${a.id} back to the original wallet code`)} disabled={busy}>Switch back to the original</button></p>
        )}
      </>)}
    </div>
  );
}

/** Mint another Trencher right here, or buy one on OpenSea. */
function BuyModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal buy-modal" role="dialog" aria-modal="true" aria-label="Get another Trencher">
        <div className="modal-head"><h2>Get another Trencher</h2><button type="button" className="tbtn" onClick={onClose}>Close</button></div>
        <MintPanel />
        <div className="buy-or mono"><span>or</span></div>
        <a className="buy-os" href={OPENSEA_URL || "https://opensea.io"} target="_blank" rel="noreferrer">
          <b>Buy one on OpenSea ↗</b>
          <small>Pick a Trencher that&apos;s already awake and trading, with its wallet and track record.</small>
        </a>
        <p className="muted-note">New Trenchers show up in your agents after you close this.</p>
      </div>
    </div>,
    document.body,
  );
}
