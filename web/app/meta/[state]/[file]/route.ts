import { metadata, parseId } from "@/lib/testnet/meta";

/** Mainnet token metadata (the NFT's base URI is https://trenchers.io/meta/): dormant or awake. */
export async function GET(_req: Request, { params }: { params: Promise<{ state: string; file: string }> }) {
  const { state, file } = await params;
  const id = parseId(file);
  if (!id || (state !== "awake" && state !== "dormant")) return new Response("Not found", { status: 404 });
  return Response.json(metadata(id, state === "awake", "mainnet"), { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
