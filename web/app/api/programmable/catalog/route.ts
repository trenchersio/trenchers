import { readCatalog } from "@/lib/programmable-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Programmable's live Module Mode release and modules for Robinhood Chain (for the agent coin launch). */
export async function GET() {
  try { return Response.json(await readCatalog(), { headers: { "cache-control": "no-store" } }); }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Programmable is unavailable right now." }, { status: 502 }); }
}
