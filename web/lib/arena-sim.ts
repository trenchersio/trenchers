/**
 * Sample-data engine for the Trading Arena. Everything here is simulated: fake Pons tokens and
 * registered agents trading them. One tick is one second. The market emits the same signals the
 * live indexer will (launches, graduations, $50k volume crosses, dev sells, DexScreener updates)
 * and each agent reacts according to its strategy (lib/strategies.ts), selling on its timer.
 * It is replaced by the real indexer API once agents go live.
 */
import ids from "./nft-ids.json";
import { STRATEGIES, VOLUME_THRESHOLD_USD, strategyByName, type StrategyEvent, type StrategyName } from "./strategies";
import { DEFAULT_RULE, describe, type CustomRule } from "./custom-strategy";

/** Sample holder guidance: what holders told their agents, and the rule each message became. */
export const GUIDED: { said: string; rule: CustomRule }[] = [
  { said: "Only new launches with more than 3 ETH liquidity. Take profit at 40%, cut at 20%.", rule: { ...DEFAULT_RULE, trigger: "launch", exit: "tpsl", holdSec: null, takeProfitPct: 40, stopLossPct: 20, minLiquidityEth: 3 } },
  { said: "Wait for $100k volume before buying, then hold two minutes.", rule: { ...DEFAULT_RULE, trigger: "volume", threshold: 100_000, exit: "time", holdSec: 120 } },
  { said: "Graduations only. Let winners run to +60%, stop at -25%.", rule: { ...DEFAULT_RULE, trigger: "graduation", exit: "tpsl", holdSec: null, takeProfitPct: 60, stopLossPct: 25 } },
  { said: "Buy dev sells on tokens younger than 30 minutes, out after 20 seconds.", rule: { ...DEFAULT_RULE, trigger: "devsell", exit: "time", holdSec: 20, maxAgeMin: 30 } },
  { said: "DexScreener updates: quick 30% target, tight 15% stop.", rule: { ...DEFAULT_RULE, trigger: "dexupdate", exit: "tpsl", holdSec: null, takeProfitPct: 30, stopLossPct: 15 } },
  { said: "Flip new launches, but hold 45 seconds instead of 15.", rule: { ...DEFAULT_RULE, trigger: "launch", exit: "time", holdSec: 45 } },
];

export type { StrategyName };
export type Token = {
  sym: string; price: number; born: number; grad: number; graduated: boolean; supply: number; dead: boolean;
  volumeUsd: number; crossed: boolean; drift: number;
};
export type Trade = { t: number; side: "BUY" | "SELL"; sym: string; eth: number; price: number; pnlPct?: number; why?: string };
export type Position = { sym: string; qty: number; entry: number; cost: number; opened: number };
export type Agent = {
  id: number; house: boolean; owner: string; wallet: string; strategy: StrategyName; params: string[];
  deposited: number; cash: number; positions: Map<string, Position>; trades: Trade[];
  nav: number; epochStart: number; history: number[]; wins: number; closed: number;
  rank: number; prevRank: number; lastTradeAt: number; lastSide: "BUY" | "SELL" | null;
  rule: CustomRule | null;   // Custom agents: the rule their holder's guidance compiled to
  guidance: string | null;   // the holder's latest message to the agent
  token: string | null;      // the agent's own Pons token, if it launched one
  tokenAddress: string | null;
  tokenRate: number;         // sample: creator fees per tick (ETH)
  tokenFees: number;         // creator fees received from its own token
  shareFees: number;         // its share of the 10% of $TRENCHERS fees paid to registered agents
};
export type MarketEvent = { t: number; kind: Exclude<StrategyEvent, "custom">; sym: string };
export type Sim = {
  now: number; tick: number; agents: Agent[]; tokens: Map<string, Token>; launches: string[];
  totalHistory: number[]; tradesToday: number; prizePool: number; feed: (Trade & { agent: number })[];
  events: MarketEvent[];
  agentFees: number;         // total $TRENCHERS fee share paid to agents
};

