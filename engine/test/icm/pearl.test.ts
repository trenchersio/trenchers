/**
 * Pearl as a second provider: `pearl/<id>` goes to Pearl with a body Pearl accepts, the cost is worked out from
 * Pearl's token counts and its per-model prices, everything else still goes to the default provider, and a model
 * with no price is never served.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { Ledger, MemoryStore, PearlUpstream, Proxy, RoutedUpstream, makeConfig, parsePearlPrices, parseUnits, parseUsd, pearlCost, toPearlBody } from "../../src/icm/index.ts";
import type { CompletionRequest, Upstream, UpstreamModel } from "../../src/icm/index.ts";

const TOKEN = { symbol: "TRENCHERS", address: "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a", decimals: 18, chainId: 4663, tokensPerUsd: "1000", sink: "burn" as const };

/** Pearl on the wire: /models, a buffered completion, and a stream ending in a usage frame. */
function fakePearl() {
  const seen: { path: string; body: Record<string, unknown> | null }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace("https://pearl.test/v1", "");
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    seen.push({ path, body });
    if (path === "/models") return Response.json({ data: [{ id: "zai-org/GLM-5.3", name: "GLM-5.3", context_length: 1_000_000 }, { id: "google/gemma-4-31B-it", context_length: 256_000 }] });
    if (body?.stream) {
      const frames = [
        `data: {"id":"p-1","choices":[{"delta":{"reasoning":"hm"}}]}`,
        `data: {"id":"p-1","choices":[{"delta":{"content":"gm"},"finish_reason":"stop"}]}`,
        `data: {"id":"p-1","choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":500,"total_tokens":1500,"prompt_tokens_details":{"cached_tokens":200}}}`,
        `data: [DONE]`,
      ].join("\n\n") + "\n\n";
      return new Response(frames, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ id: "p-2", model: "zai-org/GLM-5.3", choices: [{ message: { role: "assistant", content: "gm", reasoning: "…" }, finish_reason: "stop" }], usage: { prompt_tokens: 2000, completion_tokens: 1000, total_tokens: 3000 } });
  }) as typeof fetch;
  return { f, seen };
}

class Default implements Upstream {
  readonly name = "openrouter"; calls: string[] = [];
  async models(): Promise<UpstreamModel[]> { return [{ id: "openai/gpt-5", name: "GPT-5", contextLength: 400_000, promptPerMillionMicroUsd: 1_250_000n, completionPerMillionMicroUsd: 10_000_000n }]; }
  async complete(r: CompletionRequest) { this.calls.push(String(r.body.model)); return { body: { id: "or-1", choices: [] }, usage: { costMicroUsd: parseUsd("0.001"), tokensIn: 1, tokensOut: 1, reasoningTokens: 0, cachedTokens: 0, id: "or-1" } }; }
  async stream(): Promise<never> { throw new Error("not used"); }
}

test("prices from the setting, and the cost of a call from its tokens", () => {
  const p = parsePearlPrices("zai-org/GLM-5.3=0.6/2.2/0.11; pearl/deepseek-ai/DeepSeek-V4-Pro-0813=0.55/2.19, junk, x=abc/1");
  assert.equal(p.size, 2);
  assert.deepEqual(p.get("zai-org/GLM-5.3"), { input: 600_000n, output: 2_200_000n, cached: 110_000n });
  // 800 fresh in at $0.60/M, 200 cached at $0.11/M, 500 out at $2.20/M = 480 + 22 + 1100 µ$
  assert.equal(pearlCost(p.get("zai-org/GLM-5.3")!, { tokensIn: 1000, cachedTokens: 200, tokensOut: 500 }), 1602n);
});

