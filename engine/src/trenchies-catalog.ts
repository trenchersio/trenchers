/**
 * Trenchies: levels, XP rules, everything you can unlock, and the reward loops. Shared word for word by the engine
 * (engine/src/trenchies-catalog.ts) and the site (web/lib/trenchies-catalog.ts): keep both copies the same.
 *
 * The loops, from fastest to slowest:
 *   every 20 min   catch butterflies in the garden (a collection with rare species)
 *   every 2-5 h    fish the pond, chop the forest, mine the quarry (materials for bigger builds)
 *   every day      lock in 3 picks, claim the daily reward (7-day calendar), finish 3 daily quests, cheer lands
 *   every week     the best pickers split the prize pot
 *   long term      levels (to 40), ~160 things to build, cosmetics, achievements, land value and cheers boards
 */
export type ItemKind = "house" | "room" | "vehicle" | "indoor" | "outdoor" | "pet";
export type Item = {
  id: string; kind: ItemKind; name: string; level: number; cost: number; blurb: string;
  /** Line icon used in the shop. */
  glyph: string;
  /** Needs at least this house (index in HOUSE_ORDER). */
  needsHouse?: number;
  /** Building materials, gathered from the forest and the quarry on your land. */
  wood?: number; stone?: number;
  /** Rooms: built onto the house (a new wing with a doorway) or as a building in the garden. */
  site?: "house" | "garden";
  /** Furniture: the room it goes in when you have that room (else the main house). */
  room?: string;
  /** Your Trenchie can hang out here (a chill spot). */
  chill?: boolean;
  /** Pets: needs another item first (the dog house needs the dog, and so on). */
  needs?: string;
};

/** Houses in order, smallest first (an item can need "at least" one of them). */
export const HOUSE_ORDER = ["shack", "cabin", "house", "loft", "villa", "mansion", "palace"];

const I = (id: string, kind: ItemKind, name: string, level: number, cost: number, glyph: string, blurb: string, x: Partial<Item> = {}): Item => ({ id, kind, name, level, cost, glyph, blurb, ...x });

