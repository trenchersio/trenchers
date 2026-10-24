import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const a = privateKeyToAccount(generatePrivateKey()), b = privateKeyToAccount(generatePrivateKey());
process.env.TRENCHIES_FILE = mkdtempSync(`${tmpdir()}/trr-`) + "/t.json";
process.env.TRENCHIES_ALLOW = `${a.address},${b.address}`;

test("progression: daily calendar, quests, chests, butterflies, wardrobe", async () => {
  const R = await import("../src/trenchies-rewards");
  const C = await import("../src/trenchies-catalog");
  const p = { addr: "0xa", xp: 0, bricks: 0, wood: 0, stone: 0, items: ["shack", "bike"], hits: 0, wins: 0, hatTricks: 0, rounds: 0, streak: 0, next: {} as Record<string, number>, ...R.emptyProgress() };
  // daily: day 1, then once only, then a missed day starts again
  assert.deepEqual(R.claimDaily(p, 100), C.DAILY[0]); assert.equal(p.bricks, 25);
  assert.equal(R.claimDaily(p, 100), null, "once a day");
  R.claimDaily(p, 101); assert.equal(p.daily.next, 2); assert.equal(p.daily.run, 2);
  R.claimDaily(p, 104); assert.equal(p.daily.next, 1, "missed days reset to day 1"); assert.equal(p.daily.run, 1);
  // quests: the picks are always one of the three; finishing all three pays a chest
  const qs = R.ensureQuests(p, 200); assert.equal(qs.list.length, 3); assert.equal(qs.list[0].id, "pick");
  const before = p.chests.common;
  for (const q of qs.list) R.bump(p, 200, q.id, C.QUESTS.find((x) => x.id === q.id)!.goal);
  assert.ok(qs.list.every((q) => q.done)); assert.equal(p.chests.common, before + 1);
  // level chests: crossing level 5
  const c0 = p.chests.rare; R.gain(p, C.xpFor(5)); assert.equal(p.chests.rare, c0 + 1);
  // chests open into something
  p.chests.epic = 1; const got = R.openChest(p, "epic", () => 0.99); assert.ok(got?.cosmetic, JSON.stringify(got)); assert.ok(p.wardrobe.includes(got!.cosmetic!));
  assert.equal(R.openChest(p, "epic"), null, "no chest left");
  // butterflies: a net swing, then a cooldown
  const n1 = R.swingNet(p, 1_000_000); assert.ok(!("error" in n1) && n1.got.length >= 1);
  const n2 = R.swingNet(p, 1_000_000 + 1000); assert.ok("error" in n2);
  // fishing: one cast every 30 minutes, the rarest fish really rare
  const f1 = R.castLine(p, 2_000_000); assert.ok(!("error" in f1) && f1.got.length >= 1 && Object.keys(p.fish).length >= 1);
  assert.ok("error" in R.castLine(p, 2_000_000 + 1000), "one cast per 30 minutes");
  const total = C.FISHES.reduce((s, f) => s + f.weight, 0);
  assert.ok(C.FISHES.find((f) => f.id === "whalefish")!.weight / total < 1 / 3000, "the Moon Whale is very rare");
  const old = { ...p, fish: 0 as unknown as Record<string, number>, next: {} as Record<string, number> }; assert.ok(!("error" in R.castLine(old, 5_000_000)) && typeof old.fish === "object", "old saves with fish: 0 still work");
  // wardrobe: free at your level vs bought vs chest-only
  assert.ok(R.canWear(p, "cap")); assert.equal(R.buyCosmetic(p, "partyhat"), "This one only comes from chests.");
  p.bricks = 1000; assert.equal(R.buyCosmetic(p, "beanie"), null); assert.ok(R.canWear(p, "beanie"));
  // achievements fire from stats
  p.stats.deskWins = 12; R.checkAchievements(p); assert.ok(p.achievements.includes("deskwin10")); assert.ok(p.wardrobe.includes("trail-coins"));
});

