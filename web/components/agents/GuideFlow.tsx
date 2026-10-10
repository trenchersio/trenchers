"use client";
import { useState, type ReactNode } from "react";
import { AgentChat } from "./AgentChat";
import { TokenPlanner } from "./TokenPlanner";
import { TokenLogo } from "@/components/coins/TokenLogo";
import { TOKEN_PICKS } from "@/lib/token-picks";
import type { CustomRule } from "@/lib/custom-strategy";
import type { ChatMsg } from "@/lib/agents-store";

/**
 * "Train your agent" in three steps: choose its strategy (talk to it, or start from a house template),
 * set its hard limits, then start or pause trading. Used by the live profile and the demo walkthrough.
 */
export type GuideTemplate = { name: string; text: string; house?: number | null; tag?: string };
export type GuideLimit = { id: string; label: string; unit?: string; value: string; onChange: (v: string) => void };

export function GuideFlow(p: {
  id: number;
  busy: boolean;
  locked?: string | null;                 // why the flow can't be used yet (e.g. not awakened)
  rule: { label: string; text: string } | null;
  warning?: string | null;
  chat: { rule: CustomRule | null; msgs: ChatMsg[]; onChat: (c: ChatMsg[]) => void; onApply: (r: CustomRule, c: ChatMsg[]) => void; context?: string };
  chatExtra?: ReactNode;
  templates: GuideTemplate[];
  activeTemplate?: string;
  onTemplate: (t: GuideTemplate) => void;
  /** The "Specific token" strategy (pick a coin, DCA / buy the dip / once). */
  tokenPlan?: { current: CustomRule | null; perTrade: number | null; onApply: (r: CustomRule) => void };
  limits: GuideLimit[];
  onSaveLimits?: () => void;
  trading: boolean;
  onStart: () => void;
  onPause: () => void;
  arenaHref?: string;
}) {
  const off = p.busy || !!p.locked;
  // Picking a template only selects it; it's applied after the holder confirms.
  const [pick, setPick] = useState<GuideTemplate | null>(null);
  const [planning, setPlanning] = useState(false);
  const tokenOn = p.tokenPlan?.current?.trigger === "token";
  const s1 = p.rule ? "done" : "now";
  const s3 = p.trading ? "done" : p.rule ? "now" : "todo";
  return (
    <section className="gf" aria-label="Train your agent">
      <header className="gf-head">
        <div>
          <span className="mono gf-kick">Train your agent</span>
          <h3>Strategy, limits, go</h3>
        </div>
        <span className={`gf-state mono ${p.trading ? "on" : ""}`}><i />{p.trading ? "Trading" : p.rule ? "Paused" : "Not started"}</span>
      </header>
      {p.locked && <p className="gf-locked">{p.locked}</p>}

      <ol className="gf-steps">
        <li className={`gf-step gf-${s1}`}>
          <span className="gf-n mono">{s1 === "done" ? "✓" : "1"}</span>
          <div className="gf-body">
            <h4>Choose its strategy</h4>
            <p className="gf-lede">Tell your agent how to trade in plain English, or start from a strategy the team runs in public. Every message becomes a rule you confirm.</p>
            {p.rule && (
              <div className="gf-rule">
                <span className="mono">{p.rule.label}</span>
                <p>{p.rule.text}</p>
                {p.warning && <small>{p.warning}</small>}
              </div>
            )}
            <div className="gf-grid">
              <div className="gf-chat">
                <AgentChat id={p.id} rule={p.chat.rule} chat={p.chat.msgs} onChat={p.chat.onChat} onApply={p.chat.onApply} disabled={off} context={p.chat.context} />
                {p.chatExtra}
              </div>
              <div className="gf-tpls" role="list" aria-label="House templates">
                <span className="mono gf-sub">Or pick a ready-made strategy</span>
                {p.tokenPlan && (
                  <button type="button" role="listitem" className={`gf-tpl gf-tpl-token${tokenOn ? " on" : ""}${planning ? " picked" : ""}`} disabled={off} onClick={() => { setPick(null); setPlanning(!planning); }} aria-pressed={tokenOn || planning}>
                    <span className="gf-radio" aria-hidden="true" />
                    <span className="gf-tpl-txt"><b>Trenchers Treasury</b><small>Build a treasury in one coin you pick: DCA over days, buy the dip below a market cap, or buy once. Holds by default.</small>
                      <span className="gf-tk-row" aria-hidden="true">{TOKEN_PICKS.map((t) => <TokenLogo key={t.address} address={t.address} symbol={t.symbol} size={18} />)}<i className="mono">+ any Pons coin</i></span>
                    </span>
                    {tokenOn ? <span className="mono gf-tag on">Active</span> : <span className="mono gf-tag gf-tag-new">New</span>}
                  </button>
                )}
                {planning && p.tokenPlan && (
                  <TokenPlanner current={p.tokenPlan.current} perTrade={p.tokenPlan.perTrade} disabled={off}
                    onApply={(r) => { setPlanning(false); p.tokenPlan!.onApply(r); }} onCancel={() => setPlanning(false)} />
                )}
                {p.templates.map((t) => {
                  const on = p.activeTemplate === t.name;
                  const picked = pick?.name === t.name;
                  return (
                    <button key={t.name} type="button" role="listitem" className={`gf-tpl${on ? " on" : ""}${picked ? " picked" : ""}`} disabled={off || on} onClick={() => { setPlanning(false); setPick(picked ? null : t); }} aria-pressed={on || picked}>
                      <span className="gf-radio" aria-hidden="true" />
                      <span className="gf-tpl-txt"><b>{t.name}</b><small>{t.text}</small></span>
                      {on ? <span className="mono gf-tag on">Active</span> : picked ? <span className="mono gf-tag on">Selected</span> : t.house ? <span className="mono gf-tag">#{t.house}</span> : t.tag ? <span className="mono gf-tag">{t.tag}</span> : null}
                    </button>
                  );
                })}
                {pick && pick.name !== p.activeTemplate && (
                  <div className="gf-confirm">
                    <p>Apply <b>{pick.name}</b> as your agent&apos;s rule? You&apos;ll confirm it in your wallet. {p.trading ? "Your agent keeps trading, now with this rule." : "Trading stays off until you start it in step 3."}</p>
                    <div className="gf-confirm-actions">
                      <button type="button" className="gf-btn go" disabled={off} onClick={() => { const t = pick; setPick(null); p.onTemplate(t); }}>Apply {pick.name}</button>
                      <button type="button" className="gf-btn ghost" onClick={() => setPick(null)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </li>

        <li className={`gf-step gf-${p.rule ? "done" : "todo"}`}>
          <span className="gf-n mono">{p.rule ? "✓" : "2"}</span>
          <div className="gf-body">
            <h4>Set its limits</h4>
            <p className="gf-lede">Hard caps enforced by the agent wallet itself. Whatever you tell the agent, the trading engine can never spend more than this, and can never withdraw.</p>
            <div className="gf-limits">
              {p.limits.map((l) => (
                <label key={l.id} className="gf-limit">
                  <span className="mono">{l.label}</span>
                  <span className="gf-limit-in"><input className="mono" inputMode="decimal" value={l.value} onChange={(e) => l.onChange(e.target.value)} disabled={off} />{l.unit && <em className="mono">{l.unit}</em>}</span>
                </label>
              ))}
              {p.onSaveLimits && p.rule && <button type="button" className="gf-btn ghost" onClick={p.onSaveLimits} disabled={off}>Save limits</button>}
            </div>
          </div>
        </li>

        <li className={`gf-step gf-${s3}`}>
          <span className="gf-n mono">{s3 === "done" ? "✓" : "3"}</span>
          <div className="gf-body">
            <h4>{p.trading ? "Trading" : "Start trading"}</h4>
            <div className={`gf-go ${p.trading ? "on" : ""}`}>
              <span className="gf-orb" aria-hidden="true" />
              <div className="gf-go-txt">
                <b>{p.trading ? "Your agent is trading" : p.rule ? "Ready when you are" : "Choose a strategy first"}</b>
                <small>{p.trading ? "It follows your rule around the clock and competes in this week's Arena. Pause any time; it stops straight away." : p.rule ? "Switch it on and your agent starts following its rule, within your limits, and appears in the Arena." : "Apply a rule in step 1, then switch trading on here."}</small>
              </div>
              <div className="gf-go-actions">
                {p.trading
                  ? <button type="button" className="gf-btn stop" onClick={p.onPause} disabled={p.busy}>Pause trading</button>
                  : <button type="button" className="gf-btn go" onClick={p.onStart} disabled={off || !p.rule}>Start trading</button>}
                {p.arenaHref && <a className="tbtn" href={p.arenaHref}>View in the Arena</a>}
              </div>
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}
