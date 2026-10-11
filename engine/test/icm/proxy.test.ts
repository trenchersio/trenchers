/**
 * The gateway.
 *
 * What is worth proving here is not that a happy call works — it is what happens to the money in each of the ways
 * a call can go wrong. A refusal must cost nothing. A provider that answers without saying what it cost must not
 * be guessed at. A stream that dies halfway must not silently become free. And none of the failures may leave a
 * hold sitting on somebody's balance with nothing to resolve it.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { Ledger, MemoryStore, Proxy, makeConfig, parseUsd, parseUnits, E, IcmError } from "../../src/icm/index.ts";
import type { CompletionRequest, CompletionResponse, StreamedCompletion, Upstream, UpstreamModel } from "../../src/icm/index.ts";

const TOKEN = { symbol: "TRENCHERS", address: "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a", decimals: 18, chainId: 4663, tokensPerUsd: "1000", sink: "burn" as const };

/** A provider we can make behave any way we need. */
class FakeUpstream implements Upstream {
  readonly name = "fake";
  calls = 0;
  modelList: UpstreamModel[] = [
    { id: "anthropic/claude-sonnet-4", name: "Sonnet", contextLength: 200_000, promptPerMillionMicroUsd: 3_000_000n, completionPerMillionMicroUsd: 15_000_000n },
    { id: "openai/gpt-5", name: "GPT-5", contextLength: 400_000, promptPerMillionMicroUsd: 1_250_000n, completionPerMillionMicroUsd: 10_000_000n },
  ];
  /** What `complete` does next. */
  next: (() => Promise<CompletionResponse>) | null = null;
  /** What `stream` does next. */
  nextStream: (() => Promise<StreamedCompletion>) | null = null;

  async models() { return this.modelList; }

  async complete(_req: CompletionRequest): Promise<CompletionResponse> {
    this.calls++;
    if (this.next) return this.next();
    return {
      body: { id: "gen-abc", object: "chat.completion", choices: [{ message: { role: "assistant", content: "hello" } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.002 } },
      usage: { costMicroUsd: parseUsd("0.002"), tokensIn: 10, tokensOut: 5, reasoningTokens: 0, cachedTokens: 0, id: "gen-abc" },
    };
  }

  async stream(_req: CompletionRequest): Promise<StreamedCompletion> {
    this.calls++;
    if (this.nextStream) return this.nextStream();
    return sse([
      `data: {"id":"gen-str","choices":[{"delta":{"content":"he"}}]}`,
      `data: {"id":"gen-str","choices":[{"delta":{"content":"llo"}}]}`,
      `data: {"id":"gen-str","usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.004}}`,
      `data: [DONE]`,
    ]);
  }
}

/** Build a StreamedCompletion from SSE lines, resolving usage from the last frame that has one. */
function sse(lines: string[], o: { breakAfter?: number } = {}): StreamedCompletion {
  const empty = { costMicroUsd: null, tokensIn: 0, tokensOut: 0, reasoningTokens: 0, cachedTokens: 0, id: null as string | null };
  let settle!: (u: { costMicroUsd: bigint | null; tokensIn: number; tokensOut: number; reasoningTokens: number; cachedTokens: number; id: string | null }) => void;
  const usage = new Promise<NonNullable<typeof seen>>((r) => { settle = r; });
  let seen: { costMicroUsd: bigint | null; tokensIn: number; tokensOut: number; reasoningTokens: number; cachedTokens: number; id: string | null } | null = null;
  let i = 0;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (o.breakAfter !== undefined && i === o.breakAfter) { settle(seen ?? empty); controller.error(new Error("the connection dropped")); return; }
      if (i >= lines.length) { settle(seen ?? empty); controller.close(); return; }
      const line = lines[i++];
      const data = line.slice(5).trim();
      if (data && data !== "[DONE]") {
        const parsed = JSON.parse(data) as { id?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
        if (parsed.usage) seen = { costMicroUsd: parseUsd(String(parsed.usage.cost ?? 0)), tokensIn: parsed.usage.prompt_tokens ?? 0, tokensOut: parsed.usage.completion_tokens ?? 0, reasoningTokens: 0, cachedTokens: 0, id: parsed.id ?? null };
        else if (!seen && parsed.id) seen = { ...empty, id: parsed.id };
      }
      controller.enqueue(enc.encode(`${line}\n\n`));
    },
    cancel() { settle(seen ?? empty); },
  });
  return { stream, usage };
}

