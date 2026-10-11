"use client";
import { useEffect, useState } from "react";
import type { BuilderCoin, BuilderConfig } from "@/lib/v4builder";

export type BuilderData = { config: BuilderConfig | null; coins: BuilderCoin[] | null; failed: boolean; mock: boolean; reload: () => void };

/** Where our contracts live and every coin launched through them, from the engine's index (again every 20 seconds). */
export function useBuilder(): BuilderData {
  const [config, setConfig] = useState<BuilderConfig | null>(null);
  const [coins, setCoins] = useState<BuilderCoin[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    fetch("/api/builder/config", { cache: "no-store" }).then((r) => r.json()).then((c: BuilderConfig & { error?: string }) => {
      if (c.error) throw new Error(c.error);
      setConfig(c);
    }).catch(() => setConfig({ ready: false, reason: "The builder index could not be reached.", factory: null, hookDeployer: null, modules: {}, startBlock: 0 }));
    const t = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    fetch("/api/builder/coins", { cache: "no-store" }).then((r) => r.json()).then((j: { coins?: BuilderCoin[] }) => { setCoins(j.coins ?? []); setFailed(false); })
      .catch(() => { setFailed(true); setCoins((c) => c ?? []); });
  }, [tick]);
  return { config, coins, failed, mock: config?.mock === true, reload: () => setTick((n) => n + 1) };
}
