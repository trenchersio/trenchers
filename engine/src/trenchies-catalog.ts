/**
 * Trenchies: levels, XP rules and everything you can unlock. Shared word for word by the engine
 * (engine/src/trenchies-catalog.ts) and the site (web/lib/trenchies-catalog.ts): keep both copies the same.
 */
export type ItemKind = "house" | "room" | "vehicle" | "indoor" | "outdoor" | "pet";
export type Item = {
  id: string; kind: ItemKind; name: string; level: number; cost: number; blurb: string;
  /** Line icon used in the shop. */
  glyph: string;
  /** Needs at least this house (index in HOUSE_ORDER). */
  needsHouse?: number;
  /** Building materials, gathered from the tree and the rock on your land. */
  wood?: number; stone?: number;
};

/** Houses in order, smallest first (an item can need "at least" one of them). */
export const HOUSE_ORDER = ["shack", "cabin", "house", "loft", "villa", "mansion"];

export const ITEMS: Item[] = [
  // Houses: each one replaces the last.
  { id: "shack", kind: "house", name: "Starter Shack", level: 1, cost: 0, glyph: "house", blurb: "A bed, a desk, a toilet. Everyone starts somewhere." },
  { id: "cabin", kind: "house", name: "Trench Cabin", level: 3, cost: 300, glyph: "house", blurb: "Clean walls and a window to watch the charts from.", wood: 30 },
  { id: "house", kind: "house", name: "Modern House", level: 6, cost: 900, glyph: "house", blurb: "More floor, two windows, room for a couch.", wood: 40, stone: 30 },
  { id: "loft", kind: "house", name: "Glass Loft", level: 9, cost: 1800, glyph: "house", blurb: "Floor-to-ceiling glass and a polished floor.", wood: 20, stone: 60 },
  { id: "villa", kind: "house", name: "Chain Villa", level: 13, cost: 3500, glyph: "house", blurb: "White stone, big rooms, space for a pool.", wood: 60, stone: 120 },
  { id: "mansion", kind: "house", name: "Whale Mansion", level: 18, cost: 8000, glyph: "house", blurb: "Black glass, gold trim. The top of the trench.", wood: 100, stone: 200 },
  // Rooms and buildings: added onto your land for good.
  { id: "bathroom", kind: "room", name: "Bathroom", level: 2, cost: 180, glyph: "bath", blurb: "A real bathroom: shower, sink, and the toilet moves in.", wood: 20, stone: 10 },
  { id: "shed", kind: "room", name: "Garden Shed", level: 3, cost: 220, glyph: "shed", blurb: "Tools, a workbench and a light that stays on.", wood: 30 },
  { id: "bedroom", kind: "room", name: "Extra Bedroom", level: 5, cost: 520, glyph: "bed", blurb: "A second room off the main house.", wood: 40, stone: 20 },
  { id: "office", kind: "room", name: "Trading Office", level: 7, cost: 800, glyph: "screen", blurb: "A desk wall of screens, just for the charts.", wood: 40, stone: 30 },
  { id: "garage", kind: "room", name: "Garage", level: 8, cost: 950, glyph: "garage", blurb: "Your ride parks inside, under the lights.", wood: 30, stone: 60 },
  { id: "gym", kind: "room", name: "Home Gym", level: 10, cost: 1200, glyph: "gym", blurb: "Bench, rack and a mirror. Strong hands.", wood: 30, stone: 40 },
  { id: "servers", kind: "room", name: "Server Room", level: 12, cost: 1600, glyph: "server", blurb: "Racks of blinking lights humming all night.", wood: 20, stone: 50 },
  { id: "greenhouse", kind: "room", name: "Greenhouse", level: 14, cost: 2000, glyph: "leaf", blurb: "Glass walls, rows of plants, warm light.", wood: 60, stone: 20 },
  { id: "observatory", kind: "room", name: "Observatory", level: 20, cost: 6000, glyph: "star", blurb: "A dome and a telescope pointed at the moon.", wood: 50, stone: 120 },
  { id: "helipad", kind: "room", name: "Helipad", level: 25, cost: 12000, glyph: "heli", blurb: "For the days you can't wait for the bike.", wood: 20, stone: 200 },
  // Rides: parked out front (or in the garage).
  { id: "bike", kind: "vehicle", name: "City Bike", level: 1, cost: 0, glyph: "bike", blurb: "Gets you to the next pump." },
  { id: "moped", kind: "vehicle", name: "Moped", level: 2, cost: 150, glyph: "moped", blurb: "Faster than the bike, barely." },
  { id: "hatch", kind: "vehicle", name: "Hatchback", level: 5, cost: 600, glyph: "car", blurb: "Four wheels and a dream." },
  { id: "suv", kind: "vehicle", name: "SUV", level: 8, cost: 1100, glyph: "car", blurb: "Room for everything you bought on the dip." },
  { id: "sports", kind: "vehicle", name: "Sports Car", level: 11, cost: 2400, glyph: "car", blurb: "Bought on a green day." },
  { id: "super", kind: "vehicle", name: "Supercar", level: 16, cost: 6000, glyph: "car", blurb: "Low, loud and lit up underneath." },
  { id: "hover", kind: "vehicle", name: "Hover Car", level: 24, cost: 15000, glyph: "hover", blurb: "No wheels. It floats." },
  // Indoor: kept forever once bought.
  { id: "plant", kind: "indoor", name: "House Plant", level: 1, cost: 40, glyph: "leaf", blurb: "Green, like your PnL should be." },
  { id: "lamp", kind: "indoor", name: "Floor Lamp", level: 2, cost: 80, glyph: "lamp", blurb: "Warm light for late-night charts." },
  { id: "rug", kind: "indoor", name: "Rug", level: 2, cost: 90, glyph: "rug", blurb: "Ties the room together." },
  { id: "art", kind: "indoor", name: "Your Trencher, Framed", level: 3, cost: 160, glyph: "frame", blurb: "Your Trencher's art on the wall." },
  { id: "tv", kind: "indoor", name: "TV & Couch", level: 3, cost: 220, glyph: "screen", blurb: "Watch the charts from the couch." },
  { id: "chair", kind: "indoor", name: "Gaming Chair", level: 4, cost: 250, glyph: "chair", blurb: "RGB means more gains." },
  { id: "shelf", kind: "indoor", name: "Bookshelf", level: 4, cost: 220, glyph: "book", blurb: "Mostly whitepapers." },
  { id: "monitors", kind: "indoor", name: "Triple Monitors", level: 5, cost: 400, glyph: "screen", blurb: "Three charts are better than one." },
  { id: "neon", kind: "indoor", name: "GM Neon Sign", level: 5, cost: 350, glyph: "spark", blurb: "It's always morning somewhere." },
  { id: "coffee", kind: "indoor", name: "Coffee Machine", level: 6, cost: 300, glyph: "cup", blurb: "Fuel for the 4am candles." },
  { id: "aquarium", kind: "indoor", name: "Aquarium", level: 6, cost: 450, glyph: "fish", blurb: "Fish don't panic sell." },
  { id: "vinyl", kind: "indoor", name: "Record Player", level: 7, cost: 420, glyph: "disc", blurb: "Lo-fi beats to trade to." },
  { id: "trophies", kind: "indoor", name: "Trophy Shelf", level: 7, cost: 500, glyph: "trophy", blurb: "Shows off your top-3 picks." },
  { id: "arcade", kind: "indoor", name: "Arcade Cabinet", level: 9, cost: 900, glyph: "joystick", blurb: "For when the market is closed. It never is." },
  { id: "fridge", kind: "indoor", name: "Kitchen", level: 9, cost: 950, glyph: "cup", blurb: "Fridge, counter and a kettle." },
  { id: "piano", kind: "indoor", name: "Piano", level: 15, cost: 3000, glyph: "music", blurb: "Plays green candles in C major." },
  { id: "goldtoilet", kind: "indoor", name: "Gold Toilet", level: 12, cost: 3000, glyph: "crown", blurb: "Pure luxury, every morning." },
  // Outdoor
  { id: "mailbox", kind: "outdoor", name: "Mailbox", level: 1, cost: 30, glyph: "mail", blurb: "Your name on it." },
  { id: "trees", kind: "outdoor", name: "Garden Trees", level: 2, cost: 120, glyph: "tree", blurb: "A little shade on your land." },
  { id: "lights", kind: "outdoor", name: "Path Lights", level: 3, cost: 140, glyph: "lamp", blurb: "The way home, lit up at night." },
  { id: "fence", kind: "outdoor", name: "Fence", level: 4, cost: 200, glyph: "fence", blurb: "Clean white lines around your land.", wood: 30 },
  { id: "bench", kind: "outdoor", name: "Garden Bench", level: 4, cost: 160, glyph: "chair", blurb: "Somewhere to sit and think about entries.", wood: 15 },
  { id: "garden", kind: "outdoor", name: "Flower Beds", level: 5, cost: 260, glyph: "leaf", blurb: "Neat rows of colour.", wood: 10 },
  { id: "firepit", kind: "outdoor", name: "Fire Pit", level: 6, cost: 380, glyph: "fire", blurb: "A warm glow on cold nights.", stone: 15 },
  { id: "hammock", kind: "outdoor", name: "Hammock", level: 7, cost: 420, glyph: "moon", blurb: "Naps between trades.", wood: 10 },
  { id: "hoop", kind: "outdoor", name: "Basketball Hoop", level: 8, cost: 500, glyph: "ball", blurb: "Shoots hoops while the chart loads.", wood: 10, stone: 10 },
  { id: "solar", kind: "outdoor", name: "Solar Panels", level: 9, cost: 700, glyph: "sun", blurb: "Clean power for the server room." },
  { id: "fountain", kind: "outdoor", name: "Fountain", level: 11, cost: 1300, glyph: "drop", blurb: "Running water in the front garden.", stone: 40 },
  { id: "pool", kind: "outdoor", name: "Pool", level: 13, cost: 2200, glyph: "drop", blurb: "Needs the Chain Villa or bigger.", needsHouse: 4, stone: 60 },
  { id: "hottub", kind: "outdoor", name: "Hot Tub", level: 14, cost: 2400, glyph: "drop", blurb: "Bubbles and neon at night.", wood: 20, stone: 30 },
  { id: "turbine", kind: "outdoor", name: "Wind Turbine", level: 15, cost: 2800, glyph: "fan", blurb: "Spins all day, powers the screens." },
  { id: "billboard", kind: "outdoor", name: "Billboard", level: 17, cost: 4000, glyph: "frame", blurb: "Your Trencher, your level, lit up for the street." },
  { id: "statue", kind: "outdoor", name: "Trencher Statue", level: 22, cost: 9000, glyph: "crown", blurb: "Your Trencher in stone, in the middle of the garden.", stone: 150 },
  // Pets: they follow you around.
  { id: "cat", kind: "pet", name: "Cat", level: 4, cost: 500, glyph: "paw", blurb: "Sleeps on the couch, judges your trades." },
  { id: "dog", kind: "pet", name: "Dog", level: 8, cost: 800, glyph: "paw", blurb: "A loyal friend who follows you around." },
  { id: "robodog", kind: "pet", name: "Robot Dog", level: 19, cost: 7000, glyph: "bolt", blurb: "Never needs a walk. Walks anyway." },
  { id: "drone", kind: "pet", name: "Drone", level: 12, cost: 1500, glyph: "heli", blurb: "Hovers over your land, filming the wins." },
];
export const item = (id: string) => ITEMS.find((i) => i.id === id);
/** Old ids from the first version, read as their new names. */
export const RENAMED: Record<string, string> = { scooter: "moped" };

