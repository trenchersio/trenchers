import { describe, parse, validate, DEFAULT_RULE, type CustomRule, type CustomTrigger } from "./custom-strategy";

/**
 * The agent's mind: an AI model (through Orbio's inference gateway) reads what the holder says and
 * turns it into an exact trading rule, explaining what it understood. It only proposes: the holder
 * applies the rule, the rule is stored on-chain as plain text, and the engine trades it within the
 * wallet's hard limits. The AI never touches funds.
 */
export const ORBIO_BASE = (process.env.ORBIO_BASE_URL || "https://api.orbio.so/api/v1").replace(/\/$/, "");
export const ORBIO_MODEL = process.env.ORBIO_MODEL || "anthropic/claude-sonnet-5.5";

export type MindReply = { reply: string; rule: CustomRule | null; understood: string[]; source: "ai" | "rules" };

const TRIGGERS: CustomTrigger[] = ["launch", "graduation", "volume", "mcap", "devsell"];

const SYSTEM = `You are the mind of a Trenchers trading agent: an autonomous agent that trades memecoins launched on Pons (a launchpad on Robinhood Chain). Its holder talks to you in plain language; you turn what they want into ONE exact trading rule, and explain it briefly.

The rule must fit this schema exactly (JSON):
{
  "trigger": "launch" | "graduation" | "volume" | "mcap" | "devsell",
  "threshold": number | null,      // volume: lifetime volume in USD (e.g. 50000); mcap: market cap in ETH (e.g. 5); otherwise null
  "exit": "time" | "tpsl",         // sell after a fixed time, OR on take profit / stop loss
  "holdSec": number | null,        // exit "time": seconds to hold (>= 1)
  "takeProfitPct": number | null,  // exit "tpsl": e.g. 40 for +40%
  "stopLossPct": number | null,    // exit "tpsl": e.g. 20 for -20%
  "maxAgeMin": number | null,      // only coins launched in the last N minutes
  "minLiquidityEth": number | null // only coins with at least this much ETH in their curve
}
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
  const exit = o.exit === "tpsl" ? "tpsl" : "time";
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
export async function askMind(message: string, current: CustomRule | null, context?: string): Promise<MindReply | null> {
  const key = process.env.ORBIO_API_KEY;
  if (!key) return null;
  const user = [
    current ? `The agent's current rule: ${describe(current)} (as JSON: ${JSON.stringify(current)})` : "The agent has no rule yet.",
    context ? `Recent performance: ${context}` : "",
    `The holder says: """${message.slice(0, 600)}"""`,
  ].filter(Boolean).join("\n");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const r = await fetch(`${ORBIO_BASE}/chat/completions`, {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: ORBIO_MODEL, temperature: 0.2, max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      }),
    });
    if (!r.ok) { console.error("agent-mind: gateway", r.status, (await r.text()).slice(0, 300)); return null; }
    const j = await r.json() as { choices?: { message?: { content?: string } }[] };
    const raw = j.choices?.[0]?.message?.content ?? "";
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { reply?: string; understood?: unknown; rule?: unknown };
    const rule = json.rule === null ? null : clean(json.rule);
    if (json.rule !== null && !rule) return null; // unusable rule: let the plain reader handle it
    return {
      reply: String(json.reply ?? "").slice(0, 600) || (rule ? "Here's the rule I'd trade." : "Could you tell me a bit more?"),
      understood: Array.isArray(json.understood) ? json.understood.map(String).slice(0, 6) : [],
      rule, source: "ai",
    };
  } catch (e) {
    console.error("agent-mind:", (e as Error).message);
    return null;
  } finally { clearTimeout(timer); }
}