export const ITEMS: Item[] = [
  // ---------------------------------------------------------------- houses: each one replaces the last
  I("shack", "house", "Starter Shack", 1, 0, "house", "A bed, a desk, a toilet. Everyone starts somewhere."),
  I("cabin", "house", "Trench Cabin", 3, 300, "house", "Clean walls and a window to watch the charts from.", { wood: 30 }),
  I("house", "house", "Modern House", 6, 900, "house", "More floor, two windows, room for a couch.", { wood: 40, stone: 30 }),
  I("loft", "house", "Glass Loft", 9, 1800, "house", "Floor-to-ceiling glass and a polished floor.", { wood: 20, stone: 60 }),
  I("villa", "house", "Chain Villa", 13, 3500, "house", "White stone, big rooms, space for a pool.", { wood: 60, stone: 120 }),
  I("mansion", "house", "Whale Mansion", 18, 8000, "house", "Black glass, gold trim. The top of the trench.", { wood: 100, stone: 200 }),
  I("palace", "house", "Trench Palace", 30, 20000, "crown", "Marble, gold and a hall big enough for every trophy.", { wood: 200, stone: 400 }),

  // ---------------------------------------------------------------- rooms built onto the house (a new wing with a door through)
  I("bathroom", "room", "Bathroom", 2, 180, "bath", "Shower, sink, and the toilet moves in here.", { site: "house", wood: 20, stone: 10 }),
  I("kitchen", "room", "Kitchen", 4, 400, "cup", "Counters, a fridge and a stove. Snack breaks between candles.", { site: "house", wood: 30, stone: 20 }),
  I("bedroom", "room", "Bedroom Suite", 5, 520, "bed", "A proper bedroom with a big bed and wardrobe.", { site: "house", wood: 40, stone: 20 }),
  I("office", "room", "Trading Office", 7, 800, "screen", "A wall of screens, just for the charts.", { site: "house", wood: 40, stone: 30 }),
  I("gym", "room", "Home Gym", 10, 1200, "gym", "Rack, bench and a mirror. Strong hands.", { site: "house", wood: 30, stone: 40 }),
  I("library", "room", "Library", 11, 1400, "book", "Shelves to the ceiling and a reading chair. Built in front of the gym.", { site: "house", needs: "gym", wood: 80, stone: 20 }),
  I("servers", "room", "Server Room", 12, 1600, "server", "Racks of blinking lights humming all night. Built in front of the kitchen.", { site: "house", needs: "kitchen", wood: 20, stone: 50 }),
  I("gameroom", "room", "Game Room", 13, 1900, "joystick", "Neon, carpet and room for every table game.", { site: "house", wood: 40, stone: 40 }),
  I("cinema", "room", "Home Cinema", 15, 2600, "screen", "A big screen, rows of seats and a popcorn smell. Built in front of the game room.", { site: "house", needs: "gameroom", wood: 60, stone: 40 }),
  I("sauna", "room", "Sauna", 17, 3000, "fire", "Hot stones and cedar benches.", { site: "house", wood: 90, stone: 40 }),
  I("studio", "room", "Music Studio", 19, 3600, "music", "Foam walls, a mixing desk and a mic. Built in front of the office.", { site: "house", needs: "office", wood: 50, stone: 50 }),
  I("vault", "room", "Vault", 21, 5000, "lock", "A steel door, and what's behind it is yours.", { site: "house", stone: 160 }),
  // ---------------------------------------------------------------- buildings in the garden
  I("shed", "room", "Garden Shed", 3, 220, "shed", "Tools, a workbench and a light that stays on.", { site: "garden", wood: 30 }),
  I("garage", "room", "Garage", 8, 950, "garage", "Your ride parks inside, under the lights.", { site: "garden", wood: 30, stone: 60 }),
  I("treehouse", "room", "Treehouse", 12, 1500, "tree", "Up in the forest, with a rope ladder.", { site: "garden", wood: 120 }),
  I("greenhouse", "room", "Greenhouse", 14, 2000, "leaf", "Glass walls, rows of plants, warm light.", { site: "garden", wood: 60, stone: 20 }),
  I("observatory", "room", "Observatory", 20, 6000, "star", "A dome and a telescope pointed at the moon.", { site: "garden", wood: 50, stone: 120 }),
  I("helipad", "room", "Helipad", 25, 12000, "heli", "For the days you can't wait for the bike.", { site: "garden", wood: 20, stone: 200 }),

  // ---------------------------------------------------------------- rides
  I("bike", "vehicle", "City Bike", 1, 0, "bike", "Gets you to the next pump."),
  I("moped", "vehicle", "Moped", 2, 150, "moped", "Faster than the bike, barely."),
  I("golfcart", "vehicle", "Golf Cart", 4, 380, "car", "Quiet, slow and very comfy."),
  I("hatch", "vehicle", "Hatchback", 5, 600, "car", "Four wheels and a dream."),
  I("quad", "vehicle", "Quad Bike", 6, 750, "moped", "Mud on the tyres, wind in the face."),
  I("motorbike", "vehicle", "Motorbike", 7, 900, "moped", "Two wheels, all the noise."),
  I("suv", "vehicle", "SUV", 8, 1100, "car", "Room for everything you bought on the dip."),
  I("pickup", "vehicle", "Pickup Truck", 9, 1400, "car", "Hauls wood back from the forest."),
  I("sports", "vehicle", "Sports Car", 11, 2400, "car", "Bought on a green day."),
  I("limo", "vehicle", "Limo", 15, 4200, "car", "For arriving at the leaderboard."),
  I("super", "vehicle", "Supercar", 16, 6000, "car", "Low, loud and lit up underneath."),
  I("monster", "vehicle", "Monster Truck", 21, 8000, "car", "Big wheels for big wins."),
  I("hover", "vehicle", "Hover Car", 24, 15000, "hover", "No wheels. It floats."),

  // ---------------------------------------------------------------- inside: kept forever once bought
  I("plant", "indoor", "House Plant", 1, 40, "leaf", "Green, like your PnL should be."),
  I("beanbag", "indoor", "Bean Bag", 1, 50, "chair", "Sink in and watch the candles.", { chill: true }),
  I("cactus", "indoor", "Cactus", 1, 45, "leaf", "Low maintenance. Diamond hands."),
  I("lamp", "indoor", "Floor Lamp", 2, 80, "lamp", "Warm light for late-night charts."),
  I("rug", "indoor", "Rug", 2, 90, "rug", "Ties the room together."),
  I("lavalamp", "indoor", "Lava Lamp", 2, 85, "lamp", "Slow blobs, slow mornings."),
  I("sofa", "indoor", "Sofa", 2, 160, "chair", "Room for you and a friend.", { chill: true }),
  I("mirror", "indoor", "Standing Mirror", 2, 90, "frame", "Check the fit before the chart.", { room: "bedroom" }),
  I("art", "indoor", "Your Trencher, Framed", 3, 160, "frame", "Your Trencher's art on the wall."),
  I("tv", "indoor", "TV & Couch", 3, 220, "screen", "Watch the charts from the couch.", { chill: true }),
  I("coffeetable", "indoor", "Coffee Table", 3, 120, "rug", "Somewhere to put the coffee down."),
  I("monstera", "indoor", "Monstera", 3, 110, "leaf", "Big leaves, bigger energy."),
  I("ledstrip", "indoor", "LED Strips", 3, 140, "spark", "Neon along every edge."),
  I("chair", "indoor", "Gaming Chair", 4, 250, "chair", "RGB means more gains.", { room: "office" }),
  I("shelf", "indoor", "Bookshelf", 4, 220, "book", "Mostly whitepapers.", { room: "library" }),
  I("bonsai", "indoor", "Bonsai", 4, 260, "leaf", "Patience, trimmed."),
  I("wardrobe", "indoor", "Wardrobe", 4, 240, "shed", "Where the merch lives.", { room: "bedroom" }),
  I("armchair", "indoor", "Armchair", 4, 230, "chair", "Deep, soft, perfect for reading.", { room: "library", chill: true }),
  I("monitors", "indoor", "Triple Monitors", 5, 400, "screen", "Three charts are better than one.", { room: "office" }),
  I("neon", "indoor", "GM Neon Sign", 5, 350, "spark", "It's always morning somewhere."),
  I("cattree", "indoor", "Cat Tree", 5, 300, "paw", "Your cat's own skyscraper.", { needs: "cat" }),
  I("whiteboard", "indoor", "Chart Wall", 5, 320, "chart", "Lines drawn, levels marked.", { room: "office" }),
  I("yogamat", "indoor", "Yoga Mat", 2, 70, "rug", "Breathe in. Breathe out. Don't sell.", { room: "gym", chill: true }),
  I("coffee", "indoor", "Coffee Machine", 6, 300, "cup", "Fuel for the 4am candles.", { room: "kitchen" }),
  I("aquarium", "indoor", "Aquarium", 6, 450, "fish", "Fish don't panic sell.", { chill: true }),
  I("guitar", "indoor", "Guitar", 6, 380, "music", "Three chords and a chart.", { room: "studio", chill: true }),
  I("punchbag", "indoor", "Punching Bag", 6, 360, "gym", "For the red days.", { room: "gym" }),
  I("standdesk", "indoor", "Standing Desk", 6, 420, "screen", "Trade on your feet.", { room: "office" }),
  I("dining", "indoor", "Dining Table", 6, 480, "rug", "Seats six. Usually just you.", { room: "kitchen" }),
  I("vinyl", "indoor", "Record Player", 7, 420, "disc", "Lo-fi beats to trade to.", { chill: true }),
  I("trophies", "indoor", "Trophy Shelf", 7, 500, "trophy", "Shows off your top-3 picks."),
  I("treadmill", "indoor", "Treadmill", 7, 520, "gym", "Running while the chart runs.", { room: "gym" }),
  I("terrarium", "indoor", "Terrarium", 7, 400, "leaf", "A tiny world under glass."),
  I("bathtub", "indoor", "Bathtub", 8, 600, "bath", "Bubbles and a long soak.", { room: "bathroom", chill: true }),
  I("foosball", "indoor", "Foosball", 8, 620, "ball", "Spin to win.", { room: "gameroom", chill: true }),
  I("barcart", "indoor", "Bar Cart", 8, 540, "cup", "For celebrating green days."),
  I("wagmi", "indoor", "WAGMI Sign", 8, 560, "spark", "In neon, in case you forget."),
  I("globe", "indoor", "Antique Globe", 8, 480, "ball", "Spin it, pick a market.", { room: "library" }),
  I("arcade", "indoor", "Arcade Cabinet", 9, 900, "joystick", "For when the market is closed. It never is.", { room: "gameroom", chill: true }),
  I("fridge", "indoor", "Kitchen Counter", 9, 950, "cup", "Fridge, counter and a kettle.", { room: "kitchen" }),
  I("pingpong", "indoor", "Ping Pong Table", 9, 820, "ball", "Fast hands, faster points.", { room: "gameroom", chill: true }),
  I("popcorn", "indoor", "Popcorn Machine", 9, 700, "cup", "Fresh every movie.", { room: "cinema" }),
  I("safe", "indoor", "Safe", 9, 900, "lock", "Cold storage, literally.", { room: "vault" }),
  I("fireplace", "indoor", "Fireplace", 10, 1100, "fire", "Crackling logs and long evenings.", { chill: true }),
  I("jukebox", "indoor", "Jukebox", 10, 1000, "disc", "Plays the hits, all night.", { chill: true }),
  I("vending", "indoor", "Vending Machine", 10, 900, "cup", "Snacks at any hour.", { room: "gameroom" }),
  I("ticker", "indoor", "Ticker Wall", 11, 1400, "chart", "Every price, scrolling by.", { room: "office" }),
  I("pinball", "indoor", "Pinball", 11, 1300, "joystick", "Flippers, lights, multiball.", { room: "gameroom", chill: true }),
  I("pooltable", "indoor", "Pool Table", 12, 1600, "ball", "Eight ball, corner pocket.", { room: "gameroom", chill: true }),
  I("winerack", "indoor", "Wine Rack", 12, 1200, "cup", "Aged like a good hold.", { room: "kitchen" }),
  I("goldtoilet", "indoor", "Gold Toilet", 12, 3000, "crown", "Pure luxury, every morning."),
  I("massage", "indoor", "Massage Chair", 13, 1800, "chair", "After a long day of picks.", { chill: true }),
  I("drums", "indoor", "Drum Kit", 14, 2000, "music", "Loud enough for the whole land.", { room: "studio", chill: true }),
  I("miningrig", "indoor", "Mining Rig", 15, 2400, "server", "Fans, frames and a warm glow.", { room: "servers" }),
  I("piano", "indoor", "Piano", 15, 3000, "music", "Plays green candles in C major.", { room: "studio", chill: true }),
  I("djdeck", "indoor", "DJ Deck", 16, 2800, "disc", "Mixing pumps and dumps.", { room: "studio", chill: true }),
  I("bust", "indoor", "Marble Bust", 17, 2600, "crown", "A classic face for a classic hall.", { room: "library" }),
  I("vr", "indoor", "VR Rig", 18, 3400, "joystick", "Another world, same charts.", { room: "gameroom", chill: true }),
  I("chandelier", "indoor", "Chandelier", 19, 4200, "spark", "Crystal and light."),
  I("hologram", "indoor", "Hologram Table", 20, 5200, "spark", "Your Trencher, in light, spinning.", { room: "office" }),
  I("goldbars", "indoor", "Stack of Gold Bars", 22, 7000, "crown", "Shiny, heavy, yours.", { room: "vault" }),

  // ---------------------------------------------------------------- outside
  I("mailbox", "outdoor", "Mailbox", 1, 30, "mail", "Your name on it."),
  I("gnome", "outdoor", "Garden Gnome", 1, 35, "user", "Guards the lawn. Barely."),
  I("swing", "outdoor", "Tree Swing", 1, 60, "moon", "A rope, a plank and a lot of calm.", { chill: true }),
  I("trees", "outdoor", "Garden Trees", 2, 120, "tree", "A little shade on your land."),
  I("blanket", "outdoor", "Picnic Blanket", 2, 70, "rug", "Lie back and watch the clouds.", { chill: true }),
  I("birdbath", "outdoor", "Bird Bath", 2, 90, "drop", "Birds stop by to splash."),
  I("lights", "outdoor", "Path Lights", 3, 140, "lamp", "The way home, lit up at night."),
  I("flowers", "outdoor", "Butterfly Garden", 3, 200, "leaf", "Wild flowers: more butterflies, rarer ones too.", { chill: true }),
  I("sandbox", "outdoor", "Sandbox", 3, 110, "build", "Castles, but tiny.", { chill: true }),
  I("flag", "outdoor", "Flag Pole", 3, 150, "spark", "Your Trencher's colours, flying."),
  I("fence", "outdoor", "Fence", 4, 200, "fence", "Clean white lines around your land.", { wood: 30 }),
  I("bench", "outdoor", "Garden Bench", 4, 160, "chair", "Somewhere to sit and think about entries.", { wood: 15, chill: true }),
  I("picnic", "outdoor", "Picnic Table", 4, 180, "rug", "Lunch outside.", { wood: 20, chill: true }),
  I("veggies", "outdoor", "Vegetable Patch", 4, 160, "leaf", "Grow your own greens.", { wood: 10 }),
  I("stringlights", "outdoor", "String Lights", 4, 180, "lamp", "Warm bulbs over the garden.", { wood: 5 }),
  I("garden", "outdoor", "Flower Beds", 5, 260, "leaf", "Neat rows of colour.", { wood: 10 }),
  I("swingset", "outdoor", "Swing Set", 5, 320, "moon", "Two swings and a slide.", { wood: 25, chill: true }),
  I("bbq", "outdoor", "BBQ Grill", 5, 300, "fire", "Burgers on green days.", { stone: 10, chill: true }),
  I("tent", "outdoor", "Camping Tent", 5, 280, "build", "Sleep under the stars.", { chill: true }),
  I("firepit", "outdoor", "Fire Pit", 6, 380, "fire", "A warm glow on cold nights.", { stone: 15, chill: true }),
  I("trampoline", "outdoor", "Trampoline", 6, 420, "ball", "Bounce like a good chart.", { chill: true }),
  I("pumpkins", "outdoor", "Pumpkin Patch", 6, 300, "leaf", "Orange and round, like a sunset candle."),
  I("telescope", "outdoor", "Garden Telescope", 6, 450, "star", "Stargazing on clear nights.", { chill: true }),
  I("hammock", "outdoor", "Hammock", 7, 420, "moon", "Naps between trades.", { wood: 10, chill: true }),
  I("beehive", "outdoor", "Beehive", 7, 500, "spark", "Busy bees and a little honey.", { wood: 15 }),
  I("palms", "outdoor", "Palm Trees", 7, 600, "tree", "Holiday vibes, all year."),
  I("hoop", "outdoor", "Basketball Hoop", 8, 500, "ball", "Shoots hoops while the chart loads.", { wood: 10, stone: 10, chill: true }),
  I("coop", "outdoor", "Chicken Coop", 8, 650, "shed", "Three chickens with opinions.", { wood: 40 }),
  I("doghouse", "outdoor", "Dog House", 8, 450, "house", "A roof for the good boy.", { wood: 20, needs: "dog" }),
  I("solar", "outdoor", "Solar Panels", 9, 700, "sun", "Clean power for the server room."),
  I("cinemascreen", "outdoor", "Outdoor Cinema", 9, 900, "screen", "A big screen under the stars. Movie night.", { wood: 20, chill: true }),
  I("pergola", "outdoor", "Pergola", 9, 820, "build", "Shade, vines and a lounge chair.", { wood: 50, chill: true }),
  I("cherry", "outdoor", "Cherry Blossom", 10, 1000, "tree", "Pink petals drifting down."),
  I("fountain", "outdoor", "Fountain", 11, 1300, "drop", "Running water in the front garden.", { stone: 40 }),
  I("gazebo", "outdoor", "Gazebo", 11, 1400, "house", "A round roof and a view.", { wood: 60, chill: true }),
  I("zen", "outdoor", "Zen Garden", 12, 1500, "leaf", "Raked sand, three stones, no FUD.", { stone: 50, chill: true }),
  I("skate", "outdoor", "Skate Ramp", 12, 1600, "build", "Ollie over the dip.", { wood: 60, chill: true }),
  I("pool", "outdoor", "Pool", 13, 2200, "drop", "Needs the Chain Villa or bigger.", { needsHouse: 4, stone: 60, chill: true }),
  I("dish", "outdoor", "Satellite Dish", 13, 1200, "fan", "Picks up every signal."),
  I("bridge", "outdoor", "Koi Bridge", 13, 1500, "drop", "A red bridge over the pond.", { wood: 40 }),
  I("hottub", "outdoor", "Hot Tub", 14, 2400, "drop", "Bubbles and neon at night.", { wood: 20, stone: 30, chill: true }),
  I("minigolf", "outdoor", "Mini Golf", 14, 2200, "ball", "Nine holes of pure focus.", { stone: 30, chill: true }),
  I("turbine", "outdoor", "Wind Turbine", 15, 2800, "fan", "Spins all day, powers the screens."),
  I("letters", "outdoor", "Giant TRENCHERS Letters", 15, 3000, "spark", "Lit up for the street.", { stone: 40 }),
  I("tennis", "outdoor", "Tennis Court", 16, 3600, "ball", "Game, set, match.", { stone: 80, chill: true }),
  I("billboard", "outdoor", "Billboard", 17, 4000, "frame", "Your Trencher, your level, lit up for the street."),
  I("windmill", "outdoor", "Windmill", 18, 4400, "fan", "Old sails, new money.", { wood: 80, stone: 40 }),
  I("waterfall", "outdoor", "Waterfall", 20, 5600, "drop", "Rocks and falling water into the pond.", { stone: 120 }),
  I("statue", "outdoor", "Trencher Statue", 22, 9000, "crown", "Your Trencher in stone, in the middle of the garden.", { stone: 150 }),
  I("maze", "outdoor", "Hedge Maze", 23, 7000, "leaf", "Get lost on purpose.", { wood: 60, chill: true }),
  I("balloon", "outdoor", "Hot Air Balloon", 26, 12000, "moon", "Tied down, floating over the land.", { wood: 40 }),
  I("rocket", "outdoor", "Moon Rocket", 35, 30000, "bolt", "On the pad, pointed up. Destination obvious.", { stone: 300 }),

  // ---------------------------------------------------------------- pets: they follow you around
  I("bunny", "pet", "Bunny", 3, 300, "paw", "Hops around the flower beds."),
  I("cat", "pet", "Cat", 4, 500, "paw", "Sleeps on the couch, judges your trades."),
  I("turtle", "pet", "Turtle", 6, 450, "paw", "Slow and steady, like a good hold."),
  I("dog", "pet", "Dog", 8, 800, "paw", "A loyal friend who follows you around."),
  I("parrot", "pet", "Parrot", 10, 1200, "heli", "Repeats your calls. Loudly."),
  I("drone", "pet", "Drone", 12, 1500, "heli", "Hovers over your land, filming the wins."),
  I("fox", "pet", "Fox", 14, 2200, "paw", "Clever, quick, a bit of a trader."),
  I("owl", "pet", "Owl", 16, 2600, "moon", "Awake for the night session."),
  I("penguin", "pet", "Penguin", 18, 3200, "paw", "Waddles to the pool, every time."),
  I("robodog", "pet", "Robot Dog", 19, 7000, "bolt", "Never needs a walk. Walks anyway."),
  I("dragon", "pet", "Baby Dragon", 32, 25000, "fire", "Tiny wings, tiny fire, big flex."),
];
export const item = (id: string) => ITEMS.find((i) => i.id === id);
/** Old ids from earlier versions, read as their new names. */
export const RENAMED: Record<string, string> = { scooter: "moped" };
export const MAX_LEVEL = 40;

