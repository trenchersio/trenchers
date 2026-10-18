/**
 * Optional smart routing through Raeto (raeto.cc). A caller asks for the model `raeto/auto`; Raeto looks at the
 * request (size, code, tools, images, reasoning) and picks one of three tiers, and the desk then runs and bills
 * the call exactly as if that model had been asked for: same key, same $TRENCHERS-funded balance, same prices.
 *
 * Raeto only picks a model. It never sees our provider key or the reply; it does see the messages, so the page
 * says so. If Raeto is slow, down or not set up, the call goes to the middle tier instead of failing.
 *
 * Settings (Railway variables):
 *   RAETO_API_KEY   the Raeto key (kept only here, never in the site or the repository)
 *   RAETO_TIERS     optional "fast,mid,top" model ids, default openai/gpt-4o-mini,openai/gpt-4.1,openai/o3
 *   RAETO_URL       optional, default https://api.raeto.cc
 */
export const RAETO_MODEL = "raeto/auto";
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
type Tiers = { fast: string; mid: string; top: string };
const isId = (v: unknown): v is string => typeof v === "string" && /^[\w.\-/:]{3,120}$/.test(v) && v !== RAETO_MODEL;

export function raetoTiers(env: Record<string, string | undefined> = process.env): Tiers {
  const [fast, mid, top] = clean(env.RAETO_TIERS).split(",").map((s) => s.trim());
  return { fast: isId(fast) ? fast : "openai/gpt-4o-mini", mid: isId(mid) ? mid : "openai/gpt-4.1", top: isId(top) ? top : "openai/o3" };
}

/** Pick the model for one request. Returns the tier Raeto chose (or the middle tier on any failure) and why. */
export async function raetoPick(body: Record<string, unknown>, env: Record<string, string | undefined> = process.env, timeoutMs = 1500): Promise<{ model: string; via: "raeto" | "fallback" }> {
  // a caller may name its own three tiers: { "raeto": { "models": { "fast": …, "mid": …, "top": … } } }
  const own = (body.raeto && typeof body.raeto === "object" ? (body.raeto as { models?: Record<string, unknown> }).models : null) ?? null;
  const base = raetoTiers(env);
  const tiers: Tiers = { fast: isId(own?.fast) ? own!.fast as string : base.fast, mid: isId(own?.mid) ? own!.mid as string : base.mid, top: isId(own?.top) ? own!.top as string : base.top };
  const key = clean(env.RAETO_API_KEY);
  if (!key) return { model: tiers.mid, via: "fallback" };
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`${(clean(env.RAETO_URL) || "https://api.raeto.cc").replace(/\/+$/, "")}/v1/route`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ messages: body.messages, ...(body.tools ? { tools: body.tools } : {}), ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}), models: tiers }),
      signal: ac.signal,
    });
    if (!r.ok) return { model: tiers.mid, via: "fallback" };
    const j = (await r.json().catch(() => null)) as { model?: unknown } | null;
    const m = j && typeof j.model === "string" ? j.model : null;
    // only ever one of the three tiers we offered
    return m && [tiers.fast, tiers.mid, tiers.top].includes(m) ? { model: m, via: "raeto" } : { model: tiers.mid, via: "fallback" };
  } catch { return { model: tiers.mid, via: "fallback" }; }
  finally { clearTimeout(timer); }
}
