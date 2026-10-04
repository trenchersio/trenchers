import { askMind } from "@/lib/agent-mind";
import type { CustomRule } from "@/lib/custom-strategy";

export const runtime = "nodejs";

/** Talk to your agent: the AI reads the holder's message and proposes a rule (see lib/agent-mind.ts). */
const hits = new Map<string, number[]>();
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= 15) return Response.json({ error: "Too many messages, wait a minute." }, { status: 429 });
  hits.set(ip, [...recent, now]);
  if (hits.size > 5000) hits.clear();

  let body: { message?: string; rule?: CustomRule | null; context?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "bad request" }, { status: 400 }); }
  const message = String(body.message ?? "").trim();
  if (!message || message.length > 600) return Response.json({ error: "Say something (up to 600 characters)." }, { status: 400 });
  const out = await askMind(message, body.rule ?? null, body.context ? String(body.context).slice(0, 400) : undefined);
  if (!out) return Response.json({ error: "unavailable" }, { status: 503 });
  return Response.json(out);
}

/** Status: is the AI mind configured, and does a test question get a valid rule back? (cached 5 min) */
let lastCheck: { t: number; body: unknown } | null = null;
export async function GET() {
  const configured = !!process.env.ORBIO_API_KEY;
  if (!lastCheck || Date.now() - lastCheck.t > 300_000) {
    const t0 = Date.now();
    const out = configured ? await askMind("Buy every new launch and sell after 30 seconds.", null) : null;
    lastCheck = { t: Date.now(), body: { configured, model: process.env.ORBIO_MODEL || "anthropic/claude-sonnet-5.5", gateway: (process.env.ORBIO_BASE_URL || "https://api.orbio.so/api/v1"), working: !!out?.rule, ms: Date.now() - t0, sample: out } };
  }
  return Response.json(lastCheck.body, { headers: { "Cache-Control": "no-store" } });
}
