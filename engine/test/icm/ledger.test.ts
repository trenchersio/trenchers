/**
 * The ledger.
 *
 * One rule runs through all of this: `balance + held == deposited − spent`, for every account, after every
 * operation. `ledger.check()` asserts it, and almost every test here calls it, because an accounting bug that
 * only appears after the tenth call is the kind that reaches production.
 *
 * The rest is the ways money goes missing: a hold that is never resolved, a deposit credited twice by a reorg,
 * a settle above its hold, a key spending past its ceiling, a charge resolved automatically when nobody knows
 * what happened.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { Ledger, MemoryStore, makeConfig, formatUsd, parseUsd, parseUnits, type IcmConfig } from "../../src/icm/index.ts";

const TOKEN = { symbol: "TRENCHERS", address: "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a", decimals: 18, chainId: 4663, tokensPerUsd: "1000", sink: "burn" as const };

function setup(over: Partial<Parameters<typeof makeConfig>[0]> = {}) {
  const config: IcmConfig = makeConfig({ keyPrefix: "trench", token: TOKEN, marginBps: 1500, minDepositMicroUsd: "0.1", ...over });
  let t = Date.parse("2026-10-11T12:00:00.000Z");
  let n = 0;
  const ledger = new Ledger({ store: new MemoryStore(), config, now: () => t, randomId: () => `id${++n}` });
  return { ledger, config, tick: (ms: number) => { t += ms; }, at: () => t };
}

/** One funded account with one key, the normal starting point. */
function funded(usd = "100") {
  const s = setup();
  const account = s.ledger.account("0xAbC0000000000000000000000000000000000001");
  s.ledger.deposit({ accountId: account.id, source: "chain", ref: "0xtx1", tokenUnits: parseUnits(String(Number(usd) * 1000), 18) });
  const { key, secret } = s.ledger.issueKey({ accountId: account.id, label: "test" });
  return { ...s, account: s.ledger.accountById(account.id), key, secret };
}

const balance = (l: Ledger, id: string) => BigInt(l.accountById(id).balanceMicroUsd);
const held = (l: Ledger, id: string) => BigInt(l.accountById(id).heldMicroUsd);

// ------------------------------------------------------------------------------------------------ accounts

test("an owner gets one account however it is spelled", () => {
  const { ledger } = setup();
  const a = ledger.account("0xAbCdEf0000000000000000000000000000000001");
  const b = ledger.account("0xabcdef0000000000000000000000000000000001");
  const c = ledger.account("  0xABCDEF0000000000000000000000000000000001  ");
  assert.equal(a.id, b.id);
  assert.equal(a.id, c.id);
  assert.equal(ledger.check().length, 0);
});

// ------------------------------------------------------------------------------------------------ deposits

test("a deposit credits at the configured rate, rounding down", () => {
  const { ledger, config } = setup();
  const a = ledger.account("0x1");
  // 1,000 TRENCHERS per dollar, so 1,500 TRENCHERS is $1.50
  ledger.deposit({ accountId: a.id, source: "chain", ref: "0xa", tokenUnits: parseUnits("1500", 18) });
  assert.equal(balance(ledger, a.id), parseUsd("1.5"));
  // a fraction of a micro-dollar is not credited: 1,000 TRENCHERS minus one wei is a hair under a dollar
  ledger.deposit({ accountId: a.id, source: "chain", ref: "0xb", tokenUnits: parseUnits("1000", 18) - 1n });
  assert.equal(balance(ledger, a.id), parseUsd("2.499999"));
  assert.equal(config.token.sink, "burn");
  assert.equal(ledger.check().length, 0);
});

test("the same transaction credits exactly once, however many times a watcher sees it", () => {
  const { ledger } = setup();
  const a = ledger.account("0x1");
  const first = ledger.deposit({ accountId: a.id, source: "chain", ref: "0xdeadbeef", tokenUnits: parseUnits("1000", 18) });
  const again = ledger.deposit({ accountId: a.id, source: "chain", ref: "0xdeadbeef", tokenUnits: parseUnits("1000", 18) });
  const third = ledger.deposit({ accountId: a.id, source: "chain", ref: " 0xdeadbeef ", tokenUnits: parseUnits("99999", 18) });
  assert.equal(again.id, first.id, "a replayed block returns the deposit it already made");
  assert.equal(third.id, first.id, "and the ref is compared trimmed");
  assert.equal(balance(ledger, a.id), parseUsd("1"));
  assert.equal(ledger.check().length, 0);
});