// Small seeded PRNG so the starting board is the same on every visit; live ticks then diverge.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(4663);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const hex = (n: number) => Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const A = ["MOON", "HOOD", "FROG", "TENDIE", "STONK", "CHAD", "DEGEN", "ROBIN", "PIXEL", "TRENCH", "LASER", "WAGMI", "BAG", "APE", "CAT", "DOG", "GIGA", "SIGMA", "ZOOM", "HODL", "PUMP", "BASED", "MEGA", "TURBO"];
const B = ["", "", "AI", "INU", "X", "COIN", "MAXI", "KING", "DAO", "LORD", "BOT", "420", "ZILLA", "WIF", "GOD", "BRO"];
function newSymbol(existing: Map<string, Token>) {
  for (;;) { const s = pick(A) + pick(B); if (!existing.has(s) && s.length <= 10) return s; }
}

const LIQ = 0.97;          // holdings valued at what a sale would fetch, not the mid price
const ETH_USD = 3000;      // sample conversion for the volume threshold
const YOUNG = 30 * 60;     // "new" token: launched in the last 30 minutes
const WHY: Record<MarketEvent["kind"], string> = {
  launch: "new launch", graduation: "graduated", volume: "crossed $50k volume", devsell: "dev sold", dexupdate: "DexScreener update",
};

function navOf(a: Agent, tokens: Map<string, Token>) {
  let v = a.cash;
  a.positions.forEach((p) => { const t = tokens.get(p.sym); v += t && !t.dead ? p.qty * t.price * LIQ : 0; });
  return v;
}

let pending: MarketEvent[] = []; // signals raised during the current tick
function emit(sim: Sim, kind: MarketEvent["kind"], sym: string) {
  const e = { t: sim.now, kind, sym };
  pending.push(e);
  sim.events.unshift(e);
  if (sim.events.length > 40) sim.events.pop();
}

function launch(sim: Sim) {
  const sym = newSymbol(sim.tokens);
  sim.tokens.set(sym, {
    sym, price: 1e-9 * (0.5 + rnd()), born: sim.tick, grad: rnd() * 0.25, graduated: false, supply: 1e9, dead: false,
    volumeUsd: 0, crossed: false, drift: 0.01 + rnd() * 0.03, // fresh launches catch an early bid
  });
  sim.launches.unshift(sym);
  if (sim.launches.length > 12) sim.launches.pop();
  emit(sim, "launch", sym);
}

function moveMarket(sim: Sim) {
  const live = [...sim.tokens.values()].filter((t) => !t.dead);
  for (const t of live) {
    const age = sim.tick - t.born;
    const vol = age < 30 ? 0.07 : 0.03;
    const rug = rnd() < 0.0015 ? 0.1 : 1;
    t.price *= Math.exp(gauss() * vol + t.drift - 0.0025) * rug;   // most launches bleed out slowly
    t.drift *= 0.88;                                               // event impulses fade
    if (rug < 1) t.dead = true;
    // activity: younger and moving tokens trade more
    t.volumeUsd += Math.abs(gauss()) * (age < 600 ? 900 : 180) * (1 + Math.abs(t.drift) * 40);
    if (!t.crossed && t.volumeUsd >= VOLUME_THRESHOLD_USD) {
      t.crossed = true;
      if (age < YOUNG) { t.drift += 0.012; emit(sim, "volume", t.sym); }
    }
    if (!t.graduated) {
      t.grad = Math.min(1, Math.max(0, t.grad + gauss() * 0.012 + 0.0035));
      if (t.grad >= 1) { t.graduated = true; t.drift += 0.02; emit(sim, "graduation", t.sym); }
    }
  }
  // dev sells: price drops hard, then partly bounces
  if (live.length && rnd() < 0.05) {
    const young = live.filter((t) => sim.tick - t.born < YOUNG);
    const t = young.length ? pick(young) : pick(live);
    t.price *= 0.7 + rnd() * 0.15; t.drift += 0.018 + rnd() * 0.012;
    emit(sim, "devsell", t.sym);
  }
  // DexScreener page updates: attention, usually a short pop
  if (live.length && rnd() < 0.045) {
    const t = pick(live);
    t.drift += (rnd() < 0.7 ? 1 : -0.5) * (0.01 + rnd() * 0.02);
    emit(sim, "dexupdate", t.sym);
  }
  // retire old tokens so the market stays a manageable size
  if (sim.tokens.size > 120) {
    const held = new Set<string>();
    sim.agents.forEach((a) => a.positions.forEach((_, k) => held.add(k)));
    const old = [...sim.tokens.values()].filter((t) => !held.has(t.sym)).sort((x, y) => x.born - y.born);
    for (const t of old.slice(0, sim.tokens.size - 120)) sim.tokens.delete(t.sym);
  }
}

