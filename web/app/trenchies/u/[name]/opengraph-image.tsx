import { ImageResponse } from "next/og";
import { svg } from "@/lib/testnet/meta";
import { ENGINE_URL } from "@/lib/constants";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A Trenchie's land in Trenchies";

type S = { name: string; nft: number; level: number; landValue: number; cheers: number; rank: number; players: number; items: string[]; species: number; hits: number };

/** Share card for a land: the Trencher's art, level, land value and rank, read live from the engine. */
export default async function Image({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent((await params).name);
  let p: S | null = null;
  try { const r = await fetch(`${ENGINE_URL}/trenchies/public?name=${encodeURIComponent(name)}`, { cache: "no-store", signal: AbortSignal.timeout(4000) }); if (r.ok) p = ((await r.json()) as { player: S }).player; } catch { /* plain card */ }
  const art = `data:image/svg+xml;base64,${Buffer.from(svg(p?.nft ?? 1, !p)).toString("base64")}`;
  const stat = (k: string, v: string) => (<div style={{ display: "flex", flexDirection: "column", padding: "14px 20px", borderRadius: 16, background: "#121815", border: "2px solid #1f2924" }}><div style={{ display: "flex", fontSize: 22, color: "#8A938E" }}>{k}</div><div style={{ display: "flex", fontSize: 40, fontWeight: 700, marginTop: 4 }}>{v}</div></div>);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0B0D0C", color: "#E8ECE9", padding: 56, gap: 52, alignItems: "center" }}>
        <img src={art} width={470} height={470} style={{ borderRadius: 36, border: "4px solid #39FF88" }} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: "#39FF88" }}>TRENCHIES</div>
          <div style={{ display: "flex", fontSize: 66, fontWeight: 700, marginTop: 10 }}>{p ? `${p.name}'s land` : name}</div>
          {p ? (
            <div style={{ display: "flex", gap: 14, marginTop: 26, flexWrap: "wrap" }}>{stat("Level", String(p.level))}{stat("Land value", `${p.landValue.toLocaleString("en-US")}`)}{stat("Rank", `#${p.rank}`)}{stat("Cheers", String(p.cheers))}</div>
          ) : null}
          <div style={{ display: "flex", fontSize: 30, color: "#8A938E", marginTop: 28 }}>Pick coins. Build your land. Come build next to me.</div>
          <div style={{ display: "flex", fontSize: 28, color: "#39FF88", marginTop: "auto" }}>trenchers.io/trenchies</div>
        </div>
      </div>
    ),
    size,
  );
}
