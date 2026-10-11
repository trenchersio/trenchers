/**
 * The HTTP surface. What matters here is the boundary: what a key may see, what it may not, and that the admin
 * side is invisible rather than merely refused when it is switched off.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { Ledger, MemoryStore, Proxy, createSurface, makeConfig, parseUnits, parseUsd } from "../../src/icm/index.ts";
import type { CompletionRequest, CompletionResponse, StreamedCompletion, Upstream } from "../../src/icm/index.ts";

class Stub implements Upstream {
  readonly name = "stub";
  async models() { return [{ id: "m/one", name: "One", contextLength: 1000, promptPerMillionMicroUsd: 1_000_000n, completionPerMillionMicroUsd: 2_000_000n }]; }
  async complete(_r: CompletionRequest): Promise<CompletionResponse> {
    return { body: { id: "g1", choices: [], usage: { cost: 0.001 } }, usage: { costMicroUsd: parseUsd("0.001"), tokensIn: 2, tokensOut: 3, reasoningTokens: 0, cachedTokens: 0, id: "g1" } };
  }
  async stream(): Promise<StreamedCompletion> { throw new Error("not used"); }
}

function setup(adminToken: string | null = "admin-secret") {
  const config = makeConfig({ keyPrefix: "trench", token: { symbol: "TRENCHERS", address: "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a", decimals: 18, chainId: 4663, tokensPerUsd: "1000", sink: "burn" }, marginBps: 1500 });
  const ledger = new Ledger({ store: new MemoryStore(), config });
  const handle = createSurface({ ledger, proxy: new Proxy({ ledger, upstream: new Stub() }), adminToken });
  const account = ledger.account("0xowner");
  ledger.deposit({ accountId: account.id, source: "chain", ref: "0xd", tokenUnits: parseUnits("10000", 18) });
  const { secret } = ledger.issueKey({ accountId: account.id });
  const call = (method: string, path: string, o: { bearer?: string | null; body?: unknown; query?: string } = {}) =>
    handle({ method, path, bearer: o.bearer === undefined ? null : o.bearer, body: o.body, query: new URLSearchParams(o.query ?? "") });
  return { ledger, handle, account, secret, call, config };
}

test("the rate card is public, and says the rate and the sink", async () => {
  const { call } = setup();
  const res = await call("GET", "/v1/rate");
  assert.equal(res.status, 200);
  const body = res.json as { tokensPerUsd: string; marginPercent: string; sink: string; symbol: string };
  assert.equal(body.symbol, "TRENCHERS");
  assert.equal(body.tokensPerUsd, "1000");
  assert.equal(body.marginPercent, "15%");
  assert.equal(body.sink, "burn");
});

test("a key reads its own balance, both as an integer and as a string", async () => {
  const { call, secret } = setup();
  const res = await call("GET", "/v1/key", { bearer: secret });
  const body = res.json as { balance: { available: string; available_micro_usd: string; spendable_micro_usd: string } };
  assert.equal(body.balance.available, "10.000000");
  assert.equal(body.balance.available_micro_usd, "10000000");
  assert.equal(body.balance.spendable_micro_usd, "10000000");
});

test("usage shows the customer what they were charged and never what it cost us", async () => {
  const { call, secret } = setup();
  await call("POST", "/v1/chat/completions", { bearer: secret, body: { model: "m/one", messages: [{ role: "user", content: "hi" }] } });
  const res = await call("GET", "/v1/usage", { bearer: secret });
  const body = res.json as { data: { cost: string }[]; summary: { spent: string } };
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].cost, "0.001150", "cost plus 15%");
  assert.equal(body.summary.spent, "0.001150");
  assert.ok(!JSON.stringify(body).includes("upstream"), "the house's own cost does not leave through a key route");
});

test("every error comes back in OpenAI's envelope with a stable code, never a stack", async () => {
  const { call, secret } = setup();
  const noKey = await call("POST", "/v1/chat/completions", { body: { model: "m/one", messages: [] } });
  assert.equal(noKey.status, 401);
  assert.equal((noKey.json as { error: { code: string } }).error.code, "missing_api_key");

  const badBody = await call("POST", "/v1/chat/completions", { bearer: secret, body: { model: "m/one" } });
  assert.equal(badBody.status, 400);
  assert.equal((badBody.json as { error: { type: string } }).error.type, "invalid_request");

  const nowhere = await call("GET", "/v1/nope");
  assert.equal(nowhere.status, 404);
  assert.equal((nowhere.json as { error: { message: string } }).error.message, "No such route on this gateway.");
  // the body carries the envelope and nothing else: no stack, no cause, no internals
  assert.deepEqual(Object.keys(nowhere.json as object), ["error"]);
  assert.deepEqual(Object.keys((nowhere.json as { error: object }).error).sort(), ["code", "message", "type"]);
});

test("models answers with or without a key, at retail prices", async () => {
  const { call, secret } = setup();
  for (const bearer of [null, secret]) {
    const res = await call("GET", "/v1/models", { bearer });
    const body = res.json as { data: { id: string; pricing: { prompt: string } }[] };
    assert.equal(body.data[0].id, "m/one");
    assert.equal(body.data[0].pricing.prompt, "1.150000");
  }
});

test("the admin surface is invisible without the token, not merely refused", async () => {
  const { call, secret } = setup();
  for (const bearer of [null, secret, "wrong"]) {
    const res = await call("GET", "/admin/book", { bearer });
    assert.equal(res.status, 404, "a wrong token learns nothing about whether the route exists");
    assert.equal((res.json as { error: { message: string } }).error.message, "No such route on this gateway.");
  }
  const off = setup(null);
  assert.equal((await off.call("GET", "/admin/book", { bearer: "admin-secret" })).status, 404);
});

test("the admin book states the liability and the drift, and resolves an unknown charge", async () => {
  const { call, ledger, account, secret } = setup();
  const admin = { bearer: "admin-secret" };

  const k = ledger.keysOf(account.id)[0];
  const charge = ledger.hold({ key: k, account: ledger.accountById(account.id), model: "m/one", amountMicroUsd: parseUsd("1") });
  ledger.markUnknown(charge.id, "no answer");

  const book = (await call("GET", "/admin/book", admin)).json as { outstandingMicroUsd: string; unresolvedMicroUsd: string; backing: { unbacked: boolean }; drift: unknown[] };
  assert.equal(book.unresolvedMicroUsd, String(parseUsd("1")));
  assert.equal(book.backing.unbacked, true);
  assert.deepEqual(book.drift, [], "and the book balances");

  const listed = (await call("GET", "/admin/charges", { ...admin, query: "state=unknown" })).json as { data: { id: string; upstream_micro_usd: string }[] };
  assert.equal(listed.data.length, 1);
  assert.equal(listed.data[0].id, charge.id);

  const resolved = await call("POST", `/admin/charges/${charge.id}/resolve`, { ...admin, body: { upstream: "0.20" } });
  assert.equal(resolved.status, 200);
  assert.equal(ledger.chargeById(charge.id).state, "settled");
  assert.equal(ledger.chargeById(charge.id).retailMicroUsd, String(parseUsd("0.23")));
  assert.equal(ledger.check().length, 0);
  void secret;
});

test("a grant needs a ref, so it cannot be made twice by accident", async () => {
  const { call, ledger } = setup();
  const admin = { bearer: "admin-secret" };
  assert.equal((await call("POST", "/admin/grant", { ...admin, body: { owner: "0xnew", amount: "5" } })).status, 400);
  const first = await call("POST", "/admin/grant", { ...admin, body: { owner: "0xnew", amount: "5", ref: "promo-1" } });
  assert.equal(first.status, 201);
  await call("POST", "/admin/grant", { ...admin, body: { owner: "0xnew", amount: "5", ref: "promo-1" } });
  assert.equal(ledger.accountFor("0xnew")!.balanceMicroUsd, String(parseUsd("5")), "the second one credited nothing");
  assert.equal(ledger.book().grantedMicroUsd, String(parseUsd("5")));
});

test("a suspended account cannot spend, and can be let back in", async () => {
  const { call, secret } = setup();
  const admin = { bearer: "admin-secret" };
  await call("POST", "/admin/suspend", { ...admin, body: { owner: "0xowner", reason: "under review" } });
  const refused = await call("GET", "/v1/key", { bearer: secret });
  assert.equal(refused.status, 403);
  assert.match((refused.json as { error: { message: string } }).error.message, /under review/);
  await call("POST", "/admin/suspend", { ...admin, body: { owner: "0xowner", undo: true } });
  assert.equal((await call("GET", "/v1/key", { bearer: secret })).status, 200);
});
