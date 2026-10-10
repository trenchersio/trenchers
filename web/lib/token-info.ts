"use client";
import { useEffect, useState } from "react";
import { ENGINE_URL } from "./constants";

/** A coin as the trading engine reads it (ticker, name, logo, market cap), or why it can't be traded. */
export type TokenInfo = { ok: true; token: string; symbol: string; name: string; logo: string | null; graduated: boolean; mcapEth: number | null } | { ok: false; error: string };
const cache = new Map<string, { t: number; v: Promise<TokenInfo> }>();
export function tokenInfo(address: string): Promise<TokenInfo> {
  const a = address.toLowerCase(), c = cache.get(a);
  if (c && Date.now() - c.t < 60_000) return c.v;
  const v = fetch(`${ENGINE_URL}/token?address=${a}`).then((r) => r.json() as Promise<TokenInfo>)
    .catch(() => ({ ok: false as const, error: "The trading engine can't be reached right now." }));
  cache.set(a, { t: Date.now(), v });
  return v;
}
export function useTokenInfo(address: string | null | undefined) {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  useEffect(() => {
    setInfo(null);
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return;
    let alive = true;
    tokenInfo(address).then((v) => { if (alive) setInfo(v); });
    return () => { alive = false; };
  }, [address]);
  return info;
}
