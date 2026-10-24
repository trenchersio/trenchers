/**
 * Trenchies progression: XP and level-ups, the daily reward calendar, daily quests, chests, achievements, the
 * butterfly net and the wardrobe. Pure functions over a player's progress, so the engine stays readable and all of
 * it can be tested on its own.
 */
import { createHash } from "node:crypto";
import {
  ACHIEVEMENTS, BUTTERFLIES, CHESTS, COSMETICS, DAILY, FISHES, FISH_EVERY, LEVEL_COINS, NET_EVERY, QUESTS, QUEST_ALL, cosmetic, cosmeticFree, levelChest, levelOf,
  type ChestTier, type Reward, type Slot, type Stat,
} from "./trenchies-catalog";

export type Note = { id: number; kind: "quest" | "chest" | "ach" | "level" | "daily" | "cheer" | "ref" | "bug" | "join"; text: string; at: number };
export type Progress = {
  addr: string; xp: number; bricks: number; items: string[];
  hits: number; wins: number; hatTricks: number; rounds: number; streak: number;
  daily: { next: number; last: number | null; run: number; best: number };
  quests: { day: number; list: { id: string; n: number; done: boolean }[]; bonus: boolean };
  chests: Record<ChestTier, number>;
  stats: Partial<Record<Stat, number>>;
  bugs: Record<string, number>;
  fish: Record<string, number>;
  achievements: string[];
  wardrobe: string[]; wear: Partial<Record<Slot, string>>;
  inbox: Note[];
};

export const emptyProgress = () => ({
  daily: { next: 0, last: null, run: 0, best: 0 }, quests: { day: -1, list: [], bonus: false }, chests: { common: 0, rare: 0, epic: 0 },
  stats: {}, bugs: {}, fish: {}, achievements: [], wardrobe: [], wear: { hat: "cap" }, inbox: [],
}) as Pick<Progress, "daily" | "quests" | "chests" | "stats" | "bugs" | "fish" | "achievements" | "wardrobe" | "wear" | "inbox">;

let noteId = Date.now();
export function note(p: Progress, kind: Note["kind"], text: string) { p.inbox = [...p.inbox.slice(-19), { id: ++noteId, kind, text, at: Date.now() }]; }

/** A number from 0 to 1, the same every time for the same seed (quests, chest rolls in tests). */
export const seeded = (s: string) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16) / 0xffffffff;

/** XP (levels only; coins are earned separately). Each level up pays coins, and every 5th level a chest. */
export function gain(p: Progress, xp: number, why?: string) {
  if (xp <= 0) return;
  const before = levelOf(p.xp);
  p.xp += xp;
  const after = levelOf(p.xp);
  for (let l = before + 1; l <= after; l++) {
    p.bricks += LEVEL_COINS * l;
    const c = levelChest(l);
    note(p, "level", `Level ${l}: +${LEVEL_COINS * l} coins${c ? ` and a ${c} chest` : ""}`);
    if (c) p.chests[c]++;
  }
  if (after > before) checkAchievements(p);
  void why;
}
export function grant(p: Progress, r: Reward, why: string) {
  if (r.xp) gain(p, r.xp, why);
  if (r.bricks) p.bricks += r.bricks;
  if (r.chest) p.chests[r.chest]++;
}
export const rewardText = (r: Reward) => [r.bricks && `${r.bricks} coins`, r.xp && `${r.xp} XP`, r.chest && `a ${r.chest} chest`].filter(Boolean).join(", ");

// ------------------------------------------------------------------------------------------------ daily reward
/** The calendar: today's reward if it hasn't been claimed. Missing a day starts it again at day 1. */
export function dailyState(p: Progress, today: number) {
  const claimed = p.daily.last === today;
  const broken = p.daily.last !== null && p.daily.last < today - 1;
  const next = claimed ? p.daily.next : broken ? 0 : p.daily.next;
  return { claimed, day: next, rewards: DAILY, run: broken ? 0 : p.daily.run };
}
export function claimDaily(p: Progress, today: number): Reward | null {
  if (p.daily.last === today) return null;
  const broken = p.daily.last !== null && p.daily.last < today - 1;
  const idx = broken ? 0 : p.daily.next;
  const r = DAILY[idx % DAILY.length];
  grant(p, r, "daily");
  p.daily = { next: (idx + 1) % DAILY.length, last: today, run: broken ? 1 : p.daily.run + 1, best: Math.max(p.daily.best, broken ? 1 : p.daily.run + 1) };
  p.stats.dailyBest = Math.max(p.stats.dailyBest ?? 0, p.daily.run);
  note(p, "daily", `Day ${idx + 1} reward: ${rewardText(r)}`);
  checkAchievements(p);
  return r;
}

