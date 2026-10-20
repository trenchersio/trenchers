import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const me = privateKeyToAccount(generatePrivateKey()), friend = privateKeyToAccount(generatePrivateKey()), stranger = privateKeyToAccount(generatePrivateKey());
process.env.TRENCHIES_FILE = mkdtempSync(`${tmpdir()}/tr-`) + "/t.json";
process.env.TRENCHIES_ALLOW = `${me.address},${friend.address}`;
process.env.CHAT_ADMINS = me.address;

test("Trenchies: invite-only, spawn, picks, settle, XP, shop, leaderboard, visit", async (t) => {
  const { Trenchies, loginText } = await import("../src/trenchies");
  const { roundOf, roundStart, DAY, levelOf } = await import("../src/trenchies-catalog");
  const T = (n: number) => `0x${String(n).padStart(40, "a")}` as `0x${string}`;
  const now = Date.now() / 1000, r = roundOf(now);
  // Prices: coin n goes from 1 to 1 + n/10 over round r+1 (coin 5 best).
  const prices = {
    updatedAt: 0,
    priceAt: (t: string, at: number) => { const n = Number(t.slice(-1)); return at <= roundStart(r + 1) ? 1 : 1 + n / 10; },
    active: () => [1, 2, 3, 4, 5].map((n) => ({ token: T(n), symbol: `C${n}`, price: 1, changePct: 0, volEth: n, trades: 3, launchedAt: 0, graduated: false })),
    symbolOf: (t: string) => `C${t.slice(-1)}`, known: (t: string) => /^0xa+[1-5]$/.test(t),
  };
  const owners: Record<number, string> = { 862: me.address.toLowerCase(), 599: friend.address.toLowerCase() };
  const pub = { readContract: async ({ args }: { args: [bigint] }) => owners[Number(args[0])] ?? "0x0000000000000000000000000000000000000001" };
  const posts: string[] = [];
  const pot = { potWei: () => 1000n, feesIn: () => 20000n, view: () => ({ potEth: "0.000000000000001" }) };
  const g = new Trenchies({ pub: pub as never, nft: "0x0000000000000000000000000000000000000002", prices: prices as never, symbolOf: async (t) => `C${t.slice(-1)}`, log: () => {}, pot: pot as never, announce: (_ids, t) => { posts.push(t); } });
  const srv = createServer((req, res) => { void g.handle(req, res, req.url!.split("?")[0]); }).listen(0);
  t.after(() => srv.close());
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/trenchies/`;
  const post = async (op: string, body: unknown) => { const r = await fetch(base + op, { method: "POST", body: JSON.stringify(body) }); return { status: r.status, j: await r.json() as any }; };
  const login = async (acct: typeof me) => { const time = new Date().toISOString(); return post("login", { address: acct.address, time, signature: await acct.signMessage({ message: loginText(acct.address, time) }) }); };

  assert.equal((await login(stranger)).status, 403, "a wallet not on the list is refused");
  const a = await login(me); assert.equal(a.status, 200); assert.equal(a.j.me, null);
  const b = await login(friend);
  const tok = a.j.token, tok2 = b.j.token;
  assert.equal((await post("spawn", { token: tok, nft: 599, name: "Ser_Me" })).status, 403, "can't spawn with a Trencher you don't hold");
  const sp = await post("spawn", { token: tok, nft: 862, name: "Ser_Me" }); assert.equal(sp.status, 200); assert.deepEqual(sp.j.me.items, ["shack", "bike"]);
  assert.equal((await post("spawn", { token: tok2, nft: 599, name: "ser_me" })).status, 409, "names are unique");
  assert.equal((await post("spawn", { token: tok2, nft: 599, name: "Friend" })).status, 200);
  assert.equal((await post("picks", { token: tok, tokens: [T(1), T(2)] })).status, 400, "exactly 3 picks");
  const pk = await post("picks", { token: tok, tokens: [T(5), T(4), T(1)] }); assert.equal(pk.status, 200); assert.equal(pk.j.me.open.picks.length, 3);
  await post("picks", { token: tok2, tokens: [T(3), T(2), T(1)] });
  // The round runs, then is settled once prices cover its end.
  prices.updatedAt = roundStart(r + 2) + 60;
  g.tick(roundStart(r + 2) + 120);
  const st = (await post("state", { token: tok })).j.me;
  // Picked coins ranked: C5 +50%, C4 +40%, C3 +30% are the top 3. Me: C5 #1 (100) + C4 #2 (60) + play 10 = 170.
  assert.equal(st.results[0].xp, 170, JSON.stringify(st.results[0]));
  assert.equal(st.unseen.round, r + 1);
  const st2 = (await post("state", { token: tok2 })).j.me;
  assert.equal(st2.results[0].xp, 10 + 40, "friend: C3 finished #3");
  assert.equal(levelOf(st.xp), st.level); assert.equal(st.xp, 170 + 15 + 20, "plus the picks quest (15) and the First Picks achievement (20)");
  // Shop
  assert.equal((await post("buy", { token: tok, id: "super" })).status, 400, "level-locked");
  const buy = await post("buy", { token: tok, id: "moped" }); assert.equal(buy.status, 200, JSON.stringify(buy.j)); assert.equal(buy.j.me.vehicle, "moped"); assert.equal(buy.j.me.bricks, st.bricks - 150);
  // The tree on your land: gather wood, then it regrows.
  const w1 = await post("gather", { token: tok, res: "wood" }); assert.equal(w1.status, 200); assert.ok(w1.j.got >= 10 && w1.j.got <= 20, `wood ${w1.j.got}`); assert.equal(w1.j.me.wood, w1.j.got);
  assert.equal((await post("gather", { token: tok, res: "wood" })).status, 400, "the tree has to regrow first");
  assert.ok(w1.j.me.next.wood > Date.now() + 2.9 * 3600 * 1000);
  assert.equal((await post("buy", { token: tok, id: "fence" })).status, 400, "level and materials are checked");
  const lb = (await fetch(`${base}leaderboard?token=${tok}`).then((r) => r.json())) as any;
  assert.equal(lb.players[0].name, "Ser_Me"); assert.equal(lb.me, 1);
  const v = (await fetch(`${base}visit?token=${tok2}&name=ser_me`).then((r) => r.json())) as any;
  assert.equal(v.player.vehicle, "moped");
  assert.equal((await fetch(`${base}state?token=bad`)).status, 401);
  // The fishing pond
  const f1 = await post("gather", { token: tok, res: "fish" }); assert.equal(f1.status, 200); assert.ok(f1.j.got >= 1 && f1.j.got <= 3); assert.ok(f1.j.xp === 10 || f1.j.xp === 50);
  // Lands: ask to join, the owner accepts, then both can chat; strangers can't.
  const get = (op: string, t: string, name: string) => fetch(`${base}${op}?token=${t}&name=${name}`).then(async (r) => ({ status: r.status, j: await r.json() as any }));
  assert.equal((await get("land", tok2, "Ser_Me")).j.role, "visitor");
  assert.equal((await post("land/say", { token: tok2, name: "Ser_Me", text: "hi" })).status, 403, "visitors can't chat");
  assert.equal((await post("land/request", { token: tok2, name: "Ser_Me" })).j.role, "pending");
  const mine = await get("land", tok, "Ser_Me"); assert.equal(mine.j.role, "owner"); assert.equal(mine.j.requests[0].name, "Friend");
  assert.equal((await post("land/answer", { token: tok2, name: "Ser_Me", who: "Friend", accept: true })).status, 403, "only the owner answers");
  const ok = await post("land/answer", { token: tok, name: "Ser_Me", who: "Friend", accept: true }); assert.equal(ok.j.members[0].name, "Friend");
  const here = await get("land", tok2, "Ser_Me"); assert.equal(here.j.role, "member"); assert.equal(here.j.present[0].name, "Friend", "a member who opens the land is spawned in it");
  const said = await post("land/say", { token: tok2, name: "Ser_Me", text: "gm  everyone" }); assert.equal(said.status, 200); assert.equal(said.j.chat.at(-1).text, "gm everyone");
  assert.equal((await post("land/say", { token: tok2, name: "Ser_Me", text: "again" })).status, 429, "rate limited");
  assert.equal((await post("state", { token: tok2 })).j.me.lands[0].name, "Ser_Me");
  // Weekly prizes: once the week has ended, the best pickers get the pot (50/30/20).
  const { weekOf, weekStart } = await import("../src/trenchies-catalog");
  const wk = weekOf(roundStart(r + 1));
  const pre = (await fetch(`${base}prizes`).then((x) => x.json())) as any; assert.ok(pre.split.length === 3);
  g.tick(weekStart(wk + 1) + 700);
  const pz = (await fetch(`${base}prizes?token=${tok}`).then((x) => x.json())) as any;
  const won = pz.past.find((z: any) => z.week === wk); assert.ok(won, JSON.stringify(pz));
  assert.equal(won.winners[0].name, "Ser_Me"); assert.equal(won.winners[0].share, 62.5); assert.equal(won.winners[0].wei, "625"); assert.equal(won.winners[1].wei, "375");
  assert.ok(posts[0]?.includes("weekly prizes"));
  assert.equal((await post("prizes/paid", { token: tok, week: wk, tx: "0x" + "1".repeat(64) })).status, 200, "the team (CHAT_ADMINS) marks it paid");
  void DAY;
  srv.close();
});
