/**
 * The provider's own cost is what the house paid. It must never reach a caller: not in a plain response, and not
 * in the usage frame at the end of a stream (where it arrives split across chunks however the network likes).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { OpenRouterUpstream } from "../../src/icm/index.ts";

const frames = [
  `data: ${JSON.stringify({ id: "gen-1", choices: [{ delta: { content: "g" } }] })}\n\n`,
  `data: ${JSON.stringify({ id: "gen-1", choices: [{ delta: { content: "m" } }] })}\n\n`,
  `data: ${JSON.stringify({ id: "gen-1", choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, cost: 0.00042, cost_details: { upstream_inference_cost: 0.0004 }, is_byok: false } })}\n\n`,
  "data: [DONE]\n\n",
].join("");

function fakeFetch(): typeof fetch {
  return (async () => {
    const bytes = new TextEncoder().encode(frames);
    // deliver in awkward 7-byte pieces so frames are split mid-JSON
    const body = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
}

test("a stream reaches the caller whole, with the provider's cost taken out of the usage frame", async () => {
  const up = new OpenRouterUpstream({ apiKey: "k", fetch: fakeFetch() });
  const { stream, usage } = await up.stream({ body: { model: "x/y", messages: [] } });
  const reader = stream.getReader();
  let text = "";
  for (;;) { const { done, value } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); }
  assert.ok(text.includes('"content":"g"') && text.includes('"content":"m"'), "every token frame arrives");
  assert.ok(text.includes("[DONE]"), "the end marker arrives");
  assert.ok(!/"cost"|cost_details|upstream_inference_cost|is_byok/.test(text), "no provider cost in anything the caller reads");
  assert.ok(text.includes('"prompt_tokens":3'), "token counts are kept");
  const u = await usage;
  assert.equal(u.costMicroUsd, 420n, "the house still reads the provider's cost for billing");
  assert.equal(u.tokensIn, 3);
});
