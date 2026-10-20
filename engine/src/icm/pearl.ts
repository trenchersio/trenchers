/**
 * Pearl (pearlresearch.ai) as a second model provider, next to OpenRouter.
 *
 * Pearl serves a curated set of open-weight models (DeepSeek, GLM, Qwen, Gemma) on its own GPU network through an
 * OpenAI-compatible API, billed per token from prepaid dollar credit. Here its models are offered as `pearl/<id>`
 * (for example `pearl/zai-org/GLM-5.3`), and a caller who names one is served by Pearl, billed from the same
 * balance in the same way as every other model.
 *
 * Two things differ from OpenRouter, and both are handled here so nothing above the port changes:
 *
 *   - Pearl does not put a dollar cost on a completion. It reports tokens (input, cached input, output with
 *     reasoning inside it), so the cost is worked out here from Pearl's per-model prices. A model with no known
 *     price is not offered at all, because a call we cannot cost is a call we cannot bill.
 *   - Pearl accepts reasoning settings only as `reasoning: { enabled, effort, max_tokens }` and rejects the older
 *     switches (`reasoning_effort`, `thinking`, ...), and it does not fetch image links. Bodies are translated
 *     (or refused, for image links) before they go out.
 *
 * A stream that ends without a usage frame has an unknown cost and is left for the operator, exactly like an
 * OpenRouter stream would be. The adapter asks for the usage frame (`stream_options.include_usage`).
 */
import { E } from "./errors.ts";
import { parseUsd } from "./money.ts";
import { OpenRouterUpstream, type CompletionRequest, type CompletionResponse, type StreamedCompletion, type Upstream, type UpstreamModel, type UpstreamUsage } from "./upstream.ts";

export const PEARL_PREFIX = "pearl/";
export const PEARL_BASE = "https://inference.pearlresearch.ai/v1";

/** Dollars per million tokens, as micro-dollars. */
export type PearlPrice = { input: bigint; output: bigint; cached: bigint | null };

/**
 * Prices from a setting: `model=input/output[/cached]` entries in dollars per million tokens, separated by commas
 * or semicolons. Example: `zai-org/GLM-5.3=0.6/2.2/0.11, deepseek-ai/DeepSeek-V4-Pro-0813=0.55/2.19`.
 */
export function parsePearlPrices(raw: string | undefined | null): Map<string, PearlPrice> {
  const out = new Map<string, PearlPrice>();
  for (const part of (raw ?? "").split(/[;,\n]/).map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^([\w.\-/:]+)\s*=\s*([\d.]+)\s*\/\s*([\d.]+)(?:\s*\/\s*([\d.]+))?$/);
    if (!m) continue;
    try {
      const id = m[1].startsWith(PEARL_PREFIX) ? m[1].slice(PEARL_PREFIX.length) : m[1];
      out.set(id, { input: parseUsd(m[2]), output: parseUsd(m[3]), cached: m[4] ? parseUsd(m[4]) : null });
    } catch { /* an unreadable price is skipped, and that model stays off */ }
  }
  return out;
}

