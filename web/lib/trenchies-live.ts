"use client";
import { useEffect, useState } from "react";
import { ENGINE_URL } from "@/lib/constants";

/** Whether the Trenchies game is open to everyone (the engine's TRENCHIES_OPEN switch). Null while unknown or closed. */
export function useTrenchiesLive(): { players: number } | null {
  const [v, setV] = useState<{ players: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${ENGINE_URL}/trenchies/status`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive) setV(j?.open ? { players: Number(j.players) || 0 } : null); }).catch(() => {});
    load(); const t = setInterval(load, 120_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return v;
}