test("a payment too small to be worth the gas is refused", () => {
  const { ledger } = setup({ minDepositMicroUsd: "1" });
  const a = ledger.account("0x1");
  assert.throws(() => ledger.deposit({ accountId: a.id, source: "chain", ref: "0xa", tokenUnits: parseUnits("1", 18) }), /minimum/);
  assert.equal(balance(ledger, a.id), 0n, "and nothing was credited");
  // a grant is not a payment, so the floor does not apply to it
  ledger.deposit({ accountId: a.id, source: "grant", ref: "welcome-1", creditedMicroUsd: parseUsd("0.25") });
  assert.equal(balance(ledger, a.id), parseUsd("0.25"));
  assert.equal(ledger.check().length, 0);
});

// ------------------------------------------------------------------------------------------------ keys

test("a key is stored only as a hash, and authenticates", () => {
  const { ledger, account } = funded();
  const { key, secret } = ledger.issueKey({ accountId: account.id, label: "laptop" });
  assert.match(secret, /^trench_live_[0-9a-f]{48}$/);
  assert.ok(!JSON.stringify(key).includes(secret.slice(10)), "the secret is not in the record");
  assert.match(key.display, /^trench_live_[0-9a-f]{4}…[0-9a-f]{4}$/);
  const seen = ledger.authenticate(secret);
  assert.equal(seen.key.id, key.id);
  assert.equal(seen.account.id, account.id);
});

test("a key that is missing, wrong, off, expired or suspended is refused, each for its own reason", () => {
  const { ledger, account, secret, tick, at } = funded();
  assert.throws(() => ledger.authenticate(null), /No API key/);
  assert.throws(() => ledger.authenticate("trench_live_" + "0".repeat(48)), /not one of ours/);

  const off = ledger.issueKey({ accountId: account.id });
  ledger.setKey(off.key.id, { disabled: true });
  assert.throws(() => ledger.authenticate(off.secret), /turned off/);

  // the ledger's own clock, not the wall clock: a test that compares the two passes or fails by the hour it runs
  const expiring = ledger.issueKey({ accountId: account.id, expiresAt: new Date(at() + 30_000).toISOString() });
  assert.ok(ledger.authenticate(expiring.secret), "not expired yet");
  tick(60_000);
  assert.throws(() => ledger.authenticate(expiring.secret), /expired/);

  ledger.suspend(account.id, "chargeback");
  assert.throws(() => ledger.authenticate(secret), /suspended: chargeback/);
  ledger.unsuspend(account.id);
  assert.ok(ledger.authenticate(secret));
});

// ------------------------------------------------------------------------------------------------ holds

test("a hold comes out of the balance and goes back on settle, less the retail price", () => {
  const { ledger, account, key } = funded("10");
  const before = balance(ledger, account.id);

  const charge = ledger.hold({ key, account: ledger.accountById(account.id), model: "m", amountMicroUsd: parseUsd("1") });
  assert.equal(balance(ledger, account.id), before - parseUsd("1"));
  assert.equal(held(ledger, account.id), parseUsd("1"));
  assert.equal(ledger.check().length, 0, "a hold keeps the book balanced");

  // the call cost us 10 cents; at 15% the customer pays 11.5 cents and the rest of the hold comes back
  const settled = ledger.settle({ chargeId: charge.id, upstreamMicroUsd: parseUsd("0.10"), upstreamId: "gen-1" });
  assert.equal(settled.retailMicroUsd, String(parseUsd("0.115")));
  assert.equal(held(ledger, account.id), 0n);
  assert.equal(balance(ledger, account.id), before - parseUsd("0.115"));
  assert.equal(ledger.accountById(account.id).spentMicroUsd, String(parseUsd("0.115")));
  assert.equal(ledger.keysOf(account.id).find((k) => k.id === key.id)!.spentMicroUsd, String(parseUsd("0.115")));
  assert.equal(ledger.check().length, 0);
});

test("a release gives the whole hold back", () => {
  const { ledger, account, key } = funded("10");
  const before = balance(ledger, account.id);
  const charge = ledger.hold({ key, account: ledger.accountById(account.id), model: "m", amountMicroUsd: parseUsd("2") });
  ledger.release(charge.id, "the provider refused before generating anything");
  assert.equal(balance(ledger, account.id), before);
  assert.equal(held(ledger, account.id), 0n);
  assert.equal(ledger.accountById(account.id).spentMicroUsd, "0", "a released call is not a sale");
  assert.equal(ledger.check().length, 0);
});

