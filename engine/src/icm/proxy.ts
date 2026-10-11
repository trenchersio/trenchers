/**
 * The gateway: an OpenAI-compatible surface that bills in credit.
 *
 * One request, five steps, in this order and no other:
 *
 *   1. authenticate   the key, the account, the model
 *   2. hold           an upper bound on the price, out of the balance, before anything leaves the building
 *   3. forward        to the provider
 *   4. settle         against what the provider actually charged, returning the rest of the hold
 *   5. answer         with the provider's own body, plus headers saying what it cost and what is left
 *
 * The order is the whole design. Holding first means a call that cannot be paid for is refused before it costs
 * anybody anything. Settling on the provider's reported cost — rather than on an estimate — means the house
 * charges a known margin on a known number rather than guessing at both.
 *
 * What happens when step 3 goes wrong is the part worth reading twice. A refusal before any generation releases
 * the hold in full. A timeout, a broken stream, or a response we cannot parse leaves the charge `unknown`: the
 * hold stays put and a person decides. Nothing here ever resolves an ambiguous charge by itself, in either
 * direction, because both directions are a way to be quietly wrong about money.
 */
import type { ApiKey, Account, Charge } from "./types.ts";
import type { Ledger } from "./ledger.ts";
import type { IcmConfig } from "./config.ts";
import type { Upstream, UpstreamModel } from "./upstream.ts";
import { modelAllowed } from "./config.ts";
import { E, IcmError, asIcmError } from "./errors.ts";
import { formatUsd } from "./money.ts";
import { holdFor, retailOf } from "./pricing.ts";

/** Fields the gateway will not pass on. `stream` is set by us from the caller's own flag; the rest are the
 *  provider's account-level controls, which are the house's business and not a caller's. */
const STRIPPED = new Set(["stream_options", "user", "transforms", "route", "provider", "usage"]);

export interface ProxyOptions {
  ledger: Ledger;
  upstream: Upstream;
  /** How long a cached model list is trusted. The list is only used to size holds and to answer /models. */
  modelsTtlMs?: number;
  now?: () => number;
}

export interface ProxyResult {
  status: number;
  headers: Record<string, string>;
  /** Exactly one of these. */
  json?: unknown;
  stream?: ReadableStream<Uint8Array>;
}

export class Proxy {
  readonly ledger: Ledger;
  readonly upstream: Upstream;
  private readonly config: IcmConfig;
  private readonly now: () => number;
  private readonly modelsTtlMs: number;
  private cache: { at: number; models: UpstreamModel[] } | null = null;

  constructor(o: ProxyOptions) {
    this.ledger = o.ledger;
    this.upstream = o.upstream;
    this.config = o.ledger.config;
    this.now = o.now ?? Date.now;
    this.modelsTtlMs = o.modelsTtlMs ?? 10 * 60_000;
  }

  /** The provider's catalogue, filtered to what this gateway will route to, cached. A provider that cannot be
   *  reached yields an empty list rather than an error: the gateway can still serve a call for a model the
   *  caller already knows the name of. */
  async models(): Promise<UpstreamModel[]> {
    if (this.cache && this.now() - this.cache.at < this.modelsTtlMs) return this.cache.models;
    let models: UpstreamModel[];
    try { models = await this.upstream.models(); }
    catch { return this.cache?.models ?? []; }
    const allowed = models.filter((m) => modelAllowed(this.config, m.id));
    this.cache = { at: this.now(), models: allowed };
    return allowed;
  }

  /** The /models response, in OpenAI's envelope, with our retail prices rather than the provider's. */
  async modelsBody(): Promise<{ object: "list"; data: Record<string, unknown>[] }> {
    const models = await this.models();
    return {
      object: "list",
      data: models.map((m) => ({
        id: m.id,
        object: "model",
        name: m.name,
        context_length: m.contextLength,
        pricing: {
          // what the caller will be charged, per million tokens, as dollars — the provider's cost plus margin
          prompt: m.promptPerMillionMicroUsd == null ? null : formatUsd(retailOf(this.config, m.promptPerMillionMicroUsd)),
          completion: m.completionPerMillionMicroUsd == null ? null : formatUsd(retailOf(this.config, m.completionPerMillionMicroUsd)),
          unit: "per_million_tokens",
          currency: "USD",
        },
      })),
    };
  }

  // ------------------------------------------------------------------------------------------ the call

  /**
   * Serve one chat completion. `secret` is the key as presented; `body` is the caller's JSON, already parsed and
   * already size-checked by the transport.
   */
  async chat(o: { secret: string | null; body: unknown; signal?: AbortSignal }): Promise<ProxyResult> {
    const started = this.now();
    const { key, account } = this.ledger.authenticate(o.secret);
    const body = this.validate(o.body, key);
    const wantsStream = body.stream === true;

    const charge = this.ledger.hold({ key, account, model: String(body.model), amountMicroUsd: await this.estimate(body) });

    try {
      return wantsStream
        ? await this.streamed({ charge, key, account, body, signal: o.signal, started })
        : await this.once({ charge, key, account, body, signal: o.signal, started });
    } catch (e) {
      const err = asIcmError(e);
      // The step that failed may already have resolved the charge — `once` marks a cost-less completion unknown
      // before throwing, and a stream can settle while its request is unwinding. Only an untouched hold is ours
      // to resolve here, and resolving one twice would throw over the top of the real error.
      if (this.ledger.chargeById(charge.id).state === "held") {
        // `outcome_unknown` is the only code that must not hand the money back: we do not know whether it ran.
        if (err.code === "outcome_unknown") this.ledger.markUnknown(charge.id, err.message);
        else this.ledger.release(charge.id, `${err.code}: ${err.message}`.slice(0, 300));
      }
      throw err;
    }
  }

