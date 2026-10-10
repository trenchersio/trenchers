/**
 * Custom strategies: a buy signal with an optional threshold, an exit rule and optional filters.
 * The plain-English parser is a deterministic keyword reader (no AI in the trading path): it only
 * fills the form, and the holder reviews and saves the result.
 */
export type CustomTrigger = "launch" | "graduation" | "volume" | "devsell" | "dexupdate" | "mcap" | "token";
/** Specific token: buy it once, DCA into it on a schedule, or buy whenever its market cap is below a level. */
export type TokenMode = "once" | "dca" | "below";
export type CustomRule = {
  trigger: CustomTrigger;
  threshold: number | null;       // volume: USD; mcap: ETH; token "below": market cap in ETH
  exit: "time" | "tpsl" | "hold"; // hold: never sold automatically (specific token only)
  holdSec: number | null;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  maxAgeMin: number | null;       // only tokens launched in the last N minutes
  minLiquidityEth: number | null;
  /** Specific token strategy (trigger "token"). Optional so older saved rules stay valid. */
  token?: string | null;          // the Pons coin's address (lowercase)
  tokenMode?: TokenMode | null;
  dcaDays?: number | null;        // dca: spread the buys over this many days
  everyHours?: number | null;     // dca: one buy every N hours; below: at most one buy every N hours
  budgetEth?: number | null;      // optional total to spend; each buy is the per-trade limit or less
};

export const TRIGGERS: { key: CustomTrigger; label: string; unit?: string; defaultThreshold?: number }[] = [
  { key: "launch", label: "New launch" },
  { key: "graduation", label: "Graduates" },
  { key: "volume", label: "Volume crosses", unit: "USD", defaultThreshold: 50_000 },
  { key: "mcap", label: "Market cap crosses", unit: "ETH", defaultThreshold: 5 },
  { key: "devsell", label: "Dev sells" },
  { key: "dexupdate", label: "DexScreener update" },
  { key: "token", label: "Specific token" },
];

export const DEFAULT_RULE: CustomRule = {
  trigger: "launch", threshold: null, exit: "time", holdSec: 60, takeProfitPct: null, stopLossPct: null, maxAgeMin: null, minLiquidityEth: null,
  token: null, tokenMode: null, dcaDays: null, everyHours: null, budgetEth: null,
};
const NO_TOKEN = { token: null, tokenMode: null, dcaDays: null, everyHours: null, budgetEth: null } as const;
export const isAddress = (a: string | null | undefined): a is string => !!a && /^0x[0-9a-fA-F]{40}$/.test(a);
/** Default spacing between buys: daily for multi-day DCA, every 4 hours for shorter ones; 6 hours between dip buys. */
export const defaultEvery = (r: Pick<CustomRule, "tokenMode" | "dcaDays">) => (r.tokenMode === "below" ? 6 : (r.dcaDays ?? 7) >= 2 ? 24 : 4);
/** How many buys a DCA plan makes in total. */
export const dcaBuys = (r: CustomRule) => Math.max(1, Math.floor(((r.dcaDays ?? 0) * 24) / (r.everyHours ?? defaultEvery(r))));