// ------------------------------------------------------------------------------------------------ cosmetics
export type Slot = "hat" | "eyes" | "neck" | "back" | "aura" | "outline";
export type Rarity = "common" | "rare" | "epic" | "legendary";
/** How a cosmetic is unlocked: free, at a level, bought with bricks, from chests only, or by an achievement. */
export type Cosmetic = { id: string; slot: Slot; name: string; rarity: Rarity; level?: number; cost?: number; chest?: boolean; ach?: string; color?: string };
const K = (id: string, slot: Slot, name: string, rarity: Rarity, x: Partial<Cosmetic> = {}): Cosmetic => ({ id, slot, name, rarity, ...x });
export const COSMETICS: Cosmetic[] = [
  K("cap", "hat", "Trench Cap", "common", { level: 1 }),
  K("beanie", "hat", "Beanie", "common", { cost: 150 }),
  K("headphones", "hat", "Headphones", "common", { cost: 300 }),
  K("partyhat", "hat", "Party Hat", "rare", { chest: true }),
  K("cowboy", "hat", "Cowboy Hat", "rare", { cost: 600 }),
  K("chef", "hat", "Chef Hat", "rare", { chest: true }),
  K("tophat", "hat", "Top Hat", "rare", { cost: 1000 }),
  K("propeller", "hat", "Propeller Cap", "rare", { chest: true }),
  K("viking", "hat", "Viking Helmet", "epic", { chest: true }),
  K("wizard", "hat", "Wizard Hat", "epic", { chest: true }),
  K("crown", "hat", "Crown", "legendary", { ach: "hattrick" }),
  K("halo", "hat", "Halo", "legendary", { ach: "streak30" }),
  K("shades", "eyes", "Shades", "common", { cost: 200 }),
  K("nerd", "eyes", "Nerd Glasses", "common", { cost: 150 }),
  K("hearts", "eyes", "Heart Shades", "rare", { chest: true }),
  K("glasses3d", "eyes", "3D Glasses", "rare", { chest: true }),
  K("monocle", "eyes", "Monocle", "rare", { cost: 800 }),
  K("visor", "eyes", "Laser Visor", "epic", { chest: true }),
  K("scarf", "neck", "Scarf", "common", { cost: 200 }),
  K("bowtie", "neck", "Bow Tie", "common", { cost: 300 }),
  K("bandana", "neck", "Bandana", "rare", { chest: true }),
  K("lei", "neck", "Flower Lei", "rare", { chest: true }),
  K("medal", "neck", "Gold Medal", "epic", { ach: "top50" }),
  K("chain", "neck", "Gold Chain", "epic", { cost: 1500 }),
  K("backpack", "back", "Backpack", "common", { cost: 250 }),
  K("cape", "back", "Cape", "rare", { cost: 1200 }),
  K("rod", "back", "Fishing Rod", "rare", { ach: "fish25" }),
  K("wings", "back", "Butterfly Wings", "epic", { ach: "allbugs" }),
  K("angel", "back", "Angel Wings", "epic", { chest: true }),
  K("jetpack", "back", "Jetpack", "legendary", { level: 25, cost: 4000 }),
  K("aura-green", "aura", "Green Aura", "common", { level: 5 }),
  K("aura-cyan", "aura", "Cyan Aura", "rare", { chest: true }),
  K("aura-pink", "aura", "Pink Aura", "rare", { chest: true }),
  K("aura-gold", "aura", "Gold Aura", "epic", { ach: "wins5" }),
  K("aura-rainbow", "aura", "Rainbow Aura", "legendary", { chest: true }),
  K("line-white", "outline", "White Outline", "common", { level: 1, color: "#e8ece9" }),
  K("line-neon", "outline", "Neon Outline", "common", { level: 3, color: "#39ff88" }),
  K("line-pink", "outline", "Pink Outline", "rare", { chest: true, color: "#ff4fd8" }),
  K("line-gold", "outline", "Gold Outline", "epic", { level: 20, color: "#ffcf3a" }),
];
export const cosmetic = (id: string) => COSMETICS.find((c) => c.id === id);
/** Free from the start or at a level (no bricks, no chest). */
export const cosmeticFree = (c: Cosmetic, level: number) => !c.cost && !c.chest && !c.ach && (c.level ?? 1) <= level;

