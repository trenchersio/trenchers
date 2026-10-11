// Mock answers for the inference desk, so the whole section runs locally with INFERENCE_MOCK=1 and no engine.
// Shaped exactly like the engine's answers, so the page is exercised here rather than discovered wrong in production.

const DAY = 86_400_000, HOUR = 3_600_000, MIN = 60_000;
const E18 = 10n ** 18n;
let seed = 4663;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");
const at = (ms: number) => new Date(Date.now() - ms).toISOString();

const TOKEN = "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a";
const DESK = "0x7a1c0e5d2b9f4e83a6d1c2b0f9e8d7c6b5a4f3e2";

const MODELS: [string, string, number][] = [
  ["anthropic/claude-opus-4.1", "Claude Opus 4.1", 200000],
  ["anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5", 1000000],
  ["anthropic/claude-sonnet-4", "Claude Sonnet 4", 200000],
  ["anthropic/claude-haiku-4.5", "Claude Haiku 4.5", 200000],
  ["openai/gpt-5", "GPT-5", 400000],
  ["openai/gpt-5-mini", "GPT-5 mini", 400000],
  ["openai/gpt-5-nano", "GPT-5 nano", 400000],
  ["openai/gpt-4.1", "GPT-4.1", 1047576],
  ["openai/o3", "o3", 200000],
  ["google/gemini-2.5-pro", "Gemini 2.5 Pro", 1048576],
  ["google/gemini-2.5-flash", "Gemini 2.5 Flash", 1048576],
  ["google/gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", 1048576],
  ["x-ai/grok-4", "Grok 4", 256000],
  ["x-ai/grok-4-fast", "Grok 4 Fast", 2000000],
  ["x-ai/grok-code-fast-1", "Grok Code Fast 1", 256000],
  ["deepseek/deepseek-r1", "DeepSeek R1", 163840],
  ["deepseek/deepseek-v3.1", "DeepSeek V3.1", 163840],
  ["deepseek/deepseek-chat", "DeepSeek V3", 163840],
  ["meta-llama/llama-4-maverick", "Llama 4 Maverick", 1048576],
  ["meta-llama/llama-4-scout", "Llama 4 Scout", 327680],
  ["meta-llama/llama-3.3-70b-instruct", "Llama 3.3 70B", 131072],
  ["qwen/qwen3-235b-a22b", "Qwen3 235B", 131072],
  ["qwen/qwen3-coder", "Qwen3 Coder", 262144],
  ["qwen/qwen3-32b", "Qwen3 32B", 40960],
  ["mistralai/mistral-large", "Mistral Large", 128000],
  ["mistralai/mistral-medium-3.1", "Mistral Medium 3.1", 131072],
  ["mistralai/codestral-2508", "Codestral", 256000],
  ["moonshotai/kimi-k2", "Kimi K2", 131072],
  ["moonshotai/kimi-k2-0905", "Kimi K2 0905", 262144],
  ["z-ai/glm-4.5", "GLM 4.5", 131072],
  ["nousresearch/hermes-4-405b", "Hermes 4 405B", 131072],
  ["cohere/command-a", "Command A", 256000],
];

function account() {
  return {
    account: { id: "acct-1", owner: "0x2e81aa0000000000000000000000000000c067aa", balanceMicroUsd: "37412300", heldMicroUsd: "23000", depositedMicroUsd: "50000000", spentMicroUsd: "12587700", suspended: false },
    keys: [
      { id: "key-1", display: "trench_live_9f2c…a41e", label: "trading bot", disabled: false, createdAt: at(9 * DAY), lastUsedAt: at(4 * MIN), spentMicroUsd: "11204400", spendLimitMicroUsd: null, models: [] },
      { id: "key-2", display: "trench_live_1b07…cc92", label: "laptop", disabled: false, createdAt: at(2 * DAY), lastUsedAt: at(6 * HOUR), spentMicroUsd: "1383300", spendLimitMicroUsd: "5000000", models: [] },
      { id: "key-3", display: "trench_live_77d0…02be", label: "old script", disabled: true, createdAt: at(12 * DAY), lastUsedAt: at(10 * DAY), spentMicroUsd: "0", spendLimitMicroUsd: null, models: [] },
    ],
    deposits: [
      { id: "dep-1", createdAt: at(9 * DAY), tokenUnits: (300_000n * E18).toString(), creditedMicroUsd: "30000000", burnTx: `0x${hex(64)}`, ref: `0x${hex(64)}:0` },
      { id: "dep-2", createdAt: at(2 * DAY), tokenUnits: (200_000n * E18).toString(), creditedMicroUsd: "20000000", burnTx: `0x${hex(64)}`, ref: `0x${hex(64)}:0` },
    ],
    charges: [
      { id: "ch-1", at: at(4 * MIN), model: "anthropic/claude-sonnet-4.5", state: "settled", costMicroUsd: "4312", tokensIn: 1840, tokensOut: 622 },
      { id: "ch-2", at: at(38 * MIN), model: "openai/gpt-5", state: "settled", costMicroUsd: "11907", tokensIn: 9120, tokensOut: 1455 },
      { id: "ch-3", at: at(2 * HOUR), model: "anthropic/claude-sonnet-4.5", state: "settled", costMicroUsd: "2044", tokensIn: 740, tokensOut: 310 },
      { id: "ch-4", at: at(5 * HOUR), model: "google/gemini-2.5-pro", state: "settled", costMicroUsd: "890", tokensIn: 512, tokensOut: 204 },
      { id: "ch-5", at: at(7 * HOUR), model: "deepseek/deepseek-r1", state: "held", costMicroUsd: "0", tokensIn: 2200, tokensOut: 0 },
    ],
  };
}

