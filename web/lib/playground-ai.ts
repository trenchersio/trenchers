import { ORBIO_BASE, ORBIO_MODEL, orbioKey } from "./agent-mind";
import { ENGINE_URL } from "./constants";
import type { PgAgent } from "./playground";

/**
 * The playground's AI voices: once every few minutes the agents' real stats go to the model, which writes
 * each agent's thought and a few exchanges between agents. Server-side only, cached, so the cost doesn't
 * grow with visitors. Every line is checked: it must name real agents and may only use numbers that are
 * in the agents' real data, so the model can't invent stats.
 */
export type AiThought = { id: number; text: string; mood: "calm" | "hype" | "low" | "wait" };
export type AiTalk = { from: number; to: number; text: string };
export type AiBoard = { thoughts: AiThought[]; talks: AiTalk[]; at: number; model: string };

const SYSTEM = `You write the inner voices of Trenchers: autonomous AI trading agents (each one an NFT) that trade memecoins launched on Pons, a launchpad on Robinhood Chain. Each agent follows the trading rule its holder taught it, within hard limits.
You get each agent's real data. Write in the first person, as the agents themselves: short, witty, a little cocky or a little gloomy depending on how they're doing, like traders in a group chat. Lowercase is fine. No hashtags, no emojis.
Strict rules:
- Use ONLY facts from the data. Never invent numbers, coins, ranks, trades or events. Any number you write must appear in the data.
- Never give financial advice, price predictions or tell people to buy anything. Never mention real people.
- Each thought: max 20 words. Each talk: one agent speaking to another, max 22 words, about something real they share (a coin both traded, their ranks, a rule difference).
Return JSON only: {"thoughts":[{"id":<agent id>,"mood":"calm"|"hype"|"low"|"wait","text":"..."}], "talks":[{"from":<id>,"to":<id>,"text":"..."}]}
Give one thought per agent (up to 16 agents) and 3 to 6 talks.`;

const facts = (a: PgAgent) => ({
  id: a.id, rank: a.rank, pnlThisWeekPct: +a.pnlPct.toFixed(1), valueEth: +a.nav.toFixed(4), tradesThisWeek: a.trades, wins: a.wins, closed: a.closed,
  trading: a.live, status: a.blocked?.text ?? "ready", rule: a.rule ?? "no rule yet", ruleVersion: a.ruleVersion,
  biggestTrade: a.biggest ? `${a.biggest.pct.toFixed(0)}% on $${a.biggest.symbol}` : null,
  recentTrades: a.recent.slice(0, 5).map((t) => `${t.side} $${t.symbol ?? t.token.slice(2, 8)}${t.pnlPct !== undefined ? ` ${t.pnlPct.toFixed(0)}%` : ""}`),
});

/** Every number in the text must appear somewhere in the data the model was given. */
const numbersOk = (text: string, data: string) => (text.match(/\d+(?:[.,]\d+)?/g) ?? []).every((n) => data.includes(n.replace(",", "")) || data.includes(n));

let cache: { at: number; board: AiBoard } | null = null;
let running: Promise<AiBoard | null> | null = null;
export let lastPlaygroundError: string | null = null;

export async function aiBoard(maxAgeMs = 8 * 60_000): Promise<AiBoard | null> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.board;
  if (!orbioKey()) { lastPlaygroundError = "ORBIO_API_KEY is not set"; return cache?.board ?? null; }
  running ??= (async () => {
    try {
      const r = await fetch(`${ENGINE_URL}/arena`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      const j = (await r.json()) as { agents?: PgAgent[] };
      const agents = (j.agents ?? []).slice(0, 16);
      if (!agents.length) return cache?.board ?? null;
      const data = JSON.stringify({ agentsInArena: (j.agents ?? []).length, agents: agents.map(facts) });
      const res = await fetch(`${ORBIO_BASE}/chat/completions`, {
        method: "POST", signal: AbortSignal.timeout(40_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${orbioKey()}` },
        body: JSON.stringify({ model: ORBIO_MODEL, temperature: 0.9, max_tokens: 1800, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: data }] }),
      });
      if (!res.ok) { lastPlaygroundError = `gateway answered ${res.status}`; return cache?.board ?? null; }
      const out = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = out.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { thoughts?: unknown[]; talks?: unknown[] };
      const ids = new Set(agents.map((a) => a.id));
      const moods = ["calm", "hype", "low", "wait"];
      const tidy = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
      const thoughts = (parsed.thoughts ?? []).map((x) => x as Record<string, unknown>)
        .map((x) => ({ id: Number(x.id), mood: (moods.includes(String(x.mood)) ? x.mood : "calm") as AiThought["mood"], text: tidy(x.text, 180) }))
        .filter((x) => ids.has(x.id) && x.text && numbersOk(x.text, data));
      const talks = (parsed.talks ?? []).map((x) => x as Record<string, unknown>)
        .map((x) => ({ from: Number(x.from), to: Number(x.to), text: tidy(x.text, 200) }))
        .filter((x) => ids.has(x.from) && ids.has(x.to) && x.from !== x.to && x.text && numbersOk(x.text, data)).slice(0, 6);
      if (!thoughts.length) { lastPlaygroundError = "the model's answer had no usable lines"; return cache?.board ?? null; }
      const board = { thoughts, talks, at: Date.now(), model: ORBIO_MODEL };
      cache = { at: Date.now(), board }; lastPlaygroundError = null;
      return board;
    } catch (e) { lastPlaygroundError = (e as Error).message.slice(0, 200); return cache?.board ?? null; }
    finally { running = null; }
  })();
  return running;
}
