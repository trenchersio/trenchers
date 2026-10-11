/**
 * Money. Every one of these is a way a billing system quietly loses or invents a fraction of a cent, and every
 * fraction of a cent is a number that does not reconcile at the end of a month.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { formatCents, formatUnits, formatUsd, formatUsdShort, mulDivDown, mulDivUp, parseUnits, parseUsd } from "../../src/icm/money.ts";

test("dollars parse to integer micro-dollars", () => {
  assert.equal(parseUsd("1"), 1_000_000n);
  assert.equal(parseUsd("1.25"), 1_250_000n);
  assert.equal(parseUsd("0.000001"), 1n);
  assert.equal(parseUsd("0"), 0n);
  assert.equal(parseUsd("9999999.999999"), 9_999_999_999_999n);
  assert.equal(parseUsd(1.5), 1_500_000n);
  // a bigint is already micro-dollars and passes through: parseUsd(5n) is five micro-dollars, not five dollars
  assert.equal(parseUsd(5n), 5n);
});

test("anything that is not plainly a positive decimal is refused, not coerced", () => {
  for (const bad of ["", " ", "-1", "1e6", "1,000", "one", "1.2345678", ".5", "1.", "0x10", "Infinity", "NaN"]) {
    assert.throws(() => parseUsd(bad), TypeError, `${JSON.stringify(bad)} should be refused`);
  }
  assert.throws(() => parseUsd(-1), TypeError);
  assert.throws(() => parseUsd(Number.NaN), TypeError);
});

test("formatting truncates and never rounds up, so nobody is shown money they do not have", () => {
  assert.equal(formatUsd(1_999_999n), "1.999999");
  assert.equal(formatUsd(1n), "0.000001");
  assert.equal(formatUsd(0n), "0.000000");
  assert.equal(formatUsd(-1_500_000n), "-1.500000");
  assert.equal(formatUsdShort(1_250_000n), "1.25");
  assert.equal(formatUsdShort(2_000_000n), "2");
  assert.equal(formatUsdShort(0n), "0");
});

test("a dollar amount survives a round trip", () => {
  for (const [input, shown] of [["0.000001", "0.000001"], ["1.25", "1.25"], ["9999.999999", "9999.999999"], ["0.1", "0.1"], ["1000000", "1000000"], ["1.250000", "1.25"]] as const) {
    assert.equal(formatUsdShort(parseUsd(input)), shown, input);
  }
  // surrounding space is trimmed, so this is an amount, not a refusal
  assert.equal(parseUsd(" 1 "), 1_000_000n);
});

test("cents are for invoices only, and round to the nearest", () => {
  assert.equal(formatCents(1_004_999n), "1.00");
  assert.equal(formatCents(1_005_000n), "1.01");
  assert.equal(formatCents(0n), "0.00");
  assert.equal(formatCents(-1_005_000n), "-1.01");
});

test("token units are parsed at the token's own precision", () => {
  assert.equal(parseUnits("1.5", 18), 1_500_000_000_000_000_000n);
  assert.equal(parseUnits("1.5", 6), 1_500_000n);
  assert.equal(parseUnits("1000", 18), 1_000_000_000_000_000_000_000n);
  assert.equal(parseUnits("7", 0), 7n);
  assert.throws(() => parseUnits("1.5555555", 6), TypeError);
  assert.throws(() => parseUnits("1.5", 99), TypeError);
  assert.equal(formatUnits(1_500_000_000_000_000_000n, 18), "1.500000000000000000");
  assert.equal(formatUnits(7n, 0), "7");
  assert.equal(formatUnits(-1_500_000n, 6), "-1.500000");
});

test("the two roundings point in the directions the house and the customer each need", () => {
  // up: a price, a hold, a fee — the house must not lose a fraction
  assert.equal(mulDivUp(7n, 1n, 2n), 4n);
  assert.equal(mulDivUp(8n, 1n, 2n), 4n);
  assert.equal(mulDivUp(1n, 1n, 1_000_000n), 1n, "a cost of almost nothing still costs something");
  // down: credit for a deposit — the customer must not be granted a fraction they did not pay for
  assert.equal(mulDivDown(7n, 1n, 2n), 3n);
  assert.equal(mulDivDown(999_999n, 1n, 1_000_000n), 0n);
  assert.throws(() => mulDivUp(1n, 1n, 0n), TypeError);
  assert.throws(() => mulDivDown(1n, 1n, 0n), TypeError);
});