// ------------------------------------------------------------------------------------------------ quests
/** Today's three quests: the picks, plus two drawn for this wallet and this day. */
export function ensureQuests(p: Progress, today: number) {
  if (p.quests.day === today) return p.quests;
  const pool = QUESTS.filter((q) => q.id !== "pick").sort((a, b) => seeded(`${p.addr}:${today}:${a.id}`) - seeded(`${p.addr}:${today}:${b.id}`));
  p.quests = { day: today, list: [{ id: "pick", n: 0, done: false }, ...pool.slice(0, 2).map((q) => ({ id: q.id, n: 0, done: false }))], bonus: false };
  return p.quests;
}
/** Something happened that a quest might be waiting for. Rewards are paid the moment a quest completes. */
export function bump(p: Progress, today: number, id: string, n = 1) {
  ensureQuests(p, today);
  for (const q of p.quests.list) {
    if (q.id !== id || q.done) continue;
    const def = QUESTS.find((x) => x.id === id)!;
    q.n = Math.min(def.goal, q.n + n);
    if (q.n >= def.goal) { q.done = true; grant(p, { xp: def.xp, bricks: def.bricks }, "quest"); note(p, "quest", `Quest done: ${def.text} (+${def.xp} XP, +${def.bricks} coins)`); }
  }
  if (!p.quests.bonus && p.quests.list.every((q) => q.done)) { p.quests.bonus = true; grant(p, QUEST_ALL, "quests"); note(p, "quest", `All 3 quests done: ${rewardText(QUEST_ALL)}`); }
}

// ------------------------------------------------------------------------------------------------ stats and achievements
export function stat(p: Progress, key: Stat, add = 1) { p.stats[key] = (p.stats[key] ?? 0) + add; }
export function statValue(p: Progress, key: Stat): number {
  switch (key) {
    case "picks": return p.rounds;
    case "hits": return p.hits;
    case "wins": return p.wins;
    case "hatTricks": return p.hatTricks;
    case "owned": return p.items.length;
    case "level": return levelOf(p.xp);
    case "species": return Object.keys(p.bugs).length;
    case "fishSpecies": return p.fish && typeof p.fish === "object" ? Object.keys(p.fish).length : 0;
    default: return p.stats[key] ?? 0;
  }
}
export function checkAchievements(p: Progress) {
  for (const a of ACHIEVEMENTS) {
    if (p.achievements.includes(a.id) || statValue(p, a.stat) < a.goal) continue;
    p.achievements.push(a.id);
    if (a.chest) p.chests[a.chest]++;
    if (a.cosmetic && !p.wardrobe.includes(a.cosmetic)) p.wardrobe.push(a.cosmetic);
    note(p, "ach", `Achievement: ${a.name}${a.cosmetic ? ` (unlocked ${cosmetic(a.cosmetic)?.name})` : ""}${a.chest ? `, a ${a.chest} chest` : ""}`);
    if (a.xp) gain(p, a.xp, "achievement");
  }
}

// ------------------------------------------------------------------------------------------------ chests
export type ChestResult = { tier: ChestTier; bricks?: number; cosmetic?: string };
export function openChest(p: Progress, tier: ChestTier, rnd: () => number = Math.random): ChestResult | null {
  if ((p.chests[tier] ?? 0) <= 0) return null;
  p.chests[tier]--;
  const def = CHESTS[tier], roll = rnd(), span = (a: [number, number]) => a[0] + Math.floor(rnd() * (a[1] - a[0] + 1));
  let out: ChestResult = { tier };
  const unowned = COSMETICS.filter((c) => !p.wardrobe.includes(c.id) && !c.ach && def.rarities.includes(c.rarity) && (c.chest || c.cost));
  if (roll >= def.odds.bricks && unowned.length) {
    const c = unowned[Math.floor(rnd() * unowned.length)];
    p.wardrobe.push(c.id); out = { tier, cosmetic: c.id };
  } else { const b = span(def.bricks); p.bricks += b; out = { tier, bricks: b }; }
  return out;
}

