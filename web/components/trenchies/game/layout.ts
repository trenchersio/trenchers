/**
 * Where everything goes on a 44 x 44 land.
 *
 *   back:   the house in a row across the land, its rooms built on as wings to the left and right, and a second
 *           row of rooms in front of the outer wings (each needs the room behind it, so the plan always joins up)
 *   left:   the forest, a long strip of trees down the left side, with the treehouse inside
 *   middle: the path from the front door to the road, the pond with its dock, the garden
 *   right:  the garage, the helipad and room for statues
 *
 * Rooms join each other through doorways; when a wing isn't next to the house yet, a hallway closes the gap.
 * Walls: the far ones (back, left) are full height, the near ones (front, right) are low, so you always see in.
 */
import type { R } from "./nav";
import { FLOORS, PAINTS, ROOM_SLOTS, roomLayout } from "@/lib/trenchies-catalog";

export const LAND = 44, CX = 22, HOUSE_Y = 3.6, DEPTH = 4.4, FRONT_Y = HOUSE_Y + DEPTH;
export const ROAD = 0.95, ROAD_IN = 1.6;

export type HouseTier = { w: number; d: number; h: number; windows: number; wall: number; floor: number; trim: number; glass?: boolean };
export const HOUSES: Record<string, HouseTier> = {
  shack: { w: 4.8, d: 4.4, h: 2.0, windows: 1, wall: 0x3b4049, floor: 0x5a4636, trim: 0x39ff88 },
  cabin: { w: 5.6, d: 4.8, h: 2.1, windows: 1, wall: 0x6b4a33, floor: 0x7a5a3e, trim: 0x39ff88 },
  house: { w: 6.6, d: 5.2, h: 2.2, windows: 2, wall: 0x2c3547, floor: 0x2a2d31, trim: 0x39ff88 },
  loft: { w: 7.4, d: 5.6, h: 2.6, windows: 0, wall: 0xe2e4e3, floor: 0x1b1f1e, trim: 0x39ff88, glass: true },
  villa: { w: 8.2, d: 6.0, h: 2.4, windows: 3, wall: 0xe8eae9, floor: 0xcfc8bc, trim: 0x39ff88, glass: true },
  mansion: { w: 9.2, d: 6.4, h: 2.8, windows: 4, wall: 0x14171a, floor: 0x0d0f10, trim: 0xffcf3a, glass: true },
  palace: { w: 10, d: 7.0, h: 3.0, windows: 4, wall: 0xf1ede4, floor: 0xd9d2c3, trim: 0xffcf3a },
};
export const core = (house: string): R => { const h = HOUSES[house] ?? HOUSES.shack; return { x: CX - h.w / 2, y: HOUSE_Y, w: h.w, d: h.d }; };
export const DOOR_X = CX;

/** How each room looks when first built (you can repaint walls and floors). */
export const ROOM_STYLE: Record<string, { floor: number; wall: number }> = {
  bathroom: { floor: 0xd8dde0, wall: 0x9aa6ad }, kitchen: { floor: 0x3a3f44, wall: 0xcfc6b8 }, gym: { floor: 0x26292c, wall: 0x3c4148 }, sauna: { floor: 0x8a6440, wall: 0x9c7048 },
  library: { floor: 0x5b3d2a, wall: 0x4a3a30 }, servers: { floor: 0x1a1d20, wall: 0x2a2f36 }, bedroom: { floor: 0x6b5a4a, wall: 0x46505e }, office: { floor: 0x2a2d31, wall: 0x343a44 },
  gameroom: { floor: 0x2b1f3a, wall: 0x3a2a4f }, vault: { floor: 0x2f3438, wall: 0x5b636a }, cinema: { floor: 0x3a1418, wall: 0x241014 }, studio: { floor: 0x2a2a30, wall: 0x22252b },
};
export type PlacedRoom = R & { id: string; slot: string; side: -1 | 1; row: 0 | 1; floor: number; wall: number };
/** Every built room in its slot (your own plan first, then the defaults), with its colours. */
export function placeRooms(items: string[], layout: Record<string, string> = {}, paint: Record<string, { wall?: number; floor?: number }> = {}): PlacedRoom[] {
  const map = roomLayout(items, layout);
  return Object.entries(map).map(([id, slot]) => { const s = ROOM_SLOTS[slot], st = ROOM_STYLE[id] ?? { floor: 0x2a2d31, wall: 0x3a4048 }, pt = paint[id] ?? {};
    return { id, slot, x: s.x, y: s.y, w: s.w, d: s.d, side: s.side, row: s.row, floor: pt.floor ? FLOORS[pt.floor] : st.floor, wall: pt.wall ? PAINTS[pt.wall] : st.wall }; });
}

/** Buildings out in the garden. */
export const GARDEN_ROOMS: Record<string, R & { h: number }> = {
  shed: { x: 12.8, y: 13.2, w: 2.8, d: 2.6, h: 1.9 },
  greenhouse: { x: 12.8, y: 17.4, w: 4.2, d: 3.0, h: 2.1 },
  garage: { x: 37.6, y: 20.0, w: 4.4, d: 3.4, h: 2.2 },
  observatory: { x: 13.0, y: 36.4, w: 3.6, d: 3.6, h: 0 },
  helipad: { x: 36.6, y: 36.4, w: 4.8, d: 4.8, h: 0 },
  treehouse: { x: 4.6, y: 24.0, w: 3.0, d: 3.0, h: 0 },
};

