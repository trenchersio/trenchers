"use client";
import { useEffect, useMemo, useState } from "react";
import { NumField } from "./CustomBuilder";
import { TokenLogo } from "@/components/coins/TokenLogo";
import { DEFAULT_RULE, dcaBuys, defaultEvery, describe, isAddress, validate, type CustomRule, type TokenMode } from "@/lib/custom-strategy";
import { TOKEN_PICKS } from "@/lib/token-picks";
import { useTokenInfo } from "@/lib/token-info";

const MODES: { key: TokenMode; label: string; hint: string }[] = [
  { key: "dca", label: "DCA", hint: "Spread buys evenly over days" },
  { key: "below", label: "Buy the dip", hint: "Buy whenever its market cap is below a level" },
  { key: "once", label: "Buy once", hint: "One buy, straight away" },
];
const mcapTxt = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(2));

/**
 * The "Specific token" strategy: point the agent at one Pons coin (ours, a popular one, or any address)
 * and choose how it buys it: DCA over days, buy the dip below a market cap, or once. It holds by default.
 */
export function TokenPlanner({ current, perTrade, disabled, onApply, onCancel }: {
  current: CustomRule | null; perTrade: number | null; disabled?: boolean;
  onApply: (rule: CustomRule) => void; onCancel: () => void;
}) {
  const start: CustomRule = current?.trigger === "token" ? current
    : { ...DEFAULT_RULE, trigger: "token", token: TOKEN_PICKS[0]?.address ?? null, tokenMode: "dca", dcaDays: 10, everyHours: 24, exit: "hold", holdSec: null };
  const [rule, setRule] = useState<CustomRule>(start);
  const [custom, setCustom] = useState(start.token && !TOKEN_PICKS.some((p) => p.address === start.token) ? start.token : "");
  const set = (patch: Partial<CustomRule>) => setRule((r) => ({ ...r, ...patch }));
  const info = useTokenInfo(rule.token);

  // Buying the dip: suggest a level 20% under today's market cap once it's known.
  useEffect(() => {
    if (rule.tokenMode === "below" && !rule.threshold && info?.ok && info.mcapEth) set({ threshold: +mcapTxt(info.mcapEth * 0.8) });
  }, [rule.tokenMode, info]); // eslint-disable-line react-hooks/exhaustive-deps

  const err = validate(rule) ?? (info && !info.ok ? info.error : null);
  const plan = useMemo(() => {
    if (rule.tokenMode !== "dca" || !rule.dcaDays) return null;
    const n = dcaBuys(rule);
    const each = rule.budgetEth ? (perTrade ? Math.min(rule.budgetEth / n, perTrade) : rule.budgetEth / n) : perTrade;
    return `${n} buy${n === 1 ? "" : "s"}${each ? ` of ${+each.toPrecision(2)} ETH` : ""}${rule.budgetEth ? ` · up to ${rule.budgetEth} ETH in total` : " · each at your per-trade limit"}`;
  }, [rule, perTrade]);

  return (
    <div className="tp" aria-label="Specific token strategy">
      <div className="tp-head">
        <b>Specific token</b>
        <span>Pick a coin and how your agent buys it. It holds what it buys unless you set a take profit or stop loss.</span>
      </div>

      <div className="tp-picks" role="radiogroup" aria-label="Token">
        {TOKEN_PICKS.map((p) => {
          const on = rule.token === p.address;
          return (
            <button key={p.address} type="button" role="radio" aria-checked={on} className={`tp-pick${on ? " on" : ""}`} disabled={disabled}
              onClick={() => { set({ token: p.address, threshold: rule.tokenMode === "below" ? null : rule.threshold }); setCustom(""); }}>
              <TokenLogo address={p.address} symbol={p.symbol} size={22} />
              <span className="mono">${p.symbol}</span>
              {p.note && <em className="mono">{p.note}</em>}
            </button>
          );
        })}
        <label className={`tp-custom${custom ? " on" : ""}`}>
          <span className="mono">Any Pons coin</span>
          <input className="mono" placeholder="0x… token address" value={custom} disabled={disabled} spellCheck={false}
            onChange={(e) => { const v = e.target.value.trim(); setCustom(v); if (isAddress(v)) set({ token: v.toLowerCase(), threshold: rule.tokenMode === "below" ? null : rule.threshold }); }} />
        </label>
      </div>

      {rule.token && (
        <div className={`tp-coin${info && !info.ok ? " bad" : ""}`}>
          <TokenLogo address={rule.token} logo={info?.ok ? info.logo : null} symbol={info?.ok ? info.symbol : null} size={40} />
          <div>
            <b>{info?.ok ? `$${info.symbol}` : info ? (/reach|try again/i.test(info.error) ? "Couldn't read this coin" : "Can't trade this coin") : "Reading the coin…"}{info?.ok && info.name && info.name.toUpperCase() !== info.symbol ? <small> {info.name}</small> : null}</b>
            <span className="mono">{info?.ok ? `${info.mcapEth !== null ? `Market cap ${mcapTxt(info.mcapEth)} ETH · ` : ""}${info.graduated ? "on Uniswap" : "on its Pons curve"}` : info ? info.error : `${rule.token.slice(0, 10)}…${rule.token.slice(-6)}`}</span>
          </div>
        </div>
      )}

      <div className="tp-modes" role="radiogroup" aria-label="How it buys">
        {MODES.map((m) => (
          <button key={m.key} type="button" role="radio" aria-checked={rule.tokenMode === m.key} disabled={disabled} className={`tp-mode${rule.tokenMode === m.key ? " on" : ""}`}
            onClick={() => set({ tokenMode: m.key, threshold: m.key === "below" ? rule.threshold : null, dcaDays: m.key === "dca" ? rule.dcaDays ?? 10 : null, everyHours: m.key === "once" ? null : defaultEvery({ tokenMode: m.key, dcaDays: rule.dcaDays ?? 10 }) })}>
            <b>{m.label}</b><small>{m.hint}</small>
          </button>
        ))}
      </div>

      <div className="limits tp-fields">
        {rule.tokenMode === "dca" && <>
          <NumField id="tp-days" label="Over" unit="days" value={rule.dcaDays ?? null} onChange={(v) => set({ dcaDays: v })} disabled={disabled} />
          <NumField id="tp-every" label="One buy every" unit="hours" value={rule.everyHours ?? null} onChange={(v) => set({ everyHours: v })} disabled={disabled} />
        </>}
        {rule.tokenMode === "below" && <>
          <NumField id="tp-mcap" label="Market cap below" unit="ETH" value={rule.threshold} onChange={(v) => set({ threshold: v })} disabled={disabled} />
          <NumField id="tp-gap" label="At most every" unit="hours" value={rule.everyHours ?? null} onChange={(v) => set({ everyHours: v })} disabled={disabled} />
        </>}
        <NumField id="tp-budget" label="Total budget" unit="ETH" value={rule.budgetEth ?? null} onChange={(v) => set({ budgetEth: v })} disabled={disabled} placeholder="no cap" />
      </div>
      {plan && <p className="tp-plan mono">{plan}</p>}

      <div className="tp-exit">
        <span className="field-label">Sell</span>
        <div className="seg" role="radiogroup" aria-label="Exit">
          <button type="button" role="radio" aria-checked={rule.exit === "hold"} disabled={disabled} className={`tbtn${rule.exit === "hold" ? " tbtn-on" : ""}`}
            onClick={() => set({ exit: "hold", holdSec: null, takeProfitPct: null, stopLossPct: null })}>Hold it</button>
          <button type="button" role="radio" aria-checked={rule.exit === "tpsl"} disabled={disabled} className={`tbtn${rule.exit === "tpsl" ? " tbtn-on" : ""}`}
            onClick={() => set({ exit: "tpsl", holdSec: null, takeProfitPct: rule.takeProfitPct ?? 100, stopLossPct: rule.stopLossPct ?? null })}>Take profit / stop loss</button>
        </div>
        {rule.exit === "tpsl" && (
          <div className="limits">
            <NumField id="tp-tp" label="Take profit" unit="%" value={rule.takeProfitPct} onChange={(v) => set({ takeProfitPct: v })} disabled={disabled} placeholder="off" />
            <NumField id="tp-sl" label="Stop loss" unit="%" value={rule.stopLossPct} onChange={(v) => set({ stopLossPct: v })} disabled={disabled} placeholder="off" />
          </div>
        )}
      </div>

      <p className="custom-summary"><span className="mono">Your rule</span>{err ? <em className="tp-err">{err}</em> : describe(rule)}</p>
      <p className="tp-note">Each buy is at most your per-trade limit{perTrade ? ` (${perTrade} ETH)` : ""}, and never more than your daily limit. Set both in step 2.</p>
      <div className="gf-confirm-actions">
        <button type="button" className="gf-btn go" disabled={disabled || !!err || !info?.ok} onClick={() => onApply(rule)}>Apply this strategy</button>
        <button type="button" className="gf-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
