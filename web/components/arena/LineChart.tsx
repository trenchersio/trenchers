"use client";
import { useRef, useState } from "react";

/**
 * Line chart: area fill, faint baseline, emphasized endpoint, min/max labels.
 * With `times`, hovering (or touching) shows a crosshair with the value, its time and the change since
 * the start of the window.
 */
export function LineChart({ data, height = 120, baseline, compact = false, times, unit = "ETH" }: {
  data: number[]; height?: number; baseline?: number; compact?: boolean; times?: number[]; unit?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return <div className="linechart lc-empty mono" style={{ height }}>Not enough data yet</div>;
  const W = 600, H = height, pad = compact ? 2 : 6;
  const vals = baseline !== undefined ? [...data, baseline] : data;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { hi += 1e-6; lo -= 1e-6; }
  // With times, points sit where they happened (a quiet night takes its real width); otherwise evenly spaced.
  const t0 = times?.[0] ?? 0, t1 = times?.[times.length - 1] ?? 0, timed = !!times && times.length === data.length && t1 > t0;
  const fx = (i: number) => (timed ? (times![i] - t0) / (t1 - t0) : i / (data.length - 1));
  const x = (i: number) => fx(i) * W;
  // Enough decimals that the top and bottom labels differ (0.0103 / 0.0098 rather than 0.010 / 0.010).
  const dp = Math.min(8, Math.max(3, Math.ceil(-Math.log10(Math.max(hi - lo, 1e-9))) + 1));
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad);
  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const area = `${line}L${W} ${H}L0 ${H}Z`;
  const last = data[data.length - 1];
  const up = last >= (baseline ?? data[0]);
  const color = up ? "var(--green)" : "var(--red)";
  const interactive = !compact && !!times;

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    if (!timed) { setHover(Math.round(f * (data.length - 1))); return; }
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(fx(i) - f) < Math.abs(fx(best) - f)) best = i;
    setHover(best);
  };
  const h = hover !== null ? { i: hover, v: data[hover], t: times?.[hover] } : null;
  const hx = h ? fx(h.i) * 100 : 0;
  const chg = h ? ((h.v - data[0]) / (data[0] || 1)) * 100 : 0;

  return (
    <div
      ref={box}
      className={`linechart${compact ? " compact" : ""}${interactive ? " lc-live" : ""}`}
      style={{ height }}
      onPointerMove={interactive ? (e) => pick(e.clientX) : undefined}
      onPointerDown={interactive ? (e) => pick(e.clientX) : undefined}
      onPointerLeave={interactive ? () => setHover(null) : undefined}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={area} fill={color} fillOpacity={0.1} />
        {baseline !== undefined && (
          <line x1={0} x2={W} y1={y(baseline)} y2={y(baseline)} stroke="var(--quiet)" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        <path d={line} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {!h && <span className="lc-dot" style={{ top: `${(y(last) / H) * 100}%`, background: color }} />}
      {!compact && !h && <>
        <span className="lc-label lc-hi mono">{hi.toFixed(dp)}</span>
        <span className="lc-label lc-lo mono">{lo.toFixed(dp)}</span>
        {baseline !== undefined && <span className="lc-label lc-base mono" style={{ top: `${(y(baseline) / H) * 100}%` }}>start</span>}
      </>}
      {h && (<>
        <span className="lc-cross" style={{ left: `${hx}%` }} />
        <span className="lc-dot lc-dot-h" style={{ left: `${hx}%`, top: `${(y(h.v) / H) * 100}%`, background: color }} />
        <span className={`lc-tip mono${hx > 60 ? " left" : ""}`} style={{ left: `${hx}%` }}>
          <b>{h.v.toFixed(Math.max(4, dp))} {unit}</b>
          <em className={chg >= 0 ? "up" : "down"}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</em>
          {h.t !== undefined && <small>{fmtTime(h.t)}</small>}
        </span>
      </>)}
    </div>
  );
}

function fmtTime(ms: number) {
  const d = new Date(ms);
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", ...(Date.now() - ms < 600_000 ? { second: "2-digit" } : {}) });
  return sameDay ? time : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

/** Time-frame buttons for a chart. */
export function RangeTabs<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="lc-ranges mono" role="tablist" aria-label="Time frame">
      {options.map((o) => <button key={o} type="button" role="tab" aria-selected={o === value} className={o === value ? "on" : ""} onClick={() => onChange(o)}>{o}</button>)}
    </div>
  );
}
