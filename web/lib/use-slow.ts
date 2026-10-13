"use client";
import { useEffect, useState } from "react";

/** True once `failing` has stayed true for `ms` (default 30 s): the moment "connecting…" should become "can't reach it". */
export function useSlow(failing: boolean, ms = 30_000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!failing) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [failing, ms]);
  return slow;
}

/** "2 min ago" style age of a unix time in seconds. */
export function ago(sec: number) {
  const s = Math.max(1, Math.round(Date.now() / 1000 - sec));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
}
