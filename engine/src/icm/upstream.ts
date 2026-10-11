/**
 * The model provider, behind a port.
 *
 * One adapter ships: OpenRouter. The port exists so the gateway can be pointed somewhere else — another
 * aggregator, a direct provider, a local stack — without the ledger or the proxy knowing. Everything specific to
 * OpenRouter lives below the `OpenRouterUpstream` line and nowhere else in this package.
 *
 * The one thing the port must guarantee, and the reason billing works at all: **every completion comes back with
 * what it cost us.** OpenRouter puts `usage.cost` on the response (and on the last SSE frame of a stream) in
 * credits, where one credit is one US dollar. An adapter that cannot report a cost must say so by returning null,
 * and the proxy will then refuse to guess.
 */
import { E, IcmError, asIcmError } from "./errors.ts";
import { parseUsd } from "./money.ts";

/** What a finished generation cost and consumed. All money in integer micro-dollars. */
export interface UpstreamUsage {
  /** What the provider charged us. Null when the provider did not say, which is a billing failure, not a zero. */
  costMicroUsd: bigint | null;
  tokensIn: number;
  tokensOut: number;
  reasoningTokens: number;
  cachedTokens: number;
  /** The provider's own id for this generation, for reconciling against their invoice. */
  id: string | null;
}

export interface UpstreamModel {
  id: string;
  name: string | null;
  contextLength: number | null;
  /** Micro-dollars per million prompt tokens, when the provider publishes it. Used to size a hold. */
  promptPerMillionMicroUsd: bigint | null;
  completionPerMillionMicroUsd: bigint | null;
}

export interface CompletionRequest {
  /** The caller's body, passed through almost untouched. The proxy has already checked the model and stripped
   *  anything it will not forward. */
  body: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface CompletionResponse {
  /** The provider's JSON, to hand back to the caller as-is. */
  body: Record<string, unknown>;
  usage: UpstreamUsage;
}

export interface StreamedCompletion {
  /** Server-sent event frames, exactly as the provider wrote them, to relay without buffering. */
  stream: ReadableStream<Uint8Array>;
  /** Resolves once the stream has ended and the usage frame has been read. Rejects only if the stream itself
   *  failed; a stream that ended without a usage frame resolves with `costMicroUsd: null`. */
  usage: Promise<UpstreamUsage>;
}

export interface Upstream {
  readonly name: string;
  models(): Promise<UpstreamModel[]>;
  complete(req: CompletionRequest): Promise<CompletionResponse>;
  stream(req: CompletionRequest): Promise<StreamedCompletion>;
}

// ------------------------------------------------------------------------------------------------ OpenRouter

export interface OpenRouterOptions {
  apiKey: string;
  baseUrl?: string;
  /** Sent as `HTTP-Referer` and `X-Title`; OpenRouter uses them for its public leaderboards. Optional. */
  referer?: string;
  title?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** A number of dollars, from anything the provider might send, to micro-dollars. Returns null rather than zero
 *  for anything unreadable, because a missing cost and a free call are very different facts. */
export function costToMicroUsd(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    // A float of dollars is all the provider gives us. Convert through a fixed-point string, never by multiplying
    // a float by a million: 0.0000071 * 1e6 is 7.099999999999999.
    return parseUsd(value.toFixed(6));
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return null;
    try { return parseUsd(Number(t).toFixed(6)); } catch { return null; }
  }
  return null;
}

const asInt = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** Pull the usage block out of a completion body or a final SSE frame. */
export function readUsage(body: Record<string, unknown>): UpstreamUsage {
  const u = obj(body.usage);
  const promptDetails = obj(u.prompt_tokens_details);
  const completionDetails = obj(u.completion_tokens_details);
  return {
    costMicroUsd: costToMicroUsd(u.cost),
    tokensIn: asInt(u.prompt_tokens),
    tokensOut: asInt(u.completion_tokens),
    reasoningTokens: asInt(completionDetails.reasoning_tokens),
    cachedTokens: asInt(promptDetails.cached_tokens),
    id: typeof body.id === "string" ? body.id : null,
  };
}

export class OpenRouterUpstream implements Upstream {
  readonly name = "openrouter";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly referer: string | null;
  private readonly title: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(o: OpenRouterOptions) {
    if (!o.apiKey) throw E.notConfigured("The model provider key");
    this.apiKey = o.apiKey;
    this.baseUrl = (o.baseUrl ?? OPENROUTER_BASE).replace(/\/+$/, "");
    this.referer = o.referer ?? null;
    this.title = o.title ?? null;
    this.timeoutMs = o.timeoutMs ?? 600_000;
    this.fetchImpl = o.fetch ?? globalThis.fetch;
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" };
    if (json) h["Content-Type"] = "application/json";
    if (this.referer) h["HTTP-Referer"] = this.referer;
    if (this.title) h["X-Title"] = this.title;
    return h;
  }