const fmtHold = (s: number) => (s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60} min` : `${s}s`);
const fmtUsd = (v: number) => (v >= 1000 ? `$${+(v / 1000).toFixed(1)}k` : `$${v}`);
/** "every day", "every 2 days", "every 6h", "every 30 min" */
export const fmtEvery = (h: number) => (h < 1 ? `every ${Math.round(h * 60)} min` : h === 24 ? "every day" : h % 24 === 0 ? `every ${h / 24} days` : `every ${+h.toFixed(2)}h`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function describeToken(r: CustomRule): string {
  const a = (r.token ?? "").toLowerCase();
  const budget = r.budgetEth ? `, up to ${r.budgetEth} ETH in total` : "";
  if (r.tokenMode === "dca") return `Buy token ${a} ${fmtEvery(r.everyHours ?? defaultEvery(r))} for ${plural(r.dcaDays ?? 7, "day")}${budget}`;
  if (r.tokenMode === "below") return `Buy token ${a} when its market cap is below ${r.threshold} ETH, at most ${fmtEvery(r.everyHours ?? defaultEvery(r))}${budget}`;
  return `Buy token ${a} once${budget}`;
}

/** One-line description, also used as the strategy summary in the Arena. */
export function describe(r: CustomRule): string {
  const t = TRIGGERS.find((x) => x.key === r.trigger)!;
  if (r.trigger === "token") return `${describeToken(r)}, ${sellText(r)}.`;
  let buy = {
    launch: "Buy every new Pons launch",
    graduation: "Buy every launch that graduates",
    volume: `Buy when a token crosses ${fmtUsd(r.threshold ?? t.defaultThreshold!)} lifetime volume`,
    mcap: `Buy when a token's market cap crosses ${r.threshold ?? t.defaultThreshold} ETH`,
    devsell: "Buy every time a token's dev sells",
    dexupdate: "Buy every DexScreener update",
    token: "",
  }[r.trigger];
  const filters: string[] = [];
  if (r.maxAgeMin) filters.push(`launched in the last ${r.maxAgeMin} min`);
  if (r.minLiquidityEth) filters.push(`liquidity above ${r.minLiquidityEth} ETH`);
  if (filters.length) buy += ` (${filters.join(", ")})`;
  return `${buy}, ${sellText(r)}.`;
}

function sellText(r: CustomRule): string {
  if (r.exit === "hold") return "hold it (no automatic sell)";
  if (r.exit === "time") return `sell after ${fmtHold(r.holdSec ?? 60)}`;
  const parts = [];
  if (r.takeProfitPct) parts.push(`take profit at +${r.takeProfitPct}%`);
  if (r.stopLossPct) parts.push(`stop loss at -${r.stopLossPct}%`);
  return parts.length ? parts.join(", ") : "no exit set";
}