// ------------------------------------------------------------------------------------------------ butterflies
/** One swing of the net: 1 or 2 butterflies, rarer ones with the Butterfly Garden, the moth only at night (UTC). */
export function swingNet(p: Progress & { next: Partial<Record<string, number>> }, nowMs: number, rnd: () => number = Math.random) {
  const at = p.next.net ?? 0;
  if (nowMs < at) return { error: "The butterflies are hiding. Try again soon.", next: at } as const;
  const garden = p.items.includes("flowers"), hour = new Date(nowMs).getUTCHours(), night = hour >= 19 || hour < 6;
  const pool = BUTTERFLIES.filter((b) => !b.night || night).map((b) => ({ b, w: b.weight * (garden && b.rarity !== "common" ? 1.6 : 1) }));
  const total = pool.reduce((s, x) => s + x.w, 0);
  const n = rnd() < (garden ? 0.55 : 0.4) ? 2 : 1, got: string[] = [];
  for (let i = 0; i < n; i++) { let k = rnd() * total; for (const x of pool) { if ((k -= x.w) < 0) { got.push(x.b.id); break; } } if (got.length <= i) got.push(pool[0].b.id); }
  let xp = 0;
  for (const id of got) { const b = BUTTERFLIES.find((x) => x.id === id)!; p.bugs[id] = (p.bugs[id] ?? 0) + 1; xp += b.xp; if (b.rarity === "epic" || b.rarity === "legendary") note(p, "bug", `You caught a ${b.name}!`); }
  stat(p, "bugs", got.length);
  p.next.net = nowMs + NET_EVERY * 1000;
  gain(p, xp, "butterflies");
  checkAchievements(p);
  return { got, xp, next: p.next.net } as const;
}

// ------------------------------------------------------------------------------------------------ fishing
/** One cast from the dock: one fish (two now and then), the catfish and the Moon Whale only at night (UTC). */
export function castLine(p: Progress & { next: Partial<Record<string, number>> }, nowMs: number, rnd: () => number = Math.random) {
  const at = p.next.fish ?? 0;
  if (nowMs < at) return { error: "Nothing's biting yet. Try again soon.", next: at } as const;
  const hour = new Date(nowMs).getUTCHours(), night = hour >= 19 || hour < 6;
  const pool = FISHES.filter((f) => !f.night || night), total = pool.reduce((s, x) => s + x.weight, 0);
  const n = rnd() < 0.2 ? 2 : 1, got: string[] = [];
  for (let i = 0; i < n; i++) { let k = rnd() * total; for (const x of pool) { if ((k -= x.weight) < 0) { got.push(x.id); break; } } if (got.length <= i) got.push(pool[0].id); }
  let xp = 0; if (!p.fish || typeof p.fish !== "object") p.fish = {};
  for (const id of got) { const f = FISHES.find((x) => x.id === id)!; p.fish[id] = (p.fish[id] ?? 0) + 1; xp += f.xp; if (f.rarity === "epic" || f.rarity === "legendary" || f.rarity === "mythic") note(p, "bug", `You caught a ${f.name}!`); }
  stat(p, "fish", got.length);
  p.next.fish = nowMs + FISH_EVERY * 1000;
  gain(p, xp, "fishing");
  checkAchievements(p);
  return { got, xp, next: p.next.fish } as const;
}

// ------------------------------------------------------------------------------------------------ wardrobe
/** Everything this player can wear right now: owned, free at their level, or free from the start. */
export function canWear(p: Progress, id: string) { const c = cosmetic(id); return !!c && (p.wardrobe.includes(id) || cosmeticFree(c, levelOf(p.xp))); }
export function buyCosmetic(p: Progress, id: string): string | null {
  const c = cosmetic(id); if (!c) return "Unknown item.";
  if (canWear(p, id)) return "You already have this.";
  if (!c.cost) return c.chest ? "This one only comes from chests." : c.ach ? "This one is an achievement reward." : `Reach level ${c.level} first.`;
  if ((c.level ?? 1) > levelOf(p.xp)) return `Reach level ${c.level} first.`;
  if (p.bricks < c.cost) return `You need ${c.cost - p.bricks} more coins.`;
  p.bricks -= c.cost; p.wardrobe.push(id);
  return null;
}
