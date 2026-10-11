/**
 * Money, as integers.
 *
 * Everything in this package counts in **micro-dollars**: one millionth of a US dollar, as a bigint. Nothing here
 * ever makes a JavaScript number out of an amount, because `0.1 + 0.2` is not `0.3` and a gateway that bills people
 * cannot afford to find that out in production.
 *
 * Two separate jobs, deliberately not mixed:
 *   - deciding      — always the integer. Can this key afford this call? Subtract, compare, never format first.
 *   - showing       — always the string, made at the edge by `formatUsd`. Never parsed back to decide anything.
 *
 * Token amounts are a different thing again: a token has its own decimals (18 for most ERC-20s) and its own integer
 * space. `parseUnits` and `formatUnits` handle those, and the two spaces only ever meet in `pricing.ts`, at a rate
 * somebody set on purpose.
 */

/** Micro-dollars per dollar. */
export const MICRO = 1_000_000n;
/** Decimal places a dollar amount is carried to. */
export const USD_DECIMALS = 6;

const USD_RE = /^\d+(\.\d{1,6})?$/;

/**
 * A decimal string of dollars to integer micro-dollars. A bigint passes through unchanged and is read as
 * micro-dollars already, so `parseUsd(5n)` is five micro-dollars and `parseUsd("5")` is five dollars.
 *
 * Rejects by construction: the empty string, a negative, exponent notation, a thousands separator, seven or more
 * decimal places, and anything that is not a number. Coercion is how a typo becomes a charge.
 */
export function parseUsd(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  const text = String(value).trim();
  if (!USD_RE.test(text)) throw new TypeError(`${JSON.stringify(text)} is not an amount of dollars. Use a decimal like "1.25", to six places at most.`);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * MICRO + BigInt(`${fraction}000000`.slice(0, 6));
}

/** Integer micro-dollars to a decimal string, always six places. Truncates towards zero; it never rounds up, because
 *  showing somebody a hundredth of a cent more than they have is worse than showing a hundredth less. */
export function formatUsd(micro: bigint): string {
  const negative = micro < 0n;
  const v = negative ? -micro : micro;
  return `${negative ? "-" : ""}${v / MICRO}.${(v % MICRO).toString().padStart(6, "0")}`;
}

/** `formatUsd` with the trailing zeros taken off, for a sentence rather than a column. `2_000_000n` is `"2"`. */
export function formatUsdShort(micro: bigint): string {
  return formatUsd(micro).replace(/0+$/, "").replace(/\.$/, "");
}

/** The nearest cent, for an invoice line. Rounds half away from zero — this is for display, never for a balance. */
export function formatCents(micro: bigint): string {
  const negative = micro < 0n;
  const v = negative ? -micro : micro;
  const cents = (v + 5_000n) / 10_000n;
  return `${negative ? "-" : ""}${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** A decimal string of whole tokens to that token's integer base units. Same rules as `parseUsd`, at the token's
 *  own precision. */
export function parseUnits(value: string | number, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new TypeError(`${decimals} is not a usable number of decimals`);
  const text = String(value).trim();
  // `{1,0}` is not a quantifier, so a zero-decimal token needs its own pattern rather than a built one.
  const re = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!re.test(text)) throw new TypeError(`${JSON.stringify(text)} is not an amount with at most ${decimals} decimals`);
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Integer base units to a decimal string of whole tokens, trailing zeros kept. Truncates, like `formatUsd`. */
export function formatUnits(units: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new TypeError(`${decimals} is not a usable number of decimals`);
  const negative = units < 0n;
  const v = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  if (decimals === 0) return `${negative ? "-" : ""}${v}`;
  return `${negative ? "-" : ""}${v / base}.${(v % base).toString().padStart(decimals, "0")}`;
}

/** `a * n / d`, rounded **up**. Used wherever the house must not lose a fraction to truncation: a price, a hold,
 *  a fee. The counterpart of `formatUsd` truncating down when it shows somebody their own balance. */
export function mulDivUp(a: bigint, n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new TypeError("divide by zero");
  const p = a * n;
  return p <= 0n ? p / d : (p + d - 1n) / d;
}

/** `a * n / d`, rounded **down**. Used where the customer must not lose a fraction: credit granted for a deposit. */
export function mulDivDown(a: bigint, n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new TypeError("divide by zero");
  return (a * n) / d;
}

/** Never below zero. A balance that went negative is a bug upstream of here, but it must not be shown as one. */
export const atLeastZero = (v: bigint): bigint => (v < 0n ? 0n : v);