function sell(sim: Sim, a: Agent, p: Position, why: string) {
  const t = sim.tokens.get(p.sym);
  const price = t && !t.dead ? t.price : 0;
  const eth = p.qty * price * LIQ;
  const pnl = p.cost ? (eth - p.cost) / p.cost : -1;
  a.cash += eth; a.positions.delete(p.sym); a.closed++; if (pnl > 0) a.wins++;
  record(sim, a, { t: sim.now, side: "SELL", sym: p.sym, eth, price, pnlPct: pnl * 100, why });
}

function buy(sim: Sim, a: Agent, t: Token, why: string) {
  const cfg = strategyByName(a.strategy);
  if (a.positions.has(t.sym) || a.positions.size >= cfg.defaults.maxPositions) return;
  const size = cfg.defaults.perBuy * (0.6 + rnd() * 0.8) * (a.house ? 3 : 0.5 + a.deposited);
  const eth = Math.min(size, a.cash - 0.005);
  if (eth <= 0.0005) return;
  a.positions.set(t.sym, { sym: t.sym, qty: eth / t.price, entry: t.price, cost: eth, opened: sim.tick });
  a.cash -= eth;
  record(sim, a, { t: sim.now, side: "BUY", sym: t.sym, eth, price: t.price, why });
}

function runAgents(sim: Sim, fresh: MarketEvent[]) {
  for (const a of sim.agents) {
    const cfg = strategyByName(a.strategy);
    // exits: timed for the house strategies, take-profit / stop-loss for Custom
    for (const p of [...a.positions.values()]) {
      const t = sim.tokens.get(p.sym);
      if (!t || t.dead) { sell(sim, a, p, "token died"); continue; }
      const hold = a.rule ? (a.rule.exit === "time" ? a.rule.holdSec : null) : cfg.holdSec;
      if (hold !== null) {
        if (sim.tick - p.opened >= hold) sell(sim, a, p, `held ${hold >= 60 ? `${hold / 60}m` : `${hold}s`}`);
      } else {
        const pnl = (p.qty * t.price * LIQ - p.cost) / p.cost;
        const tp = (a.rule?.takeProfitPct ?? 150) / 100, sl = (a.rule?.stopLossPct ?? 40) / 100;
        if (pnl >= tp || pnl <= -sl) sell(sim, a, p, pnl > 0 ? "take profit" : "stop loss");
      }
    }
    // entries
    if (a.rule) {
      // Guided agents act on their own signal, and their holder's filters skip a lot of the junk.
      const kind = a.rule.trigger === "mcap" ? "volume" : a.rule.trigger;
      for (const e of fresh) {
        if (e.kind !== kind) continue;
        const t = sim.tokens.get(e.sym);
        if (!t || t.dead) continue;
        if (t.drift <= 0 && rnd() < 0.75) continue;
        buy(sim, a, t, `${WHY[e.kind]}, your rule`);
      }
      continue;
    }
    for (const e of fresh) {
      if (e.kind !== cfg.event) continue;
      if (!a.house && rnd() > 0.55) continue; // holders' agents react a bit less reliably (caps, gas reserve)
      const t = sim.tokens.get(e.sym);
      if (t && !t.dead) buy(sim, a, t, WHY[e.kind]);
    }
  }
}

function record(sim: Sim, a: Agent, tr: Trade) {
  a.trades.unshift(tr); if (a.trades.length > 80) a.trades.pop();
  a.lastTradeAt = sim.now; a.lastSide = tr.side;
  sim.tradesToday++;
  sim.feed.unshift({ ...tr, agent: a.id }); if (sim.feed.length > 30) sim.feed.pop();
}

function rerank(sim: Sim) {
  const ret = (a: Agent) => (a.nav - a.epochStart) / a.epochStart;
  [...sim.agents].sort((x, y) => ret(y) - ret(x)).forEach((a, i) => { a.prevRank = a.rank; a.rank = i; });
}

