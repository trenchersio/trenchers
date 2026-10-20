import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
process.env.XPOINTS_FILE = `${mkdtempSync(`${tmpdir()}/xp-`)}/xp.json`;
const { XPoints, XP_RULES } = await import("../src/xpoints.ts");

test("usage XP: NFTs, trades (capped per day), coins and inference, each counted once", () => {
  const days: Record<number, number> = { 100: 5, 101: 50 };
  const x = new XPoints(() => {}, { nftsOf: (w) => (w === "0xa" ? [7] : w === "0xb" ? [7] : []), tradeDays: () => days, coinsOf: () => ["0xC0"], inferenceUsd: () => 3.7 });
  const u = { id: "1", handle: "a", name: "a", avatar: "", createdAt: 0, lastSeen: 0, xp: 0, followed: null, done: {}, log: [], wallet: "0xa" };
  assert.equal(x.sync(u as never), true);
  assert.equal(u.xp, XP_RULES.nft + (5 + 20) * XP_RULES.trade + XP_RULES.coin + 3 * XP_RULES.inferencePerUsd);
  assert.equal(x.sync(u as never), false, "nothing new");
  days[101] = 60; days[102] = 3; assert.equal(x.sync(u as never), true); assert.equal((u as unknown as { usage: { trades: number } }).usage.trades, 28);
  const v = { id: "2", handle: "b", name: "b", avatar: "", createdAt: 0, lastSeen: 0, xp: 0, followed: null, done: {}, log: [], wallet: "0xb" };
  x.sync(v as never); assert.equal(v.xp, 3 * XP_RULES.inferencePerUsd, "the same NFT and coin don't count twice");
});
