"use client";
import { useEffect, useState } from "react";
import type { BuilderCoin, BuilderConfig } from "@/lib/v4builder";

export type BuilderData = { config: BuilderConfig | null; coins: BuilderCoin[] | null; failed: boolean; mock: boolean; reload: () => void };

/** Where our contracts live and every coin launched through them, from the engine's index (again every 20 seconds). */
const PREVIEW = process.env.NEXT_PUBLIC_PREVIEW === "1";
/** The static preview has no server: the same sample data the local mock serves. */
export async function builderApi(path: string): Promise<unknown> {
  if (PREVIEW) {
    const { mockBuilder } = await import("@/lib/v4builder-mock");
    const [p, q] = path.split("?");
    return mockBuilder(p, new URLSearchParams(q ?? "").get("token") ?? "");
  }
  const r = await fetch(`/api/builder/${path}`, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

export function useBuilder(): BuilderData {
  const [config, setConfig] = useState<BuilderConfig | null>(null);
  const [coins, setCoins] = useState<BuilderCoin[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    builderApi("config").then((x) => {
      const c = x as (BuilderConfig & { error?: string }) | null;
      if (!c || c.error) throw new Error(c?.error ?? "unreachable");
      setConfig(c);
    }).catch(() => setConfig({ ready: false, reason: "The builder index could not be reached.", factory: null, hookDeployer: null, modules: {}, startBlock: 0 }));
    const t = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    builderApi("coins").then((x) => { const j = (x ?? {}) as { coins?: BuilderCoin[] }; setCoins(j.coins ?? []); setFailed(false); })
      .catch(() => { setFailed(true); setCoins((c) => c ?? []); });
  }, [tick]);
  return { config, coins, failed, mock: config?.mock === true, reload: () => setTick((n) => n + 1) };
}
