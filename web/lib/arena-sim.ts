/**
 * Sample-data engine for the Trading Arena. Everything here is simulated: fake Pons tokens with
 * random-walk prices, and registered agents that trade them by strategy. It is replaced by the
 * real indexer API once agents go live.
 */
import ids from "./nft-ids.json";

export type StrategyName = "Sniper" | "Momentum" | "Graduation hunter" | "Custom";
export type Token = { sym: string; price: number; born: number; grad: number; supply: number; dead: boolean };
export type Trade = { t: number; side: "BUY" | "SELL"; sym: string; eth: number; price: number; pnlPct?: number };
export type Position = { sym: string; qty: number; entry: number; cost: number };
export type Agent = {
  id: number; house: boolean; owner: string; wallet: string; strategy: StrategyName; params: string[];
  deposited: number; cash: number; positions: Map<string, Position>; trades: Trade[];
  nav: number; epochStart: number; history: number[]; wins: number; closed: number;
  rank: number; prevRank: number; lastTradeAt: number; lastSide: "BUY" | "SELL" | null;
};
export type Sim = {
  now: number; tick: number; agents: Agent[]; tokens: Map<string, Token>; launches: string[];
  totalHistory: number[]; tradesToday: number; prizePool: number; feed: (Trade & { agent: number })[];
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

const STRATS: Record<StrategyName, { params: string[]; size: [number, number]; vol: number; tp: number; sl: number }> = {
  "Sniper": { params: ["every new launch", "0.001 ETH per buy", "max 20 buys / hour", "sell at 3x or -50%"], size: [0.001, 0.003], vol: 1.4, tp: 2.0, sl: -0.5 },
  "Momentum": { params: ["market cap > 5 ETH", "liquidity > 2 ETH", "0.01 ETH per buy", "take profit 2x"], size: [0.01, 0.03], vol: 1.0, tp: 1.0, sl: -0.35 },
  "Graduation hunter": { params: ["graduation > 70%", "0.02 ETH per buy", "sell on graduation", "trailing stop 25%"], size: [0.02, 0.05], vol: 0.8, tp: 0.6, sl: -0.25 },
  "Custom": { params: ["natural-language rules", "0.005 ETH per buy", "daily cap 0.25 ETH"], size: [0.005, 0.015], vol: 1.2, tp: 1.5, sl: -0.4 },
};

const LIQ = 0.97; // holdings valued at what a sale would fetch, not the mid price

function navOf(a: Agent, tokens: Map<string, Token>) {
  let v = a.cash;
  a.positions.forEach((p) => { const t = tokens.get(p.sym); v += t && !t.dead ? p.qty * t.price * LIQ : 0; });
  return v;
}

function launch(sim: Sim) {
  const sym = newSymbol(sim.tokens);
  sim.tokens.set(sym, { sym, price: 1e-9 * (0.5 + rnd()), born: sim.tick, grad: rnd() * 0.2, supply: 1e9, dead: false });
  sim.launches.unshift(sym);
  if (sim.launches.length > 12) sim.launches.pop();
}

function moveMarket(sim: Sim) {
  sim.tokens.forEach((t) => {
    if (t.dead) return;
    const age = sim.tick - t.born;
    const vol = age < 20 ? 0.09 : 0.04;
    const pump = rnd() < 0.006 ? 1.6 + rnd() : 1;     // occasional pumps
    const rug = rnd() < 0.002 ? 0.08 : 1;             // and rugs
    t.price *= Math.exp(gauss() * vol - 0.0035) * pump * rug;  // most launches bleed out
    t.grad = Math.min(1, Math.max(0, t.grad + gauss() * 0.02 + 0.004));
    if (rug < 1 && rnd() < 0.5) t.dead = true;
  });
  // retire old tokens so the market stays a manageable size
  if (sim.tokens.size > 90) {
    const held = new Set<string>();
    sim.agents.forEach((a) => a.positions.forEach((_, k) => held.add(k)));
    const old = [...sim.tokens.values()].filter((t) => !held.has(t.sym)).sort((x, y) => x.born - y.born);
    for (const t of old.slice(0, sim.tokens.size - 90)) sim.tokens.delete(t.sym);
  }
}

function chooseToken(sim: Sim, s: StrategyName): Token | null {
  const live = [...sim.tokens.values()].filter((t) => !t.dead);
  if (!live.length) return null;
  if (s === "Sniper") return sim.tokens.get(sim.launches[Math.floor(rnd() * Math.min(3, sim.launches.length))]) ?? null;
  if (s === "Momentum") { const top = live.sort((a, b) => b.price - a.price).slice(0, 8); return pick(top); }
  if (s === "Graduation hunter") { const near = live.filter((t) => t.grad > 0.7); return near.length ? pick(near) : null; }
  return pick(live);
}

function act(sim: Sim, a: Agent) {
  const cfg = STRATS[a.strategy];
  // exits first
  for (const p of a.positions.values()) {
    const t = sim.tokens.get(p.sym);
    const price = t && !t.dead ? t.price : 0;
    const pnl = p.cost ? (p.qty * price * LIQ - p.cost) / p.cost : -1;
    if (pnl >= cfg.tp || pnl <= cfg.sl || (t && t.grad >= 1 && a.strategy === "Graduation hunter") || rnd() < 0.08) {
      const eth = p.qty * price * LIQ;
      a.cash += eth; a.positions.delete(p.sym); a.closed++; if (pnl > 0) a.wins++;
      record(sim, a, { t: sim.now, side: "SELL", sym: p.sym, eth, price, pnlPct: pnl * 100 });
      return;
    }
  }
  const t = chooseToken(sim, a.strategy);
  if (!t) return;
  const size = cfg.size[0] + rnd() * (cfg.size[1] - cfg.size[0]);
  const eth = Math.min(size * (a.house ? 2 : 1) * (0.5 + a.deposited), a.cash - 0.01);
  if (eth <= 0.0005 || a.positions.size >= 8) return;
  const qty = eth / t.price;
  const cur = a.positions.get(t.sym);
  a.positions.set(t.sym, cur ? { ...cur, qty: cur.qty + qty, cost: cur.cost + eth } : { sym: t.sym, qty, entry: t.price, cost: eth });
  a.cash -= eth;
  record(sim, a, { t: sim.now, side: "BUY", sym: t.sym, eth, price: t.price });
}

function record(sim: Sim, a: Agent, tr: Trade) {
  a.trades.unshift(tr); if (a.trades.length > 60) a.trades.pop();
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
  if (rnd() < 0.35) launch(sim);
  moveMarket(sim);
  const actors = 2 + Math.floor(rnd() * 4);
  for (let i = 0; i < actors; i++) act(sim, pick(sim.agents));
  let total = 0;
  for (const a of sim.agents) {
    a.nav = navOf(a, sim.tokens);
    a.history.push(a.nav); if (a.history.length > 180) a.history.shift();
    total += a.nav;
  }
  sim.totalHistory.push(total); if (sim.totalHistory.length > 240) sim.totalHistory.shift();
  sim.prizePool += 0.0004 + rnd() * 0.0008;
  rerank(sim);
}

export function createSim(): Sim {
  rnd = mulberry32(4663);
  const names = Object.keys(STRATS) as StrategyName[];
  const agents: Agent[] = (ids as number[]).map((id) => {
    const house = id <= 5;
    const strategy = house ? (["Momentum", "Graduation hunter", "Sniper", "Momentum", "Custom"] as StrategyName[])[id - 1] : pick(names);
    const deposited = house ? 2 + rnd() * 2 : +(0.1 + Math.pow(rnd(), 2) * 2.4).toFixed(2);
    return {
      id, house, owner: house ? "Trenchers team" : `0x${hex(4)}…${hex(4)}`, wallet: `0x${hex(4)}…${hex(4)}`,
      strategy, params: STRATS[strategy].params, deposited, cash: deposited, positions: new Map(), trades: [],
      nav: deposited, epochStart: deposited, history: [], wins: 0, closed: 0, rank: 0, prevRank: 0, lastTradeAt: 0, lastSide: null,
    };
  });
  const sim: Sim = { now: Date.now() - 600_000, tick: 0, agents, tokens: new Map(), launches: [], totalHistory: [], tradesToday: 0, prizePool: 1.84, feed: [] };
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
