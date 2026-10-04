import { metadata, parseId } from "@/lib/testnet/meta";

export async function GET(_req: Request, { params }: { params: Promise<{ state: string; file: string }> }) {
  const { state, file } = await params;
  const id = parseId(file);
  if (!id || (state !== "awake" && state !== "dormant")) return new Response("Not found", { status: 404 });
  return Response.json(metadata(id, state === "awake"), { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
