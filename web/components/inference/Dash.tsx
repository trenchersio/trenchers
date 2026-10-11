"use client";
// The account, read the way anybody reads a usage dashboard: four figures, spend by day, spend by model.
// Signed out it shows a sample, labelled as one. A dashboard of zeroes tells a first-time visitor nothing, and
// invented numbers presented as real would be a lie. A sample that says it is a sample is neither.
import { useMemo } from "react";
import { compact, family, usd, type Charge } from "@/lib/inference";

type Acct = { balanceMicroUsd: string; heldMicroUsd: string; spentMicroUsd: string; depositedMicroUsd: string };

function sample(): { charges: Charge[]; account: Acct } {
  const models = ["anthropic/claude-sonnet-4.5", "openai/gpt-5", "google/gemini-2.5-pro", "deepseek/deepseek-r1", "x-ai/grok-4"];
  const out: Charge[] = [];
  let x = 20_261_011;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const now = Date.now();
  for (let d = 13; d >= 0; d--) {
    const n = 3 + Math.floor(rnd() * 7) + Math.floor((13 - d) / 3);
    for (let i = 0; i < n; i++) {
      const cost = BigInt(Math.round((0.004 + rnd() * 0.09) * 1e6));
      out.push({ id: `s${d}-${i}`, at: new Date(now - d * 86_400_000 - Math.floor(rnd() * 3.6e7)).toISOString(), model: models[Math.floor(Math.pow(rnd(), 1.6) * models.length)], state: "settled", costMicroUsd: String(cost), tokensIn: 400 + Math.floor(rnd() * 9_000), tokensOut: 150 + Math.floor(rnd() * 3_000) });
    }
  }
  const spent = out.reduce((a, c) => a + BigInt(c.costMicroUsd), 0n);
  return { charges: out, account: { balanceMicroUsd: String(spent * 2n), heldMicroUsd: "41200", spentMicroUsd: String(spent), depositedMicroUsd: String(spent * 3n) } };
}
export const SAMPLE = sample();

export function Dash({ account, charges, isSample, where }: { account: Acct; charges: Charge[]; isSample?: boolean; where: string }) {
  const data = useMemo(() => {
    const days: { key: string; label: string; total: bigint }[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let d = 13; d >= 0; d--) {
      const t = new Date(today.getTime() - d * 86_400_000);
      days.push({ key: t.toDateString(), label: t.toLocaleDateString("en-US", { month: "short", day: "numeric" }), total: 0n });
    }
    const index = new Map(days.map((d, i) => [d.key, i]));
    const byModel = new Map<string, { total: bigint; calls: number }>();
    let tokens = 0;
    for (const c of charges) {
      let cost = 0n;
      try { cost = BigInt(c.costMicroUsd); } catch { /* not a figure */ }
      const i = index.get(new Date(c.at).toDateString());
      if (i !== undefined) days[i].total += cost;
      const m = byModel.get(c.model) ?? { total: 0n, calls: 0 };
      m.total += cost; m.calls += 1; byModel.set(c.model, m);
      tokens += (c.tokensIn || 0) + (c.tokensOut || 0);
    }
    const peak = days.reduce((a, d) => (d.total > a ? d.total : a), 1n);
    const models = [...byModel.entries()].sort((a, b) => (b[1].total > a[1].total ? 1 : -1)).slice(0, 5);
    const sum = models.reduce((a, [, m]) => a + m.total, 0n) || 1n;
    return { days, peak, models, sum, tokens, calls: charges.length };
  }, [charges]);

  return (
    <div className={`idash${isSample ? " idash-sample" : ""}`}>
      <div className="ipanel-head">
        <span className="ipanel-dot" /><span>{where}</span>
        {isSample && <span className="idash-flag mono">sample account</span>}
      </div>
      <div className="idash-tiles">
        <div className="idash-tile idash-lit"><span>Available</span><b>{usd(account.balanceMicroUsd)}</b></div>
        <div className="idash-tile"><span>Calls</span><b>{data.calls.toLocaleString("en-US")}</b></div>
        <div className="idash-tile"><span>Tokens</span><b>{compact(data.tokens)}</b></div>
        <div className="idash-tile"><span>Spent all time</span><b>{usd(account.spentMicroUsd)}</b></div>
      </div>
      <div className="idash-grid">
        <div className="idash-panel">
          <div className="idash-ph"><span>Spend by day</span><span className="mono">14 days</span></div>
          <div className="idash-chart" role="img" aria-label="Spend over the last fourteen days">
            {data.days.map((d, i) => (
              <span key={d.key} className="idash-bar" title={`${d.label}: ${usd(d.total)}`}>
                <i style={{ height: `${Math.max(3, Number((d.total * 100n) / data.peak))}%`, ["--i" as string]: i }} />
              </span>
            ))}
          </div>
          <div className="idash-axis mono"><span>{data.days[0].label}</span><span>today</span></div>
        </div>
        <div className="idash-panel">
          <div className="idash-ph"><span>By model</span><span className="mono">top {data.models.length || 0}</span></div>
          {data.models.length === 0 ? <p className="inf-muted" style={{ margin: 0 }}>No calls yet.</p> : (
            <>
              <div className="idash-stack" aria-hidden="true">
                {data.models.map(([id, m]) => <i key={id} style={{ flexGrow: Number((m.total * 1000n) / data.sum), background: family(id).color }} />)}
              </div>
              <ul className="idash-models">
                {data.models.map(([id, m]) => (
                  <li key={id}>
                    <span className="idash-sw" style={{ background: family(id).color }} />
                    <span className="idash-m mono">{id}</span>
                    <span className="idash-calls mono">{m.calls}</span>
                    <span className="idash-amt mono">{usd(m.total)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
