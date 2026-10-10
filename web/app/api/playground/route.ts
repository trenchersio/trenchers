import { aiBoard, lastPlaygroundError } from "@/lib/playground-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The playground's AI-written thoughts and talks (refreshed at most every 8 minutes, shared by all visitors). */
export async function GET() {
  const board = await aiBoard();
  return Response.json(board ? { ...board, error: null } : { thoughts: [], talks: [], at: 0, error: lastPlaygroundError ?? "unavailable" }, { headers: { "Cache-Control": "no-store" } });
}
