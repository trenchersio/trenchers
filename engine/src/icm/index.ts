/**
 * Inference Capital Markets — sell LLM inference for a token.
 *
 * Four pieces, each usable alone:
 *
 *   Ledger     accounts, keys, deposits, holds, charges, and a house book that states the liability
 *   Proxy      an OpenAI-compatible gateway that bills what the provider actually charged, plus a margin
 *   Upstream   the provider, behind a port; an OpenRouter adapter ships
 *   Store      the storage port; a MemoryStore ships, a database is an adapter
 *
 * Nothing here knows what token it is selling for, what chain that token is on, who the operator is, or what the
 * product is called. All of that is `makeConfig`, and pointing this at a different token on a different chain is
 * a config change and a funding adapter, not a fork.
 *
 * The three rules the rest of the code exists to keep:
 *
 *   1. Money is an integer of micro-dollars. A float never touches an amount.
 *   2. Nothing is served that has not been held for first.
 *   3. A charge whose outcome is unknown is never resolved automatically, in either direction.
 */

export { MICRO, USD_DECIMALS, parseUsd, formatUsd, formatUsdShort, formatCents, parseUnits, formatUnits, mulDivUp, mulDivDown, atLeastZero } from "./money.ts";
export { IcmError, E, asIcmError, type IcmErrorCode, type IcmErrorInit } from "./errors.ts";
export { COLLECTIONS, MemoryStore, type CollectionName, type Store, type Row, type Tables } from "./store.ts";
export { DEFAULTS, makeConfig, modelAllowed, type IcmConfig, type TokenConfig } from "./config.ts";
export { creditForTokens, tokensForCredit, retailOf, marginOf, rateCard, holdFor, describeRate } from "./pricing.ts";
export { Ledger, hashSecret, usdFromInput, type LedgerOptions, type IssuedKey } from "./ledger.ts";
export { Proxy, type ProxyOptions, type ProxyResult } from "./proxy.ts";
export { createSurface, type IcmRequest, type IcmResponse, type SurfaceOptions } from "./http.ts";
export { DepositWatcher, type ConfirmedPayment, type PaymentSource, type WatcherOptions, type PollResult } from "./funding.ts";
export {
  OpenRouterUpstream, costToMicroUsd, readUsage,
  type Upstream, type UpstreamModel, type UpstreamUsage, type OpenRouterOptions,
  type CompletionRequest, type CompletionResponse, type StreamedCompletion,
} from "./upstream.ts";
export type { Account, ApiKey, Charge, Deposit, DepositSource, ChargeState, HouseBook } from "./types.ts";