test("a call that cannot be paid for is refused before anything is held", () => {
  const { ledger, account, key } = funded("1");
  assert.throws(() => ledger.hold({ key, account: ledger.accountById(account.id), model: "m", amountMicroUsd: parseUsd("5") }), /Not enough credit/);
  assert.equal(held(ledger, account.id), 0n);
  assert.equal(balance(ledger, account.id), parseUsd("1"), "the balance is untouched");
  assert.equal(ledger.check().length, 0);
});

test("a key's own ceiling binds before the account balance does", () => {
  const { ledger, account } = funded("100");
  const { key } = ledger.issueKey({ accountId: account.id, spendLimitMicroUsd: parseUsd("1") });
  const a = () => ledger.accountById(account.id);
  const k = () => ledger.keysOf(account.id).find((x) => x.id === key.id)!;

  assert.equal(ledger.spendable(k(), a()), parseUsd("1"), "spendable is the smaller of the two");
  const first = ledger.hold({ key: k(), account: a(), model: "m", amountMicroUsd: parseUsd("0.90") });
  ledger.settle({ chargeId: first.id, upstreamMicroUsd: parseUsd("0.80") });   // retail 0.92
  assert.throws(() => ledger.hold({ key: k(), account: a(), model: "m", amountMicroUsd: parseUsd("0.50") }), /spend limit/);
  assert.ok(balance(ledger, account.id) > parseUsd("98"), "the account still has plenty; the key does not");
  assert.equal(ledger.check().length, 0);
});

test("a cost that came in above its hold is charged in full rather than billed below cost", () => {
  const { ledger, account, key } = funded("10");
  const charge = ledger.hold({ key, account: ledger.accountById(account.id), model: "m", amountMicroUsd: parseUsd("0.10") });
  // the work is done; underbilling it would mean paying people to use the gateway
  ledger.settle({ chargeId: charge.id, upstreamMicroUsd: parseUsd("1") });
  assert.equal(ledger.accountById(account.id).spentMicroUsd, String(parseUsd("1.15")));
  assert.equal(balance(ledger, account.id), parseUsd("10") - parseUsd("1.15"));
  assert.equal(ledger.check().length, 0, "the book still balances even when a hold was too small");
});

test("a hold cannot be settled or released twice", () => {
  const { ledger, account, key } = funded("10");
  const charge = ledger.hold({ key, account: ledger.accountById(account.id), model: "m", amountMicroUsd: parseUsd("1") });
  ledger.settle({ chargeId: charge.id, upstreamMicroUsd: parseUsd("0.10") });
  assert.throws(() => ledger.settle({ chargeId: charge.id, upstreamMicroUsd: parseUsd("0.10") }), /already settled/);
  assert.throws(() => ledger.release(charge.id, "again"), /already settled/);
  assert.equal(ledger.check().length, 0);
});

// ------------------------------------------------------------------------------------------------ the unknown

test("an unknown outcome keeps the hold and waits for a person", () => {
  const { ledger, account, key } = funded("10");
  const before = balance(ledger, account.id);
  const charge = ledger.hold({ key, account: ledger.accountById(account.id), model: "m", amountMicroUsd: parseUsd("1") });
  ledger.markUnknown(charge.id, "the provider never answered");

  assert.equal(balance(ledger, account.id), before - parseUsd("1"), "the money stays held");
  assert.equal(held(ledger, account.id), parseUsd("1"));
  const book = ledger.book();
  assert.equal(book.counts.unknown, 1);
  assert.equal(book.unresolvedMicroUsd, String(parseUsd("1")), "and the house book says so, in money");
  assert.equal(ledger.check().length, 0);

  // a sweep must not touch it: only a person resolves an unknown outcome
  const swept = ledger.sweepStaleHolds(0);
  assert.equal(swept.length, 0);
  assert.equal(held(ledger, account.id), parseUsd("1"));
});

