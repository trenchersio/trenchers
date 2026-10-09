import { ImageResponse } from "next/og";
import { svg } from "@/lib/testnet/meta";
import { ENGINE_URL } from "@/lib/constants";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A Trencher: an AI trading agent on Robinhood Chain";

type Row = { id: number; rank: number; pnlPct: number; nav: number; trades: number; live: boolean; rule: string | null };

/** Share card for one agent: its art, rank and weekly PnL, read live from the trading engine. */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const id = Math.max(1, Math.min(2000, Number((await params).id) || 1));
  let row: Row | null = null, of = 0;
  try {
    const r = await fetch(`${ENGINE_URL}/arena`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    const j = (await r.json()) as { agents?: Row[] };
    of = j.agents?.length ?? 0; row = j.agents?.find((a) => a.id === id) ?? null;
  } catch { /* card without stats */ }
  const art = `data:image/svg+xml;base64,${Buffer.from(svg(id, !row)).toString("base64")}`;
  const up = (row?.pnlPct ?? 0) >= 0;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0B0D0C", color: "#E8ECE9", padding: 56, gap: 56, alignItems: "center" }}>
        <img src={art} width={500} height={500} style={{ borderRadius: 36, border: row ? "4px solid #39FF88" : "4px solid #232826" }} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: "#39FF88" }}>TRENCHERS</div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, marginTop: 14 }}>Trencher #{id}</div>
          {row ? (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 26 }}>
              <div style={{ display: "flex", fontSize: 30, color: "#8A938E" }}>Rank {row.rank} of {of} · this week</div>
              <div style={{ display: "flex", marginTop: 18, fontSize: 96, fontWeight: 700, color: up ? "#0B0D0C" : "#FF5C5C", background: up ? "#39FF88" : "transparent", padding: up ? "6px 24px" : 0, borderRadius: 12, alignSelf: "flex-start" }}>{`${up ? "+" : ""}${row.pnlPct.toFixed(1)}%`}</div>
              <div style={{ display: "flex", fontSize: 28, color: "#8A938E", marginTop: 22 }}>{`${row.nav.toFixed(4)} ETH in its wallet · ${row.trades} trades`}</div>
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 34, color: "#8A938E", marginTop: 26 }}>An AI trading agent with its own wallet.</div>
          )}
          <div style={{ display: "flex", fontSize: 28, color: "#39FF88", marginTop: "auto" }}>trenchers.io</div>
        </div>
      </div>
    ),
    size,
  );
}