test("engine: daily, quests, cheers, referral, wear, public page", async () => {
  const { Trenchies, loginText } = await import("../src/trenchies");
  const owners: Record<number, string> = { 862: a.address.toLowerCase(), 599: b.address.toLowerCase() };
  const pub = { readContract: async ({ args }: { args: [bigint] }) => owners[Number(args[0])] ?? "0x0000000000000000000000000000000000000001" };
  const prices = { updatedAt: 0, priceAt: () => 1, active: () => [], symbolOf: () => "C", known: (t: string) => /^0xa+[1-5]$/.test(t) };
  const pushes: string[] = [];
  const g = new Trenchies({ pub: pub as never, nft: "0x0000000000000000000000000000000000000002", prices: prices as never, symbolOf: async () => "C", log: () => {}, notify: (_a, m) => { pushes.push(m.title); } });
  const srv = createServer((req, res) => { void g.handle(req, res, req.url!.split("?")[0]); }).listen(0);
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/trenchies/`;
  const post = async (op: string, body: unknown) => { const r = await fetch(base + op, { method: "POST", body: JSON.stringify(body) }); return { status: r.status, j: await r.json() as any }; };
  const login = async (acct: typeof a) => { const time = new Date().toISOString(); return (await post("login", { address: acct.address, time, signature: await acct.signMessage({ message: loginText(acct.address, time) }) })).j.token as string; };
  const ta = await login(a), tb = await login(b);
  await post("spawn", { token: ta, nft: 862, name: "Host" });
  const sb = await post("spawn", { token: tb, nft: 599, name: "Guest", ref: "host" });
  assert.equal(sb.j.me.bricks, 100, "invited: starts with bricks"); assert.equal(sb.j.me.chests.common, 1);
  const d = await post("daily", { token: ta }); assert.equal(d.status, 200); assert.equal(d.j.me.daily.claimed, true);
  assert.equal((await post("daily", { token: ta })).status, 400);
  // cheering: once per land per day, the owner gets bricks
  const c1 = await post("cheer", { token: tb, name: "Host" }); assert.equal(c1.status, 200); assert.equal(c1.j.cheers, 1);
  assert.equal((await post("cheer", { token: tb, name: "Host" })).status, 400);
  assert.equal((await post("cheer", { token: tb, name: "Guest" })).status, 400, "not your own land");
  const host = (await post("state", { token: ta })).j.me; assert.ok(host.inbox.some((x: any) => x.kind === "cheer"));
  // wardrobe
  assert.equal((await post("wear", { token: tb, slot: "hat", id: "crown" })).status, 400, "not unlocked");
  const w = await post("wear", { token: tb, slot: "outline", id: "line-white" }); assert.equal(w.status, 200); assert.equal(w.j.me.wear.outline, "line-white");
  // chest + net
  const ch = await post("chest", { token: tb, tier: "common" }); assert.equal(ch.status, 200); assert.ok(ch.j.got);
  const nt = await post("net", { token: tb }); assert.equal(nt.status, 200); assert.ok(nt.j.got.length >= 1);
  assert.equal((await post("net", { token: tb })).status, 400);
  // public page (no sign-in) and the boards
  const pubv = await fetch(`${base}public?name=host`).then((r) => r.json()) as any; assert.equal(pubv.player.cheers, 1); assert.ok(pubv.player.landValue >= 0);
  const bv = await fetch(`${base}leaderboard?token=${ta}&kind=cheers`).then((r) => r.json()) as any; assert.equal(bv.players[0].name, "Host");
  // reminders: the daily reward is waiting for Guest (if it's after 08:00 UTC) and nothing repeats
  g.remind(Date.now() / 1000); const n = pushes.length; g.remind(Date.now() / 1000); assert.equal(pushes.length, n, "no repeats");
  srv.close();
});