/** The tree, the rock and the fishing pond on every land: tap to gather, then they regrow (or the fish come back). */
export const GATHER = {
  wood: { every: 4 * 3600, min: 8, max: 16, xp: 5, label: "wood" },
  stone: { every: 6 * 3600, min: 5, max: 10, xp: 5, label: "stone" },
  fish: { every: 2 * 3600, min: 1, max: 3, xp: 10, label: "fish" },
} as const;
/** Now and then the catch is a golden fish: bonus XP on top. */
export const GOLDEN_FISH = { chance: 0.08, xp: 40 };
export type Resource = keyof typeof GATHER;

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

/**
 * Weekly prizes: weeks run Monday 00:00 to Monday 00:00 UTC. The week's pot is PRIZE_BPS of the $TRENCHERS creator
 * fees that came in that week, split between the week's best pickers (the XP their picks earned that week).
 */
export const PRIZE_BPS = 500; // 5%
export const PRIZE_SPLIT = [50, 30, 20];
export const weekOf = (t: number) => Math.floor((Math.floor(t / DAY) - 4) / 7); // day 4 of 1970 was a Monday
export const weekStart = (w: number) => (w * 7 + 4) * DAY;
export const weekLabel = (w: number) => `${new Date(weekStart(w) * 1000).toISOString().slice(0, 10)} to ${new Date((weekStart(w + 1) - DAY) * 1000).toISOString().slice(0, 10)}`;
