/**
 * Pricing. Two conversions and a hold, and the three numbers an operator will be asked about: what a deposit
 * buys, what a call costs, and what the house keeps.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { creditForTokens, tokensForCredit, retailOf, marginOf, rateCard, holdFor, describeRate, makeConfig, parseUnits, parseUsd, formatUsd, modelAllowed } from "../../src/icm/index.ts";

const cfg = (over: Record<string, unknown> = {}) => makeConfig({
  keyPrefix: "trench",
  token: { symbol: "TRENCHERS", address: "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a", decimals: 18, chainId: 4663, tokensPerUsd: "1000", sink: "burn" },
  marginBps: 1500,
  ...over,
});

test("a deposit buys credit at the rate, rounding down", () => {
  const c = cfg();
  assert.equal(creditForTokens(c, parseUnits("1000", 18)), parseUsd("1"));
  assert.equal(creditForTokens(c, parseUnits("1", 18)), parseUsd("0.001"));
  assert.equal(creditForTokens(c, 0n), 0n);
  // one wei short of a dollar does not round up to one
  assert.equal(creditForTokens(c, parseUnits("1000", 18) - 1n), parseUsd("0.999999"));
  assert.throws(() => creditForTokens(c, -1n), TypeError);
});

test("a quote asks for enough, rounding up, and round-trips to within a base unit", () => {
  const c = cfg();
  assert.equal(tokensForCredit(c, parseUsd("1")), parseUnits("1000", 18));
  assert.equal(tokensForCredit(c, 1n), parseUnits("0.001", 18));
  for (const usd of ["0.000001", "0.01", "1", "123.456789"]) {
    const needed = tokensForCredit(c, parseUsd(usd));
    assert.ok(creditForTokens(c, needed) >= parseUsd(usd), `${usd}: a quote must not come up short`);
  }
});

test("retail is the provider's cost plus the margin, rounding in the house's favour by at most a micro-dollar", () => {
  const c = cfg();
  assert.equal(retailOf(c, parseUsd("1")), parseUsd("1.15"));
  assert.equal(retailOf(c, 0n), 0n, "a free call is free");
  assert.equal(retailOf(c, 1n), 2n, "a cost of one micro-dollar rounds up to two, not down to one");
  assert.equal(marginOf(c, parseUsd("1")), parseUsd("0.15"));
  assert.equal(retailOf(cfg({ marginBps: 0 }), parseUsd("1")), parseUsd("1"), "no margin means cost price");
  assert.throws(() => retailOf(c, -1n), TypeError);
});

test("the rate card says both directions, and the sink", () => {
  const card = rateCard(cfg());
  assert.equal(card.symbol, "TRENCHERS");
  assert.equal(card.tokensPerUsd, "1000");
  assert.equal(card.usdPerToken, "0.001000");
  assert.equal(card.marginPercent, "15%");
  assert.equal(card.sink, "burn");
  assert.deepEqual(card.examples[0], { tokens: "1000", usd: "1.000000" });
  assert.match(describeRate(cfg()), /^1000 TRENCHERS buys \$1\.00 of credit\. A call costs what the model provider charged plus 15%\.$/);
  assert.equal(rateCard(cfg({ marginBps: 1250 })).marginPercent, "12.50%");
});

test("a hold is an upper bound, clamped at both ends", () => {
  const c = cfg({ minHoldMicroUsd: "0.001", maxHoldMicroUsd: "1" });
  // 1M prompt tokens at $3/M and 1M completion at $15/M is $18 upstream, far over the ceiling
  assert.equal(holdFor(c, { promptTokens: 1_000_000, maxCompletionTokens: 1_000_000, promptPerMillionMicroUsd: 3_000_000n, completionPerMillionMicroUsd: 15_000_000n }), parseUsd("1"));
  // a tiny call still holds the floor rather than nothing
  assert.equal(holdFor(c, { promptTokens: 1, maxCompletionTokens: 1, promptPerMillionMicroUsd: 1n, completionPerMillionMicroUsd: 1n }), parseUsd("0.001"));
  // an unknown model falls back to a flat guess: twenty cents upstream, so twenty-three with the margin
  assert.equal(holdFor(c, { promptTokens: 100, maxCompletionTokens: 1000 }), parseUsd("0.23"));
  // and the ceiling still binds that guess when it is set below it
  assert.equal(holdFor(cfg({ maxHoldMicroUsd: "0.05" }), { promptTokens: 100, maxCompletionTokens: 1000 }), parseUsd("0.05"));
  assert.equal(formatUsd(holdFor(cfg(), { promptTokens: 1000, maxCompletionTokens: 1000, promptPerMillionMicroUsd: 3_000_000n, completionPerMillionMicroUsd: 15_000_000n })), "0.020700");
});

test("the model list admits a family and a deny always wins", () => {
  const c = cfg({ allowModels: ["anthropic/*", "openai/gpt-5"], denyModels: ["anthropic/claude-opus-*"] });
  assert.equal(modelAllowed(c, "anthropic/claude-sonnet-4"), true);
  assert.equal(modelAllowed(c, "openai/gpt-5"), true);
  assert.equal(modelAllowed(c, "openai/gpt-4"), false);
  assert.equal(modelAllowed(c, "anthropic/claude-opus-5"), false, "deny beats the family allow");
  assert.equal(modelAllowed(cfg(), "anything/at-all"), true, "an empty allow list admits everything");
});

test("a config that would mis-bill is refused at the door", () => {
  const token = { symbol: "TRENCHERS", address: "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a", tokensPerUsd: "1000" };
  assert.throws(() => makeConfig({ token: { ...token, tokensPerUsd: "0" } }), /greater than zero/);
  assert.throws(() => makeConfig({ token: { ...token, address: "nope" } }), /40 hex/);
  assert.throws(() => makeConfig({ token: { ...token, symbol: "a token!" } }), /symbol/);
  assert.throws(() => makeConfig({ token, marginBps: -1 }), /marginBps/);
  assert.throws(() => makeConfig({ token, keyPrefix: "X" }), /keyPrefix/);
  assert.throws(() => makeConfig({ token, minHoldMicroUsd: "1", maxHoldMicroUsd: "0.5" }), /below minHoldMicroUsd/);
  assert.throws(() => makeConfig({ token: { ...token, decimals: 99 } }), /decimals/);
  // a token with no decimals at all is legitimate and must work
  assert.equal(makeConfig({ token: { ...token, decimals: 0, tokensPerUsd: "1000" } }).token.decimals, 0);
});

test("the package carries no token of its own: two configs, two currencies, one code path", () => {
  const comd = cfg();
  const other = makeConfig({
    keyPrefix: "aicm", environment: "live",
    token: { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, chainId: 1, tokensPerUsd: "1", sink: "treasury" },
    marginBps: 500,
  });
  assert.equal(creditForTokens(comd, parseUnits("1000", 18)), parseUsd("1"));
  assert.equal(creditForTokens(other, parseUnits("1", 6)), parseUsd("1"), "a dollar stablecoin at one-to-one");
  assert.equal(retailOf(other, parseUsd("1")), parseUsd("1.05"));
  assert.equal(rateCard(other).sink, "treasury");
});
