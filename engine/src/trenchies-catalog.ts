/**
 * Trenchies: levels, XP rules and everything you can unlock. Shared word for word by the engine
 * (engine/src/trenchies-catalog.ts) and the site (web/lib/trenchies-catalog.ts): keep both copies the same.
 */
export type ItemKind = "house" | "vehicle" | "decor";
export type Item = { id: string; kind: ItemKind; name: string; level: number; cost: number; blurb: string };

export const ITEMS: Item[] = [
  // Houses: each one replaces the last (bigger room, better walls, more room for decor).
  { id: "shack", kind: "house", name: "Starter Shack", level: 1, cost: 0, blurb: "A bed, a desk, a toilet. Everyone starts somewhere." },
  { id: "cabin", kind: "house", name: "Trench Cabin", level: 3, cost: 300, blurb: "Wooden walls, a window, room to breathe." },
  { id: "house", kind: "house", name: "Suburban House", level: 6, cost: 900, blurb: "Bigger rooms and proper walls." },
  { id: "villa", kind: "house", name: "Chain Villa", level: 10, cost: 2500, blurb: "Marble floors and space for a pool." },
  { id: "mansion", kind: "house", name: "Whale Mansion", level: 15, cost: 6000, blurb: "The top of the trench." },
  // Vehicles: parked outside; your Trenchie takes it for a ride.
  { id: "bike", kind: "vehicle", name: "Old Bike", level: 1, cost: 0, blurb: "Gets you to the next pump." },
  { id: "scooter", kind: "vehicle", name: "Scooter", level: 2, cost: 150, blurb: "Faster than the bike, barely." },
  { id: "hatch", kind: "vehicle", name: "Hatchback", level: 5, cost: 600, blurb: "Four wheels and a dream." },
  { id: "sports", kind: "vehicle", name: "Sports Car", level: 9, cost: 1800, blurb: "Bought on a green day." },
  { id: "super", kind: "vehicle", name: "Supercar", level: 14, cost: 5000, blurb: "Wen supercar? Now." },
  // Decor: kept forever once bought.
  { id: "mailbox", kind: "decor", name: "Mailbox", level: 1, cost: 30, blurb: "Your name on it." },
  { id: "plant", kind: "decor", name: "House Plant", level: 1, cost: 40, blurb: "Green, like your PnL should be." },
  { id: "lamp", kind: "decor", name: "Floor Lamp", level: 2, cost: 80, blurb: "Warm light for late-night charts." },
  { id: "rug", kind: "decor", name: "Rug", level: 2, cost: 90, blurb: "Ties the room together." },
  { id: "trees", kind: "decor", name: "Garden Trees", level: 3, cost: 150, blurb: "A little shade for your land." },
  { id: "tv", kind: "decor", name: "TV & Couch", level: 3, cost: 220, blurb: "Watch the charts from the couch." },
  { id: "chair", kind: "decor", name: "Gaming Chair", level: 4, cost: 250, blurb: "RGB means more gains." },
  { id: "shelf", kind: "decor", name: "Bookshelf", level: 4, cost: 220, blurb: "Mostly whitepapers." },
  { id: "monitors", kind: "decor", name: "Triple Monitors", level: 5, cost: 400, blurb: "Three charts are better than one." },
  { id: "neon", kind: "decor", name: "GM Neon Sign", level: 5, cost: 350, blurb: "It's always morning somewhere." },
  { id: "aquarium", kind: "decor", name: "Aquarium", level: 6, cost: 450, blurb: "Fish don't panic sell." },
  { id: "trophies", kind: "decor", name: "Trophy Shelf", level: 7, cost: 500, blurb: "Shows off your top-3 picks." },
  { id: "dog", kind: "decor", name: "Dog", level: 8, cost: 800, blurb: "A loyal friend who follows you around." },
  { id: "pool", kind: "decor", name: "Pool", level: 10, cost: 1500, blurb: "Needs the Chain Villa or bigger." },
  { id: "goldtoilet", kind: "decor", name: "Gold Toilet", level: 12, cost: 3000, blurb: "Pure luxury, every morning." },
];
export const item = (id: string) => ITEMS.find((i) => i.id === id);

/** XP for a pick that finishes 1st, 2nd or 3rd of all coins picked that day. */
export const RANK_XP = [100, 60, 40];
/** For taking part (picks submitted for the day). */
export const PLAY_XP = 10;
/** Streak bonus: +5 XP per day in a row, up to +50. */
export const streakXp = (streak: number) => Math.min(streak, 10) * 5;
/** All three picks in the top 3. */
export const HAT_TRICK_XP = 100;
/** Linking your X account. */
export const X_XP = 50;
export const PICKS = 3;

/** Total XP needed to reach `level` (level 1 at 0 XP). */
export const xpFor = (level: number) => (level <= 1 ? 0 : Math.round(60 * Math.pow(level - 1, 1.55)));
export function levelOf(xp: number) { let l = 1; while (xp >= xpFor(l + 1)) l++; return l; }

/** The daily round: picks made on day D count for round D+1 (UTC), which runs 00:00 to 24:00 and is settled after. */
export const DAY = 86400;
export const roundOf = (t: number) => Math.floor(t / DAY); // the round running at time t (seconds)
export const roundStart = (r: number) => r * DAY;
export const roundLabel = (r: number) => new Date(r * DAY * 1000).toISOString().slice(0, 10);