test("bodies are translated to what Pearl accepts, and image links are refused", () => {
  const b = toPearlBody({ model: "pearl/zai-org/GLM-5.3", messages: [{ role: "user", content: "hi" }], reasoning_effort: "high", thinking: { type: "enabled" }, stop: ["a", "b", "c", "d", "e"] }, "zai-org/GLM-5.3");
  assert.equal(b.model, "zai-org/GLM-5.3"); assert.deepEqual(b.reasoning, { effort: "high" });
  assert.equal(b.reasoning_effort, undefined); assert.equal(b.thinking, undefined); assert.equal((b.stop as string[]).length, 4);
  assert.deepEqual(toPearlBody({ messages: [], reasoning: { effort: "low", max_tokens: 512, exclude: true } }, "m").reasoning, { effort: "low", max_tokens: 512 });
  assert.throws(() => toPearlBody({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/y.png" } }] }] }, "m"), /data: URIs/);
  toPearlBody({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }] }, "m");
});

test("pearl/ models go to Pearl and are billed from its token counts; the rest go to the default provider", async () => {
  const { f, seen } = fakePearl(), def = new Default();
  const pearl = new PearlUpstream({ apiKey: "sk-prl-infapi-test", baseUrl: "https://pearl.test/v1", prices: parsePearlPrices("zai-org/GLM-5.3=0.6/2.2/0.11"), fetch: f });
  const up = new RoutedUpstream(def, [{ prefix: "pearl/", upstream: pearl }]);
  const models = await up.models();
  assert.deepEqual(models.map((m) => m.id).sort(), ["openai/gpt-5", "pearl/zai-org/GLM-5.3"], "a Pearl model with no price is not offered");

  const config = makeConfig({ keyPrefix: "trench", token: TOKEN, marginBps: 1000, minDepositMicroUsd: "0.1" });
  const ledger = new Ledger({ store: new MemoryStore(), config });
  const acct = ledger.account("0xabc0000000000000000000000000000000000001");
  ledger.deposit({ accountId: acct.id, source: "chain", ref: "0xdep", tokenUnits: parseUnits("100000", 18) });
  const { secret } = ledger.issueKey({ accountId: acct.id });
  const proxy = new Proxy({ ledger, upstream: up });

  const r = await proxy.chat({ secret, body: { model: "pearl/zai-org/GLM-5.3", messages: [{ role: "user", content: "gm" }], reasoning_effort: "medium" } });
  const sent = seen.find((x) => x.path === "/chat/completions")!.body!;
  assert.equal(sent.model, "zai-org/GLM-5.3"); assert.deepEqual(sent.reasoning, { effort: "medium" }); assert.equal(sent.reasoning_effort, undefined);
  // 2000 in at $0.60/M + 1000 out at $2.20/M = $0.0034, plus the 10% margin = $0.00374
  assert.equal(r.headers["x-icm-cost"], "0.003740");

  const s = await proxy.chat({ secret, body: { model: "pearl/zai-org/GLM-5.3", messages: [{ role: "user", content: "gm" }], stream: true } });
  const text = await new Response(s.stream!).text();
  assert.match(text, /"content":"gm"/);
  assert.deepEqual(seen.at(-1)!.body!.stream_options, { include_usage: true }, "the usage frame is asked for");
  await new Promise((res) => setTimeout(res, 10));
  const charge = ledger.chargeById(s.headers["x-icm-charge"]);
  assert.equal(charge.state, "settled");
  // 800 fresh + 200 cached in, 500 out = 1602 µ$, plus 10% = 1763 (rounded up)
  assert.ok(BigInt(charge.retailMicroUsd) >= 1762n && BigInt(charge.retailMicroUsd) <= 1763n, charge.retailMicroUsd);

  await proxy.chat({ secret, body: { model: "openai/gpt-5", messages: [{ role: "user", content: "gm" }] } });
  assert.deepEqual(def.calls, ["openai/gpt-5"], "other models still go to the default provider");
  await assert.rejects(proxy.chat({ secret, body: { model: "pearl/google/gemma-4-31B-it", messages: [{ role: "user", content: "gm" }] } }), /not|allowed|available/i);
});
