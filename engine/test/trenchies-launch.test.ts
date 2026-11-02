import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

// Launch day: TRENCHIES_OPEN lets every wallet in. Holders spawn from their Trencher, everyone else as a Recruit.
const holder = privateKeyToAccount(generatePrivateKey()), fan = privateKeyToAccount(generatePrivateKey());
process.env.TRENCHIES_FILE = mkdtempSync(`${tmpdir()}/trl-`) + "/t.json";
process.env.TRENCHIES_ALLOW = "0x0000000000000000000000000000000000000009";
delete process.env.TRENCHIES_OPEN; delete process.env.TRENCHIES_OPEN_AT;

test("Trenchies launch: open switch, Recruits, upgrade to a Trencher, status", async (t) => {
  const { Trenchies, loginText, OPEN, recruitArt } = await import("../src/trenchies");
  const T = (n: number) => `0x${String(n).padStart(40, "a")}` as `0x${string}`;
  const prices = { updatedAt: 0, priceAt: () => 1, active: () => [1, 2, 3].map((n) => ({ token: T(n), symbol: `C${n}`, price: 1, changePct: 0, volEth: n, trades: 3, launchedAt: 0, graduated: false })), symbolOf: (x: string) => `C${x.slice(-1)}`, known: (x: string) => /^0xa+[1-5]$/.test(x) };
  const owners: Record<number, string> = { 862: holder.address.toLowerCase(), 777: fan.address.toLowerCase() };
  const pub = { readContract: async ({ args }: { args: [bigint] }) => owners[Number(args[0])] ?? "0x0000000000000000000000000000000000000001" };
  const g = new Trenchies({ pub: pub as never, nft: "0x0000000000000000000000000000000000000002", prices: prices as never, symbolOf: async (x: string) => `C${x.slice(-1)}`, log: () => {} } as never);
  const srv = createServer((req, res) => { void g.handle(req, res, req.url!.split("?")[0]); }).listen(0);
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/trenchies/`;
  const post = async (op: string, body: unknown) => { const r = await fetch(base + op, { method: "POST", body: JSON.stringify(body) }); return { status: r.status, j: await r.json() as any }; };
  const login = async (acct: typeof holder) => { const time = new Date().toISOString(); return post("login", { address: acct.address, time, signature: await acct.signMessage({ message: loginText(acct.address, time) }) }); };

  // Before launch: closed, and the status endpoint says so
  assert.equal(OPEN(), false);
  assert.equal((await fetch(base + "status").then((r) => r.json()) as any).open, false);
  assert.equal((await login(fan)).status, 403, "closed before launch");

  // Launch time in the past opens it by itself
  process.env.TRENCHIES_OPEN = "1";
  assert.equal(OPEN(), true);
  assert.equal((await fetch(base + "status").then((r) => r.json()) as any).open, true);

  // A fan with no Trencher plays as a Recruit
  const f = await login(fan); assert.equal(f.status, 200);
  const sp = await post("spawn", { token: f.j.token, guest: true, name: "Recruit_1" }); assert.equal(sp.status, 200, JSON.stringify(sp.j));
  assert.equal(sp.j.me.guest, true); assert.equal(sp.j.me.nft, recruitArt(fan.address.toLowerCase()));
  // Recruits can make picks and call the desk like anyone
  assert.equal((await post("picks", { token: f.j.token, tokens: [T(1), T(2), T(3)] })).status, 200);
  // Logging in again doesn't kick a Recruit out for "not holding" its borrowed art
  const f2 = await login(fan); assert.equal(f2.j.me.guest, true); assert.equal(f2.j.me.held, true);
  assert.equal((await post("picks", { token: f2.j.token, tokens: [T(3), T(2), T(1)] })).status, 200);
  // Later they get a Trencher and move in: no longer a Recruit, XP and land kept
  const up = await post("spawn", { token: f2.j.token, nft: 777, name: "Recruit_1" }); assert.equal(up.status, 200, JSON.stringify(up.j));
  assert.equal(up.j.me.guest, false); assert.equal(up.j.me.nft, 777);
  // ...and can't go back to being a Recruit
  assert.equal((await post("spawn", { token: f2.j.token, guest: true, name: "Recruit_1" })).status, 400);

  // A holder still spawns from their own Trencher, and can't use one they don't hold
  const h = await login(holder);
  assert.equal((await post("spawn", { token: h.j.token, nft: 777, name: "Holder" })).status, 403);
  const hs = await post("spawn", { token: h.j.token, nft: 862, name: "Holder" }); assert.equal(hs.status, 200); assert.equal(hs.j.me.guest, false);

  // The public status shows the player count
  assert.equal((await fetch(base + "status").then((r) => r.json()) as any).players, 2);
  delete process.env.TRENCHIES_OPEN;
});
