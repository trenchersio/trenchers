"use client";
import { useEffect, useState } from "react";
import { TextButton } from "@/components/TextButton";
import { OPENSEA_URL, ROUTES, SAMPLE_MODE, chain } from "@/lib/constants";
import { short, useWallet } from "@/lib/wallet";
import {
  PRESETS, agentWalletFor, identityFor, loadAgent, ownedIds, saveAgent, statusOf, wait,
  type AgentState, type Preset, type Strategy,
} from "@/lib/agents-store";

export function MyAgents() {
  const w = useWallet();
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (!w.address) { setAgents([]); return; }
    const list = ownedIds(w.address).map((id) => loadAgent(w.address!, id));
    setAgents(list);
    setSelected((s) => (s && list.some((a) => a.id === s) ? s : list[0]?.id ?? null));
  }, [w.address]);

  if (!w.ready) return <div className="arena-loading mono">Loading…</div>;

  if (!w.address) {
    return (
      <div className="connect-gate">
        <p className="eyebrow">Your agents</p>
        <h1>Connect to see your Trenchers</h1>
        <p className="lede">Connect the wallet that holds your Trenchers to register them as agents, fund them and send them into the Arena.</p>
        <TextButton large onClick={w.openModal}>Connect wallet</TextButton>
      </div>
    );
  }

  const update = (a: AgentState) => {
    saveAgent(w.address!, a);
    setAgents((list) => list.map((x) => (x.id === a.id ? a : x)));
  };
  const sel = agents.find((a) => a.id === selected) ?? null;

  return (
    <div className="agents">
      <section className="board agents-board" aria-label="Your Trenchers">
        <div className="board-head">
          <h1>Your Trenchers</h1>
          <span className="board-meta">{short(w.address)}</span>
          {(SAMPLE_MODE || w.kind === "demo") && <span className="sample">Sample data</span>}
        </div>
        <ul className="agents-list">
          {agents.map((a) => {
            const st = statusOf(a);
            return (
              <li key={a.id}>
                <button type="button" className={`agent-item${a.id === selected ? " active" : ""}`} onClick={() => setSelected(a.id)}>
                  <img src={`nft/${a.id}.webp`} alt="" width={56} height={56} />
                  <span className="agent-item-text">
                    <span className="agent-item-name">Trencher #{a.id}</span>
                    <span className={`status status-${st.tone} mono`}>{st.label}</span>
                  </span>
                  <span className="mono agent-item-bal">{a.registered ? `${a.balance.toFixed(3)} ETH` : ""}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="agents-foot">
          <p>Want another agent?</p>
          {OPENSEA_URL ? <TextButton href={OPENSEA_URL} external>Buy on OpenSea</TextButton> : <TextButton disabled>OpenSea listing soon</TextButton>}
        </div>
      </section>

      <section className="detail" aria-label="Agent setup">
        {sel && <Setup key={sel.id} a={sel} owner={w.address} onChange={update} />}
      </section>
    </div>
  );
}

function Setup({ a, owner, onChange }: { a: AgentState; owner: string; onChange: (a: AgentState) => void }) {
  const [busy, setBusy] = useState<string[] | null>(null);
  const [amount, setAmount] = useState("0.1");
  const [draft, setDraft] = useState<Strategy>(a.strategy ?? { preset: "Momentum", ...PRESETS.Momentum.defaults });
  const [notice, setNotice] = useState<string | null>(null);
  const st = statusOf(a);
  const step = !a.registered ? 1 : a.balance <= 0 ? 2 : !a.strategy ? 3 : 4;

  const log = (x: AgentState, text: string): AgentState => ({ ...x, log: [{ t: Date.now(), text }, ...x.log].slice(0, 20) });

  async function run(lines: string[], finish: () => void) {
    setNotice(null);
    const shown: string[] = [];
    for (const l of lines) { shown.push(l); setBusy([...shown]); await wait(900); }
    finish(); setBusy(null);
  }

  const register = () => run(["Creating the agent wallet (ERC-6551)…", "Registering the agent identity (ERC-8004)…"], () => {
    onChange(log({ ...a, registered: true, agentWallet: agentWalletFor(owner, a.id), identityId: identityFor(a.id) }, "Registered as an agent"));
  });

  const deposit = () => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v < 0.01) { setNotice("Deposit at least 0.01 ETH."); return; }
    run([`Sending ${v} ETH to the agent wallet…`], () => onChange(log({ ...a, balance: +(a.balance + v).toFixed(4) }, `Deposited ${v} ETH`)));
  };

  const withdraw = () => {
    if (a.balance <= 0) return;
    const v = a.balance;
    run(["Withdrawing to your wallet…"], () => onChange(log({ ...a, balance: 0, live: false }, `Withdrew ${v.toFixed(4)} ETH${a.live ? ", trading paused" : ""}`)));
  };

  const saveStrategy = () => {
    if (draft.perBuy <= 0 || draft.dailyCap < draft.perBuy || draft.maxPositions < 1) {
      setNotice("Check the limits: the daily cap must be at least one buy, and at least one position is needed.");
      return;
    }
    run(["Signing the strategy…", "Setting on-chain spending limits…"], () => onChange(log({ ...a, strategy: draft }, `Strategy set: ${draft.preset}`)));
  };

  const enter = () => run(["Enabling trading for this agent…"], () => onChange(log({ ...a, live: true }, "Entered the Arena")));
  const pause = () => run(["Pausing trading…"], () => onChange(log({ ...a, live: false }, "Trading paused")));

  return (
    <div className="detail-inner">
      <header className="detail-head">
        <img src={`nft/${a.id}.webp`} alt={`Trencher #${a.id}`} width={88} height={88} />
        <div>
          <p className="eyebrow">Your agent</p>
          <h2>Trencher #{a.id}</h2>
          <p className="mono who-line"><span className={`status status-${st.tone}`}>{st.label}</span></p>
          {a.agentWallet && <p className="mono who-line">Agent wallet {short(a.agentWallet)} · Identity #{a.identityId} on {chain.name}</p>}
        </div>
      </header>

      {busy && (
        <div className="txbox mono" role="status">
          {busy.map((l, i) => <p key={l}>{i < busy.length - 1 ? "✓" : <span className="spin" />} {l}</p>)}
          <p className="txbox-note">{SAMPLE_MODE ? "Sample mode: simulated, nothing is sent on-chain." : "Confirm in your wallet."}</p>
        </div>
      )}
      {notice && <p className="notice">{notice}</p>}

      <ol className="steps-v">
        <Step n={1} title="Register as an agent" state={a.registered ? "done" : step === 1 ? "now" : "todo"}>
          {a.registered ? (
            <p>Registered. Your Trencher has its own wallet and an on-chain identity. Both stay with the NFT if you sell it.</p>
          ) : (<>
            <p>Gives your Trencher its own wallet and an on-chain agent identity. Two transactions, paid in gas only.</p>
            <TextButton onClick={register} disabled={!!busy}>Register agent</TextButton>
          </>)}
        </Step>

        <Step n={2} title="Fund the agent wallet" state={!a.registered ? "todo" : a.balance > 0 ? "done" : "now"}>
          <p>The agent trades with the ETH in its own wallet. Only you can withdraw it.</p>
          <div className="fund-row">
            <span className="balance mono"><small>Balance</small>{a.balance.toFixed(4)} ETH</span>
            <label className="field">
              <span>Amount (ETH)</span>
              <input id={`amt-${a.id}`} className="mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!a.registered || !!busy} />
            </label>
            <div className="chips">
              {["0.05", "0.1", "0.25"].map((v) => <button key={v} type="button" className={`tbtn${amount === v ? " tbtn-on" : ""}`} onClick={() => setAmount(v)} disabled={!a.registered || !!busy}>{v}</button>)}
            </div>
          </div>
          <div className="actions">
            <TextButton onClick={deposit} disabled={!a.registered || !!busy}>Deposit</TextButton>
            {a.balance > 0 && <TextButton onClick={withdraw} disabled={!!busy}>Withdraw all</TextButton>}
          </div>
        </Step>

        <Step n={3} title="Choose a strategy" state={!a.registered || a.balance <= 0 ? "todo" : a.strategy ? "done" : "now"}>
          <div className="presets" role="radiogroup" aria-label="Strategy">
            {(Object.keys(PRESETS) as Preset[]).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={draft.preset === p}
                className={`tbtn${draft.preset === p ? " tbtn-on" : ""}`}
                onClick={() => setDraft({ preset: p, ...PRESETS[p].defaults })} disabled={!!busy}>{p}</button>
            ))}
          </div>
          <p className="preset-line">{PRESETS[draft.preset].line} <span className="mono">{PRESETS[draft.preset].rules.join(" · ")}</span></p>
          <div className="limits">
            <label className="field"><span>ETH per buy</span>
              <input id={`pb-${a.id}`} className="mono" inputMode="decimal" value={draft.perBuy} onChange={(e) => setDraft({ ...draft, perBuy: Number(e.target.value) || 0 })} /></label>
            <label className="field"><span>Daily cap (ETH)</span>
              <input id={`dc-${a.id}`} className="mono" inputMode="decimal" value={draft.dailyCap} onChange={(e) => setDraft({ ...draft, dailyCap: Number(e.target.value) || 0 })} /></label>
            <label className="field"><span>Max open positions</span>
              <input id={`mp-${a.id}`} className="mono" inputMode="numeric" value={draft.maxPositions} onChange={(e) => setDraft({ ...draft, maxPositions: Math.round(Number(e.target.value)) || 0 })} /></label>
          </div>
          <p className="hint-line">These limits are enforced by the agent wallet itself. The trading engine can never spend more, or withdraw.</p>
          <TextButton onClick={saveStrategy} disabled={!a.registered || a.balance <= 0 || !!busy}>{a.strategy ? "Update strategy" : "Save strategy"}</TextButton>
        </Step>

        <Step n={4} title="Enter the Arena" state={a.live ? "done" : step === 4 ? "now" : "todo"}>
          {a.live ? (<>
            <p>Trading. Your agent is competing in this week&apos;s epoch.</p>
            <div className="actions">
              <TextButton href={ROUTES.arena}>View in the Arena</TextButton>
              <TextButton onClick={pause} disabled={!!busy}>Pause trading</TextButton>
            </div>
          </>) : (<>
            <p>Switch trading on. Your agent starts following its strategy and appears on the live leaderboard. Pause any time.</p>
            <TextButton onClick={enter} disabled={step < 4 || !!busy}>Enter the Arena</TextButton>
          </>)}
        </Step>
      </ol>

      {a.log.length > 0 && (
        <div className="panel-block">
          <h3>Activity</h3>
          <ol className="trades mono">
            {a.log.map((l) => <li key={l.t} className="log-li"><span className="t-ago">{new Date(l.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span>{l.text}</span></li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, state, children }: { n: number; title: string; state: "done" | "now" | "todo"; children: React.ReactNode }) {
  return (
    <li className={`step step-${state}`}>
      <span className="step-mark mono" aria-hidden="true">{state === "done" ? "✓" : n}</span>
      <div className="step-body">
        <h3>{title}{state === "done" && <span className="sr-only"> (done)</span>}</h3>
        <div className="step-content">{children}</div>
      </div>
    </li>
  );
}
