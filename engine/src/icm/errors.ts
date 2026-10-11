/**
 * Errors with stable codes.
 *
 * A caller deciding whether to retry, to stop, or to tell a person something should never have to read a sentence
 * to find out which. Every failure carries a `code` from a closed set and an HTTP `status`, and `retryable` answers
 * the only question an automated caller actually has.
 *
 * The one rule worth stating out loud: **a charge whose outcome is unknown is never retryable.** If we sent a
 * request upstream and did not learn whether it ran, retrying it may bill the customer twice for one answer. That
 * veto beats the 5xx rule, which is otherwise what decides.
 */

export type IcmErrorCode =
  // the key
  | "missing_api_key" | "invalid_api_key" | "key_disabled" | "key_expired"
  // the account
  | "insufficient_balance" | "spend_limit_reached" | "account_suspended"
  // the request
  | "invalid_request" | "unknown_model" | "model_not_allowed" | "payload_too_large"
  // us
  | "not_configured" | "upstream_unavailable" | "upstream_refused" | "outcome_unknown"
  | "rate_limited" | "invalid_response" | "aborted" | "not_found" | "forbidden"
  | "unknown";

export interface IcmErrorInit {
  code?: IcmErrorCode;
  status?: number;
  /** Seconds the caller was asked to wait, when the upstream said so. Advisory; it does not decide `retryable`. */
  retryAfter?: number | null;
  /** Anything safe to hand back to the caller alongside the message. Never secrets, never upstream URLs. */
  detail?: Record<string, unknown> | null;
}

export class IcmError extends Error {
  readonly code: IcmErrorCode;
  readonly status: number;
  readonly retryAfter: number | null;
  readonly detail: Record<string, unknown> | null;

  constructor(message: string, init: IcmErrorInit = {}) {
    super(message);
    this.name = "IcmError";
    this.code = init.code ?? "unknown";
    this.status = init.status ?? 0;
    this.retryAfter = init.retryAfter ?? null;
    this.detail = init.detail ?? null;
  }

  /** Whether sending the same request again could reasonably work. */
  get retryable(): boolean {
    // An ambiguous charge is never replayed, whatever the status says, and a misconfiguration will not fix itself.
    if (this.code === "outcome_unknown" || this.code === "not_configured") return false;
    if (this.code === "rate_limited" || this.code === "upstream_unavailable") return true;
    return this.status >= 500;
  }

  /** The body this error becomes on the wire — OpenAI's error envelope, which every client already understands. */
  toBody(): { error: { message: string; type: IcmErrorCode; code: IcmErrorCode; detail?: Record<string, unknown> } } {
    return { error: { message: this.message, type: this.code, code: this.code, ...(this.detail ? { detail: this.detail } : {}) } };
  }
}

export const E = {
  missingKey: () => new IcmError("No API key. Send `Authorization: Bearer <key>`.", { code: "missing_api_key", status: 401 }),
  invalidKey: () => new IcmError("That API key is not one of ours, or it has been deleted.", { code: "invalid_api_key", status: 401 }),
  keyDisabled: () => new IcmError("That API key has been turned off. Turn it back on, or make a new one.", { code: "key_disabled", status: 403 }),
  keyExpired: () => new IcmError("That API key has expired.", { code: "key_expired", status: 403 }),
  suspended: (why: string) => new IcmError(`This account is suspended: ${why}`, { code: "account_suspended", status: 403 }),
  insufficient: (availableUsd: string, neededUsd: string) =>
    new IcmError(`Not enough credit: this account holds $${availableUsd} and the call needs about $${neededUsd}. Nothing was charged.`,
      { code: "insufficient_balance", status: 402, detail: { available: availableUsd, needed: neededUsd } }),
  spendLimit: (limitUsd: string) =>
    new IcmError(`This key has reached its spend limit of $${limitUsd}. Raise it, or use another key. Nothing was charged.`,
      { code: "spend_limit_reached", status: 402, detail: { limit: limitUsd } }),
  invalid: (message: string, detail?: Record<string, unknown>) => new IcmError(message, { code: "invalid_request", status: 400, detail: detail ?? null }),
  unknownModel: (id: string) => new IcmError(`No model called ${JSON.stringify(id)} is available here.`, { code: "unknown_model", status: 404, detail: { model: id } }),
  modelNotAllowed: (id: string) => new IcmError(`${id} is not on this gateway's model list.`, { code: "model_not_allowed", status: 403, detail: { model: id } }),
  tooLarge: (bytes: number) => new IcmError(`That request body is larger than this gateway accepts (${bytes} bytes).`, { code: "payload_too_large", status: 413 }),
  notConfigured: (what: string) => new IcmError(`${what} is not configured on this deployment.`, { code: "not_configured", status: 503 }),
  upstreamDown: (detail?: string) => new IcmError(`The model provider could not be reached${detail ? `: ${detail}` : "."}`, { code: "upstream_unavailable", status: 503 }),
  upstreamRefused: (status: number, message: string) => new IcmError(message, { code: "upstream_refused", status: status >= 400 && status < 600 ? status : 502 }),
  outcomeUnknown: (message: string) => new IcmError(message, { code: "outcome_unknown", status: 502 }),
  rateLimited: (retryAfter: number | null) => new IcmError("Too many requests. Slow down and try again.", { code: "rate_limited", status: 429, retryAfter }),
  notFound: (what: string) => new IcmError(`No ${what} with that id.`, { code: "not_found", status: 404 }),
  forbidden: (message: string) => new IcmError(message, { code: "forbidden", status: 403 }),
  aborted: () => new IcmError("The request was cancelled here. Work already started upstream is not cancelled by this.", { code: "aborted", status: 499 }),
} as const;

/** Anything thrown, as an `IcmError`. An unrecognised throw becomes a deliberately bare message, because a custom
 *  fetch or an upstream client can put an Authorization header or a private URL into an exception string. */
export function asIcmError(e: unknown): IcmError {
  if (e instanceof IcmError) return e;
  if (e instanceof Error && e.name === "AbortError") return E.aborted();
  return new IcmError("The request failed before a response was confirmed.", { code: "unknown", status: 0 });
}
