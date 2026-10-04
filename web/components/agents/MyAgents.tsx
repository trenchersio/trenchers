"use client";
import { AgentLinks } from "@/components/AgentLinks";
import { useEffect, useState } from "react";
import { TextButton } from "@/components/TextButton";
import { CustomBuilder, NumField } from "./CustomBuilder";
import { Launchpad } from "./Launchpad";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { AgentChat } from "./AgentChat";
import { AGENT_FEE_SHARE_PCT, tokenFees, trenchersShare, type TokenDraft } from "@/lib/agent-token";
import { DEFAULT_RULE, describe, validate, type CustomRule } from "@/lib/custom-strategy";
import { OPENSEA_URL, ROUTES, SAMPLE_MODE, STARTER_ETH, STARTER_LOCK_DAYS, chain } from "@/lib/constants";
import { short, useWallet } from "@/lib/wallet";
import {
  PRESETS, agentWalletFor, identityFor, tokenAddressFor, loadAgent, ownedIds, saveAgent, statusOf, wait,
  type AgentState, type ChatMsg, type Preset, type Strategy,
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
        <p className="eyebrow">NFT / Agent Profile</p>
        <h1>Connect to see your Trenchers</h1>
        <p className="lede">Connect the wallet that holds your Trenchers to register them as agents, fund them, launch their own tokens and send them into the Arena.</p>
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
    <div className="ap">
      <header className="ap-top">
        <div>
          <p className="eyebrow">NFT / Agent Profile</p>
          <h1>Your agents</h1>
          <p className="ap-sub">Awaken, fund and guide each Trencher. The NFT is the agent&apos;s identity: its wallet, coin, rules and record all stay with it.</p>
        </div>
        <div className="ap-wallet mono">
          <span className={`dot ${w.kind === "demo" ? "dot-demo" : ""}`} />{short(w.address)}
          {(SAMPLE_MODE || w.kind === "demo") && <span className="sample">Sample data</span>}
        </div>
      </header>

      <div className="ap-roster" role="tablist" aria-label="Your Trenchers">
        {agents.map((a) => {
          const st = statusOf(a);
          return (
            <button key={a.id} type="button" role="tab" aria-selected={a.id === selected} className={`ap-card${a.id === selected ? " on" : ""}`} onClick={() => setSelected(a.id)}>
              <ArtCanvas id={a.id} size={56} className={`ap-card-art${a.starterClaimed ? "" : " is-dormant"}`} />
              <span className="ap-card-text">
                <b>Trencher #{a.id}</b>
                <span className={`status status-${st.tone} mono`}>{st.label}</span>
              </span>
              <span className="mono ap-card-bal">{a.registered ? `${a.balance.toFixed(3)} ETH` : ""}</span>
            </button>
          );
        })}
        <div className="ap-card ap-card-more">
          <span className="ap-plus" aria-hidden="true">+</span>
          <span className="ap-card-text"><b>Another agent?</b>{OPENSEA_URL ? <TextButton href={OPENSEA_URL} external>OpenSea</TextButton> : <span className="tbtn tbtn-static">OpenSea</span>}</span>
        </div>
      </div>

      {sel && <Setup key={sel.id} a={sel} owner={w.address} onChange={update} />}
    </div>
  );
}

