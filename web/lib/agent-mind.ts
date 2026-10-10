import { describe, parse, validate, isAddress, DEFAULT_RULE, type CustomRule, type CustomTrigger } from "./custom-strategy";
import { TOKEN_PICKS } from "./token-picks";

/**
 * The agent's mind: an AI model (through Orbio's inference gateway) reads what the holder says and
 * turns it into an exact trading rule, explaining what it understood. It only proposes: the holder
 * applies the rule, the rule is stored on-chain as plain text, and the engine trades it within the
 * wallet's hard limits. The AI never touches funds.
 */
export const ORBIO_BASE = (process.env.ORBIO_BASE_URL || "https://api.orbio.so/api/v1").replace(/\/$/, "");
export const ORBIO_MODEL = process.env.ORBIO_MODEL || "anthropic/claude-sonnet-5.5";
/** The model actually used: ORBIO_MODEL, or (if the gateway says it doesn't exist) the closest one it lists. */
export let orbioModel = ORBIO_MODEL;
async function pickModel(): Promise<string | null> {
  const r = await fetch(`${ORBIO_BASE}/models`, { headers: { authorization: `Bearer ${orbioKey()}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null) as { data?: { id?: string }[]; models?: { id?: string }[] } | null;
  const ids = (j?.data ?? j?.models ?? []).map((m) => String(m.id ?? "")).filter(Boolean);
  return ids.find((i) => /claude/i.test(i) && /sonnet/i.test(i)) ?? ids.find((i) => /claude/i.test(i)) ?? ids[0] ?? null;
}
/** One chat completion through Orbio. If the configured model isn't found (404), switches to one the gateway lists and retries once. */
export async function orbioChat(body: Record<string, unknown>, timeoutMs: number): Promise<{ content: string; model: string }> {
  const call = (model: string) => fetch(`${ORBIO_BASE}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json", authorization: `Bearer ${orbioKey()}` },
    body: JSON.stringify({ ...body, model }),
  });
  let r = await call(orbioModel);
  if (r.status === 404 || r.status === 400) {
    const first = (await r.text()).slice(0, 300);
    const alt = await pickModel();
    if (alt && alt !== orbioModel) { console.error(`orbio: model ${orbioModel} not available (${r.status}), switching to ${alt}`); orbioModel = alt; r = await call(alt); }
    else throw new Error(`gateway answered ${r.status}: ${first}${alt === null ? " (and it lists no models at /models: check ORBIO_BASE_URL)" : ""}`);
  }
  if (!r.ok) throw new Error(`gateway answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json() as { choices?: { message?: { content?: string } }[] };
  return { content: j.choices?.[0]?.message?.content ?? "", model: orbioModel };
}

export type MindReply = { reply: string; rule: CustomRule | null; understood: string[]; source: "ai" | "rules" };

const TRIGGERS: CustomTrigger[] = ["launch", "graduation", "volume", "mcap", "devsell", "token"];

const SYSTEM = `You are the mind of a Trenchers trading agent: an autonomous agent that trades memecoins launched on Pons (a launchpad on Robinhood Chain). Its holder talks to you in plain language; you turn what they want into ONE exact trading rule, and explain it briefly.

The rule must fit this schema exactly (JSON):
{
  "trigger": "launch" | "graduation" | "volume" | "mcap" | "devsell" | "token",
  "threshold": number | null,      // volume: lifetime volume in USD (e.g. 50000); mcap: market cap in ETH (e.g. 5); token "below": market cap in ETH; otherwise null
  "exit": "time" | "tpsl" | "hold",// sell after a fixed time, OR on take profit / stop loss, OR (trigger "token" only) hold: never sell automatically
  "holdSec": number | null,        // exit "time": seconds to hold (>= 1)
  "takeProfitPct": number | null,  // exit "tpsl": e.g. 40 for +40%
  "stopLossPct": number | null,    // exit "tpsl": e.g. 20 for -20%
  "maxAgeMin": number | null,      // only coins launched in the last N minutes
  "minLiquidityEth": number | null,// only coins with at least this much ETH in their curve
  "token": string | null,          // trigger "token": the coin's address (0x + 40 hex)
  "tokenMode": "once" | "dca" | "below" | null, // trigger "token": buy once now; DCA on a schedule; or buy when its market cap is below threshold
  "dcaDays": number | null,        // tokenMode "dca": spread the buys over this many days
  "everyHours": number | null,     // "dca": hours between buys (default 24, or 4 for plans under 2 days); "below": at least this many hours between buys (default 6)
  "budgetEth": number | null       // trigger "token", optional: total ETH to spend on the plan (the only place an ETH amount is allowed)
}
Specific token (trigger "token"): the holder names ONE coin to accumulate, e.g. "DCA into $ORBIO over 10 days" or "buy $AI when its market cap is under 20 ETH". It must be a Pons coin; use the address the holder gives, or one of these known coins: ${TOKEN_PICKS.map((p) => `$${p.symbol} ${p.address}`).join(", ")}. If they name a coin you don't have an address for, ask for its contract address. Default exit for a specific token is "hold". Filters (maxAgeMin, minLiquidityEth) don't apply to it.
Signals: launch = a new coin launches; graduation = a coin's curve sells out and it moves to Uniswap; volume = a coin crosses a lifetime volume in USD; mcap = a coin's market cap crosses a value in ETH; devsell = the coin's creator sells.
Only one exit type: either a holding time, or take profit and/or stop loss. Spending limits per trade and per day are set separately by the holder; never put amounts of ETH to spend in the rule.
If the holder asks for something the schema can't express, choose the closest rule and say plainly what you left out. If you need one essential detail, ask one short question and return "rule": null.
Reply with JSON only: {"reply": "<one to three short sentences to the holder, friendly and concrete>", "understood": ["<short bullet>", ...], "rule": <rule or null>}`;

function clean(r: unknown): CustomRule | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && isFinite(v) && v > 0 ? +v.toFixed(4) : null);
  const trigger = TRIGGERS.includes(o.trigger as CustomTrigger) ? (o.trigger as CustomTrigger) : null;
  if (!trigger) return null;
  const token = trigger === "token" && typeof o.token === "string" && isAddress(o.token) ? o.token.toLowerCase() : null;
  if (trigger === "token" && !token) return null;
  const mode = o.tokenMode === "dca" || o.tokenMode === "below" ? o.tokenMode : "once";
  const exit = o.exit === "tpsl" ? "tpsl" : o.exit === "hold" && token ? "hold" : token && o.exit !== "time" ? "hold" : "time";
  if (token) {
    const rule: CustomRule = {
      ...DEFAULT_RULE, trigger, token, tokenMode: mode, exit,
      threshold: mode === "below" ? n(o.threshold) : null,
      dcaDays: mode === "dca" ? n(o.dcaDays) ?? 7 : null,
      everyHours: mode === "once" ? null : n(o.everyHours) ?? (mode === "below" ? 6 : (n(o.dcaDays) ?? 7) >= 2 ? 24 : 4),
      budgetEth: n(o.budgetEth),
      holdSec: exit === "time" ? (n(o.holdSec) ? Math.round(n(o.holdSec)!) : null) : null,
      takeProfitPct: exit === "tpsl" ? n(o.takeProfitPct) : null,
      stopLossPct: exit === "tpsl" ? n(o.stopLossPct) : null,
      maxAgeMin: null, minLiquidityEth: null,
    };
    if (validate(rule)) return null;
    const text = describe(rule);
    return describe(parse(text).rule) === text ? parse(text).rule : null;
  }
  const rule: CustomRule = {
    ...DEFAULT_RULE, trigger,
    threshold: trigger === "volume" || trigger === "mcap" ? n(o.threshold) : null,
    exit,
    holdSec: exit === "time" ? (n(o.holdSec) ? Math.round(n(o.holdSec)!) : null) : null,
    takeProfitPct: exit === "tpsl" ? n(o.takeProfitPct) : null,
    stopLossPct: exit === "tpsl" ? n(o.stopLossPct) : null,
    maxAgeMin: n(o.maxAgeMin) ? Math.round(n(o.maxAgeMin)!) : null,
    minLiquidityEth: n(o.minLiquidityEth),
  };
  if (validate(rule)) return null;
  // The rule is stored on-chain as its description and read back by the engine: it must survive that exactly.
  const text = describe(rule);
  if (describe(parse(text).rule) !== text) return null;
  return rule;
}

/** Asks the model. Returns null when no key is configured or the model's answer can't be used. */
/** The last thing that went wrong talking to the gateway (never contains the key), for the status page. */
export let lastMindError: string | null = null;
export const orbioKey = () => (process.env.ORBIO_API_KEY ?? "").trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "");
export async function askMind(message: string, current: CustomRule | null, context?: string): Promise<MindReply | null> {
  const key = orbioKey();
  if (!key) return null;
  const user = [
    current ? `The agent's current rule: ${describe(current)} (as JSON: ${JSON.stringify(current)})` : "The agent has no rule yet.",
    context ? `Recent performance: ${context}` : "",
    `The holder says: """${message.slice(0, 600)}"""`,
  ].filter(Boolean).join("\n");
  try {
    const { content: raw } = await orbioChat({ temperature: 0.2, max_tokens: 500, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }] }, 20_000);
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { reply?: string; understood?: unknown; rule?: unknown };
    const rule = json.rule === null ? null : clean(json.rule);
    if (json.rule !== null && !rule) { lastMindError = "model answered, but its rule didn't validate"; return null; } // let the plain reader handle it
    lastMindError = null;
    return {
      reply: String(json.reply ?? "").slice(0, 600) || (rule ? "Here's the rule I'd trade." : "Could you tell me a bit more?"),
      understood: Array.isArray(json.understood) ? json.understood.map(String).slice(0, 6) : [],
      rule, source: "ai",
    };
  } catch (e) {
    lastMindError = /abort|timeout/i.test((e as Error).name) ? "gateway timed out (20s)" : (e as Error).message.slice(0, 300);
    console.error("agent-mind:", lastMindError);
    return null;
  }
}
