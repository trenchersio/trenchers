/**
 * Two conversions, and nothing else.
 *
 *   tokens  →  dollars of credit     at a rate the operator set, rounding **down** so a deposit never mints
 *                                    more credit than was paid for
 *   upstream cost  →  retail price   plus margin, rounding **up** so the house never eats a fraction
 *
 * Both roundings favour the house by at most one micro-dollar, which is a ten-thousandth of a cent. They point
 * that way because the alternative — rounding both towards the customer — is a slow leak that nobody notices
 * until the books do not add up.
 */
import type { IcmConfig } from "./config.ts";
import { MICRO, formatUnits, formatUsd, mulDivDown, mulDivUp, parseUnits } from "./money.ts";

/** Micro-dollars of credit for a payment of `tokenUnits` base units. Rounds down. */
export function creditForTokens(cfg: IcmConfig, tokenUnits: bigint): bigint {
  if (tokenUnits < 0n) throw new TypeError("a deposit cannot be negative");
  const perUsd = parseUnits(cfg.token.tokensPerUsd, cfg.token.decimals);
  return mulDivDown(tokenUnits, MICRO, perUsd);
}

/** Base units of the token needed to buy `micro` dollars of credit. Rounds **up**: a quote must not ask for
 *  less than it costs. The inverse of `creditForTokens` to within one base unit. */
export function tokensForCredit(cfg: IcmConfig, micro: bigint): bigint {
  if (micro < 0n) throw new TypeError("a quote cannot be negative");
  const perUsd = parseUnits(cfg.token.tokensPerUsd, cfg.token.decimals);
  return mulDivUp(micro, perUsd, MICRO);
}

/** What the customer pays for something that cost the house `upstreamMicroUsd`. Rounds up. */
export function retailOf(cfg: Pick<IcmConfig, "marginBps">, upstreamMicroUsd: bigint): bigint {
  if (upstreamMicroUsd < 0n) throw new TypeError("an upstream cost cannot be negative");
  if (upstreamMicroUsd === 0n) return 0n;
  return mulDivUp(upstreamMicroUsd, BigInt(10_000 + cfg.marginBps), 10_000n);
}

/** The house's share of a retail price: retail − upstream. */
export function marginOf(cfg: Pick<IcmConfig, "marginBps">, upstreamMicroUsd: bigint): bigint {
  return retailOf(cfg, upstreamMicroUsd) - upstreamMicroUsd;
}

/** The published rate, in both directions, for a page or an API response. */
export function rateCard(cfg: IcmConfig): {
  symbol: string;
  tokensPerUsd: string;
  usdPerToken: string;
  marginBps: number;
  marginPercent: string;
  sink: IcmConfig["token"]["sink"];
  examples: { tokens: string; usd: string }[];
} {
  const perUsd = parseUnits(cfg.token.tokensPerUsd, cfg.token.decimals);
  const one = 10n ** BigInt(cfg.token.decimals);
  const examples = ["1000", "10000", "100000", "1000000"].map((whole) => {
    const units = parseUnits(whole, cfg.token.decimals);
    return { tokens: whole, usd: formatUsd(creditForTokens(cfg, units)) };
  });
  return {
    symbol: cfg.token.symbol,
    tokensPerUsd: cfg.token.tokensPerUsd,
    // what one whole token is worth, to the micro-dollar. Often "0.000000" for a cheap token; that is honest.
    usdPerToken: formatUsd(mulDivDown(one, MICRO, perUsd)),
    marginBps: cfg.marginBps,
    marginPercent: `${(cfg.marginBps / 100).toFixed(cfg.marginBps % 100 === 0 ? 0 : 2)}%`,
    sink: cfg.token.sink,
    examples,
  };
}

/**
 * What to reserve before a call runs.
 *
 * There is no way to know what a completion will cost before it exists, so the hold is an upper bound built from
 * what the caller asked for, and the difference comes straight back when the real cost arrives. Over-holding
 * briefly is annoying; under-holding means serving work that cannot be paid for.
 *
 * `perMillion` is the provider's own worst-case rate for the model, in micro-dollars per million tokens, when the
 * gateway knows it. When it does not, `fallbackMicroUsd` stands in — a flat guess, clamped by the config.
 */
export function holdFor(cfg: IcmConfig, o: {
  promptTokens: number;
  maxCompletionTokens: number;
  promptPerMillionMicroUsd?: bigint | null;
  completionPerMillionMicroUsd?: bigint | null;
  fallbackMicroUsd?: bigint;
}): bigint {
  const million = 1_000_000n;
  const prompt = BigInt(Math.max(0, Math.ceil(o.promptTokens)));
  const completion = BigInt(Math.max(0, Math.ceil(o.maxCompletionTokens)));
  let upstream: bigint;
  if (o.promptPerMillionMicroUsd != null || o.completionPerMillionMicroUsd != null) {
    upstream = mulDivUp(prompt, o.promptPerMillionMicroUsd ?? 0n, million) + mulDivUp(completion, o.completionPerMillionMicroUsd ?? 0n, million);
  } else {
    upstream = o.fallbackMicroUsd ?? 200_000n; // twenty cents: generous for one call, cheap to be wrong about
  }
  const retail = retailOf(cfg, upstream);
  if (retail < cfg.minHoldMicroUsd) return cfg.minHoldMicroUsd;
  if (retail > cfg.maxHoldMicroUsd) return cfg.maxHoldMicroUsd;
  return retail;
}

/** A sentence for a human: "1,000 TRENCHERS buys $1.000000 of credit; the house adds its margin." */
export function describeRate(cfg: IcmConfig): string {
  const card = rateCard(cfg);
  const perUsd = parseUnits(cfg.token.tokensPerUsd, cfg.token.decimals);
  return `${formatUnits(perUsd, cfg.token.decimals).replace(/\.?0+$/, "")} ${cfg.token.symbol} buys $1.00 of credit. `
    + `A call costs what the model provider charged plus ${card.marginPercent}.`;
}
