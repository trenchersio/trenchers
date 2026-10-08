"use client";
import { useEffect, useState } from "react";
import { ENGINE_URL } from "@/lib/constants";

/** One agent coin as the trading engine follows it: creator fees earned, volume and price history (ETH per coin). */
export type CoinInfo = {
  agent: number; wallet: string; coin: string; curve: string; symbol: string; launchedAt: number;
  feesEth: number; feesExact: boolean; volumeEth: number; trades: number; graduated: boolean;
  price: number | null; chart: { t: number; p: number }[];
};

let cache: { at: number; coins: CoinInfo[] } | null = null;
let inflight: Promise<CoinInfo[]> | null = null;
function load(): Promise<CoinInfo[]> {
  if (cache && Date.now() - cache.at < 20_000) return Promise.resolve(cache.coins);
  inflight ??= fetch(`${ENGINE_URL}/coins`, { cache: "no-store" }).then((r) => r.json()).then((j: { coins?: CoinInfo[] }) => {
    cache = { at: Date.now(), coins: j.coins ?? [] }; return cache.coins;
  }).finally(() => { inflight = null; });
  return inflight;
}

/** Every agent coin (null while loading, [] if the engine can't be reached). */
export function useCoins() {
  const [coins, setCoins] = useState<CoinInfo[] | null>(cache?.coins ?? null);
  useEffect(() => {
    let alive = true;
    const go = () => load().then((c) => alive && setCoins(c)).catch(() => alive && setCoins((x) => x ?? []));
    go(); const iv = setInterval(go, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  return coins;
}

export const ethFmt = (v: number) => (v === 0 ? "0" : v >= 1 ? v.toFixed(3) : v >= 0.001 ? v.toFixed(4) : v.toPrecision(2));