/** What a call cost, from its token counts. Cached input is billed at the cached rate when Pearl has one. Rounded up. */
export function pearlCost(p: PearlPrice, u: Pick<UpstreamUsage, "tokensIn" | "tokensOut" | "cachedTokens">): bigint {
  const cached = BigInt(Math.min(u.cachedTokens, u.tokensIn)), fresh = BigInt(u.tokensIn) - cached;
  const n = fresh * p.input + cached * (p.cached ?? p.input) + BigInt(u.tokensOut) * p.output;
  return (n + 999_999n) / 1_000_000n;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** The caller's body, as Pearl will accept it. Throws (before anything is held) for image links. */
export function toPearlBody(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const b: Record<string, unknown> = { ...body, model };
  // reasoning: one object, three members; the older switches are refused by Pearl outright
  const r = obj(b.reasoning), effort = typeof b.reasoning_effort === "string" ? b.reasoning_effort : typeof r.effort === "string" ? r.effort : null;
  const reasoning: Record<string, unknown> = {};
  if (effort && EFFORTS.has(effort)) reasoning.effort = effort;
  if (typeof r.max_tokens === "number" && r.max_tokens > 0) reasoning.max_tokens = Math.floor(r.max_tokens);
  if (typeof r.enabled === "boolean") reasoning.enabled = r.enabled;
  if (r.exclude === true && reasoning.enabled === undefined && !reasoning.effort) reasoning.enabled = false;
  for (const k of ["reasoning", "reasoning_effort", "thinking", "thinking_budget", "chat_template_kwargs", "include_reasoning", "enable_thinking", "plugins", "models", "verbosity", "raeto"]) delete b[k];
  if (Object.keys(reasoning).length) b.reasoning = reasoning;
  // images: Pearl does not fetch links, only inline data: URIs
  for (const msg of Array.isArray(b.messages) ? b.messages : []) {
    for (const part of Array.isArray(obj(msg).content) ? (obj(msg).content as unknown[]) : []) {
      const url = obj(obj(part).image_url).url;
      if (typeof url === "string" && !url.startsWith("data:")) throw E.invalid("Pearl models take images as data: URIs (base64), not links. Encode the image and send it inline.");
    }
  }
  if (Array.isArray(b.stop) && b.stop.length > 4) b.stop = b.stop.slice(0, 4);
  return b;
}

export interface PearlOptions { apiKey: string; baseUrl?: string; prices: Map<string, PearlPrice>; timeoutMs?: number; fetch?: typeof globalThis.fetch }

export class PearlUpstream implements Upstream {
  readonly name = "pearl";
  private readonly http: OpenRouterUpstream;
  constructor(private o: PearlOptions) {
    // Pearl speaks the same wire format, so the OpenRouter adapter does the HTTP, the error mapping and the SSE
    // relay; this class adds the prefix, the body translation and the costing.
    this.http = new OpenRouterUpstream({ apiKey: o.apiKey, baseUrl: o.baseUrl ?? PEARL_BASE, timeoutMs: o.timeoutMs, fetch: o.fetch });
  }
  private priceOf(model: string) { return this.o.prices.get(model) ?? null; }
  private target(body: Record<string, unknown>) {
    const id = String(body.model ?? "");
    const model = id.startsWith(PEARL_PREFIX) ? id.slice(PEARL_PREFIX.length) : id;
    const price = this.priceOf(model);
    if (!price) throw E.modelNotAllowed(id);
    return { model, price };
  }
  private costed(u: UpstreamUsage, price: PearlPrice): UpstreamUsage {
    // no token counts at all means no usage frame: the cost is unknown, not zero
    if (u.tokensIn === 0 && u.tokensOut === 0) return { ...u, costMicroUsd: null };
    return { ...u, costMicroUsd: pearlCost(price, u) };
  }

  async models(): Promise<UpstreamModel[]> {
    let live: UpstreamModel[] = [];
    try { live = await this.http.models(); } catch { /* fall back to the priced list */ }
    const byId = new Map(live.map((m) => [m.id, m]));
    const ids = new Set([...this.o.prices.keys(), ...live.filter((m) => m.promptPerMillionMicroUsd !== null && m.completionPerMillionMicroUsd !== null).map((m) => m.id)]);
    const out: UpstreamModel[] = [];
    for (const id of ids) {
      const m = byId.get(id), p = this.o.prices.get(id);
      // a price from the setting wins; a price Pearl publishes on /models is used when there is no setting
      if (!p && m?.promptPerMillionMicroUsd != null && m.completionPerMillionMicroUsd != null) this.o.prices.set(id, { input: m.promptPerMillionMicroUsd, output: m.completionPerMillionMicroUsd, cached: null });
      const price = this.o.prices.get(id)!;
      out.push({ id: PEARL_PREFIX + id, name: `Pearl · ${m?.name ?? id.split("/").pop()}`, contextLength: m?.contextLength ?? null, promptPerMillionMicroUsd: price.input, completionPerMillionMicroUsd: price.output });
    }
    return out;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const { model, price } = this.target(req.body);
    const r = await this.http.complete({ body: toPearlBody(req.body, model), signal: req.signal });
    return { body: r.body, usage: this.costed(r.usage, price) };
  }

  async stream(req: CompletionRequest): Promise<StreamedCompletion> {
    const { model, price } = this.target(req.body);
    const r = await this.http.stream({ body: { ...toPearlBody(req.body, model), stream_options: { include_usage: true } }, signal: req.signal });
    return { stream: r.stream, usage: r.usage.then((u) => this.costed(u, price)) };
  }
}

/** Several providers behind one port: a model id's prefix picks the provider, everything else goes to the default. */
export class RoutedUpstream implements Upstream {
  readonly name: string;
  constructor(private fallback: Upstream, private routes: { prefix: string; upstream: Upstream }[]) { this.name = [fallback.name, ...routes.map((r) => r.upstream.name)].join("+"); }
  private pick(body: Record<string, unknown>) { const id = String(body.model ?? ""); return this.routes.find((r) => id.startsWith(r.prefix))?.upstream ?? this.fallback; }
  async models(): Promise<UpstreamModel[]> {
    const all = await Promise.allSettled([this.fallback, ...this.routes.map((r) => r.upstream)].map((u) => u.models()));
    // the default provider failing must still surface (the proxy keeps its last list); the others just drop out
    if (all.every((x) => x.status === "rejected")) throw (all[0] as PromiseRejectedResult).reason;
    return all.flatMap((x) => (x.status === "fulfilled" ? x.value : []));
  }
  complete(req: CompletionRequest) { return this.pick(req.body).complete(req); }
  stream(req: CompletionRequest) { return this.pick(req.body).stream(req); }
}
