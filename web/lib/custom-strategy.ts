/**
 * Custom strategies: a buy signal with an optional threshold, an exit rule and optional filters.
 * Talking to the agent goes through its AI mind first (lib/agent-mind.ts, a model via Orbio), which
 * proposes a rule in this exact schema; this deterministic reader is the fallback, and it is also how
 * the engine reads every rule back from the chain. The holder reviews and applies every rule; trading
 * itself is rule-based and capped by the wallet.
 */
export type CustomTrigger = "launch" | "graduation" | "volume" | "devsell" | "dexupdate" | "mcap";
export type CustomRule = {
  trigger: CustomTrigger;
  threshold: number | null;       // volume: USD; mcap: ETH
  exit: "time" | "tpsl";
  holdSec: number | null;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  maxAgeMin: number | null;       // only tokens launched in the last N minutes
  minLiquidityEth: number | null;
};

export const TRIGGERS: { key: CustomTrigger; label: string; unit?: string; defaultThreshold?: number }[] = [
  { key: "launch", label: "New launch" },
  { key: "graduation", label: "Graduates" },
  { key: "volume", label: "Volume crosses", unit: "USD", defaultThreshold: 50_000 },
  { key: "mcap", label: "Market cap crosses", unit: "ETH", defaultThreshold: 5 },
  { key: "devsell", label: "Dev sells" },
  { key: "dexupdate", label: "DexScreener update" },
];

export const DEFAULT_RULE: CustomRule = {
  trigger: "launch", threshold: null, exit: "time", holdSec: 60, takeProfitPct: null, stopLossPct: null, maxAgeMin: null, minLiquidityEth: null,
};

const fmtHold = (s: number) => (s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60} min` : `${s}s`);
const fmtUsd = (v: number) => (v >= 1000 ? `$${+(v / 1000).toFixed(1)}k` : `$${v}`);

/** One-line description, also used as the strategy summary in the Arena. */
export function describe(r: CustomRule): string {
  const t = TRIGGERS.find((x) => x.key === r.trigger)!;
  let buy = {
    launch: "Buy every new Pons launch",
    graduation: "Buy every launch that graduates",
    volume: `Buy when a token crosses ${fmtUsd(r.threshold ?? t.defaultThreshold!)} lifetime volume`,
    mcap: `Buy when a token's market cap crosses ${r.threshold ?? t.defaultThreshold} ETH`,
    devsell: "Buy every time a token's dev sells",
    dexupdate: "Buy every DexScreener update",
  }[r.trigger];
  const filters: string[] = [];
  if (r.maxAgeMin) filters.push(`launched in the last ${r.maxAgeMin} min`);
  if (r.minLiquidityEth) filters.push(`liquidity above ${r.minLiquidityEth} ETH`);
  if (filters.length) buy += ` (${filters.join(", ")})`;
  let sell: string;
  if (r.exit === "time") sell = `sell after ${fmtHold(r.holdSec ?? 60)}`;
  else {
    const parts = [];
    if (r.takeProfitPct) parts.push(`take profit at +${r.takeProfitPct}%`);
    if (r.stopLossPct) parts.push(`stop loss at -${r.stopLossPct}%`);
    sell = parts.length ? parts.join(", ") : "no exit set";
  }
  return `${buy}, ${sell}.`;
}

export function validate(r: CustomRule): string | null {
  if ((r.trigger === "volume" || r.trigger === "mcap") && !(r.threshold && r.threshold > 0)) return "Set the threshold for this signal.";
  if (r.exit === "time" && !(r.holdSec && r.holdSec >= 1)) return "Set how long to hold, at least 1 second.";
  if (r.exit === "tpsl" && !r.takeProfitPct && !r.stopLossPct) return "Set a take profit, a stop loss, or both.";
  return null;
}

function num(s: string) {
  const m = s.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k|m)?/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return m[2]?.toLowerCase() === "k" ? v * 1_000 : m[2]?.toLowerCase() === "m" ? v * 1_000_000 : v;
}

