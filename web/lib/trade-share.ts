import { ENGINE_URL } from "@/lib/constants";

/** One agent trade, read from the engine for share links (cached for an hour). */
export type Trade = { agent: number; symbol?: string; token: string; side: "buy" | "sell"; eth: string; pnlPct?: number };

export async function trade(id: number, tx: string): Promise<Trade | null> {
  if (!tx) return null;
  try { const r = await fetch(`${ENGINE_URL}/trade?tx=${tx}&agent=${id}`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(4000) }); return r.ok ? ((await r.json()) as Trade) : null; } catch { return null; }
}
export const tradeLine = (id: number, t: Trade | null) => !t ? `Trencher #${id}'s trade`
  : t.side === "sell" && t.pnlPct !== undefined ? `Trencher #${id} sold $${t.symbol ?? t.token.slice(2, 8)} at ${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(1)}%`
  : `Trencher #${id} ${t.side === "buy" ? "bought" : "sold"} $${t.symbol ?? t.token.slice(2, 8)}`;