  /** Every call out. Errors are translated here so nothing above this line sees a provider's wording, a status
   *  code it does not understand, or a URL with a key in it. */
  private async call(path: string, init: RequestInit & { stream?: boolean }, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers: this.headers(init.method === "POST"), redirect: "error", signal: composed });
    } catch (e) {
      if (signal?.aborted) throw E.aborted();
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        // The request went out and we never heard back. Whether it ran is exactly what we do not know.
        throw E.outcomeUnknown("The model provider did not answer in time. Whether the call ran upstream is unknown, so it has not been charged or refunded automatically.");
      }
      throw E.upstreamDown();
    }
    if (res.ok) return res;

    const retryAfter = /^\d{1,6}$/.test(res.headers.get("retry-after") ?? "") ? Number(res.headers.get("retry-after")) : null;
    if (res.status === 429) throw E.rateLimited(retryAfter);
    if (res.status === 402) throw new IcmError("The gateway's own account with the model provider is out of credit. This is ours to fix, not yours.", { code: "not_configured", status: 503 });
    if (res.status === 401 || res.status === 403) throw E.notConfigured("The model provider key");
    const text = await res.text().catch(() => "");
    let message = `The model provider refused the request (${res.status}).`;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown } | string };
      const m = typeof parsed.error === "string" ? parsed.error : typeof parsed.error?.message === "string" ? parsed.error.message : null;
      if (m) message = m.slice(0, 400);
    } catch { /* the body was not JSON; the generic message stands */ }
    if (res.status >= 500) throw E.upstreamDown(message);
    throw E.upstreamRefused(res.status, message);
  }

  async models(): Promise<UpstreamModel[]> {
    const res = await this.call("/models", { method: "GET" });
    const body = await res.json().catch(() => ({})) as { data?: unknown };
    if (!Array.isArray(body.data)) return [];
    const perMillion = (v: unknown): bigint | null => {
      // OpenRouter publishes pricing as dollars per single token, as a string: "0.000003".
      const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
      if (!Number.isFinite(n) || n < 0) return null;
      return costToMicroUsd((n * 1_000_000).toFixed(6));
    };
    return body.data.flatMap((raw): UpstreamModel[] => {
      const m = obj(raw);
      if (typeof m.id !== "string") return [];
      const pricing = obj(m.pricing);
      return [{
        id: m.id,
        name: typeof m.name === "string" ? m.name : null,
        contextLength: typeof m.context_length === "number" ? m.context_length : null,
        promptPerMillionMicroUsd: perMillion(pricing.prompt),
        completionPerMillionMicroUsd: perMillion(pricing.completion),
      }];
    });
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const res = await this.call("/chat/completions", { method: "POST", body: JSON.stringify({ ...req.body, stream: false }) }, req.signal);
    let body: Record<string, unknown>;
    try { body = obj(await res.json()); }
    catch { throw E.outcomeUnknown("The model provider answered with something that is not JSON. The call may have run; it has not been charged."); }
    return { body, usage: readUsage(body) };
  }

  async stream(req: CompletionRequest): Promise<StreamedCompletion> {
    const res = await this.call("/chat/completions", { method: "POST", body: JSON.stringify({ ...req.body, stream: true }) }, req.signal);
    if (!res.body) throw E.upstreamDown("the provider opened a stream with no body");

    const empty: UpstreamUsage = { costMicroUsd: null, tokensIn: 0, tokensOut: 0, reasoningTokens: 0, cachedTokens: 0, id: null };
    let settle!: (u: UpstreamUsage) => void;
    const usage = new Promise<UpstreamUsage>((resolve) => { settle = resolve; });

    // Every exit from the stream — ended, cancelled, errored — comes through here exactly once. A usage promise
    // that can hang is a hold that is never resolved, which is a customer's money stuck.
    let seen: UpstreamUsage | null = null;
    let finished = false;
    const finish = () => { if (!finished) { finished = true; settle(seen ?? empty); } };

    // Relay every byte unchanged and read a copy for the usage frame. `tee` would buffer one side against the
    // other and delay the customer's tokens behind our accounting, so this passes through and parses as it goes.
    const decoder = new TextDecoder();
    let tail = "";
    const scan = (chunk: Uint8Array) => {
      tail += decoder.decode(chunk, { stream: true });
      // SSE frames are separated by a blank line; whatever follows the last one belongs to the next chunk.
      const frames = tail.split("\n\n");
      tail = frames.pop() ?? "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = obj(JSON.parse(data));
            // The usage frame is last and authoritative; earlier frames are read only for the generation id.
            if (parsed.usage) seen = readUsage(parsed);
            else if (typeof parsed.id === "string") seen = seen ? { ...seen, id: seen.id ?? parsed.id } : { ...empty, id: parsed.id };
          } catch { /* a frame we cannot parse is not a billing event */ }
        }
      }
    };

    const reader = res.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) { finish(); controller.close(); return; }
          if (value) { scan(value); controller.enqueue(value); }
        } catch (e) {
          finish();
          controller.error(e);
        }
      },
      cancel(reason) { finish(); return reader.cancel(reason); },
    });

    return { stream, usage };
  }
}

export { asIcmError };