async function drain(s: ReadableStream<Uint8Array>): Promise<string> {
  let out = "";
  const dec = new TextDecoder();
  for await (const chunk of s as unknown as AsyncIterable<Uint8Array>) out += dec.decode(chunk, { stream: true });
  return out;
}

function setup(over: Partial<Parameters<typeof makeConfig>[0]> = {}) {
  const config = makeConfig({ keyPrefix: "trench", token: TOKEN, marginBps: 1500, minDepositMicroUsd: "0.1", ...over });
  let t = Date.parse("2026-10-11T12:00:00.000Z");
  let n = 0;
  const ledger = new Ledger({ store: new MemoryStore(), config, now: () => t, randomId: () => `id${++n}` });
  const upstream = new FakeUpstream();
  const proxy = new Proxy({ ledger, upstream, now: () => t });
  const account = ledger.account("0xabc0000000000000000000000000000000000001");
  ledger.deposit({ accountId: account.id, source: "chain", ref: "0xdep", tokenUnits: parseUnits("100000", 18) }); // $100
  const { secret, key } = ledger.issueKey({ accountId: account.id });
  const chat = (body: unknown, s = secret) => proxy.chat({ secret: s, body });
  return { ledger, proxy, upstream, account, key, secret, chat, config, tick: (ms: number) => { t += ms; } };
}

const bal = (l: Ledger, id: string) => BigInt(l.accountById(id).balanceMicroUsd);
const held = (l: Ledger, id: string) => BigInt(l.accountById(id).heldMicroUsd);
const body = { model: "anthropic/claude-sonnet-4", messages: [{ role: "user", content: "hi" }] };

// ------------------------------------------------------------------------------------------------ happy path

test("a completion is billed at the provider's own cost plus the margin", async () => {
  const { ledger, account, chat } = setup();
  const before = bal(ledger, account.id);
  const res = await chat(body);

  assert.equal(res.status, 200);
  // cost us $0.002, so the customer pays $0.0023
  assert.equal(res.headers["x-icm-cost"], "0.002300");
  assert.equal(bal(ledger, account.id), before - parseUsd("0.0023"));
  assert.equal(held(ledger, account.id), 0n, "the rest of the hold came back");

  const charge = ledger.chargeById(res.headers["x-icm-charge"]);
  assert.equal(charge.state, "settled");
  assert.equal(charge.upstreamMicroUsd, String(parseUsd("0.002")), "what we owe the provider is recorded separately");
  assert.equal(charge.retailMicroUsd, String(parseUsd("0.0023")));
  assert.equal(charge.upstreamId, "gen-abc", "and the provider's own id, for reconciling their invoice");
  assert.equal(charge.tokensIn, 10);
  assert.equal(ledger.check().length, 0);
});

test("the body handed back reports what the caller was charged, not what we paid", async () => {
  const { chat } = setup();
  const res = await chat(body);
  const json = res.json as { usage: { cost: number; prompt_tokens: number } };
  assert.equal(json.usage.cost, 0.0023, "a client reading usage.cost sees its own bill");
  assert.equal(json.usage.prompt_tokens, 10, "and the provider's other usage fields survive");
});

test("the model list carries retail prices, and only models this gateway allows", async () => {
  const { proxy } = setup({ allowModels: ["anthropic/*"] });
  const list = await proxy.modelsBody();
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].id, "anthropic/claude-sonnet-4");
  // $3/M upstream becomes $3.45/M retail
  assert.deepEqual((list.data[0].pricing as { prompt: string }).prompt, "3.450000");
});

// ------------------------------------------------------------------------------------------------ refusals cost nothing