export const FOREST: R = { x: 2.0, y: 13.0, w: 9.6, d: 28.8 };
/** The forest in six plots, top to bottom: each one can be chopped down (plot1 first) and built on. */
export const PLOTS: (R & { id: string; build: string })[] = ["lumbermill", "archery", "logcabin", "campground", "lookout", "stonecircle"].map((build, i) => ({ id: `plot${i + 1}`, build, x: FOREST.x, y: FOREST.y + i * 4.8, w: FOREST.w, d: 4.8 }));
/** The big oak at the forest edge, and where you stand to admire it. */
export const CHOP = { x: 10.4, y: 20.6, sx: 11.45, sy: 21.15 };

export const POND = { x: 31.0, y: 31.0, rx: 3.4, ry: 2.4 };
/** The dock runs from x0 out over the water to x1; you fish from its end. */
export const DOCK = { x0: 25.9, x1: 28.9, y: 31.0 };
export const PATH_W = 1.1;

/** Fixed spots for garden things that belong in one place. */
export const FIXED: Record<string, R> = {
  pool: { x: 24.2, y: 12.4, w: 4.2, d: 2.6 },
  hottub: { x: 17.0, y: 12.6, w: 2.0, d: 2.0 },
  statue: { x: 18.2, y: 28.6, w: 1.4, d: 1.4 },
  fountain: { x: 23.8, y: 23.2, w: 2.4, d: 2.4 },
  letters: { x: 26.4, y: 40.6, w: 7.0, d: 1.0 },
  billboard: { x: 19.6, y: 1.65, w: 4.8, d: 0.3 },
  bridge: { x: 30.2, y: 27.9, w: 1.6, d: 2.0 },
  waterfall: { x: 33.4, y: 27.0, w: 3.0, d: 1.6 },
  swing: { x: 11.5, y: 27.0, w: 1.2, d: 1.2 },
  rocket: { x: 39.2, y: 26.4, w: 3.0, d: 3.0 },
  balloon: { x: 17.8, y: 22.0, w: 2.4, d: 2.4 },
  tennis: { x: 26.2, y: 16.6, w: 7.6, d: 4.2 },
  maze: { x: 13.0, y: 30.4, w: 5.0, d: 5.0 },
  minigolf: { x: 24.0, y: 36.4, w: 6.0, d: 3.2 },
};

/** Parking when there's no garage, and the path's extent. */
export const PARK = { x: 24.6, y: 41.6 };

/** Footprints for packed garden items [w, d]; facing the path. */
export const GARDEN_FP: Record<string, [number, number]> = {
  mailbox: [0.5, 0.5], gnome: [0.5, 0.5], trees: [1.4, 1.4], blanket: [1.6, 1.3], birdbath: [0.8, 0.8], flowers: [3.0, 2.0], sandbox: [1.8, 1.8],
  flag: [0.6, 0.6], bench: [1.6, 0.7], picnic: [1.8, 1.6], veggies: [2.4, 1.6], stringlights: [3.2, 0.4], swingset: [3.0, 1.6], bbq: [1.2, 0.8],
  tent: [2.0, 1.8], firepit: [2.4, 2.4], trampoline: [2.2, 2.2], pumpkins: [2.0, 1.6], telescope: [1.0, 1.0], hammock: [3.2, 0.9], beehive: [0.9, 0.9],
  palms: [2.4, 1.6], hoop: [2.4, 2.4], coop: [2.0, 1.6], doghouse: [1.2, 1.2], solar: [3.6, 1.4], cinemascreen: [3.6, 3.0], pergola: [2.8, 2.4],
  cherry: [2.0, 2.0], gazebo: [3.0, 3.0], zen: [3.0, 2.4], skate: [3.2, 2.0], dish: [1.4, 1.4], turbine: [1.2, 1.2], windmill: [2.2, 2.2], garden: [2.0, 1.0],
};

/** Free-placement of rectangles in a region, nearest a point first. */
export class Packer {
  rects: (R & { pad: number })[] = [];
  constructor(public area: R) {}
  block(r: R, pad = 0.3) { this.rects.push({ ...r, pad }); }
  private hit(r: R, pad: number) { return this.rects.some((b) => r.x < b.x + b.w + Math.max(pad, b.pad) && r.x + r.w + Math.max(pad, b.pad) > b.x && r.y < b.y + b.d + Math.max(pad, b.pad) && r.y + r.d + Math.max(pad, b.pad) > b.y); }
  /** Exactly this rectangle, if it's inside the area and free. */
  at(r: R, pad = 0.3): R | null {
    const A = this.area; if (r.x < A.x || r.y < A.y || r.x + r.w > A.x + A.w || r.y + r.d > A.y + A.d || this.hit(r, pad)) return null;
    this.block(r, pad); return r;
  }
  place(w: number, d: number, near: { x: number; y: number }, pad = 0.5, step = 0.5): R | null {
    const cands: { r: R; k: number }[] = [];
    for (let y = this.area.y; y + d <= this.area.y + this.area.d; y += step) for (let x = this.area.x; x + w <= this.area.x + this.area.w; x += step) {
      cands.push({ r: { x, y, w, d }, k: Math.hypot(x + w / 2 - near.x, (y + d / 2 - near.y) * 1.15) });
    }
    cands.sort((a, b) => a.k - b.k);
    for (const c of cands) if (!this.hit(c.r, pad)) { this.block(c.r, pad); return c.r; }
    return null;
  }
}
