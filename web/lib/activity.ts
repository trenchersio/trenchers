"use client";
import { useEffect, useState } from "react";
import { ENGINE_URL } from "@/lib/constants";

/** The engine's live activity: mints, awakenings, agent coins and big wins, plus the weekly fee share. */
export type ActivityItem = { kind: "mint" | "awaken" | "coin" | "win"; id: number; time: number; tx: string | null; symbol?: string; count?: number; pct?: number };
export type FeeShare = { week: number; closesIn: string; agentsEarningThisWeek: number; joiningNextWeek: number; potThisWeek: string; lastPayout: string } | null;
type Activity = { items: ActivityItem[]; feeShare: FeeShare; now: number };

let cache: { at: number; data: Activity } | null = null;
let inflight: Promise<Activity | null> | null = null;
function load(): Promise<Activity | null> {
  if (cache && Date.now() - cache.at < 15_000) return Promise.resolve(cache.data);
  inflight ??= fetch(`${ENGINE_URL}/activity`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d: Activity | null) => {
    if (d && Array.isArray(d.items)) cache = { at: Date.now(), data: d };
    return d;
  }).catch(() => null).finally(() => { inflight = null; });
  return inflight;
}

/** Polls /activity every 20 seconds while mounted. */
export function useActivity() {
  const [data, setData] = useState<Activity | null>(cache?.data ?? null);
  useEffect(() => {
    let alive = true;
    const go = () => load().then((d) => { if (alive && d) setData(d); });
    go(); const iv = setInterval(go, 20_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  return data;
}

export const activityText = (a: ActivityItem) =>
  a.kind === "mint" ? (a.count && a.count > 1 ? `${a.count} Trenchers minted` : `Trencher #${a.id} minted`)
  : a.kind === "awaken" ? `Trencher #${a.id} awakened`
  : a.kind === "coin" ? `Trencher #${a.id} launched ${a.symbol ? `$${a.symbol}` : "its own coin"}`
  : `Trencher #${a.id} closed ${a.symbol ? `$${a.symbol} ` : "a trade "}at +${a.pct}%`;