/** A believable order book: asks above, bids below, a few agent coins besides $TRENCHERS. */
export function mockOrders() {
  seed = 99;
  const coins = [
    { token: TOKEN, symbol: "TRENCHERS", verified: true, agent: null as number | null, mid: 0.0000001 },
    { token: "0x51e0c3b1a5d4f2e9871b2c3d4e5f60718293a4b5", symbol: "T12", verified: true, agent: 12, mid: 0.00000042 },
    { token: "0x8f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f50", symbol: "BOOT", verified: true, agent: 418, mid: 0.00000018 },
    { token: "0x1234abcd5678ef901234abcd5678ef901234abcd", symbol: "FROG", verified: false, agent: null, mid: 0.0000009 },
  ];
  const out = [];
  let id = 1;
  for (const c of coins) {
    const n = c.symbol === "TRENCHERS" ? 7 : 3;
    for (const side of ["ask", "bid"] as const) {
      for (let i = 0; i < n; i++) {
        const step = 1 + (i + 1) * (0.012 + rnd() * 0.02);
        const price = side === "ask" ? c.mid * step : c.mid / step;
        const amount = Math.round((40_000 + rnd() * 900_000) / 1000) * 1000;
        const left = rnd() < 0.3 ? Math.round(amount * (0.3 + rnd() * 0.6) / 1000) * 1000 : amount;
        const ethTotal = amount * price;
        out.push({
          id: id++, side, token: c.token, symbol: c.symbol, verified: c.verified, agent: c.agent,
          maker: `0x${hex(40)}`,
          tokenTotal: (BigInt(amount) * E18).toString(),
          tokenLeft: (BigInt(left) * E18).toString(),
          ethTotal: BigInt(Math.round(ethTotal * 1e18)).toString(),
          createdAt: at(Math.floor(rnd() * 3 * DAY)),
          expiresAt: rnd() < 0.5 ? null : new Date(Date.now() + Math.floor((0.2 + rnd() * 6) * DAY)).toISOString(),
          taker: i === 2 && side === "ask" && c.symbol === "TRENCHERS" ? `0x${hex(40)}` : null,
        });
      }
    }
  }
  return out;
}

/** The last fills, newest first, for the tape under the book. */
function mockFills() {
  seed = 7;
  return Array.from({ length: 14 }, (_, i) => {
    const side = rnd() < 0.55 ? "buy" : "sell";
    const amount = Math.round((10_000 + rnd() * 400_000) / 1000) * 1000;
    const price = 0.0000001 * (1 + (rnd() - 0.5) * 0.06);
    return {
      id: `f${i}`, side, symbol: "TRENCHERS", token: TOKEN,
      tokenAmount: (BigInt(amount) * E18).toString(),
      ethAmount: BigInt(Math.round(amount * price * 1e18)).toString(),
      at: at(i * (7 + Math.floor(rnd() * 40)) * MIN),
      toDesk: rnd() < 0.3,
    };
  });
}

export function mockInference(method: string, path: string, body: Record<string, unknown> | undefined): { status: number; json: unknown } {
  const ok = (json: unknown) => ({ status: 200, json });
  const p = path.split("?")[0];
  if (p === "/icm") return ok({
    mock: true, enabled: true, reason: null,
    endpoint: "https://inference.trenchers.io/v1",
    keyPrefix: "trench",
    rate: { tokensPerUsd: "10000", symbol: "TRENCHERS" },
    deposit: {
      address: DESK, token: TOKEN, symbol: "TRENCHERS", chainId: 4663, decimals: 18, tokensPerUsd: "10000", minimumTokens: "10000", burns: true,
      note: "Send $TRENCHERS to this address and it is burned: credit is bought by taking the token out of supply for good. The credit lands on the wallet that sent it.",
    },
    router: "0x3f1d0000000000000000000000000000000c0de1",
    otc: "0x0dc0000000000000000000000000000000000c7c",
  });
  if (p === "/icm/stats") {
    seed = 3;
    const days = Array.from({ length: 14 }, (_, i) => (BigInt(Math.round((60_000 + rnd() * 240_000) * (0.5 + i / 14))) * E18).toString());
    return ok({ burnedTokens: days.reduce((a, d) => a + BigInt(d), 0n).toString(), calls: 48213, accounts: 212, models: MODELS.length, burnedByDay: days });
  }
  if (p === "/icm/v1/models") return ok({ object: "list", data: MODELS.map(([id, name, c]) => ({ id, object: "model", name, context_length: c })) });
  if (p === "/icm/nonce") return ok({ nonce: hex(32), message: `Trenchers Inference Markets\n\nSign in to manage your inference keys.\n\nNonce: ${hex(16)}` });
  if (p === "/icm/account") return ok(account());
  if (p === "/icm/keys" && method === "POST") return { status: 201, json: { secret: `trench_live_${hex(48)}`, key: { id: `key-${hex(4)}`, display: `trench_live_${hex(4)}…${hex(4)}`, label: (body?.label as string) ?? null, disabled: false, createdAt: new Date().toISOString(), lastUsedAt: null, spentMicroUsd: "0", spendLimitMicroUsd: body?.spendLimitUsd ? String(Math.round(Number(body.spendLimitUsd) * 1e6)) : null, models: [] } } };
  if (/^\/icm\/keys\/[^/]+\/revoke$/.test(p)) return ok({ revoked: p.split("/")[3] });
  if (p === "/icm/otc/orders") return ok({ orders: mockOrders(), fills: mockFills() });
  return { status: 404, json: { error: "not_found", detail: `No mock for ${method} ${p}` } };
}