/** Reads plain English into a rule. Returns the rule and what it could not place. */
export function parse(text: string, base: CustomRule = DEFAULT_RULE): { rule: CustomRule; understood: string[]; missed: boolean } {
  const s = text.toLowerCase();
  const r: CustomRule = { ...base };
  const understood: string[] = [];

  if (/dex ?screener/.test(s)) { r.trigger = "dexupdate"; understood.push("signal: DexScreener update"); }
  else if (/dev(eloper)?s? (sell|sold|dump)/.test(s) || /dev dump/.test(s)) { r.trigger = "devsell"; understood.push("signal: dev sells"); }
  else if (/graduat/.test(s)) { r.trigger = "graduation"; understood.push("signal: graduation"); }
  else if (/volume/.test(s)) {
    r.trigger = "volume";
    const m = s.match(/\$?\s*(\d[\d,.]*\s*[km]?)\s*(?:usd|dollars?)?\s*(?:lifetime\s*)?volume|volume[^0-9$]*\$?\s*(\d[\d,.]*\s*[km]?)/);
    r.threshold = num(m?.[1] ?? m?.[2] ?? "") ?? 50_000;
    understood.push(`signal: volume crosses $${r.threshold.toLocaleString()}`);
  } else if (/market ?cap|mcap/.test(s)) {
    r.trigger = "mcap";
    const m = s.match(/(?:market ?cap|mcap)[^0-9]*(\d[\d,.]*\s*[km]?)/);
    r.threshold = num(m?.[1] ?? "") ?? 5;
    understood.push(`signal: market cap crosses ${r.threshold} ETH`);
  } else if (/launch|new token|every token|new coin/.test(s.replace(/launched (in|within) the last[^,.]*/g, ""))) { r.trigger = "launch"; understood.push("signal: new launch"); }

  const hold = s.match(/(?:after|hold(?:ing)?(?: for)?|for)\s*(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/);
  if (hold) {
    const v = parseFloat(hold[1]); const u = hold[2][0];
    r.exit = "time"; r.holdSec = Math.round(u === "h" ? v * 3600 : u === "m" ? v * 60 : v);
    understood.push(`exit: after ${fmtHold(r.holdSec)}`);
  }
  const tp = s.match(/(?:take profit|tp|profit)\s*(?:at|of)?\s*\+?(\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)\s*x\b/);
  if (tp) {
    if (r.exit !== "tpsl") { r.exit = "tpsl"; r.stopLossPct = null; }
    r.takeProfitPct = tp[1] ? parseFloat(tp[1]) : Math.round((parseFloat(tp[2]) - 1) * 100);
    understood.push(`take profit: +${r.takeProfitPct}%`);
  }
  const sl = s.match(/(?:stop ?loss|sl|cut)\s*(?:at|of)?\s*-?(\d+(?:\.\d+)?)\s*%/);
  if (sl) { if (r.exit !== "tpsl") { r.exit = "tpsl"; r.takeProfitPct = tp ? r.takeProfitPct : null; } r.stopLossPct = parseFloat(sl[1]); understood.push(`stop loss: -${r.stopLossPct}%`); }
  if (r.exit === "tpsl" && hold) r.holdSec = null;

  const age = s.match(/(?:younger than|launched in the last|newer than|under)\s*(\d+)\s*(minutes?|mins?|m|hours?|h)\b/);
  if (age) { r.maxAgeMin = parseInt(age[1]) * (age[2][0] === "h" ? 60 : 1); understood.push(`only tokens launched in the last ${r.maxAgeMin} min`); }
  const liqM = s.match(/liquidity\s*(?:above|over|>|of at least|of more than|more than|at least)?\s*(\d+(?:\.\d+)?)\s*eth/) ?? s.match(/(?:more than|over|above|at least|>)?\s*(\d+(?:\.\d+)?)\s*eth\s*(?:of\s*)?liquidity/);
  const liq = liqM;
  if (liq) { r.minLiquidityEth = parseFloat(liq[1]); understood.push(`liquidity above ${r.minLiquidityEth} ETH`); }

  return { rule: r, understood, missed: understood.length === 0 };
}