export function step(sim: Sim, dtMs = 1000) {
  sim.tick++; sim.now += dtMs;
  pending = [];
  if (rnd() < 0.3) launch(sim);
  moveMarket(sim);
  runAgents(sim, pending);
  let total = 0;
  for (const a of sim.agents) {
    a.nav = navOf(a, sim.tokens);
    a.history.push(a.nav); if (a.history.length > 300) a.history.shift();
    total += a.nav;
  }
  sim.totalHistory.push(total); if (sim.totalHistory.length > 240) sim.totalHistory.shift();
  sim.prizePool += 0.0004 + rnd() * 0.0008;
  // Self-funding income lands in the agent wallet. It counts like a deposit, not as trading return.
  const share = (0.00006 + rnd() * 0.00004) / sim.agents.length * 40;
  for (const a of sim.agents) {
    const f = share + (a.token ? a.tokenRate * (0.5 + rnd()) : 0);
    a.cash += f; a.epochStart += f;
    a.shareFees += share; if (a.token) a.tokenFees += f - share;
  }
  sim.agentFees += share * sim.agents.length;
  rerank(sim);
}

export function createSim(): Sim {
  rnd = mulberry32(4663);
  const pool = STRATEGIES.map((s) => s.name);
  const agents: Agent[] = (ids as number[]).map((id) => {
    const house = id <= 5;
    // Most holders guide their agent themselves (Custom); some start from a house template.
    const def = house ? STRATEGIES.find((s) => s.houseAgent === id)! : strategyByName(rnd() < 0.7 ? "Custom" : pick(pool.filter((n) => n !== "Custom")));
    const g = def.name === "Custom" ? GUIDED[Math.floor(rnd() * GUIDED.length)] : null;
    const deposited = house ? 2 + rnd() * 2 : +(0.1 + Math.pow(rnd(), 2) * 2.4).toFixed(2);
    return {
      id, house, owner: house ? "Trenchers team" : `0x${hex(40)}`, wallet: `0x${hex(40)}`,
      strategy: def.name, params: g ? [describe(g.rule), "Guided by its holder", `${def.defaults.perBuy} ETH per buy`] : [def.trigger, def.exit, `${def.defaults.perBuy} ETH per buy`],
      rule: g ? g.rule : null, guidance: g ? g.said : null,
      deposited, cash: deposited, positions: new Map(), trades: [],
      nav: deposited, epochStart: deposited, history: [], wins: 0, closed: 0, rank: 0, prevRank: 0, lastTradeAt: 0, lastSide: null,
      token: null, tokenAddress: null, tokenRate: 0, tokenFees: 0, shareFees: 0,
    };
  });
  const sim: Sim = { now: Date.now() - 600_000, tick: 0, agents, tokens: new Map(), launches: [], totalHistory: [], tradesToday: 0, prizePool: 1.84, feed: [], events: [], agentFees: 0.92 };
  // About a third of agents have launched their own token on Pons.
  const taken = new Set<string>();
  for (const a of agents) {
    if (!(a.house || rnd() < 0.34)) continue;
    let sym = ""; do { sym = pick(A) + pick(["", "AI", "BOT", "AGENT", "X", "MAXI"]); } while (taken.has(sym) || sym.length > 10);
    taken.add(sym);
    a.token = sym; a.tokenAddress = `0x${hex(40)}`; a.tokenRate = 0.000004 + rnd() * 0.00002;
    a.tokenFees = +(rnd() * 0.6).toFixed(4); a.shareFees = +(0.01 + rnd() * 0.02).toFixed(4);
  }
  for (const a of agents) if (!a.shareFees) a.shareFees = +(0.01 + rnd() * 0.02).toFixed(4);
  for (let i = 0; i < 12; i++) launch(sim);
  for (let i = 0; i < 600; i++) step(sim, 1000); // warm up: ten minutes of history
  sim.now = Date.now();
  sim.agents.forEach((a) => { a.prevRank = a.rank; a.lastTradeAt = 0; });
  rnd = mulberry32((Date.now() & 0xffffffff) >>> 0); // live ticks differ per visit
  return sim;
}

export const fmtEth = (v: number, d = 3) => `${v.toFixed(d)}`;
export const pct = (a: Agent) => ((a.nav - a.epochStart) / a.epochStart) * 100;
export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}
export function mcapEth(t: Token, ethUsd = 1) { return (t.price * t.supply) / ethUsd; }
export const usd = (eth: number) => eth * ETH_USD;
export const signalLabel = (e: MarketEvent) => `${WHY[e.kind]} $${e.sym}`;
