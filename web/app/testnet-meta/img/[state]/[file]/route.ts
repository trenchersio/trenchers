import { parseId, svg } from "@/lib/testnet/meta";

export async function GET(_req: Request, { params }: { params: Promise<{ state: string; file: string }> }) {
  const { state, file } = await params;
  const id = parseId(file);
  if (!id || (state !== "awake" && state !== "dormant")) return new Response("Not found", { status: 404 });
  return new Response(svg(id, state === "dormant"), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" } });
}
