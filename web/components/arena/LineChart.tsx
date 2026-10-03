/** Small line chart: area fill, faint baseline, emphasized endpoint, min/max labels. */
export function LineChart({ data, height = 120, baseline, compact = false }: {
  data: number[]; height?: number; baseline?: number; compact?: boolean;
}) {
  if (data.length < 2) return <div style={{ height }} />;
  const W = 600, H = height, pad = compact ? 2 : 6;
  const vals = baseline !== undefined ? [...data, baseline] : data;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { hi += 1e-6; lo -= 1e-6; }
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad);
  const line = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const area = `${line}L${W} ${H}L0 ${H}Z`;
  const last = data[data.length - 1];
  const up = last >= (baseline ?? data[0]);
  const color = up ? "var(--green)" : "var(--red)";
  return (
    <div className={`linechart${compact ? " compact" : ""}`} style={{ height }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={area} fill={color} fillOpacity={0.1} />
        {baseline !== undefined && (
          <line x1={0} x2={W} y1={y(baseline)} y2={y(baseline)} stroke="var(--quiet)" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        <path d={line} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <span className="lc-dot" style={{ top: `${(y(last) / H) * 100}%`, background: color }} />
      {!compact && <>
        <span className="lc-label lc-hi mono">{hi.toFixed(3)}</span>
        <span className="lc-label lc-lo mono">{lo.toFixed(3)}</span>
        {baseline !== undefined && <span className="lc-label lc-base mono" style={{ top: `${(y(baseline) / H) * 100}%` }}>start</span>}
      </>}
    </div>
  );
}
