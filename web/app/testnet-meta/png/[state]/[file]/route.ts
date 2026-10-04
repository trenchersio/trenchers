import { Resvg } from "@resvg/resvg-js";
import { parseId, svg } from "@/lib/testnet/meta";

export const runtime = "nodejs";

/** The Trencher's art as a 1000 x 1000 PNG, for places that don't take SVG (Telegram posts, social previews). */
export async function GET(_req: Request, { params }: { params: Promise<{ state: string; file: string }> }) {
  const { state, file } = await params;
  const id = parseId(file.replace(/\.png$/, ".svg"));
  if (!id || (state !== "awake" && state !== "dormant")) return new Response("Not found", { status: 404 });
  const png = new Resvg(svg(id, state === "dormant"), { fitTo: { mode: "width", value: 1000 } }).render().asPng();
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } });
}