test("an operator resolves an unknown charge either way, and the book follows", () => {
  const { ledger, account, key } = funded("10");
  const a = () => ledger.accountById(account.id);

  const one = ledger.hold({ key, account: a(), model: "m", amountMicroUsd: parseUsd("1") });
  ledger.markUnknown(one.id, "no answer");
  ledger.resolveUnknown(one.id, { settleAtUpstreamMicroUsd: parseUsd("0.20") });
  assert.equal(ledger.chargeById(one.id).state, "settled");
  assert.equal(a().spentMicroUsd, String(parseUsd("0.23")));

  const two = ledger.hold({ key: ledger.keysOf(account.id)[0], account: a(), model: "m", amountMicroUsd: parseUsd("1") });
  ledger.markUnknown(two.id, "no answer");
  ledger.resolveUnknown(two.id, { release: true, reason: "the provider confirmed it never ran" });
  assert.equal(ledger.chargeById(two.id).state, "released");
  assert.equal(held(ledger, account.id), 0n);
  assert.equal(ledger.book().counts.unknown, 0);
  assert.equal(ledger.check().length, 0);
});

test("a hold whose process died is swept back to the customer, not kept", () => {
  const { ledger, account, key, tick } = funded("10");
  const before = balance(ledger, account.id);
  ledger.hold({ key, account: ledger.accountById(account.id), model: "m", amountMicroUsd: parseUsd("3") });
  assert.equal(ledger.sweepStaleHolds(15 * 60_000).length, 0, "a fresh hold is not stale");
  tick(16 * 60_000);
  const swept = ledger.sweepStaleHolds(15 * 60_000);
  assert.equal(swept.length, 1);
  assert.equal(swept[0].state, "released");
  assert.equal(balance(ledger, account.id), before, "the benefit of the doubt goes to whoever paid");
  assert.equal(ledger.check().length, 0);
});

// ------------------------------------------------------------------------------------------------ the house

test("the house book states the liability, and the margin it actually earned", () => {
  const { ledger } = setup();
  const alice = ledger.account("0xa");
  const bob = ledger.account("0xb");
  // $100 sold, $5 given away
  ledger.deposit({ accountId: alice.id, source: "chain", ref: "0x1", tokenUnits: parseUnits("100000", 18), burnTx: "0xburn1" });
  ledger.deposit({ accountId: bob.id, source: "grant", ref: "promo", creditedMicroUsd: parseUsd("5") });

  const { key } = ledger.issueKey({ accountId: alice.id });
  const c = ledger.hold({ key, account: ledger.accountById(alice.id), model: "m", amountMicroUsd: parseUsd("20") });
  ledger.settle({ chargeId: c.id, upstreamMicroUsd: parseUsd("10") });      // retail 11.50

  const book = ledger.book();
  assert.equal(book.soldMicroUsd, String(parseUsd("100")));
  assert.equal(book.grantedMicroUsd, String(parseUsd("5")));
  assert.equal(book.revenueMicroUsd, String(parseUsd("11.5")));
  assert.equal(book.upstreamCostMicroUsd, String(parseUsd("10")));
  assert.equal(book.grossMarginMicroUsd, String(parseUsd("1.5")), "15% of ten dollars");
  assert.equal(book.outstandingMicroUsd, String(parseUsd("93.5")), "105 sold and granted, less 11.50 spent");
  assert.equal(book.outstandingGrantedMicroUsd, "0", "grants are counted as spent first");
  assert.equal(book.outstandingSoldMicroUsd, String(parseUsd("93.5")));

  // burning the token means nothing stands behind that liability, and the book has to say so
  assert.equal(book.backing.sink, "burn");
  assert.equal(book.backing.unbacked, true);
  // serving $93.50 of credit costs upstream 93.50 / 1.15
  assert.equal(book.backing.coverNeededMicroUsd, String((parseUsd("93.5") * 10_000n) / 11_500n));
  assert.match(book.backing.note, /treasury must be able to find \$81\.304347/);
  assert.deepEqual(book.burned, [{ symbol: "TRENCHERS", units: String(parseUnits("100000", 18)), tokens: "100000.000000000000000000" }]);
  assert.equal(ledger.check().length, 0);
});

