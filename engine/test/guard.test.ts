import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

process.env.GUARD_FILE = `${mkdtempSync(`${tmpdir()}/guard-`)}/guard.json`;
const { scan, scanOrigin, SEL } = await import("../src/guard-scan");
const { Guard, TOPIC, guardText } = await import("../src/guard");

const A = "0x1111111111111111111111111111111111111111", B = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333", ROUTER = "0x4444444444444444444444444444444444444444";
const pad = (a: string) => a.slice(2).padStart(64, "0");
const MAX = "f".repeat(64);
const ctx = { trusted: new Set([ROUTER]), names: { [TOKEN]: "USDC", [ROUTER]: "Router" } };

test("unlimited approval to an unknown contract is danger, to a known router only info", () => {
  const bad = scan({ method: "eth_sendTransaction", params: [{ to: TOKEN, data: `${SEL.approve}${pad(B)}${MAX}` }] }, ctx);
  assert.equal(bad.level, "danger");
  assert.match(bad.findings[0].title, /ALL your USDC/);
  const ok = scan({ method: "eth_sendTransaction", params: [{ to: TOKEN, data: `${SEL.approve}${pad(ROUTER)}${"0".repeat(63)}5` }] }, ctx);
  assert.equal(ok.level, "info");
  const revoke = scan({ method: "eth_sendTransaction", params: [{ to: TOKEN, data: `${SEL.approve}${pad(B)}${"0".repeat(64)}` }] }, ctx);
  assert.equal(revoke.level, "ok");
});

test("setApprovalForAll, permits, eth_sign, 7702 and hash signing are flagged", () => {
  assert.equal(scan({ method: "eth_sendTransaction", params: [{ to: TOKEN, data: `${SEL.setApprovalForAll}${pad(B)}${"0".repeat(63)}1` }] }, ctx).level, "danger");
  const permit = { primaryType: "Permit", domain: { name: "USD Coin", verifyingContract: TOKEN }, message: { owner: A, spender: B, value: (2n ** 256n - 1n).toString(), deadline: "9999999999" } };
  const p = scan({ method: "eth_signTypedData_v4", params: [A, JSON.stringify(permit)] }, ctx);
  assert.equal(p.level, "danger"); assert.match(p.findings[0].title, /Permit/);
  assert.equal(scan({ method: "eth_sign", params: [A, "0x00"] }).level, "danger");
  assert.equal(scan({ method: "wallet_signAuthorization", params: [] }).level, "danger");
  assert.equal(scan({ method: "personal_sign", params: [`0x${"ab".repeat(32)}`, A] }).level, "danger");
  const hello = `0x${Buffer.from("Sign in to Example\nNonce: 42").toString("hex")}`;
  assert.equal(scan({ method: "personal_sign", params: [hello, A] }).level, "ok");
});

test("look-alike and punycode sites are caught, the real ones pass", () => {
  assert.equal(scanOrigin("https://uniswap.org"), null);
  assert.equal(scanOrigin("https://app.uniswap.org"), null);
  assert.equal(scanOrigin("https://www.trenchers.io"), null);
  assert.equal(scanOrigin("https://unlswap.org")?.level, "danger");
  assert.equal(scanOrigin("https://trenchers-claim.io")?.level, "warn");
  assert.equal(scanOrigin("https://pond.xyz"), null);
  assert.equal(scanOrigin("https://xn--uniswp-9ua.org")?.level, "warn");
  assert.equal(scanOrigin("https://bad.example", { phishing: new Set(["bad.example"]) })?.level, "danger");
  assert.equal(scanOrigin("https://example.com"), null);
});

test("a batch with an approval inside is as bad as its worst call", () => {
  const r = scan({ method: "wallet_sendCalls", params: [{ calls: [{ to: ROUTER, data: "0x12345678" }, { to: TOKEN, data: `${SEL.approve}${pad(B)}${MAX}` }] }] }, ctx);
  assert.equal(r.level, "danger");
  assert.ok(r.findings.some((f) => f.kind === "batch"));
});

function guard(extra: Partial<ConstructorParameters<typeof Guard>[0]> = {}) {
  const sent: { to: string; title: string }[] = [];
  const g = new Guard({ pub: null, site: "https://www.trenchers.io", explorer: "https://x", log: () => {}, owned: () => [], trusted: { [ROUTER]: "Router" }, secret: "s", notify: (to, m) => sent.push({ to, title: m.title }), ...extra });
  return { g, sent };
}
const log = (topics: string[], data = "0x", address = TOKEN, tx = "0xaa") => ({ address, topics, data, transactionHash: tx, blockNumber: "0x1" });