// ------------------------------------------------------------------------------------------------ gathering
/** The forest, the quarry and the pond on every land: tap to gather, then they regrow (or the fish come back). */
export const GATHER = {
  wood: { every: 3 * 3600, min: 10, max: 20, xp: 6, label: "wood" },
  stone: { every: 5 * 3600, min: 6, max: 12, xp: 6, label: "stone" },
  fish: { every: 2 * 3600, min: 1, max: 3, xp: 10, label: "fish" },
} as const;
/** Now and then the catch is a golden fish: bonus XP and a chest. */
export const GOLDEN_FISH = { chance: 0.08, xp: 40 };
export type Resource = keyof typeof GATHER;

/** Butterflies in the garden: a net swing every 20 minutes, each species with its own rarity. */
export const NET_EVERY = 20 * 60;
export type Bug = { id: string; name: string; rarity: Rarity | "uncommon"; weight: number; xp: number; color: string; night?: boolean };
export const BUTTERFLIES: Bug[] = [
  { id: "white", name: "Cabbage White", rarity: "common", weight: 30, xp: 3, color: "#f2f2ea" },
  { id: "brown", name: "Meadow Brown", rarity: "common", weight: 26, xp: 3, color: "#a67c52" },
  { id: "copper", name: "Small Copper", rarity: "common", weight: 22, xp: 3, color: "#e07a2e" },
  { id: "peacock", name: "Peacock", rarity: "uncommon", weight: 12, xp: 6, color: "#c0392b" },
  { id: "admiral", name: "Red Admiral", rarity: "uncommon", weight: 11, xp: 6, color: "#d1452e" },
  { id: "swallowtail", name: "Swallowtail", rarity: "uncommon", weight: 9, xp: 6, color: "#f4d03f" },
  { id: "morpho", name: "Blue Morpho", rarity: "rare", weight: 4, xp: 15, color: "#2e86de" },
  { id: "monarch", name: "Monarch", rarity: "rare", weight: 4, xp: 15, color: "#f39c12" },
  { id: "glasswing", name: "Glasswing", rarity: "epic", weight: 1.2, xp: 40, color: "#d6f5ff" },
  { id: "neonmoth", name: "Neon Moth", rarity: "epic", weight: 1.2, xp: 40, color: "#39ff88", night: true },
  { id: "birdwing", name: "Golden Birdwing", rarity: "legendary", weight: 0.35, xp: 100, color: "#ffcf3a" },
];
export const bug = (id: string) => BUTTERFLIES.find((b) => b.id === id);

