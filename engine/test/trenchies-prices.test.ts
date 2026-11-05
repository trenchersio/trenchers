import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { PicksPrices } from "../src/trenchies-prices";

const CURVE = "0x" + "c".repeat(40), GRAD = "0x" + "d".repeat(40), TRENCH = "0x" + "e".repeat(40);
const DAY = 86_400;

function setup() {
  // Curve coin: price 1 then 2. GRAD: curve trades until t=5000 (price 3), then graduated. TRENCH: graduated long ago (no curve data).
  const curvePts: Record<string, [number, number][]> = { [CURVE]: [[100, 1], [3000, 2]], [GRAD]: [[100, 1], [5000, 3]] };
  const grad = new Set([GRAD, TRENCH]);
  const base = {
    updatedAt: 0,
    priceAt: (t: string, at: number) => { const P = curvePts[t]; if (!P) return null; let b: number | null = null; for (const [s, p] of P) { if (s <= at) b = p; else { if (b === null) b = p; break; } } return b; },
    info: (t: string) => (curvePts[t] || grad.has(t) ? { symbol: t === TRENCH ? "TRENCHERS" : t.slice(2, 6), graduated: grad.has(t), lastTrade: curvePts[t]?.at(-1)?.[0] ?? null } : null),
    active: () => [{ token: CURVE, symbol: "CCCC", price: 2, changePct: 100, volEth: 1, trades: 2, launchedAt: 0, graduated: false }],
    symbolOf: (t: string) => (t === TRENCH ? "TRENCHERS" : t.slice(2, 6).toUpperCase()), known: (t: string) => !!curvePts[t] || grad.has(t),
  };
  let spot: Record<string, number> = { [GRAD]: 4, [TRENCH]: 0.5 };
  const reads: string[] = [];
  const pp = new PicksPrices(base as never, async (t) => { reads.push(t); return spot[t] ?? null; }, (t) => grad.has(t), [TRENCH as never], mkdtempSync(`${tmpdir()}/pp-`) + "/p.json");
  return { pp, base, setSpot: (s: Record<string, number>) => { spot = s; }, reads };
}

test("picks prices: curve coins unchanged, graduated coins follow the pool, $TRENCHERS pinned", async () => {
  const { pp, base, setSpot, reads } = setup();
  // nothing followed but $TRENCHERS: the first tick reads only it
  await pp.tick(10 * DAY + 100);
  assert.deepEqual(reads, [TRENCH], "only followed graduated coins are read");
  assert.equal(pp.priceAt(CURVE as never, 3500), 2, "curve coin: curve price");
  assert.equal(pp.priceAt(TRENCH as never, 10 * DAY + 200), 0.5, "graduated, no curve data: pool sample");
  assert.equal(pp.priceAt(TRENCH as never, 10 * DAY), null, "no price before the first sample");
  // a pick of GRAD: followed from now on; before its first sample the last curve price (graduation) counts
  pp.follow(GRAD as never);
  assert.equal(pp.priceAt(GRAD as never, 10 * DAY + 150), 3, "graduated, not sampled yet: its graduation price");
  setSpot({ [GRAD]: 6, [TRENCH]: 0.6 });
  await pp.tick(10 * DAY + 800);
  assert.equal(pp.priceAt(GRAD as never, 10 * DAY + 900), 6, "after a sample: the pool price");
  assert.equal(pp.priceAt(GRAD as never, 4000), 1, "before graduation: still the curve");
  // no extra reads within 10 minutes
  const n = reads.length; await pp.tick(10 * DAY + 900); assert.equal(reads.length, n);
  // the day's close: sampled in the last 90 s before midnight, and again just after
  setSpot({ [GRAD]: 9, [TRENCH]: 0.7 });
  await pp.tick(11 * DAY - 60); assert.equal(pp.priceAt(GRAD as never, 11 * DAY), 9, "closing price just before midnight");
  await pp.tick(11 * DAY + 40);
  base.updatedAt = 11 * DAY + 100; assert.ok(pp.updatedAt >= 11 * DAY, "settling waits for both sources past midnight");
  // the list shows followed graduated coins, $TRENCHERS first
  const list = pp.active(11 * DAY - DAY, 80);
  assert.equal(list[0].token, TRENCH); assert.ok(list.some((c) => c.token === GRAD && c.graduated)); assert.ok(list.some((c) => c.token === CURVE));
  // a pasted graduated address is priced and followed
  const fresh = setup(); const c = await fresh.pp.lookup(GRAD as never); assert.equal(c?.price, 4); assert.equal(c?.graduated, true);
  assert.equal(await fresh.pp.lookup(CURVE as never), null, "curve coins don't need a lookup");
  assert.ok(pp.known(GRAD as never) && pp.known(TRENCH as never));
});
