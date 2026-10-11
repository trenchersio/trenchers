import { ENGINE_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** The V4 Builder's read-outs (where our contracts live, and every coin launched through them), proxied from the
 *  engine. Launches and trades never pass through here: the browser signs them straight to the chain.
 *  INFERENCE_MOCK=1 answers from local sample data. */
const MOCK = process.env.INFERENCE_MOCK === "1" || process.env.BUILDER_MOCK === "1";
const ENGINE = (process.env.ENGINE_URL || ENGINE_URL || "").replace(/\/$/, "");
const ALLOWED = new Set(["config", "coins", "coin"]);

export async function GET(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const p = (path ?? []).join("/");
  if (!ALLOWED.has(p)) return Response.json({ error: "not_found" }, { status: 404 });
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (p === "coin" && !/^0x[0-9a-fA-F]{40}$/.test(token)) return Response.json({ error: "bad_token" }, { status: 400 });
  const search = p === "coin" ? `?token=${token}` : "";
  if (MOCK) {
    const { mockBuilder } = await import("@/lib/v4builder-mock");
    const m = mockBuilder(p, token);
    return Response.json(m ?? { error: "not_found" }, { status: m ? 200 : 404, headers: { "x-mock": "1", "cache-control": "no-store" } });
  }
  if (!ENGINE) return Response.json({ error: "not_configured" }, { status: 503 });
  try {
    const res = await fetch(`${ENGINE}/builder/${p}${search}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return new Response(await res.arrayBuffer(), { status: res.status, headers: { "content-type": "application/json", "cache-control": "public, max-age=10" } });
  } catch {
    return Response.json({ error: "upstream_unreachable", detail: "The builder index could not be reached. Try again in a moment." }, { status: 503 });
  }
}