// ------------------------------------------------------------------------------------------------ picks and XP
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
export function levelOf(xp: number) { let l = 1; while (l < MAX_LEVEL && xp >= xpFor(l + 1)) l++; return l; }

/** The daily round: picks made on day D count for round D+1 (UTC), which runs 00:00 to 24:00 and is settled after. */
export const DAY = 86400;
export const roundOf = (t: number) => Math.floor(t / DAY); // the round running at time t (seconds)
export const roundStart = (r: number) => r * DAY;
export const roundLabel = (r: number) => new Date(r * DAY * 1000).toISOString().slice(0, 10);

// ------------------------------------------------------------------------------------------------ rewards
export type Reward = { bricks?: number; xp?: number; wood?: number; stone?: number; chest?: ChestTier };
export type ChestTier = "common" | "rare" | "epic";
/** The daily reward calendar: come back every day; miss one and it starts again at day 1. */
export const DAILY: Reward[] = [
  { bricks: 25 }, { bricks: 40 }, { wood: 15, stone: 10 }, { bricks: 60 }, { chest: "common" }, { bricks: 100 }, { chest: "rare", bricks: 50 },
];
/** Three quests a day: the first is always the picks; two more are drawn for you. Each pays XP and bricks; all three, a chest. */
export type Quest = { id: string; text: string; goal: number; xp: number; bricks: number };
export const QUESTS: Quest[] = [
  { id: "pick", text: "Lock in your 3 picks", goal: 1, xp: 15, bricks: 40 },
  { id: "wood", text: "Chop wood in the forest", goal: 1, xp: 15, bricks: 40 },
  { id: "stone", text: "Mine the quarry", goal: 1, xp: 15, bricks: 40 },
  { id: "fish", text: "Go fishing", goal: 1, xp: 15, bricks: 40 },
  { id: "net", text: "Catch butterflies twice", goal: 2, xp: 15, bricks: 40 },
  { id: "visit", text: "Visit 2 other lands", goal: 2, xp: 15, bricks: 40 },
  { id: "cheer", text: "Cheer 3 lands", goal: 3, xp: 15, bricks: 40 },
  { id: "chat", text: "Say something in a land chat", goal: 1, xp: 15, bricks: 40 },
  { id: "build", text: "Build or buy something", goal: 1, xp: 15, bricks: 40 },
  { id: "wear", text: "Change your Trenchie's look", goal: 1, xp: 15, bricks: 40 },
  { id: "chest", text: "Open a chest", goal: 1, xp: 15, bricks: 40 },
  { id: "share", text: "Share your land on X", goal: 1, xp: 15, bricks: 40 },
];
export const QUEST_ALL: Reward = { chest: "common", xp: 20 };
/** Cheering a land: once per land per day. You get XP (up to 10 a day), the owner gets bricks. */
export const CHEER = { xp: 3, ownerBricks: 5, perDay: 10 };
/** Inviting a friend: both get bricks when they spawn; you get a rare chest once they've played their first day. */
export const REFERRAL = { newBricks: 100, refBricks: 150, refChest: "rare" as ChestTier };
/** Every 5 levels: a chest. */
export const levelChest = (level: number): ChestTier | null => (level % 10 === 0 ? "epic" : level % 5 === 0 ? "rare" : null);