export function validate(r: CustomRule): string | null {
  if (r.trigger === "token") {
    if (!isAddress(r.token)) return "Paste the token's contract address (0x followed by 40 characters).";
    if (r.tokenMode === "dca" && !(r.dcaDays && r.dcaDays > 0)) return "Set over how many days to spread the buys.";
    if (r.tokenMode === "dca" && r.everyHours && r.dcaDays && r.everyHours > r.dcaDays * 24) return "The time between buys is longer than the whole plan.";
    if (r.tokenMode === "below" && !(r.threshold && r.threshold > 0)) return "Set the market cap (in ETH) to buy below.";
    if (r.everyHours !== null && r.everyHours !== undefined && r.everyHours < 0.25) return "Leave at least 15 minutes between buys.";
  } else if (r.exit === "hold") return "Holding without an exit is only for a specific token.";
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
  const full = text.toLowerCase();
  const r: CustomRule = { ...DEFAULT_RULE, ...base };
  const understood: string[] = [];
  const addr = full.match(/0x[0-9a-f]{40}/)?.[0] ?? null;
  // The address is read separately, so its digits never count as amounts or times.
  const s = addr ? full.split(addr).join(" ") : full;
  if (addr) {
    const wasToken = r.trigger === "token";
    Object.assign(r, { trigger: "token", token: addr, maxAgeMin: null, minLiquidityEth: null });
    if (!wasToken) Object.assign(r, { tokenMode: "once", dcaDays: null, everyHours: null, budgetEth: null, threshold: null, exit: "hold", holdSec: null, takeProfitPct: null, stopLossPct: null });
    understood.push(`token: ${addr.slice(0, 6)}…${addr.slice(-4)}`);
    const below = s.match(/(?:below|under|less than|beneath|dips? (?:below|under)|drops? (?:below|under))\s*(?:a\s+)?(?:market ?cap(?: of)?\s*|mcap(?: of)?\s*)?(\d[\d,.]*\s*[km]?)\s*eth/);
    const days = s.match(/(?:for|over|during|across)\s*(\d+(?:\.\d+)?)\s*(days?|d|weeks?|w)\b/);
    const every = s.match(/every\s*(\d+(?:\.\d+)?)?\s*(minutes?|mins?|min|hours?|hrs?|h|days?|d|weeks?|w)\b/);
    const budget = s.match(/(?:up to|max(?:imum)?(?: of)?|budget(?: of)?|total(?: of)?|spend)\s*(\d+(?:\.\d+)?)\s*eth/) ?? s.match(/(\d+(?:\.\d+)?)\s*eth\s*(?:in total|total)/);
    if (below && /market ?cap|mcap/.test(s)) {
      r.tokenMode = "below"; r.threshold = num(below[1]); r.dcaDays = null;
      understood.push(`buys when its market cap is below ${r.threshold} ETH`);
    } else if (/\bdca\b|dollar.?cost|spread|accumulat/.test(s) || (days && every)) {
      r.tokenMode = "dca"; r.threshold = null;
      r.dcaDays = days ? +(parseFloat(days[1]) * (days[2][0] === "w" ? 7 : 1)).toFixed(2) : r.dcaDays ?? 7;
      understood.push(`DCA over ${plural(r.dcaDays, "day")}`);
    } else if (/\bonce\b|\bnow\b|\bbuy\b/.test(s) && !wasToken) { r.tokenMode = "once"; }
    if (every && r.tokenMode !== "once") {
      const v = every[1] ? parseFloat(every[1]) : 1, u = every[2][0];
      r.everyHours = +(u === "w" ? v * 168 : u === "d" ? v * 24 : u === "m" ? v / 60 : v).toFixed(4);
      understood.push(`${r.tokenMode === "below" ? "at most " : ""}${fmtEvery(r.everyHours)}`);
    } else if (r.tokenMode !== "once" && !r.everyHours) r.everyHours = defaultEvery(r);
    if (r.tokenMode === "once") { r.everyHours = null; r.dcaDays = null; r.threshold = null; understood.push("buys once"); }
    if (budget) { r.budgetEth = parseFloat(budget[1]); understood.push(`up to ${r.budgetEth} ETH in total`); }
    if (/\bhold\b|never sell|don.?t sell|no (?:automatic )?sell/.test(s)) { r.exit = "hold"; r.holdSec = null; r.takeProfitPct = null; r.stopLossPct = null; understood.push("exit: hold"); }
  }

  if (addr) { /* specific token, read above */ }
  else if (/dex ?screener/.test(s)) { r.trigger = "dexupdate"; understood.push("signal: DexScreener update"); }
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

  if (r.trigger !== "token") {
    Object.assign(r, NO_TOKEN);
    if (r.exit === "hold") { r.exit = "time"; r.holdSec = r.holdSec ?? 60; }
  }
  const age = r.trigger === "token" ? null : s.match(/(?:younger than|launched in the last|newer than|under)\s*(\d+)\s*(minutes?|mins?|m|hours?|h)\b/);
  if (age) { r.maxAgeMin = parseInt(age[1]) * (age[2][0] === "h" ? 60 : 1); understood.push(`only tokens launched in the last ${r.maxAgeMin} min`); }
  const liqM = r.trigger === "token" ? null : s.match(/liquidity\s*(?:above|over|>|of at least|of more than|more than|at least)?\s*(\d+(?:\.\d+)?)\s*eth/) ?? s.match(/(?:more than|over|above|at least|>)?\s*(\d+(?:\.\d+)?)\s*eth\s*(?:of\s*)?liquidity/);
  const liq = liqM;
  if (liq) { r.minLiquidityEth = parseFloat(liq[1]); understood.push(`liquidity above ${r.minLiquidityEth} ETH`); }

  return { rule: r, understood, missed: understood.length === 0 };
}
