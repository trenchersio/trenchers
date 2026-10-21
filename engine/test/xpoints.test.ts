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

test("original posts: sent in once, one a day, reviewed by the team", async () => {
  const x = new XPoints(() => {}, { nftsOf: () => [], tradeDays: () => ({}), coinsOf: () => [], inferenceUsd: () => 0 });
  const X = x as unknown as { users: Map<string, unknown>; session: (id: string) => string; tasks: () => Promise<unknown[]> };
  X.tasks = async () => [];
  const mk = (id: string, handle: string) => { X.users.set(id, { id, handle, name: handle, avatar: "", createdAt: 0, lastSeen: 0, xp: 0, followed: null, done: {}, log: [] }); return X.session(id); };
  const a = mk("10", "alice"), team = mk("20", "trenchersio");
  const call = async (op: string, body?: Record<string, unknown>, s?: string) => {
    const raw = body ? JSON.stringify(body) : "";
    const req = Object.assign((async function* () { if (raw) yield raw; })(), { method: body ? "POST" : "GET", url: `/xp/${op}${body ? "" : `?s=${s}`}`, headers: {} });
    let code = 0, out = "";
    const res = { statusCode: 200, setHeader() {}, end(t?: string) { code = this.statusCode; out = t ?? ""; } };
    await x.handle(req as never, res as never, `/xp/${op}`);
    return { code, j: JSON.parse(out || "{}") };
  };
  assert.equal((await call("original", { s: a, url: "https://x.com/bob/status/123456" })).code, 400, "someone else's post");
  const ok = await call("original", { s: a, url: "https://twitter.com/Alice/status/123456?s=20" });
  assert.equal(ok.code, 200); assert.equal(ok.j.me.originals[0].status, "pending");
  assert.equal((await call("original", { s: a, url: "https://x.com/alice/status/999999" })).code, 400, "one a day");
  assert.equal((await call("review", undefined, a)).code, 403, "only the team reviews");
  const q = await call("review", undefined, team); assert.equal(q.j.pending.length, 1);
  const d = await call("review", { s: team, user: "10", id: "123456", ok: true }); assert.equal(d.j.pending.length, 0);
  assert.equal((X.users.get("10") as { xp: number }).xp, XP_RULES.original);
  await call("review", { s: team, user: "10", id: "123456", ok: true }); assert.equal((X.users.get("10") as { xp: number }).xp, XP_RULES.original, "approved once");
});
