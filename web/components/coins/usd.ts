"use client";
import { useEffect, useState } from "react";

/** ETH's USD price (CoinGecko, refreshed every 5 minutes; the last known price is kept in the browser). */
let cached: { at: number; usd: number } | null = null;
let inflight: Promise<number | null> | null = null;
const KEY = "trenchers:ethusd";
function load(): Promise<number | null> {
  if (!cached) { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (v?.usd) cached = v; } catch { /* private mode */ } }
  if (cached && Date.now() - cached.at < 300_000) return Promise.resolve(cached.usd);
  inflight ??= fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")
    .then((r) => r.json()).then((j: { ethereum?: { usd?: number } }) => {
      const usd = j.ethereum?.usd; if (!usd) return cached?.usd ?? null;
      cached = { at: Date.now(), usd }; try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch { /* private mode */ }
      return usd;
    }).catch(() => cached?.usd ?? null).finally(() => { inflight = null; });
  return inflight;
}
export function useEthUsd() {
  const [usd, setUsd] = useState<number | null>(cached?.usd ?? null);
  useEffect(() => { let alive = true; load().then((v) => alive && setUsd(v)); return () => { alive = false; }; }, []);
  return usd;
}

const SUB = "₀₁₂₃₄₅₆₇₈₉";
/** Small prices the way trading sites show them: 0.0₅1713 (five zeros after the point, then the digits). */
export function tiny(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (v >= 0.0001) return v.toPrecision(sig).replace(/0+$/, "").replace(/\.$/, "");
  const zeros = Math.ceil(-Math.log10(v)) - 1;
  const digits = Math.round(v * 10 ** (zeros + sig)).toString().slice(0, sig).replace(/0+$/, "");
  return `0.0${String(zeros).split("").map((d) => SUB[+d]).join("")}${digits || "0"}`;
}
/** $4.2K, $1.35M, $820 */
export function compactUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `$${(v / 1e3).toFixed(1)}K`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  if (a >= 1) return `$${v.toFixed(0)}`;
  return `$${tiny(v, 3)}`;
}
export const usdPrice = (v: number) => `$${tiny(v)}`;