  private async once(o: { charge: Charge; key: ApiKey; account: Account; body: Record<string, unknown>; signal?: AbortSignal; started: number }): Promise<ProxyResult> {
    const { body: answer, usage } = await this.upstream.complete({ body: { ...o.body, stream: false }, signal: o.signal });
    if (usage.costMicroUsd === null) {
      // The provider answered but did not say what it cost. Billing a guess is worse than asking a person.
      this.ledger.markUnknown(o.charge.id, "the provider returned a completion with no cost on it");
      throw E.outcomeUnknown("The call ran but the provider did not report its cost, so it has not been billed. The operator has been shown this.");
    }
    const settled = this.ledger.settle({
      chargeId: o.charge.id,
      upstreamMicroUsd: usage.costMicroUsd,
      upstreamId: usage.id,
      usage: { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, reasoningTokens: usage.reasoningTokens, cachedTokens: usage.cachedTokens },
      streamed: false,
      latencyMs: this.now() - o.started,
    });
    const account = this.ledger.accountById(o.account.id);
    return {
      status: 200,
      headers: this.costHeaders(settled, account),
      // the provider's own body, with its cost replaced by ours: a caller reading `usage.cost` must see what
      // they were charged, not what we paid.
      json: { ...answer, usage: { ...(answer.usage as object ?? {}), cost: Number(formatUsd(BigInt(settled.retailMicroUsd))) } },
    };
  }

  private async streamed(o: { charge: Charge; key: ApiKey; account: Account; body: Record<string, unknown>; signal?: AbortSignal; started: number }): Promise<ProxyResult> {
    const { stream, usage } = await this.upstream.stream({ body: { ...o.body, stream: true }, signal: o.signal });

    // The headers go out before the first token, so they cannot carry the cost. The caller reads it from the
    // final usage frame, which the provider sends and we pass through untouched.
    void usage.then((u) => {
      try {
        if (u.costMicroUsd === null) {
          this.ledger.markUnknown(o.charge.id, "the stream ended without a usage frame, so the cost is unknown");
          return;
        }
        this.ledger.settle({
          chargeId: o.charge.id,
          upstreamMicroUsd: u.costMicroUsd,
          upstreamId: u.id,
          usage: { tokensIn: u.tokensIn, tokensOut: u.tokensOut, reasoningTokens: u.reasoningTokens, cachedTokens: u.cachedTokens },
          streamed: true,
          latencyMs: this.now() - o.started,
        });
      } catch {
        // settle throws only if the charge already moved on — a sweep, or a double settle. Either way the
        // ledger is already consistent and there is nothing to do here but not crash the stream.
      }
    });

    return {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-icm-charge": o.charge.id,
        "x-icm-held": formatUsd(BigInt(o.charge.heldMicroUsd)),
      },
      stream,
    };
  }

  // ------------------------------------------------------------------------------------------ validation

  /** Check and clean the caller's body. Everything refused here costs nothing, because no hold has been taken. */
  private validate(raw: unknown, key: ApiKey): Record<string, unknown> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw E.invalid("the request body has to be a JSON object");
    const body = { ...(raw as Record<string, unknown>) };

    const model = body.model;
    if (typeof model !== "string" || !model.trim()) throw E.invalid("`model` is required and has to be a string");
    if (!modelAllowed(this.config, model)) throw E.modelNotAllowed(model);
    if (key.models.length > 0 && !key.models.some((p) => (p.endsWith("*") ? model.startsWith(p.slice(0, -1)) : p === model))) {
      throw E.forbidden(`This key may only call ${key.models.join(", ")}.`);
    }

    const messages = body.messages;
    const prompt = body.prompt;
    if (!Array.isArray(messages) && typeof prompt !== "string") throw E.invalid("`messages` is required and has to be an array");
    if (Array.isArray(messages) && messages.length === 0) throw E.invalid("`messages` cannot be empty");

    for (const field of STRIPPED) delete body[field];
    body.model = model.trim();
    body.stream = body.stream === true;
    return body;
  }

  /** What to hold. Uses the provider's published per-token price for the model when the catalogue has it, and a
   *  flat guess when it does not; either way the config clamps it and the real cost replaces it a moment later. */
  private async estimate(body: Record<string, unknown>): Promise<bigint> {
    const model = String(body.model);
    const known = (await this.models()).find((m) => m.id === model) ?? null;
    const maxTokens = [body.max_tokens, body.max_completion_tokens].find((v) => typeof v === "number" && v > 0) as number | undefined;
    return holdFor(this.config, {
      // A rough prompt size from the serialised messages: four bytes to a token is wrong in both directions but
      // close enough for a bound that is replaced by the truth within seconds.
      promptTokens: Math.ceil(JSON.stringify(body.messages ?? body.prompt ?? "").length / 4),
      maxCompletionTokens: maxTokens ?? 4096,
      promptPerMillionMicroUsd: known?.promptPerMillionMicroUsd ?? null,
      completionPerMillionMicroUsd: known?.completionPerMillionMicroUsd ?? null,
    });
  }

  private costHeaders(charge: Charge, account: Account): Record<string, string> {
    return {
      "content-type": "application/json; charset=utf-8",
      "x-icm-charge": charge.id,
      "x-icm-cost": formatUsd(BigInt(charge.retailMicroUsd)),
      "x-icm-balance": formatUsd(BigInt(account.balanceMicroUsd)),
    };
  }
}

export { IcmError };
