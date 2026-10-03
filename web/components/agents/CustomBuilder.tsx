"use client";
import { useEffect, useState } from "react";
import { TextButton } from "@/components/TextButton";
import { DEFAULT_RULE, TRIGGERS, describe, parse, type CustomRule } from "@/lib/custom-strategy";

/** Number input that keeps what the person types (so "0.0" can become "0.005") and reports valid numbers. */
export function NumField({ id, label, value, onChange, placeholder, unit, disabled }: {
  id: string; label: string; value: number | null; onChange: (v: number | null) => void;
  placeholder?: string; unit?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    const parsed = text.trim() === "" ? null : Number(text);
    if (parsed !== value) setText(value === null ? "" : String(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="field" htmlFor={id}>
      <span>{label}{unit ? ` (${unit})` : ""}</span>
      <input id={id} className="mono" inputMode="decimal" value={text} placeholder={placeholder} disabled={disabled}
        onChange={(e) => {
          const t = e.target.value.replace(",", ".");
          if (!/^\d*\.?\d*$/.test(t)) return;
          setText(t);
          onChange(t === "" || t === "." ? null : Number(t));
        }} />
    </label>
  );
}

export function CustomBuilder({ idPrefix, rule, onChange, disabled }: {
  idPrefix: string; rule: CustomRule; onChange: (r: CustomRule) => void; disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [heard, setHeard] = useState<string | null>(null);
  const set = (patch: Partial<CustomRule>) => onChange({ ...rule, ...patch });
  const trig = TRIGGERS.find((t) => t.key === rule.trigger)!;

  function readText() {
    const { rule: r, understood, missed } = parse(text);
    if (missed) { setHeard("Couldn't find a signal or exit in that. Try: \"buy every graduated launch and sell after 5 minutes\"."); return; }
    onChange(r);
    setHeard(`Filled in: ${understood.join(" · ")}. Check the form below before saving.`);
  }

  return (
    <div className="custom">
      <div className="custom-nl">
        <label htmlFor={`${idPrefix}-nl`} className="field-label">Describe it in plain English</label>
        <textarea id={`${idPrefix}-nl`} className="mono" rows={2} value={text} disabled={disabled}
          placeholder="buy every pons token that crosses $100k volume, take profit at 50%, stop loss 20%"
          onChange={(e) => setText(e.target.value)} />
        <div className="custom-nl-row">
          <TextButton onClick={readText} disabled={disabled || !text.trim()}>Fill in the form</TextButton>
          {heard && <p className="custom-heard">{heard}</p>}
        </div>
      </div>

      <div className="custom-group">
        <span className="field-label">Buy when</span>
        <div className="seg" role="radiogroup" aria-label="Buy signal">
          {TRIGGERS.map((t) => (
            <button key={t.key} type="button" role="radio" aria-checked={rule.trigger === t.key} disabled={disabled}
              className={`tbtn${rule.trigger === t.key ? " tbtn-on" : ""}`}
              onClick={() => set({ trigger: t.key, threshold: t.defaultThreshold ?? null })}>{t.label}</button>
          ))}
        </div>
        {trig.unit && (
          <div className="limits">
            <NumField id={`${idPrefix}-thr`} label="Threshold" unit={trig.unit} value={rule.threshold} onChange={(v) => set({ threshold: v })} disabled={disabled} />
          </div>
        )}
      </div>

      <div className="custom-group">
        <span className="field-label">Sell</span>
        <div className="seg" role="radiogroup" aria-label="Exit rule">
          <button type="button" role="radio" aria-checked={rule.exit === "time"} disabled={disabled}
            className={`tbtn${rule.exit === "time" ? " tbtn-on" : ""}`} onClick={() => set({ exit: "time", holdSec: rule.holdSec ?? 60 })}>After a set time</button>
          <button type="button" role="radio" aria-checked={rule.exit === "tpsl"} disabled={disabled}
            className={`tbtn${rule.exit === "tpsl" ? " tbtn-on" : ""}`} onClick={() => set({ exit: "tpsl", takeProfitPct: rule.takeProfitPct ?? 50, stopLossPct: rule.stopLossPct ?? 25 })}>Take profit / stop loss</button>
        </div>
        <div className="limits">
          {rule.exit === "time" ? (
            <NumField id={`${idPrefix}-hold`} label="Hold for" unit="seconds" value={rule.holdSec} onChange={(v) => set({ holdSec: v === null ? null : Math.round(v) })} disabled={disabled} />
          ) : (<>
            <NumField id={`${idPrefix}-tp`} label="Take profit" unit="%" value={rule.takeProfitPct} onChange={(v) => set({ takeProfitPct: v })} disabled={disabled} placeholder="off" />
            <NumField id={`${idPrefix}-sl`} label="Stop loss" unit="%" value={rule.stopLossPct} onChange={(v) => set({ stopLossPct: v })} disabled={disabled} placeholder="off" />
          </>)}
        </div>
      </div>

      <div className="custom-group">
        <span className="field-label">Only tokens that match (optional)</span>
        <div className="limits">
          <NumField id={`${idPrefix}-age`} label="Launched in the last" unit="min" value={rule.maxAgeMin} onChange={(v) => set({ maxAgeMin: v === null ? null : Math.round(v) })} disabled={disabled} placeholder="any" />
          <NumField id={`${idPrefix}-liq`} label="Liquidity above" unit="ETH" value={rule.minLiquidityEth} onChange={(v) => set({ minLiquidityEth: v })} disabled={disabled} placeholder="any" />
        </div>
      </div>

      <p className="custom-summary"><span className="mono">Your rule</span>{describe(rule)}</p>
    </div>
  );
}

export { DEFAULT_RULE };
