"use client";
import { useEffect, useState } from "react";
import { ENGINE_URL, EXPLORER, TRENCHERS_TOKEN } from "@/lib/constants";

type Burns = { token: string; buybackWallet: string; boughtBack: number; burnt: number; boughtBackPct: number; burntPct: number; totalSupply: number; updatedAt: number; error: string | null };
const big = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0));
const pct = (p: number) => (p >= 10 ? p.toFixed(1) : p >= 0.1 ? p.toFixed(2) : p.toFixed(3));

/** $TRENCHERS bought back and burnt so far, read from the chain by the trading engine. */
export function BurnStats() {
  const [b, setB] = useState<Burns | null>(null);
  useEffect(() => {
    if (!TRENCHERS_TOKEN) return;
    let alive = true;
    const go = () => fetch(`${ENGINE_URL}/burns`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j: Burns | null) => { if (alive && j && j.updatedAt) setB(j); }).catch(() => {});
    go(); const iv = setInterval(go, 120_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  if (!b || (b.boughtBack <= 0 && b.burnt <= 0)) return null;
  return (
    <div className="burns" aria-label="$TRENCHERS buybacks and burns">
      <div className="burns-head"><span className="mono burns-kick"><i className="burns-flame" />$TRENCHERS supply</span><a className="mono" href={`${EXPLORER}/token/${b.token}`} target="_blank" rel="noreferrer">Verify on-chain ↗</a></div>
      <div className="burns-grid">
        <div><span className="mono burns-lbl">Burnt</span><b className="mono">{pct(b.burntPct)}%</b><small className="mono">{big(b.burnt)} $TRENCHERS</small></div>
        <div><span className="mono burns-lbl">Bought back</span><b className="mono">{pct(b.boughtBackPct)}%</b><small className="mono">{big(b.boughtBack)} $TRENCHERS</small></div>
      </div>
      <div className="burns-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, b.burntPct)}%` }} /></div>
      <p className="muted-note">Read live from the token&apos;s transfers: tokens sent to a burn address, and tokens received by the buyback wallet.</p>
    </div>
  );
}