test("a long run of mixed activity leaves the book exactly balanced", () => {
  const { ledger, tick } = setup();
  const owners = ["0xa", "0xb", "0xc"].map((o) => ledger.account(o));
  const keys = owners.map((a) => ledger.issueKey({ accountId: a.id }).key);
  owners.forEach((a, i) => ledger.deposit({ accountId: a.id, source: "chain", ref: `0xdep${i}`, tokenUnits: parseUnits("50000", 18) }));

  // deterministic pseudo-random, so a failure is reproducible
  let seed = 7;
  const next = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;

  for (let i = 0; i < 300; i++) {
    const which = next(3);
    const account = ledger.accountById(owners[which].id);
    const key = ledger.keysOf(account.id)[0];
    const amount = BigInt(next(500_000) + 1_000);
    if (BigInt(account.balanceMicroUsd) < amount) continue;
    const charge = ledger.hold({ key, account, model: `m${next(3)}`, amountMicroUsd: amount });
    const roll = next(10);
    if (roll < 6) ledger.settle({ chargeId: charge.id, upstreamMicroUsd: amount / 2n });
    else if (roll < 8) ledger.release(charge.id, "refused");
    else if (roll < 9) ledger.markUnknown(charge.id, "no answer");
    // and one in ten is simply left held, as a request still in flight
    assert.equal(ledger.check().length, 0, `drift after operation ${i}`);
    tick(1_000);
  }
  void keys;

  const drift = ledger.check();
  assert.deepEqual(drift, [], "every account balances after three hundred operations");
  const book = ledger.book();
  // the house book's own identity: what customers hold is what was sold and granted, less what was spent
  assert.equal(
    BigInt(book.outstandingMicroUsd),
    BigInt(book.soldMicroUsd) + BigInt(book.grantedMicroUsd) - BigInt(book.revenueMicroUsd),
  );
  assert.ok(BigInt(book.grossMarginMicroUsd) > 0n, "the margin earned something");
  assert.equal(formatUsd(BigInt(book.revenueMicroUsd) - BigInt(book.upstreamCostMicroUsd)), formatUsd(BigInt(book.grossMarginMicroUsd)));
});

// ------------------------------------------------------------------------------------------------ transfers

test("a transfer moves free credit to another account, once per ref, and the book still adds up", () => {
  const { ledger, account } = funded("10");
  const trencher = ledger.account("0x00000000000000000000000000000000000000aa");
  const t = ledger.transfer({ fromAccountId: account.id, toAccountId: trencher.id, amountMicroUsd: parseUsd("4"), ref: "gift-1" });
  assert.equal(balance(ledger, account.id), parseUsd("6"));
  assert.equal(balance(ledger, trencher.id), parseUsd("4"));
  const again = ledger.transfer({ fromAccountId: account.id, toAccountId: trencher.id, amountMicroUsd: parseUsd("4"), ref: "gift-1" });
  assert.equal(again.id, t.id);
  assert.equal(balance(ledger, account.id), parseUsd("6"));
  assert.equal(ledger.transfersOf(trencher.id).length, 1);
  assert.equal(ledger.check().length, 0);
  // the house sold $10 of credit and still owes $10: a gift is not revenue and not new money
  const book = ledger.book();
  assert.equal(book.soldMicroUsd, parseUsd("10").toString());
  assert.equal(book.outstandingMicroUsd, parseUsd("10").toString());
  assert.equal(book.revenueMicroUsd, "0");
});

test("a transfer can't overdraw, can't be zero, can't go to itself, and never moves held credit", () => {
  const { ledger, account, key } = funded("5");
  const other = ledger.account("0xbb");
  assert.throws(() => ledger.transfer({ fromAccountId: account.id, toAccountId: other.id, amountMicroUsd: parseUsd("6"), ref: "a" }), /Not enough credit/);
  assert.throws(() => ledger.transfer({ fromAccountId: account.id, toAccountId: other.id, amountMicroUsd: 0n, ref: "b" }), /more than zero/);
  assert.throws(() => ledger.transfer({ fromAccountId: account.id, toAccountId: account.id, amountMicroUsd: 1n, ref: "c" }), /itself/);
  ledger.hold({ key, account: ledger.accountById(account.id), model: "m", amountMicroUsd: parseUsd("4") });
  assert.throws(() => ledger.transfer({ fromAccountId: account.id, toAccountId: other.id, amountMicroUsd: parseUsd("2"), ref: "d" }), /Not enough credit/);
  ledger.transfer({ fromAccountId: account.id, toAccountId: other.id, amountMicroUsd: parseUsd("1"), ref: "e" });
  assert.equal(held(ledger, account.id), parseUsd("4"));
  assert.equal(ledger.check().length, 0);
});

test("a suspended account can't send credit", () => {
  const { ledger, account } = funded("5");
  const other = ledger.account("0xcc");
  ledger.suspend(account.id, "abuse");
  assert.throws(() => ledger.transfer({ fromAccountId: account.id, toAccountId: other.id, amountMicroUsd: 1n, ref: "x" }), /suspended/);
});
