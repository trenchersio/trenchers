/**
 * Getting paid. Every test here is a way a watcher double-credits, loses a payment, or credits the wrong wallet —
 * which are the three ways this costs real money.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { DepositWatcher, Ledger, MemoryStore, makeConfig, parseUnits, parseUsd, formatUsd } from "../../src/icm/index.ts";
import type { ConfirmedPayment, PaymentSource } from "../../src/icm/index.ts";

const DEAD = "0x000000000000000000000000000000000000dEaD";
const TREASURY = "0x71A2e394A20bea28C6C80Dbdc8e238Da40050E29";
const ALICE = "0xAaAa000000000000000000000000000000000001";
const BOB = "0xbBbB000000000000000000000000000000000002";

function setup(depositAddress = DEAD, over: Record<string, unknown> = {}) {
  const config = makeConfig({
    keyPrefix: "trench",
    token: { symbol: "TRENCHERS", address: "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a", decimals: 18, chainId: 4663, tokensPerUsd: "1000", sink: "burn" },
    marginBps: 1500, minDepositMicroUsd: "1",
    ...over,
  });
  const ledger = new Ledger({ store: new MemoryStore(), config });
  let batches: ConfirmedPayment[][] = [];
  let cursor: string | null = null;
  const source: PaymentSource = {
    async since(from) {
      const batch = batches.shift() ?? [];
      return { payments: batch, cursor: `${(Number(from ?? 0) || 0) + 1}` };
    },
  };
  const credited: string[] = [];
  const skipped: [string, string][] = [];
  const watcher = new DepositWatcher({
    ledger, source, depositAddress,
    cursor: { read: () => cursor, write: (v) => { cursor = v; } },
    onCredited: (d) => credited.push(d.id),
    onSkipped: (p, why) => skipped.push([p.ref, why]),
  });
  return { ledger, watcher, credited, skipped, queue: (b: ConfirmedPayment[]) => batches.push(b), cursorNow: () => cursor, config };
}

const pay = (o: Partial<ConfirmedPayment> & { from: string; tokens: string }): ConfirmedPayment => ({
  ref: o.ref ?? `0x${o.from.slice(2, 10)}:0`,
  from: o.from,
  to: o.to ?? DEAD,
  tokenUnits: parseUnits(o.tokens, 18),
  at: o.at ?? "2026-10-11T12:00:00.000Z",
  blockNumber: o.blockNumber ?? 100,
});

test("a payment becomes credit on the wallet that sent it", async () => {
  const { ledger, watcher, queue, credited } = setup();
  queue([pay({ from: ALICE, tokens: "5000" })]);
  const res = await watcher.poll();
  assert.equal(res.credited.length, 1);
  assert.equal(credited.length, 1);
  assert.equal(ledger.accountFor(ALICE)!.balanceMicroUsd, String(parseUsd("5")), "5,000 TRENCHERS at 1,000 per dollar");
  assert.equal(ledger.check().length, 0);
});

test("the same payment seen again credits nothing — a reorg replay is normal", async () => {
  const { ledger, queue, watcher } = setup();
  const p = pay({ from: ALICE, tokens: "5000", ref: "0xabc:0" });
  queue([p]);
  queue([p, pay({ from: ALICE, tokens: "1000", ref: "0xdef:0" })]);
  await watcher.poll();
  const second = await watcher.poll();
  assert.equal(second.credited.length, 1, "only the new one");
  assert.equal(second.skipped.length, 0, "a replay is not a problem worth reporting");
  assert.equal(ledger.accountFor(ALICE)!.balanceMicroUsd, String(parseUsd("6")));
  assert.equal(ledger.check().length, 0);
});

test("two transfers in one transaction are two payments", async () => {
  const { ledger, queue, watcher } = setup();
  queue([pay({ from: ALICE, tokens: "1000", ref: "0xsame:0" }), pay({ from: BOB, tokens: "2000", ref: "0xsame:1" })]);
  await watcher.poll();
  assert.equal(ledger.accountFor(ALICE)!.balanceMicroUsd, String(parseUsd("1")));
  assert.equal(ledger.accountFor(BOB)!.balanceMicroUsd, String(parseUsd("2")));
});

test("a transfer somewhere else is never credit, whatever the source says", async () => {
  const { ledger, queue, watcher, skipped } = setup();
  queue([pay({ from: ALICE, tokens: "5000", to: TREASURY })]);
  const res = await watcher.poll();
  assert.equal(res.credited.length, 0);
  assert.match(skipped[0][1], /not the deposit address/);
  assert.equal(ledger.accountFor(ALICE), undefined, "and no account was even made");
});

test("dust is skipped without stopping the batch behind it", async () => {
  const { ledger, queue, watcher, skipped } = setup();
  queue([
    pay({ from: ALICE, tokens: "1", ref: "0xdust:0" }),       // $0.001, under the $1 floor
    pay({ from: BOB, tokens: "9000", ref: "0xreal:0" }),
  ]);
  const res = await watcher.poll();
  assert.equal(res.credited.length, 1);
  assert.match(skipped[0][1], /minimum/);
  assert.equal(ledger.accountFor(BOB)!.balanceMicroUsd, String(parseUsd("9")), "the good payment behind the dust still landed");
  assert.equal(ledger.check().length, 0);
});

test("zero, a bad payer and an empty ref are refused rather than thrown", async () => {
  const { queue, watcher, skipped } = setup();
  queue([
    { ref: "0xa:0", from: ALICE, to: DEAD, tokenUnits: 0n, at: "", blockNumber: 1 },
    { ref: "0xb:0", from: "not-an-address", to: DEAD, tokenUnits: parseUnits("5000", 18), at: "", blockNumber: 1 },
    { ref: "  ", from: BOB, to: DEAD, tokenUnits: parseUnits("5000", 18), at: "", blockNumber: 1 },
  ]);
  const res = await watcher.poll();
  assert.equal(res.credited.length, 0);
  assert.deepEqual(skipped.map((s) => s[1]), ["zero amount", "payer not-an-address is not an address", "no reference"]);
});

test("the cursor moves only after the credits are written, so a crash replays rather than loses", async () => {
  const { queue, watcher, cursorNow, ledger } = setup();
  assert.equal(cursorNow(), null);
  queue([pay({ from: ALICE, tokens: "5000" })]);
  await watcher.poll();
  assert.equal(cursorNow(), "1");
  // a batch that credits nothing still advances, or the watcher would re-read the same empty range forever
  queue([]);
  await watcher.poll();
  assert.equal(cursorNow(), "2");
  assert.equal(ledger.check().length, 0);
});

test("paying the burn address makes the payment its own burn, and the book counts it", async () => {
  const { ledger, queue, watcher } = setup(DEAD);
  assert.equal(watcher.paymentIsBurn, true);
  queue([pay({ from: ALICE, tokens: "5000", ref: "0xburned:0" })]);
  const res = await watcher.poll();
  assert.equal(res.credited[0].burnTx, "0xburned", "the transaction that paid is the transaction that burned");
  const book = ledger.book();
  assert.equal(book.burned[0].tokens, "5000.000000000000000000");
  assert.equal(book.backing.unbacked, true);
  assert.match(book.backing.note, /treasury must be able to find/);
});

test("paying a treasury address does not claim a burn that did not happen", async () => {
  const { ledger, queue, watcher } = setup(TREASURY, { token: { symbol: "TRENCHERS", address: "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a", decimals: 18, chainId: 4663, tokensPerUsd: "1000", sink: "treasury" } });
  assert.equal(watcher.paymentIsBurn, false);
  queue([pay({ from: ALICE, tokens: "5000", to: TREASURY, ref: "0xkept:0" })]);
  const res = await watcher.poll();
  assert.equal(res.credited[0].burnTx, null);
  assert.deepEqual(ledger.book().burned, []);
  assert.equal(ledger.book().backing.unbacked, false);
});

test("the instructions say where to pay, what it buys and the floor", () => {
  const { watcher } = setup();
  const i = watcher.instructions();
  assert.equal(i.address, DEAD.toLowerCase());
  assert.equal(i.symbol, "TRENCHERS");
  assert.equal(i.chainId, 4663);
  assert.equal(i.tokensPerUsd, "1000");
  assert.equal(i.minimumTokens, "1000", "the $1 floor is 1,000 TRENCHERS");
  assert.equal(i.paymentIsBurn, true);
  assert.equal(i.burns, true);
  assert.match(i.note, /destroyed/);
  assert.match(i.note, /send from the wallet you want credited/);
});

test("a desk whose host burns what lands says so, even when the address is an ordinary one", () => {
  // The two ways the token ends up destroyed look nothing alike from the outside: one is visible in the address,
  // the other is only in the configured sink. A desk that burns and says "paid to the desk" is hiding the part
  // a holder cares about most.
  const { watcher } = setup(TREASURY, { token: { symbol: "TRENCHERS", address: "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a", decimals: 18, chainId: 4663, tokensPerUsd: "1000", sink: "burn" } });
  const i = watcher.instructions();
  assert.equal(i.paymentIsBurn, false, "the address is not the fire");
  assert.equal(i.burns, true, "but the token is still destroyed");
  assert.equal(i.sink, "burn");
  assert.match(i.note, /destroyed/);
});

test("a desk that keeps what it takes does not claim to burn it", () => {
  const { watcher } = setup(TREASURY, { token: { symbol: "TRENCHERS", address: "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a", decimals: 18, chainId: 4663, tokensPerUsd: "1000", sink: "treasury" } });
  const i = watcher.instructions();
  assert.equal(i.paymentIsBurn, false);
  assert.equal(i.burns, false);
  assert.equal(i.sink, "treasury");
  assert.ok(!/destroyed/.test(i.note), "nothing is destroyed, so the note must not say so");
});

test("a deposit address that is not an address is refused when the watcher is built", () => {
  const { ledger } = setup();
  assert.throws(() => new DepositWatcher({
    ledger, depositAddress: "nope",
    source: { async since() { return { payments: [], cursor: "0" }; } },
    cursor: { read: () => null, write: () => {} },
  }), /40 hex/);
  void formatUsd;
});
