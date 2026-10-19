import { ImageResponse } from "next/og";
import { svg } from "@/lib/testnet/meta";
import { trade } from "@/lib/trade-share";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A trade by a Trencher, an AI trading agent on Robinhood Chain";

/** Share card for one trade: the agent's art, the coin, ETH in or out and the profit or loss. */
export default async function Image({ params }: { params: Promise<{ id: string; tx: string }> }) {
  const p = await params;
  const id = Math.max(1, Math.min(2000, Number(p.id) || 1));
  const t = /^0x[0-9a-fA-F]{64}$/.test(p.tx) ? await trade(id, p.tx) : null;
  const art = `data:image/svg+xml;base64,${Buffer.from(svg(id, false)).toString("base64")}`;
  const sym = t ? `$${t.symbol ?? t.token.slice(2, 8)}` : "";
  const pct = t?.side === "sell" && t.pnlPct !== undefined ? t.pnlPct : null;
  const up = pct === null || pct >= 0;
  const eth = t ? Number(t.eth) : 0;
  const ethTxt = eth >= 1 ? eth.toFixed(3) : eth >= 0.01 ? eth.toFixed(4) : eth.toPrecision(3);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0B0D0C", color: "#E8ECE9", padding: 56, gap: 56, alignItems: "center" }}>
        <img src={art} width={500} height={500} style={{ borderRadius: 36, border: `4px solid ${up ? "#39FF88" : "#FF5C5C"}` }} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: "#39FF88" }}>TRENCHERS · LIVE TRADE</div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, marginTop: 14 }}>Trencher #{id}</div>
          {t ? (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 22 }}>
              <div style={{ display: "flex", fontSize: 44, color: "#C9D0CC" }}>{`${t.side === "buy" ? "bought" : "sold"} ${sym}`}</div>
              {pct !== null ? (
                <div style={{ display: "flex", marginTop: 18, fontSize: 104, fontWeight: 700, color: up ? "#0B0D0C" : "#FF5C5C", background: up ? "#39FF88" : "transparent", padding: up ? "6px 24px" : 0, borderRadius: 12, alignSelf: "flex-start" }}>{`${up ? "+" : ""}${pct.toFixed(1)}%`}</div>
              ) : null}
              <div style={{ display: "flex", fontSize: 30, color: "#8A938E", marginTop: 20 }}>{`${ethTxt} ETH ${t.side === "buy" ? "in" : "out"} · its holder's own rules`}</div>
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