function Setup({ a, owner, onChange }: { a: AgentState; owner: string; onChange: (a: AgentState) => void }) {
  const [busy, setBusy] = useState<string[] | null>(null);
  const [amount, setAmount] = useState("0.02");
  const [draft, setDraft] = useState<Strategy>(a.strategy ?? { preset: "Custom", ...PRESETS["Custom"].defaults, custom: undefined });
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"register" | "coin" | "strategy" | "activity">(
    !a.registered || !a.starterClaimed || (!a.token && !a.fundingMode) ? "register" : a.fundingMode === "coin" && !a.token ? "coin" : "strategy");
  const st = statusOf(a);
  const locked = Math.min(a.locked ?? 0, a.balance);
  const withdrawable = +(a.balance - locked).toFixed(4);
  const unlockDate = new Date((a.registeredAt ?? Date.now()) + STARTER_LOCK_DAYS * 86_400_000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const step = !a.registered ? 1 : !a.starterClaimed && a.balance <= 0 ? 2 : !a.strategy ? 5 : 6;

  const log = (x: AgentState, text: string): AgentState => ({ ...x, log: [{ t: Date.now(), text }, ...x.log].slice(0, 20) });

  async function run(lines: string[], finish: () => void) {
    setNotice(null);
    const shown: string[] = [];
    for (const l of lines) { shown.push(l); setBusy([...shown]); await wait(900); }
    finish(); setBusy(null);
  }

  const awaken = () => run([
    "Creating the agent wallet (ERC-6551)…",
    `Claiming ${STARTER_ETH} ETH from the Agent Starter Fund into it…`,
    "Registering the agent identity (ERC-8004)…",
  ], () => {
    const v = Number(STARTER_ETH);
    onChange(log({ ...a, registered: true, registeredAt: Date.now(), agentWallet: agentWalletFor(owner, a.id), identityId: identityFor(a.id), starterClaimed: true, balance: +(a.balance + v).toFixed(4), locked: +((a.locked ?? 0) + v).toFixed(4) }, `Awakened: agent wallet created, ${STARTER_ETH} ETH starter claimed`));
  });

  const claimStarter = () => run([
    "Claiming from the Agent Starter Fund…",
    `Sending ${STARTER_ETH} ETH into the agent wallet…`,
  ], () => {
    const v = Number(STARTER_ETH);
    onChange(log({ ...a, starterClaimed: true, balance: +(a.balance + v).toFixed(4), locked: +((a.locked ?? 0) + v).toFixed(4) }, `Claimed the ${STARTER_ETH} ETH starter balance`));
  });

  const deposit = () => {
    const v = Number(amount);
    if (!Number.isFinite(v) || v < 0.005) { setNotice("Deposit at least 0.005 ETH."); return; }
    run([`Sending ${v} ETH to the agent wallet…`], () => onChange(log({ ...a, balance: +(a.balance + v).toFixed(4) }, `Deposited ${v} ETH`)));
  };

  const withdraw = () => {
    if (withdrawable <= 0) return;
    const v = withdrawable;
    run(["Withdrawing to your wallet…"], () => onChange(log({ ...a, balance: +(a.balance - v).toFixed(4) }, `Withdrew ${v.toFixed(4)} ETH`)));
  };

  const saveStrategy = () => {
    if (!(draft.perBuy > 0) || !(draft.dailyCap >= draft.perBuy) || !(draft.maxPositions >= 1)) {
      setNotice("Check the limits: the daily cap must be at least one buy, and at least one position is needed.");
      return;
    }
    if (draft.preset === "Custom") {
      const problem = validate(draft.custom ?? DEFAULT_RULE);
      if (problem) { setNotice(problem); return; }
    }
    const saved = draft.preset === "Custom" ? { ...draft, custom: draft.custom ?? DEFAULT_RULE } : { ...draft, custom: undefined };
    const what = saved.custom ? `Custom: ${describe(saved.custom)}` : saved.preset;
    run(["Signing the strategy…", "Setting on-chain spending limits…"], () => onChange(log({ ...a, strategy: saved }, `Strategy set: ${what}`)));
  };

  const applyTemplate = (k: Preset) => {
    const saved: Strategy = { preset: k, ...PRESETS[k].defaults, custom: undefined };
    setDraft(saved);
    const intro: ChatMsg = { role: "agent", t: Date.now(), text: `Running the ${k} template: ${PRESETS[k].line.toLowerCase()}, ${PRESETS[k].rules.join(", ").toLowerCase()}. Tell me what to change and I'll make it your own.` };
    run(["Signing the template…", "Setting on-chain spending limits…"], () => onChange(log({ ...a, strategy: saved, chat: [...(a.chat ?? []), intro] }, `Template set: ${k}`)));
  };

  const applyRule = (rule: CustomRule, chat: ChatMsg[]) => {
    const limits = { perBuy: draft.perBuy, dailyCap: draft.dailyCap, maxPositions: draft.maxPositions };
    if (!(limits.perBuy > 0) || !(limits.dailyCap >= limits.perBuy) || !(limits.maxPositions >= 1)) { setNotice("Check the limits in step 2 first."); return; }
    const saved: Strategy = { preset: "Custom", ...limits, custom: rule };
    setDraft(saved);
    run(["Signing the new rule…", "Updating the agent's policy…"], () => onChange(log({ ...a, chat, strategy: saved }, `Guidance applied: ${describe(rule)}`)));
  };

  const enter = () => run(["Enabling trading for this agent…"], () => onChange(log({ ...a, live: true }, "Entered the Arena")));
  const launchToken = (d: TokenDraft) => new Promise<void>((done) => run([
    "Uploading the token image and details…",
    `Launching $${d.symbol} on Pons from the agent wallet…`,
    "Setting the agent wallet as fee recipient…",
  ], () => {
    onChange(log({ ...a, balance: +(a.balance - 0.0012).toFixed(4), locked: Math.max(0, +((a.locked ?? 0) - 0.0012).toFixed(4)), token: { ...d, address: tokenAddressFor(owner, a.id), launchedAt: Date.now(), feeRate: 0.02 + (a.id % 7) * 0.006 } }, `Launched $${d.symbol} on Pons`));
    done();
  }));

  const chooseCoin = () => { onChange(log({ ...a, fundingMode: "coin" }, "Chose option A: launch an agent coin")); setTab("coin"); };
  const chooseSelf = () => { onChange(log({ ...a, fundingMode: "self" }, "Chose option B: self-funded from the $TRENCHERS fee share and trading profits")); setTab("strategy"); };

  const pause = () => run(["Pausing trading…"], () => onChange(log({ ...a, live: false }, "Trading paused")));

  const versions = (a.chat ?? []).filter((m) => m.status === "applied").length;
  const funding = a.token ? `Coin $${a.token.symbol}` : a.fundingMode === "self" ? "Self-funded" : a.fundingMode === "coin" ? "Coin (not launched)" : "Not chosen";

  return (
    <div className="ap-main">
      <section className="ap-hero">
        <div className={`ap-art${a.starterClaimed ? "" : " is-dormant"}`}><ArtCanvas id={a.id} size={208} />{!a.starterClaimed && <span className="mono ap-art-tag">{STARTER_ETH} ETH claimable</span>}</div>
        <div className="ap-id">
          <span className="mono ap-kick">Your agent</span>
          <h2>Trencher #{a.id}</h2>
          <div className="ap-chips">
            <span className={`status status-${st.tone} mono`}>{st.label}</span>
            {a.registered && <span className={`ap-chip mono ${a.token ? "chip-coin" : a.fundingMode === "self" ? "chip-self" : ""}`}>Funding · {funding}</span>}
            {a.strategy && <span className="ap-chip mono chip-rule">{a.strategy.preset === "Custom" ? `Guided · rule v${Math.max(1, versions)}` : `Template · ${a.strategy.preset}`}</span>}
          </div>
          {a.agentWallet ? (
            <p className="mono ap-wallet-line">Agent wallet {short(a.agentWallet)} · Identity #{a.identityId} · {chain.name}</p>
          ) : (
            <p className="ap-wallet-line">Dormant: awaken it below to give it a wallet, an identity and its 0.01 ETH.</p>
          )}
          <AgentLinks wallet={a.agentWallet} />
          <dl className="ap-kpis">
            <div><dt className="mono">Balance</dt><dd className="mono">{a.balance.toFixed(4)} <small>ETH</small></dd>{locked > 0 && <span className="mono kpi-note">{locked.toFixed(3)} starter, locked until {unlockDate}</span>}</div>
            <SelfFundedKpi a={a} />
            <div><dt className="mono">Guidance</dt><dd className="mono">{versions ? `v${versions}` : "—"}</dd><span className="mono kpi-note">{versions ? `${versions} rule${versions > 1 ? "s" : ""} applied` : "Talk to it in section 3"}</span></div>
            <div><dt className="mono">Arena</dt><dd className="mono">{a.live ? <span className="up">Live</span> : a.strategy ? "Ready" : "—"}</dd><span className="mono kpi-note">{a.live ? "Competing this week" : "Not entered"}</span></div>
          </dl>
        </div>
      </section>

      {busy && (
        <div className="txbox mono" role="status">
          {busy.map((l, i) => <p key={l}>{i < busy.length - 1 ? "✓" : <span className="spin" />} {l}</p>)}
          <p className="txbox-note">{SAMPLE_MODE ? "Sample mode: simulated, nothing is sent on-chain." : "Confirm in your wallet."}</p>
        </div>
      )}
      {notice && <p className="notice">{notice}</p>}

      <div className="segs" role="tablist" aria-label="Agent profile sections">
        {([
          ["register", "1", "Awaken", a.registered && a.starterClaimed ? "done" : ""],
          ["coin", "2", a.token ? `Coin $${a.token.symbol}` : "Coin launchpad", a.token ? "done" : a.fundingMode === "self" ? "skip" : "opt"],
          ["strategy", "3", "Guide your agent", a.live ? "done" : ""],
        ] as const).map(([k, n, label, state]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`seg${tab === k ? " seg-on" : ""}${state === "done" ? " seg-done" : ""}`} onClick={() => setTab(k)}>
            <span className="seg-n mono">{state === "done" ? "✓" : n}</span>
            <span className="seg-text"><b>{label}</b><small className="mono">{state === "opt" ? "Optional · option A" : state === "skip" ? "Skipped · self-funded (B)" : state === "done" ? "Done" : k === "register" ? `Wallet, identity, +${STARTER_ETH} ETH` : "Talk to it, set limits, compete"}</small></span>
          </button>
        ))}
        <button type="button" role="tab" aria-selected={tab === "activity"} className={`tbtn seg-log${tab === "activity" ? " tbtn-on" : ""}`} onClick={() => setTab("activity")}>Activity</button>
      </div>

      {tab === "coin" && (<>
        <Launchpad a={a} busy={!!busy} onLaunch={launchToken} />
        {!a.token && (
          <div className="seg-foot">
            <span>Rather not launch a coin?</span>
            <TextButton onClick={chooseSelf} disabled={!a.registered || !!busy}>Self-fund instead (option B)</TextButton>
          </div>
        )}
      </>)}

      {tab === "register" && <ol className="steps-v">
        <Step n={1} title="Awaken your Trencher" state={a.registered && a.starterClaimed ? "done" : "now"}>
          {a.registered && a.starterClaimed ? (
            <p>Awake. Your Trencher has its own wallet, an on-chain identity and {STARTER_ETH} ETH of starter balance, locked for trading until {unlockDate}. All of it stays with the NFT if you sell it.</p>
          ) : a.registered ? (<>
            <p>The wallet exists but the {STARTER_ETH} ETH starter balance is still waiting in the Agent Starter Fund.</p>
            <TextButton onClick={claimStarter} disabled={!!busy}>{`Claim ${STARTER_ETH} ETH`}</TextButton>
          </>) : (<>
            <p>One transaction does it all: it creates your Trencher&apos;s own wallet, claims the <b>{STARTER_ETH} ETH</b> set aside from your purchase straight into it, and gives it an on-chain identity. The art turns from grey to full colour on OpenSea and its traits change from Dormant to Awake.</p>
            <p className="muted-note">The starter balance is locked in the agent for 6 months: it can pay for a coin launch or trades, but can&apos;t be withdrawn until then. Anything you deposit yourself stays withdrawable at any time.</p>
            <TextButton onClick={awaken} disabled={!!busy}>{`Awaken · claim ${STARTER_ETH} ETH`}</TextButton>
          </>)}
        </Step>

        <Step n={2} title="Choose how your agent funds itself" state={a.token || a.fundingMode === "self" ? "done" : a.starterClaimed ? "now" : "todo"}>
          <div className="ab">
            <button type="button" className={`ab-opt ab-a${a.fundingMode === "coin" || a.token ? " ab-on" : ""}`} onClick={chooseCoin} disabled={!a.registered || !!busy}>
              <span className="sf-letter">A</span>
              <span><b>Let it launch a coin</b><small>Opens the coin launchpad. Every creator fee goes to the agent.</small></span>
            </button>
            <button type="button" className={`ab-opt ab-b${a.fundingMode === "self" && !a.token ? " ab-on" : ""}`} onClick={chooseSelf} disabled={!a.registered || !!busy}>
              <span className="sf-letter">B</span>
              <span><b>Let it self-fund</b><small>No coin: its $TRENCHERS fee share and trading profits keep it going.</small></span>
            </button>
          </div>
        </Step>

        <Step n={3} title="Top up (optional)" state={!a.registered ? "todo" : a.balance > Number(STARTER_ETH) || (!a.starterClaimed && a.balance > 0) ? "done" : "todo"}>
          <p>Add your own ETH whenever you want more trading capital. Anything you deposit stays withdrawable; only the starter balance is locked, for 6 months.</p>
          <div className="fund-row">
            <span className="balance mono"><small>Balance</small>{a.balance.toFixed(4)} ETH{locked > 0 && <em className="locked-note">{locked.toFixed(4)} starter, locked until {unlockDate}</em>}</span>
            <label className="field">
              <span>Amount (ETH)</span>
              <input id={`amt-${a.id}`} className="mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!a.registered || !!busy} />
            </label>
            <div className="chips">
              {["0.01", "0.02", "0.05"].map((v) => <button key={v} type="button" className={`tbtn${amount === v ? " tbtn-on" : ""}`} onClick={() => setAmount(v)} disabled={!a.registered || !!busy}>{v}</button>)}
            </div>
          </div>
          <div className="actions">
            <TextButton onClick={deposit} disabled={!a.registered || !!busy}>Deposit</TextButton>
            {withdrawable > 0 && <TextButton onClick={withdraw} disabled={!!busy}>{`Withdraw ${withdrawable.toFixed(4)} ETH`}</TextButton>}
          </div>
        </Step>
      </ol>}

      {tab === "strategy" && <ol className="steps-v">
        <Step n={1} title="Talk to your agent" state={!a.registered || a.balance <= 0 ? "todo" : a.strategy ? "done" : "now"}>
          <p>This is where your edge comes from. Tell your agent how to trade in plain English and keep guiding it as the market changes. Every message becomes a rule you confirm; the agent then executes it 24/7, without fear or greed.</p>
          <div className="guide-grid">
            <div className="guide-chat">
              <AgentChat id={a.id} rule={a.strategy?.custom ?? null} chat={a.chat ?? []} disabled={!a.registered || a.balance <= 0 || !!busy}
                onChat={(c) => onChange({ ...a, chat: c })}
                onApply={(rule, c) => applyRule(rule, c)} />
              {(!a.registered || a.balance <= 0) && <p className="hint-line">Register and claim the starter balance first (section 1).</p>}
              <details className="alt-ways">
                <summary className="mono">Edit the rule as a form</summary>
                <div className="alt-body">
                  <CustomBuilder idPrefix={`c-${a.id}`} rule={draft.custom ?? a.strategy?.custom ?? DEFAULT_RULE} onChange={(r) => setDraft({ ...draft, preset: "Custom", custom: r })} disabled={!!busy} />
                  <TextButton onClick={saveStrategy} disabled={!a.registered || a.balance <= 0 || !!busy || draft.preset !== "Custom"}>Save this rule</TextButton>
                </div>
              </details>
            </div>
            <aside className="tpl" aria-label="House templates">
              <span className="mono ap-kick">House templates</span>
              <p>Start from a strategy the team runs in public, then talk your agent into something better. Templates never adapt on their own.</p>
              <ul>
                {(Object.keys(PRESETS) as Preset[]).filter((k) => k !== "Custom").map((k) => {
                  const on = a.strategy?.preset === k;
                  return (
                    <li key={k} className={on ? "on" : undefined}>
                      <div className="tpl-top"><b>{k}</b><span className="mono">#{PRESETS[k].house}</span></div>
                      <p>{PRESETS[k].line}. {PRESETS[k].rules.join(" · ")}.</p>
                      <TextButton onClick={() => applyTemplate(k)} disabled={!a.registered || a.balance <= 0 || !!busy}>{on ? "Active" : "Start from this"}</TextButton>
                    </li>
                  );
                })}
              </ul>
            </aside>
          </div>
        </Step>

        <Step n={2} title="Set its limits" state={!a.strategy ? "todo" : "done"}>
          <p>Hard caps enforced by the agent wallet itself. Whatever you tell the agent, the trading engine can never spend more than this, or withdraw.</p>
          <div className="limits">
            <NumField id={`pb-${a.id}`} label="ETH per buy" value={draft.perBuy} onChange={(v) => setDraft({ ...draft, perBuy: v ?? 0 })} />
            <NumField id={`dc-${a.id}`} label="Daily cap" unit="ETH" value={draft.dailyCap} onChange={(v) => setDraft({ ...draft, dailyCap: v ?? 0 })} />
            <NumField id={`mp-${a.id}`} label="Max open positions" value={draft.maxPositions} onChange={(v) => setDraft({ ...draft, maxPositions: v === null ? 0 : Math.round(v) })} />
          </div>
          {a.strategy && <TextButton onClick={saveStrategy} disabled={!!busy}>Update limits</TextButton>}
        </Step>

        <Step n={3} title="Enter the Arena" state={a.live ? "done" : step === 6 ? "now" : "todo"}>
          {a.live ? (<>
            <p>Trading. Your agent is competing in this week&apos;s PnL race. Keep talking to it whenever you want it to trade differently.</p>
            <div className="actions">
              <TextButton href={ROUTES.arena}>View in the Arena</TextButton>
              <TextButton onClick={pause} disabled={!!busy}>Pause trading</TextButton>
            </div>
          </>) : (<>
            <p>Switch trading on. Your agent starts following your guidance and appears on the live leaderboard. Pause any time.</p>
            <TextButton onClick={enter} disabled={step < 6 || !!busy}>Enter the Arena</TextButton>
          </>)}
        </Step>
      </ol>}

      {tab === "activity" && (
        <div className="panel-block">
          {a.log.length === 0 && <p className="hint-line">Nothing yet. Register the agent to get started.</p>}
          <ol className="trades mono">
            {a.log.map((l) => <li key={l.t} className="log-li"><span className="t-ago">{new Date(l.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span>{l.text}</span></li>)}
          </ol>
        </div>
      )}

      <section className="ap-resale">
        <div>
          <span className="mono ap-kick">Train it, rank it, sell it</span>
          <h3>A guided agent is a strategy you can sell</h3>
          <p>Every rule you apply and every trade it makes is on-chain and moves with the NFT. Guide your agent up the Arena, and its Trencher carries a verifiable track record. Selling it is selling a proven strategy, not just a picture.</p>
        </div>
        <dl className="ap-resale-stats">
          <div><dt className="mono">Rule versions</dt><dd className="mono">{versions}</dd></div>
          <div><dt className="mono">Agent coin</dt><dd className="mono">{a.token ? `$${a.token.symbol}` : "—"}</dd></div>
          <div><dt className="mono">Market</dt><dd>{OPENSEA_URL ? <TextButton href={OPENSEA_URL} external>List on OpenSea</TextButton> : <span className="tbtn tbtn-static">OpenSea</span>}</dd></div>
        </dl>
      </section>
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

/** KPI tile: what the agent has funded itself with (coin fees + its share of $TRENCHERS fees). */
function SelfFundedKpi({ a }: { a: AgentState }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(i); }, []);
  const tok = a.token ? tokenFees(a.token, now) : 0;
  const share = a.registered ? trenchersShare(a.registeredAt ?? null, now) : 0;
  return (
    <div className="kpi-green"><dt className="mono">Self-funded</dt><dd className="mono">{(tok + share).toFixed(5)} <small>ETH</small></dd><span className="mono kpi-note">{a.token ? "coin fees + " : ""}{AGENT_FEE_SHARE_PCT}% fee share</span></div>
  );
}