test("every refusal leaves the balance exactly where it was, and never reaches the provider", async () => {
  const { ledger, account, upstream, chat, secret } = setup({ allowModels: ["anthropic/*"] });
  const before = bal(ledger, account.id);

  const cases: [string, unknown, RegExp][] = [
    ["no model", { messages: [] }, /`model` is required/],
    ["no messages", { model: "anthropic/claude-sonnet-4" }, /`messages` is required/],
    ["empty messages", { model: "anthropic/claude-sonnet-4", messages: [] }, /cannot be empty/],
    ["not an object", "hello", /has to be a JSON object/],
    ["a model off the list", { model: "openai/gpt-5", messages: [{ role: "user", content: "hi" }] }, /not on this gateway's model list/],
  ];
  for (const [what, b, re] of cases) {
    await assert.rejects(() => chat(b), re, what);
  }
  await assert.rejects(() => chat(body, "trench_live_" + "0".repeat(48)), /not one of ours/);
  await assert.rejects(() => chat(body, null as unknown as string), /No API key/);

  assert.equal(upstream.calls, 0, "nothing was sent upstream");
  assert.equal(bal(ledger, account.id), before);
  assert.equal(held(ledger, account.id), 0n);
  assert.equal(ledger.check().length, 0);
  void secret;
});

test("a call bigger than the balance is refused with what is there and what was needed", async () => {
  const { ledger, proxy, upstream } = setup();
  const poor = ledger.account("0xpoor");
  ledger.deposit({ accountId: poor.id, source: "grant", ref: "g1", creditedMicroUsd: parseUsd("0.0001") });
  const { secret } = ledger.issueKey({ accountId: poor.id });

  await assert.rejects(
    () => proxy.chat({ secret, body }),
    (e: IcmError) => {
      assert.equal(e.code, "insufficient_balance");
      assert.equal(e.status, 402);
      assert.match(e.message, /holds \$0\.000100/);
      assert.match(e.message, /Nothing was charged/);
      assert.equal(e.retryable, false);
      return true;
    },
  );
  assert.equal(upstream.calls, 0);
  assert.equal(ledger.check().length, 0);
});

test("a key restricted to one model cannot spend on another", async () => {
  const { ledger, proxy, account, upstream } = setup();
  const { secret } = ledger.issueKey({ accountId: account.id, models: ["openai/*"] });
  await assert.rejects(() => proxy.chat({ secret, body }), /may only call openai/);
  assert.equal(upstream.calls, 0);
  assert.equal(held(ledger, account.id), 0n);
});

// ------------------------------------------------------------------------------------------------ the provider misbehaves

test("a provider that refuses before generating anything gives the whole hold back", async () => {
  const { ledger, account, upstream, chat } = setup();
  const before = bal(ledger, account.id);
  upstream.next = () => Promise.reject(E.upstreamRefused(400, "that model does not accept images"));

  await assert.rejects(() => chat(body), /does not accept images/);
  assert.equal(bal(ledger, account.id), before, "not a cent");
  assert.equal(held(ledger, account.id), 0n);
  const charge = ledger.chargesOf(account.id)[0];
  assert.equal(charge.state, "released");
  assert.equal(ledger.check().length, 0);
});

test("a provider that never answers leaves the charge unknown, held, for a person", async () => {
  const { ledger, account, upstream, chat } = setup();
  const before = bal(ledger, account.id);
  upstream.next = () => Promise.reject(E.outcomeUnknown("the provider did not answer in time"));

  await assert.rejects(() => chat(body), (e: IcmError) => {
    assert.equal(e.code, "outcome_unknown");
    assert.equal(e.retryable, false, "an ambiguous charge is never replayed automatically");
    return true;
  });

  const charge = ledger.chargesOf(account.id)[0];
  assert.equal(charge.state, "unknown");
  assert.ok(bal(ledger, account.id) < before, "the hold is still out");
  assert.equal(held(ledger, account.id), BigInt(charge.heldMicroUsd));
  assert.equal(ledger.book().counts.unknown, 1);
  assert.equal(ledger.check().length, 0);
});

test("a completion that arrives without a cost is not guessed at", async () => {
  const { ledger, account, upstream, chat } = setup();
  upstream.next = async () => ({
    body: { id: "gen-x", choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
    usage: { costMicroUsd: null, tokensIn: 3, tokensOut: 1, reasoningTokens: 0, cachedTokens: 0, id: "gen-x" },
  });

  await assert.rejects(() => chat(body), /did not report its cost/);
  const charge = ledger.chargesOf(account.id)[0];
  assert.equal(charge.state, "unknown", "billing a guess is worse than asking a person");
  assert.equal(ledger.check().length, 0);
});

test("a provider that is down is retryable; a provider that refused the request is not", async () => {
  const { upstream, chat } = setup();
  upstream.next = () => Promise.reject(E.upstreamDown("connection reset"));
  await assert.rejects(() => chat(body), (e: IcmError) => { assert.equal(e.retryable, true); return true; });

  upstream.next = () => Promise.reject(E.upstreamRefused(400, "bad request"));
  await assert.rejects(() => chat(body), (e: IcmError) => { assert.equal(e.retryable, false); return true; });
});

// ------------------------------------------------------------------------------------------------ streaming

test("a stream is relayed byte for byte and billed from its final usage frame", async () => {
  const { ledger, account, chat } = setup();
  const before = bal(ledger, account.id);
  const res = await chat({ ...body, stream: true });

  assert.equal(res.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.ok(res.stream);
  assert.ok(held(ledger, account.id) > 0n, "the hold is out while the stream runs");

  const text = await drain(res.stream!);
  assert.match(text, /"content":"he"/);
  assert.match(text, /\[DONE\]/);
  assert.match(text, /"cost":0\.004/, "the provider's own frames are passed through untouched");

  await new Promise((r) => setImmediate(r)); // the settle happens on the usage promise
  const charge = ledger.chargeById(res.headers["x-icm-charge"]);
  assert.equal(charge.state, "settled");
  assert.equal(charge.streamed, true);
  assert.equal(charge.retailMicroUsd, String(parseUsd("0.0046")), "$0.004 upstream, 15% on top");
  assert.equal(bal(ledger, account.id), before - parseUsd("0.0046"));
  assert.equal(held(ledger, account.id), 0n);
  assert.equal(ledger.check().length, 0);
});

test("a stream that dies before its usage frame leaves the charge unknown, not free", async () => {
  const { ledger, account, upstream, chat } = setup();
  upstream.nextStream = async () => sse([
    `data: {"id":"gen-cut","choices":[{"delta":{"content":"he"}}]}`,
    `data: {"id":"gen-cut","choices":[{"delta":{"content":"llo"}}]}`,
    `data: {"id":"gen-cut","usage":{"prompt_tokens":10,"completion_tokens":5,"cost":0.004}}`,
  ], { breakAfter: 2 });

  const res = await chat({ ...body, stream: true });
  await assert.rejects(() => drain(res.stream!), /connection dropped/);
  await new Promise((r) => setImmediate(r));

  const charge = ledger.chargeById(res.headers["x-icm-charge"]);
  assert.equal(charge.state, "unknown", "tokens were delivered; somebody has to decide what they cost");
  assert.equal(held(ledger, account.id), BigInt(charge.heldMicroUsd));
  assert.equal(ledger.check().length, 0);
});

test("a stream the caller walks away from still resolves its hold", async () => {
  const { ledger, account, chat } = setup();
  const res = await chat({ ...body, stream: true });
  const reader = res.stream!.getReader();
  await reader.read();
  await reader.cancel("the caller hung up");
  await new Promise((r) => setImmediate(r));

  const charge = ledger.chargeById(res.headers["x-icm-charge"]);
  assert.notEqual(charge.state, "held", "a cancelled stream must not leave money stuck");
  assert.equal(held(ledger, account.id), charge.state === "unknown" ? BigInt(charge.heldMicroUsd) : 0n);
  assert.equal(ledger.check().length, 0);
});

// ------------------------------------------------------------------------------------------------ holds

test("the hold is sized from the model's published price and clamped by the config", async () => {
  const { ledger, account, chat } = setup({ maxHoldMicroUsd: "0.05" });
  const res = await chat({ ...body, max_tokens: 100_000, stream: true });
  const charge = ledger.chargeById(res.headers["x-icm-charge"]);
  // 100k completion tokens at $15/M is $1.50, well over the ceiling
  assert.equal(charge.heldMicroUsd, String(parseUsd("0.05")), "one mistake cannot hold the whole balance");
  await drain(res.stream!);
  await new Promise((r) => setImmediate(r));
  assert.equal(held(ledger, account.id), 0n);
});

test("a model the provider has never heard of still gets a hold, from the fallback", async () => {
  const { ledger, account, chat } = setup();
  const res = await chat({ model: "someone/brand-new", messages: [{ role: "user", content: "hi" }] });
  const charge = ledger.chargeById(res.headers["x-icm-charge"]);
  assert.ok(BigInt(charge.heldMicroUsd) > 0n);
  assert.equal(charge.state, "settled");
  assert.equal(held(ledger, account.id), 0n);
});