test("watcher: unknown unlimited approval and sweep alert the watcher, trusted ones don't", () => {
  const { g, sent } = guard();
  assert.deepEqual(g.watch(B, A), { ok: true });
  g.digest([
    log([TOPIC.Approval, `0x${pad(A)}`, `0x${pad(ROUTER)}`], `0x${MAX}`),
    log([TOPIC.Approval, `0x${pad(A)}`, `0x${pad(B)}`], `0x${MAX}`, TOKEN, "0xbb"),
    log([TOPIC.Transfer, `0x${pad(A)}`, `0x${pad(B)}`], `0x${"0".repeat(63)}1`, "0x5555555555555555555555555555555555555555", "0xcc"),
    log([TOPIC.Transfer, `0x${pad(A)}`, `0x${pad(B)}`], `0x${"0".repeat(63)}1`, "0x6666666666666666666666666666666666666666", "0xcc"),
    log([TOPIC.Transfer, `0x${pad(A)}`, `0x${pad(B)}`], `0x${"0".repeat(63)}1`, "0x7777777777777777777777777777777777777777", "0xcc"),
    log([TOPIC.Approval, `0x${pad(B)}`, `0x${pad(ROUTER)}`], `0x${MAX}`), // not watched
  ]);
  const st = g.state(B);
  assert.equal(st.alerts.length, 2);
  assert.deepEqual(st.alerts.map((a) => a.kind).sort(), ["approve", "sweep"]);
  assert.ok(st.alerts.every((a) => a.level === "danger"));
  assert.equal(sent.length, 2); assert.ok(sent.every((s) => s.to === B));
  g.digest([log([TOPIC.Approval, `0x${pad(A)}`, `0x${pad(B)}`], `0x${MAX}`, TOKEN, "0xbb")]);
  assert.equal(g.state(B).alerts.length, 2, "same alert isn't raised twice");
});

test("watch limits, sessions and the key-use check", async () => {
  const { g } = guard();
  const me = "0x9999999999999999999999999999999999999999";
  for (let i = 0; i < 3; i++) assert.equal(g.watch(me, `0x${String(i).repeat(40)}`).ok, true);
  assert.equal(g.watch(me, `0x${"8".repeat(40)}`).ok, false);
  const t = g.token(me); assert.equal(g.who(t), me); assert.equal(g.who(`${t}x`), null);

  const now = { t: Date.now() };
  const { g: g2, sent } = guard({ now: () => now.t });
  g2.keyUsed(me, "k1", "sk-…abcd", "1.2.3.4");
  g2.keyUsed(me, "k1", "sk-…abcd", "1.2.3.9");
  assert.equal(sent.length, 0);
  now.t += 2 * 3_600_000;
  g2.keyUsed(me, "k1", "sk-…abcd", "1.2.3.10");
  assert.equal(sent.length, 0, "same network");
  g2.keyUsed(me, "k1", "sk-…abcd", "8.8.8.8");
  assert.equal(sent.length, 1);
  assert.equal(g2.state(me).alerts[0].kind, "key-new-network");
});

test("login verifies the wallet signature over HTTP", async () => {
  const { g } = guard();
  const acct = privateKeyToAccount(generatePrivateKey());
  const time = new Date().toISOString();
  const signature = await acct.signMessage({ message: guardText(acct.address, time) });
  const res = await call(g, "/guard/login", { address: acct.address, time, signature });
  assert.equal(res.code, 200);
  const body = res.body as { token: string; state: { wallets: { addr: string }[] } };
  assert.equal(body.state.wallets[0].addr, acct.address.toLowerCase());
  const st = await call(g, "/guard/state", undefined, body.token);
  assert.equal(st.code, 200);
  const bad = await call(g, "/guard/login", { address: acct.address, time, signature: signature.replace(/.$/, "0") });
  assert.notEqual(bad.code, 200);
  const sc = await call(g, "/guard/scan", { method: "eth_sign", params: [] });
  assert.equal((sc.body as { level: string }).level, "danger");
});

async function call(g: InstanceType<typeof Guard>, path: string, body?: unknown, token?: string) {
  const { Readable } = await import("node:stream");
  const req = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), { method: body ? "POST" : "GET", headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: "127.0.0.1" }, url: path });
  let out = ""; const res = { statusCode: 200, setHeader() {}, end(s: string) { out = s; } };
  await g.handle(req as never, res as never, path);
  return { code: res.statusCode, body: JSON.parse(out || "{}") as unknown };
}
