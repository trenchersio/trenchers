import { ENGINE_URL } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** The inference desk, proxied through the site so a browser never needs the engine's origin or a CORS exception.
 *  Programs call the inference endpoint directly; the page's rate card, stats, account view, keys and the P2P book
 *  come through here. Reads get an 8 second deadline, writes 20, and a write that times out says it may have
 *  gone through rather than being retried. INFERENCE_MOCK=1 answers from local mocks. */
const MOCK = process.env.INFERENCE_MOCK === "1";
const ENGINE = (process.env.ENGINE_URL || ENGINE_URL || "").replace(/\/$/, "");

async function handle(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const p = (path ?? []).map(encodeURIComponent).join("/");
  const target = p ? `/icm/${p}` : "/icm";
  const method = req.method.toUpperCase();
  const search = new URL(req.url).search;
  const bodyText = method === "GET" || method === "HEAD" ? undefined : await req.text();

  if (MOCK) {
    const { mockInference } = await import("@/lib/inference-mock");
    let parsed: Record<string, unknown> | undefined;
    try { parsed = bodyText ? JSON.parse(bodyText) : undefined; } catch { return Response.json({ error: "invalid_request", detail: "The body is not JSON." }, { status: 400 }); }
    await new Promise((r) => setTimeout(r, 120));
    const r = mockInference(method, `${target}${search}`, parsed);
    return Response.json(r.json, { status: r.status, headers: { "x-mock": "1", "cache-control": "no-store" } });
  }
  if (!ENGINE) return Response.json({ error: "not_configured", detail: "The desk is not connected yet." }, { status: 503 });

  const idempotent = method === "GET" || method === "HEAD";
  const headers = new Headers();
  for (const h of ["authorization", "content-type", "accept"]) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  const fwd = req.headers.get("x-forwarded-for"); if (fwd) headers.set("x-forwarded-for", fwd);
  try {
    const res = await fetch(`${ENGINE}${target}${search}`, { method, headers, body: bodyText, cache: "no-store", signal: AbortSignal.timeout(idempotent ? 8_000 : 20_000) });
    const out = new Headers({ "cache-control": "no-store" });
    const ct = res.headers.get("content-type"); if (ct) out.set("content-type", ct);
    return new Response(await res.arrayBuffer(), { status: res.status, headers: out });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return Response.json({ error: "upstream_timeout", detail: idempotent
        ? "The desk did not answer in time. Try again in a moment."
        : "The desk did not answer in time, so this may or may not have gone through. Reload before trying again." }, { status: 504 });
    }
    return Response.json({ error: "upstream_unreachable", detail: "The desk could not be reached. Try again in a moment." }, { status: 503 });
  }
}
export const GET = handle;
export const POST = handle;
