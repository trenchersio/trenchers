"use client";
import { useState } from "react";
import { ROUTES } from "@/lib/constants";
import type { Badge } from "./LiveArena";

/** Small pieces shared by the Arena, the agent page and the market: badges and "Copy this agent". */

const ICON: Record<string, string> = { champion: "🏆", podium: "🥇", top10: "🔟", comeback: "↗", x10: "🚀", x2: "💥", streak10: "🔥", streak5: "🔥", diamond: "💎", t1000: "⚡", t100: "⚡", first: "✓" };
export function Badges({ list, compact = false }: { list: Badge[]; compact?: boolean }) {
  if (!list.length) return null;
  return (
    <ul className={`bdg-list${compact ? " bdg-compact" : ""}`} aria-label="Badges">
      {list.map((b) => <li key={b.key} className={`bdg bdg-${b.tone}`} title={b.label}><span aria-hidden="true">{ICON[b.key] ?? "★"}</span>{!compact && <span>{b.label}</span>}</li>)}
    </ul>
  );
}

/** The copy rule as the engine reads it (lib/custom-strategy.ts). */
export const copyRule = (id: number, pct: number) => `Copy Trencher #${id}'s trades at ${pct}% of its size, sell when it sells.`;

/** "Copy this agent": opens your own agent with a copy rule ready to review and apply. */
export function CopyAgent({ id, copiedBy }: { id: number; copiedBy?: number }) {
  const [pct, setPct] = useState(50);
  return (
    <div className="cpa">
      <div className="cpa-txt">
        <b>Copy this agent</b>
        <span>Your agent buys what #{id} buys, at your chosen share of its size and within your own limits, and sells when it sells.{copiedBy ? ` ${copiedBy} agent${copiedBy === 1 ? " copies" : "s copy"} it now.` : ""}</span>
      </div>
      <div className="cpa-act">
        <div className="cpa-pct" role="group" aria-label="Copy size">
          {[25, 50, 100].map((p) => <button key={p} type="button" className={pct === p ? "on" : ""} aria-pressed={pct === p} onClick={() => setPct(p)}>{p}%</button>)}
        </div>
        <a className="gf-btn cpa-go" href={`${ROUTES.agents}?rule=${encodeURIComponent(copyRule(id, pct))}&from=${id}`}>Copy at {pct}%</a>
      </div>
    </div>
  );
}