/** What a chest can hold: bricks, materials or a cosmetic you don't have yet (by rarity). */
export const CHESTS: Record<ChestTier, { bricks: [number, number]; mats: [number, number]; odds: { bricks: number; mats: number; cosmetic: number }; rarities: Rarity[] }> = {
  common: { bricks: [40, 120], mats: [10, 30], odds: { bricks: 0.6, mats: 0.25, cosmetic: 0.15 }, rarities: ["common", "rare"] },
  rare: { bricks: [120, 320], mats: [30, 60], odds: { bricks: 0.4, mats: 0.25, cosmetic: 0.35 }, rarities: ["rare", "epic"] },
  epic: { bricks: [300, 800], mats: [60, 120], odds: { bricks: 0.3, mats: 0.15, cosmetic: 0.55 }, rarities: ["epic", "legendary"] },
};

// ------------------------------------------------------------------------------------------------ achievements
export type Stat = "picks" | "hits" | "wins" | "hatTricks" | "bestStreak" | "wood" | "stone" | "fish" | "golden" | "bugs" | "species" | "owned" | "cheersGiven" | "cheersGot" | "visits" | "referrals" | "level" | "joined" | "dailyBest" | "visitors";
export type Achievement = { id: string; name: string; text: string; stat: Stat; goal: number; xp: number; chest?: ChestTier; cosmetic?: string };
export const ACHIEVEMENTS: Achievement[] = [
  { id: "first", name: "First Picks", text: "Play your first day", stat: "picks", goal: 1, xp: 20 },
  { id: "picks30", name: "Regular", text: "Play 30 days", stat: "picks", goal: 30, xp: 150, chest: "rare" },
  { id: "top10", name: "Sharp Eye", text: "10 picks in the top 3", stat: "hits", goal: 10, xp: 100 },
  { id: "top50", name: "Market Reader", text: "50 picks in the top 3", stat: "hits", goal: 50, xp: 300, cosmetic: "medal" },
  { id: "wins5", name: "Number One", text: "5 picks finishing #1", stat: "wins", goal: 5, xp: 200, cosmetic: "aura-gold" },
  { id: "hattrick", name: "Hat Trick", text: "All 3 picks in the top 3", stat: "hatTricks", goal: 1, xp: 150, chest: "epic", cosmetic: "crown" },
  { id: "streak7", name: "On a Roll", text: "A 7-day pick streak", stat: "bestStreak", goal: 7, xp: 100, chest: "rare" },
  { id: "streak30", name: "Unbreakable", text: "A 30-day pick streak", stat: "bestStreak", goal: 30, xp: 500, chest: "epic", cosmetic: "halo" },
  { id: "daily7", name: "Every Day", text: "Claim the daily reward 7 days in a row", stat: "dailyBest", goal: 7, xp: 80 },
  { id: "wood100", name: "Lumberjack", text: "Chop 100 wood", stat: "wood", goal: 100, xp: 60 },
  { id: "wood1000", name: "Forester", text: "Chop 1,000 wood", stat: "wood", goal: 1000, xp: 250, chest: "rare" },
  { id: "stone100", name: "Miner", text: "Mine 100 stone", stat: "stone", goal: 100, xp: 60 },
  { id: "fish25", name: "Angler", text: "Catch 25 fish", stat: "fish", goal: 25, xp: 80, cosmetic: "rod" },
  { id: "golden", name: "Golden Catch", text: "Catch a golden fish", stat: "golden", goal: 1, xp: 60 },
  { id: "bugs50", name: "Net Gains", text: "Catch 50 butterflies", stat: "bugs", goal: 50, xp: 100 },
  { id: "allbugs", name: "Collector", text: "Catch every kind of butterfly", stat: "species", goal: 11, xp: 400, chest: "epic", cosmetic: "wings" },
  { id: "build10", name: "Builder", text: "Own 10 things", stat: "owned", goal: 10, xp: 60 },
  { id: "build40", name: "Architect", text: "Own 40 things", stat: "owned", goal: 40, xp: 250, chest: "rare" },
  { id: "build100", name: "Tycoon", text: "Own 100 things", stat: "owned", goal: 100, xp: 800, chest: "epic" },
  { id: "cheer25", name: "Good Neighbour", text: "Cheer 25 lands", stat: "cheersGiven", goal: 25, xp: 80 },
  { id: "loved50", name: "Popular", text: "Get 50 cheers on your land", stat: "cheersGot", goal: 50, xp: 200, chest: "rare" },
  { id: "visit20", name: "Explorer", text: "Visit 20 different lands", stat: "visits", goal: 20, xp: 100 },
  { id: "joined", name: "Neighbours", text: "Join someone's land", stat: "joined", goal: 1, xp: 40 },
  { id: "ref1", name: "Recruiter", text: "Bring a friend who plays", stat: "referrals", goal: 1, xp: 100 },
  { id: "ref5", name: "Ringleader", text: "Bring 5 friends who play", stat: "referrals", goal: 5, xp: 400, chest: "epic" },
  { id: "lvl10", name: "Level 10", text: "Reach level 10", stat: "level", goal: 10, xp: 0 },
  { id: "lvl20", name: "Level 20", text: "Reach level 20", stat: "level", goal: 20, xp: 0 },
  { id: "lvl30", name: "Level 30", text: "Reach level 30", stat: "level", goal: 30, xp: 0 },
];

// ------------------------------------------------------------------------------------------------ weekly prizes
/**
 * Weekly prizes: weeks run Monday 00:00 to Monday 00:00 UTC. The week's pot is PRIZE_BPS of the $TRENCHERS creator
 * fees that came in that week, split between the week's best pickers (the XP their picks earned that week).
 */
export const PRIZE_BPS = 500; // 5%
export const PRIZE_SPLIT = [50, 30, 20];
export const weekOf = (t: number) => Math.floor((Math.floor(t / DAY) - 4) / 7); // day 4 of 1970 was a Monday
export const weekStart = (w: number) => (w * 7 + 4) * DAY;
export const weekLabel = (w: number) => `${new Date(weekStart(w) * 1000).toISOString().slice(0, 10)} to ${new Date((weekStart(w + 1) - DAY) * 1000).toISOString().slice(0, 10)}`;

/** A land's value: everything on it, at what it cost. */
export const landValue = (items: string[]) => items.reduce((s, id) => s + (item(id)?.cost ?? 0), 0);
