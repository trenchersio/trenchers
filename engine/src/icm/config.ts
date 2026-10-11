/**
 * Everything that differs between one deployment and another.
 *
 * This file is the whole reason the package is portable: no token, chain, brand, price or provider is written
 * anywhere else in `src/`. Point it at a different token on a different chain and nothing below it changes.
 *
 * The rate is the one number an operator must own. It is set by hand and changed by hand, deliberately: a live
 * price feed on a thin pool is a way to sell a dollar of inference for a cent during a wick. The cost of setting
 * it by hand is drift, and drift is a number the house book shows rather than a surprise.
 */
import { parseUnits, parseUsd } from "./money.ts";
import { IcmError } from "./errors.ts";

export interface TokenConfig {
  /** Shown to people. "TRENCHERS", not "$TRENCHERS" — the sigil is the host's to add. */
  symbol: string;
  /** ERC-20 address, lowercased. The package never calls it; the host's funding adapter does. */
  address: string;
  decimals: number;
  chainId: number;
  /** Whole tokens per one US dollar of credit, as a decimal string. "1000" means 1,000 tokens buys $1. */
  tokensPerUsd: string;
  /** What happens to tokens taken in: destroyed, kept, or split by the host's own router. Recorded on every
   *  deposit so the house book can tell a burned token from a held one. */
  sink: "burn" | "treasury" | "router";
}

export interface IcmConfig {
  /** Prefix on every key this deployment issues, e.g. "trench". Keys read `trench_live_<32 hex>`. */
  keyPrefix: string;
  /** "live" or "test". A test key may not spend real credit; the host decides what it does instead. */
  environment: "live" | "test";
  token: TokenConfig;
  /** What the house adds on top of what the provider charged, in basis points. Set by the operator, privately. */
  marginBps: number;
  /** Refuse to open a call that could not possibly be paid for. A hold smaller than this is pointless. */
  minHoldMicroUsd: bigint;
  /** The most a single call may hold, however large its max_tokens. A ceiling on one mistake. */
  maxHoldMicroUsd: bigint;
  /** The smallest deposit worth crediting, in micro-dollars of face value. Below it the gas costs more than
   *  the credit is worth. */
  minDepositMicroUsd: bigint;
  /** Largest request body the proxy will read, in bytes. */
  maxRequestBytes: number;
  /** Models this gateway will route to. Empty means every model the provider offers. A `*` suffix matches a
   *  prefix, so "anthropic/*" admits the family. */
  allowModels: string[];
  /** Models refused whatever the allow list says. Checked second, so it wins. */
  denyModels: string[];
}

export const DEFAULTS = {
  keyPrefix: "icm",
  environment: "live",
  marginBps: 0,
  minHoldMicroUsd: 100n,
  maxHoldMicroUsd: 50_000_000n,
  minDepositMicroUsd: 100_000n,
  maxRequestBytes: 4_194_304,
  allowModels: [] as string[],
  denyModels: [] as string[],
} as const;

/** Build a config, refusing anything that would quietly mis-bill. Every check here is a mistake that would
 *  otherwise only show up on somebody's balance. */
export function makeConfig(input: {
  keyPrefix?: string;
  environment?: "live" | "test";
  token: Partial<TokenConfig> & Pick<TokenConfig, "symbol" | "address" | "tokensPerUsd">;
  marginBps?: number;
  minHoldMicroUsd?: bigint | string;
  maxHoldMicroUsd?: bigint | string;
  minDepositMicroUsd?: bigint | string;
  maxRequestBytes?: number;
  allowModels?: string[];
  denyModels?: string[];
}): IcmConfig {
  const bad = (m: string) => new IcmError(m, { code: "not_configured", status: 503 });

  const keyPrefix = input.keyPrefix ?? DEFAULTS.keyPrefix;
  if (!/^[a-z][a-z0-9]{1,15}$/.test(keyPrefix)) throw bad(`keyPrefix must be 2 to 16 lowercase letters and digits, starting with a letter; got ${JSON.stringify(keyPrefix)}`);

  const decimals = input.token.decimals ?? 18;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw bad(`token.decimals must be a whole number from 0 to 36; got ${decimals}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.token.address)) throw bad(`token.address must be 0x and 40 hex characters; got ${JSON.stringify(input.token.address)}`);
  if (!/^[A-Za-z][A-Za-z0-9.]{0,15}$/.test(input.token.symbol)) throw bad(`token.symbol must be 1 to 16 letters, digits or dots; got ${JSON.stringify(input.token.symbol)}`);

  // The rate has to parse at the token's own precision, and it cannot be zero: dividing by it is how credit is priced.
  let rate: bigint;
  try { rate = parseUnits(input.token.tokensPerUsd, decimals); }
  catch { throw bad(`token.tokensPerUsd must be a decimal number of whole tokens with at most ${decimals} places; got ${JSON.stringify(input.token.tokensPerUsd)}`); }
  if (rate <= 0n) throw bad("token.tokensPerUsd must be greater than zero, or a deposit would buy unlimited credit");

  const marginBps = input.marginBps ?? DEFAULTS.marginBps;
  if (!Number.isInteger(marginBps) || marginBps < 0 || marginBps > 100_000) throw bad(`marginBps must be a whole number from 0 to 100000; got ${marginBps}`);

  const amount = (v: bigint | string | undefined, dflt: bigint, name: string): bigint => {
    if (v === undefined) return dflt;
    try { return parseUsd(v); } catch { throw bad(`${name} must be an amount of dollars; got ${JSON.stringify(String(v))}`); }
  };
  const minHoldMicroUsd = amount(input.minHoldMicroUsd, DEFAULTS.minHoldMicroUsd, "minHoldMicroUsd");
  const maxHoldMicroUsd = amount(input.maxHoldMicroUsd, DEFAULTS.maxHoldMicroUsd, "maxHoldMicroUsd");
  if (maxHoldMicroUsd < minHoldMicroUsd) throw bad("maxHoldMicroUsd cannot be below minHoldMicroUsd");

  const maxRequestBytes = input.maxRequestBytes ?? DEFAULTS.maxRequestBytes;
  if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 1024) throw bad(`maxRequestBytes must be at least 1024; got ${maxRequestBytes}`);

  const sink = input.token.sink ?? "treasury";
  if (sink !== "burn" && sink !== "treasury" && sink !== "router") throw bad(`token.sink must be burn, treasury or router; got ${JSON.stringify(sink)}`);

  return {
    keyPrefix,
    environment: input.environment ?? DEFAULTS.environment,
    token: { symbol: input.token.symbol, address: input.token.address.toLowerCase(), decimals, chainId: input.token.chainId ?? 1, tokensPerUsd: input.token.tokensPerUsd, sink },
    marginBps,
    minHoldMicroUsd,
    maxHoldMicroUsd,
    minDepositMicroUsd: amount(input.minDepositMicroUsd, DEFAULTS.minDepositMicroUsd, "minDepositMicroUsd"),
    maxRequestBytes,
    allowModels: input.allowModels ?? [...DEFAULTS.allowModels],
    denyModels: input.denyModels ?? [...DEFAULTS.denyModels],
  };
}

/** Whether a model id may be routed. Deny wins; an empty allow list admits everything not denied. */
export function modelAllowed(cfg: Pick<IcmConfig, "allowModels" | "denyModels">, id: string): boolean {
  const matches = (pattern: string) => (pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern);
  if (cfg.denyModels.some(matches)) return false;
  return cfg.allowModels.length === 0 || cfg.allowModels.some(matches);
}
