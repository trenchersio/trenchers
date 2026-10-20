/**
 * The house and the garden buildings.
 *
 * The house is the core you start with plus rooms built on as wings in fixed slots (so the plan never shuffles as
 * you add more). Where a wing isn't right next to the house yet, a hallway joins it up. Nothing has a roof: walls on
 * the far side (back and left) are full height with lit windows, every other wall is low, so you always see inside.
 *
 * Each room gets its own fixtures (the bathroom a shower and a sink, the kitchen a counter, the cinema a screen and
 * seats...), then the furniture you own is packed in: against the walls first (tall things only on the far walls,
 * so nothing blocks the view), free-standing things in the middle, wall pieces hung on the far walls between the
 * windows.
 */
import * as THREE from "three";
import { CYAN, GOLD, NEON, PINK, WARM, type Frame, type Kit, type Wall } from "./kit";
import { DOOR_X, GARDEN_ROOMS, HOUSES, HOUSE_ROOMS, HOUSE_Y, core } from "./layout";
import { INDOOR, MODIFIERS, type Ctx } from "./indoor";
import type { R } from "./nav";
import { ITEMS, item as catItem } from "@/lib/trenchies-catalog";

export type Room = { id: string; r: R; floor: number; wall: number; h: number; kind: "core" | "wing" | "hall" };
type Hang = { room: string; side: Wall; a: number; b: number; used: [number, number][] };
const T = 0.14, LOW = 0.5, EPS = 0.06;
const LABEL: Record<string, string> = {
  bathroom: "BATH", kitchen: "KITCHEN", bedroom: "BEDROOM", office: "OFFICE", gym: "GYM", library: "LIBRARY", servers: "NODES", gameroom: "GAMES",
  cinema: "CINEMA", sauna: "SAUNA", studio: "STUDIO", vault: "VAULT", shed: "SHED", garage: "GARAGE",
};

// ------------------------------------------------------------------ the plan
export function plan(house: string, has: (id: string) => boolean): Room[] {
  const H = HOUSES[house] ?? HOUSES.shack, c = core(house);
  const rooms: Room[] = [{ id: "core", r: c, floor: H.floor, wall: H.wall, h: H.h, kind: "core" }];
  const wing = (id: string) => { const s = HOUSE_ROOMS[id]; rooms.push({ id, r: { x: s.x, y: s.y, w: s.w, d: s.d }, floor: s.floor, wall: s.wall, h: H.h, kind: "wing" }); };
  for (const side of [-1, 1] as const) {
    const slots = Object.entries(HOUSE_ROOMS).filter(([, s]) => s.side === side && s.row === 0).sort((a, b) => (side < 0 ? b[1].x - a[1].x : a[1].x - b[1].x));
    let edge = side < 0 ? c.x : c.x + c.w;
    for (const [id, s] of slots) {
      if (!has(id)) continue;
      const near = side < 0 ? s.x + s.w : s.x;
      if (Math.abs(near - edge) > 0.05) { const a = Math.min(near, edge), b = Math.max(near, edge); rooms.push({ id: `hall-${id}`, r: { x: a, y: HOUSE_Y + 1.4, w: b - a, d: 1.6 }, floor: H.floor, wall: H.wall, h: H.h, kind: "hall" }); }
      wing(id); edge = side < 0 ? s.x : s.x + s.w;
    }
  }
  for (const [id, s] of Object.entries(HOUSE_ROOMS)) if (s.row === 1 && has(id) && s.behind && has(s.behind)) wing(id);
  return rooms;
}
/** Rooms you could build next (shown as marked-out lots): not built, not crossed by a hallway, and close to your level. */
export function nextLots(rooms: Room[], has: (id: string) => boolean, level: number) {
  const out: { id: string; r: R; name: string; level: number; cost: number }[] = [];
  const cross = (r: R) => rooms.some((m) => m.r.x < r.x + r.w - 0.1 && m.r.x + m.r.w > r.x + 0.1 && m.r.y < r.y + r.d - 0.1 && m.r.y + m.r.d > r.y + 0.1);
  const cands = [...Object.entries(HOUSE_ROOMS).map(([id, s]) => ({ id, r: s as R, ok: !s.behind || has(s.behind) })), ...Object.entries(GARDEN_ROOMS).map(([id, r]) => ({ id, r: r as R, ok: true }))];
  for (const c of cands) {
    const it = catItem(c.id); if (!it || has(c.id) || !c.ok || cross(c.r) || it.level > level + 6) continue;
    out.push({ id: c.id, r: { x: c.r.x, y: c.r.y, w: c.r.w, d: c.r.d }, name: it.name, level: it.level, cost: it.cost });
  }
  return out.sort((a, b) => a.level - b.level).slice(0, 5);
}

// ------------------------------------------------------------------ walls
type Span = { line: number; a: number; b: number; hz: boolean };
const span = (r: R, s: Wall): Span => (s === "back" || s === "front" ? { line: s === "back" ? r.y : r.y + r.d, a: r.x, b: r.x + r.w, hz: true } : { line: s === "left" ? r.x : r.x + r.w, a: r.y, b: r.y + r.d, hz: false });
function touching(r: R, s: Wall, o: R): [number, number] | null {
  const sp = span(r, s), opp = s === "back" ? o.y + o.d : s === "front" ? o.y : s === "left" ? o.x + o.w : o.x;
  if (Math.abs(opp - sp.line) > EPS) return null;
  const a = Math.max(sp.a, sp.hz ? o.x : o.y), b = Math.min(sp.b, sp.hz ? o.x + o.w : o.y + o.d);
  return b - a > 0.2 ? [a, b] : null;
}
function minus(a: number, b: number, cuts: { a: number; b: number }[]) {
  let out = [{ a, b }];
  for (const c of cuts) { const n: { a: number; b: number }[] = []; for (const s of out) { if (c.b <= s.a || c.a >= s.b) { n.push(s); continue; } if (c.a > s.a) n.push({ a: s.a, b: c.a }); if (c.b < s.b) n.push({ a: c.b, b: s.b }); } out = n; }
  return out.filter((s) => s.b - s.a > 0.05);
}
/** Along-the-wall coordinate (as a frame on that side of the room measures it) of an absolute x or y. */
const along = (r: R, s: Wall, v: number) => (s === "back" ? v - r.x : s === "left" ? r.y + r.d - v : s === "front" ? r.x + r.w - v : v - r.y);
const zone = (sp: Span, a: number, b: number): R => (sp.hz ? { x: a, y: sp.line - 1.1, w: b - a, d: 2.2 } : { x: sp.line - 1.1, y: a, w: 2.2, d: b - a });

function seg(k: Kit, sp: Span, a: number, b: number, z0: number, h: number, m: THREE.Material, block = true) {
  if (b - a < 0.02 || h <= 0) return;
  const r: R = sp.hz ? { x: a, y: sp.line - T / 2, w: b - a, d: T } : { x: sp.line - T / 2, y: a, w: T, d: b - a };
  k.box(r.x, r.y, z0, r.w, r.d, h, m);
  if (block && z0 < 0.3) k.nav.block(r, 0.16);
}

type ShellOpts = { trim: number; glass: (r: Room) => boolean; door?: number; led: boolean; open?: Record<string, Wall[]>; fullDoors?: boolean };
function shell(k: Kit, rooms: Room[], o: ShellOpts) {
  const doors: R[] = [], hangs: Hang[] = [], M = k.M, trim = k.glow(o.trim, 1.4);
  for (const rm of rooms) {
    const r = rm.r;
    k.box(r.x, r.y, -0.05, r.w, r.d, 0.054, k.std(rm.floor, 0.38, 0.22), false).castShadow = false;
    const wm = k.std(rm.wall, 0.75, rm.wall < 0x404040 ? 0.2 : 0.04), cap = k.std(0xe9ece9, 0.6, 0.05);
    const led = k.glow(rm.id.length % 2 ? PINK : NEON, 1.3);
    for (const side of ["back", "left", "front", "right"] as Wall[]) {
      if (o.open?.[rm.id]?.includes(side)) continue;
      const sp = span(r, side), shared: { a: number; b: number; o: Room }[] = [];
      for (const q of rooms) if (q !== rm) { const t = touching(r, side, q.r); if (t) shared.push({ a: t[0], b: t[1], o: q }); }
      for (const e of minus(sp.a, sp.b, shared)) {
        const a = e.a - T / 2, b = e.b + T / 2;
        // full height only on the outside of the building's far side; a far wall that faces another room stays low
        const far = (side === "back" || side === "left") && rm.kind !== "hall" && !rooms.some((q) => q !== rm && (side === "left" ? q.r.x + q.r.w <= r.x + EPS && q.r.y < e.b && q.r.y + q.r.d > e.a : q.r.y + q.r.d <= r.y + EPS && q.r.x < e.b && q.r.x + q.r.w > e.a));
        if (far) {
          if (o.glass(rm)) {
            seg(k, sp, a, b, 0, 0.35, wm); seg(k, sp, a, b, rm.h - 0.18, 0.18, wm, false);
            const G = k.glass(0.2); if (sp.hz) k.box(a, sp.line - 0.02, 0.35, b - a, 0.04, rm.h - 0.53, G, false); else k.box(sp.line - 0.02, a, 0.35, 0.04, b - a, rm.h - 0.53, G, false);
            const n = Math.max(2, Math.round((b - a) / 1.4)); for (let i = 0; i <= n; i++) { const p = a + ((b - a - 0.06) * i) / n; if (sp.hz) k.box(p, sp.line - T / 2, 0, 0.06, T, rm.h, M.ink); else k.box(sp.line - T / 2, p, 0, T, 0.06, rm.h, M.ink); }
            const gl = k.night(WARM, 0.25); gl.userData.k = 0.28; if (sp.hz) k.box(a, sp.line - 0.03, 0.35, b - a, 0.005, rm.h - 0.53, gl, false); else k.box(sp.line - 0.03, a, 0.35, 0.005, b - a, rm.h - 0.53, gl, false);
            k.nav.block(sp.hz ? { x: a, y: sp.line - T / 2, w: b - a, d: T } : { x: sp.line - T / 2, y: a, w: T, d: b - a }, 0.16);
          } else seg(k, sp, a, b, 0, rm.h, wm);
          // a glowing line along the top, on the inside
          if (sp.hz) k.box(a, sp.line + T / 2 - 0.01, rm.h - 0.04, b - a, 0.025, 0.03, trim, false); else k.box(sp.line + T / 2 - 0.01, a, rm.h - 0.04, 0.025, b - a, 0.03, trim, false);
          if (o.led) { if (sp.hz) k.box(a, sp.line + T / 2, 0.02, b - a, 0.02, 0.025, led, false); else k.box(sp.line + T / 2, a, 0.02, 0.02, b - a, 0.025, led, false); }
          if (rm.kind !== "hall") { const p = along(r, side, e.a), q = along(r, side, e.b); hangs.push({ room: rm.id, side, a: Math.min(p, q), b: Math.max(p, q), used: [] }); }
        } else {
          let cut: [number, number] | null = null;
          if (side === "front" && rm.kind === "core" && o.door !== undefined && o.door > e.a + 0.65 && o.door < e.b - 0.65) cut = [o.door - 0.6, o.door + 0.6];
          else if (side === "front" && rm.kind !== "hall" && e.b - e.a >= 2.2) { const m = (e.a + e.b) / 2; cut = [m - 0.5, m + 0.5]; }
          lowWall(k, sp, a, b, cut, wm, cap, o.led ? led : null);
          if (cut) doors.push(zone(sp, cut[0], cut[1]));
        }
      }
      if (side === "front" || side === "right") for (const s of shared) {
        const hall = rm.kind === "hall" || s.o.kind === "hall";
        if (hall && s.b - s.a <= 2.3) { doors.push(zone(sp, s.a, s.b)); continue; }
        // the doorway sits near the front (or the house end), leaving the rest of the wall for furniture
        const m = s.b - s.a < 2.6 ? (s.a + s.b) / 2 : sp.hz ? (r.x + r.w / 2 < 22 ? s.b - 0.85 : s.a + 0.85) : s.b - 0.85, cut: [number, number] = [m - 0.55, m + 0.55];
        lowWall(k, sp, s.a, s.b, cut, wm, cap, o.led ? led : null); doors.push(zone(sp, cut[0], cut[1]));
      }
    }
    if (rm.id === "gameroom") { // neon-edged carpet
      const cr = { x: r.x + 0.6, y: r.y + 0.6, w: r.w - 1.2, d: r.d - 1.2 }; k.box(cr.x, cr.y, 0.004, cr.w, cr.d, 0.01, k.std(0x3b2266, 0.95), false).castShadow = false;
      for (const [x, y, w, d] of [[cr.x, cr.y, cr.w, 0.03], [cr.x, cr.y + cr.d - 0.03, cr.w, 0.03], [cr.x, cr.y, 0.03, cr.d], [cr.x + cr.w - 0.03, cr.y, 0.03, cr.d]]) k.box(x, y, 0.015, w, d, 0.004, k.glow(PINK, 1.2), false);
    }
  }
  return { doors, hangs };
}
function lowWall(k: Kit, sp: Span, a: number, b: number, cut: [number, number] | null, m: THREE.Material, cap: THREE.Material, led: THREE.Material | null) {
  const parts = cut ? [[a, cut[0]], [cut[1], b]] : [[a, b]];
  for (const [p, q] of parts) {
    seg(k, sp, p, q, 0, LOW, m);
    if (q - p > 0.02) { if (sp.hz) k.box(p, sp.line - T / 2 - 0.01, LOW, q - p, T + 0.02, 0.03, led ?? cap, false); else k.box(sp.line - T / 2 - 0.01, p, LOW, T + 0.02, q - p, 0.03, led ?? cap, false); }
  }
}

// ------------------------------------------------------------------ packing furniture into a room
type Use = { side: Wall; a: number; b: number; top: number };
class Pack {
  used: R[] = []; uses: Use[] = [];
  constructor(public room: Room, blocked: R[]) { this.used.push(...blocked); }
  get inner(): R { const r = this.room.r; return { x: r.x + 0.1, y: r.y + 0.1, w: r.w - 0.2, d: r.d - 0.2 }; }
  private hit(a: R, pad: number) { return this.used.some((b) => a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.d + pad && a.y + a.d + pad > b.y); }
  private fits(a: R) { const I = this.inner; return a.x >= I.x - 1e-6 && a.y >= I.y - 1e-6 && a.x + a.w <= I.x + I.w + 1e-6 && a.y + a.d <= I.y + I.d + 1e-6; }
  wall(len: number, dep: number, walls: Wall[]) {
    const I = this.inner;
    for (const w of walls) {
      const L = w === "back" || w === "front" ? I.w : I.d;
      for (let s = 0; s + len <= L + 1e-6; s += 0.1) {
        const rect = w === "back" ? { x: I.x + s, y: I.y, w: len, d: dep } : w === "front" ? { x: I.x + I.w - s - len, y: I.y + I.d - dep, w: len, d: dep } : w === "left" ? { x: I.x, y: I.y + I.d - s - len, w: dep, d: len } : { x: I.x + I.w - dep, y: I.y + s, w: dep, d: len };
        if (this.fits(rect) && !this.hit(rect, 0.12)) { this.used.push(rect); return { rect, wall: w, s: s + 0.1 }; }
      }
    }
    return null;
  }
  center(w: number, d: number) {
    const I = this.inner, cx = I.x + I.w / 2, cy = I.y + I.d / 2, c: { r: R; k: number }[] = [];
    for (let y = I.y + 0.5; y + d <= I.y + I.d - 0.4; y += 0.1) for (let x = I.x + 0.5; x + w <= I.x + I.w - 0.4; x += 0.1) c.push({ r: { x, y, w, d }, k: Math.hypot(x + w / 2 - cx, y + d / 2 - cy) });
    c.sort((a, b) => a.k - b.k);
    for (const q of c) if (!this.hit(q.r, 0.45)) { this.used.push(q.r); return { rect: q.r, wall: "back" as Wall, s: 0 }; }
    return null;
  }
}

// ------------------------------------------------------------------ fixtures every room comes with
type Fix = { fp: [number, number]; tall?: boolean; center?: boolean; walls?: Wall[]; build: (f: Frame, k: Kit, c: Ctx) => void };
const screenAt = (f: Frame, m: THREE.Material, w: number, h: number, x: number, z: number, y: number) => { const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); s.position.set(x, y, z); f.g.add(s); return s; };
const FIX: Record<string, Fix> = {
  desk: { fp: [1.5, 1.6], walls: ["left", "back", "right"], build: (f, k, c) => {
    const M = k.M; f.b(0, 0, 0.72, 1.5, 0.72, 0.05, M.ink); for (const [a, b] of [[0.05, 0.05], [1.39, 0.05], [0.05, 0.62], [1.39, 0.62]]) f.b(a, b, 0, 0.06, 0.06, 0.72, M.white);
    const tri = c.has("monitors");
    for (const o of tri ? [-0.48, 0, 0.48] : [0]) {
      f.b(0.75 + o - 0.04, 0.12, 0.77, 0.08, 0.06, 0.18, M.ink);
      const s = screenAt(f, k.screen(o ? 1 : 0), 0.46, 0.28, 0.75 + o, 0.19, 1.09), bk = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.3, 0.03), M.ink); bk.position.set(0.75 + o, 1.09, 0.17); f.g.add(bk);
      if (o) { s.rotation.y = -Math.sign(o) * 0.25; bk.rotation.y = s.rotation.y; }
    }
    f.b(0.53, 0.4, 0.77, 0.44, 0.14, 0.015, M.dark);
    const g = c.has("chair"), cm = g ? M.ink : M.white;
    f.b(0.48, 0.98, 0.38, 0.54, 0.5, 0.08, cm); f.b(0.48, 1.42, 0.38, 0.54, 0.08, g ? 0.8 : 0.46, cm); f.b(0.71, 1.18, 0, 0.08, 0.08, 0.38, M.ink);
    if (g) { f.b(0.48, 1.505, 0.52, 0.54, 0.01, 0.56, k.glow(NEON, 1.4), false); f.b(0.45, 0.98, 0.46, 0.04, 0.5, 0.18, M.ink); f.b(1.02, 0.98, 0.46, 0.04, 0.5, 0.18, M.ink); }
    f.spot("desk", 0.75, 1.15, 0.26, "sit", { az: 1.95, w: 3, min: 12, max: 26, tag: "desk" });
  } },
  bed: { fp: [1.3, 2.35], walls: ["back", "right", "left"], build: (f, k) => {
    const M = k.M; f.b(0, 0.05, 0, 1.3, 2.0, 0.26, M.ink); f.b(0.05, 0.1, 0.26, 1.2, 1.9, 0.14, M.white); f.b(0.12, 0.15, 0.4, 1.06, 0.38, 0.11, M.white);
    f.b(0.05, 0.75, 0.4, 1.2, 1.25, 0.06, k.std(0x2b3a52, 0.9)); f.b(0.05, 0.75, 0.46, 1.2, 0.03, 0.01, k.glow(NEON, 1.3), false); f.b(-0.02, 0, 0, 1.34, 0.08, 0.86, M.ink);
    f.spot("bed", 0.65, 1.25, 0.62, "lie", { face: Math.PI, ax: 0.65, az: 2.7, w: 0.3, min: 25, max: 45, night: 9 });
  } },
  dbed: { fp: [2.8, 2.4], walls: ["back", "left"], build: (f, k) => {
    const M = k.M, x = 0.6; f.b(x, 0.05, 0, 1.6, 2.05, 0.28, M.ink); f.b(x + 0.05, 0.1, 0.28, 1.5, 1.95, 0.16, M.white);
    for (const px of [x + 0.12, x + 0.84]) f.b(px, 0.15, 0.44, 0.64, 0.38, 0.12, M.white);
    f.b(x + 0.05, 0.8, 0.44, 1.5, 1.25, 0.07, k.std(0x5a2a3a, 0.9)); f.b(x + 0.05, 0.8, 0.51, 1.5, 0.03, 0.01, k.glow(PINK, 1.2), false); f.b(x - 0.04, 0, 0, 1.68, 0.1, 1.05, M.darkwood);
    for (const nx of [0, x + 1.75]) { f.b(nx, 0.05, 0, 0.45, 0.42, 0.48, M.ink); f.c(nx + 0.22, 0.26, 0.48, 0.09, 0.22, k.night(), 14); }
    f.spot("bed", x + 0.5, 1.3, 0.64, "lie", { face: Math.PI, ax: x + 0.5, az: 2.7, w: 0.4, min: 25, max: 45, night: 9 });
  } },
  toilet: { fp: [0.62, 0.9], walls: ["right", "back", "front", "left"], build: (f, k, c) => {
    const m = c.has("goldtoilet") ? k.M.gold : k.M.white; f.b(0.06, 0, 0.36, 0.5, 0.18, 0.44, m); f.b(0.13, 0.12, 0, 0.36, 0.44, 0.36, m); f.c(0.31, 0.36, 0.36, 0.2, 0.04, m, 20);
    f.spot("toilet", 0.31, 0.36, 0.2, "sit", { face: Math.PI, az: 1.3, w: 0.8, min: 5, max: 9, night: 0.4 });
  } },
  shower: { fp: [1.1, 1.1], tall: true, build: (f, k) => {
    const M = k.M, G = k.glass(0.22); f.b(0, 0, 0, 1.1, 1.1, 0.06, M.soft); f.b(0, 1.07, 0.06, 1.1, 0.03, 1.9, G, false); f.b(1.07, 0, 0.06, 0.03, 0.7, 1.9, G, false);
    f.b(0.45, 0.02, 1.85, 0.14, 0.32, 0.03, M.metal); f.b(0.02, 1.06, 1.96, 1.06, 0.03, 0.02, k.glow(CYAN, 1.2), false);
    f.spot("shower", 0.55, 0.5, 0.06, "stand", { face: Math.PI, ax: 1.45, az: 0.92, w: 0.6, min: 6, max: 10 });
  } },
  sink: { fp: [0.85, 0.6], tall: true, build: (f, k) => {
    const M = k.M; f.b(0.05, 0, 0, 0.75, 0.45, 0.78, M.ink); f.b(0, 0, 0.78, 0.85, 0.5, 0.08, M.white); f.c(0.42, 0.26, 0.8, 0.15, 0.07, M.soft, 18);
    f.b(0.06, 0.01, 1.05, 0.73, 0.02, 0.68, k.std(0xd9e4ea, 0.04, 1)); f.b(0.06, 0.02, 1.75, 0.73, 0.01, 0.015, k.glow(NEON, 1.4), false);
    f.spot("sink", 0.42, 0.8, 0, "stand", { az: 1.05, w: 0.4, min: 3, max: 5 });
  } },
  kitchen: { fp: [2.6, 0.75], tall: true, build: (f, k) => {
    const M = k.M; f.b(0, 0, 0, 2.6, 0.6, 0.86, M.ink); f.b(0, 0, 0.86, 2.6, 0.64, 0.05, M.white); f.b(0, 0, 1.5, 2.6, 0.36, 0.6, M.white); f.b(0.02, 0.36, 1.48, 2.56, 0.01, 0.02, k.glow(WARM, 1.2), false);
    f.b(0.25, 0.08, 0.88, 0.55, 0.42, 0.02, M.metal); for (const [x, z] of [[1.65, 0.18], [1.95, 0.18], [1.65, 0.44], [1.95, 0.44]]) f.c(x, z, 0.91, 0.08, 0.01, k.glow(0xff4a2a, 1.1), 16);
    f.b(1.55, 0, 1.2, 0.55, 0.4, 0.28, M.metal); for (let i = 0; i < 5; i++) f.b(0.05 + i * 0.52, 0.61, 0.15, 0.45, 0.01, 0.62, M.dark);
    f.spot("cook", 1.8, 0.95, 0, "work", { az: 1.45, w: 1.2, min: 7, max: 12 });
  } },
  tradewall: { fp: [2.8, 1.7], tall: true, build: (f, k) => {
    const M = k.M; f.b(0, 0, 0.72, 2.8, 0.78, 0.05, M.ink); for (const a of [0.05, 2.7]) f.b(a, 0.05, 0, 0.05, 0.7, 0.72, M.white); f.b(0.5, 0.02, 0.8, 1.8, 0.03, 1.12, M.ink);
    for (let i = 0; i < 4; i++) screenAt(f, k.screen(i % 2), 0.84, 0.46, 0.96 + (i % 2) * 0.88, 0.045, 1.08 + Math.floor(i / 2) * 0.5);
    screenAt(f, k.screen(2, 512, 34), 1.8, 0.12, 1.4, 0.045, 1.96);
    f.b(1.15, 1.0, 0.38, 0.5, 0.48, 0.08, M.ink); f.b(1.15, 1.42, 0.38, 0.5, 0.08, 0.72, M.ink); f.b(1.15, 1.5, 0.52, 0.5, 0.01, 0.5, k.glow(NEON, 1.3), false);
    f.spot("office", 1.4, 1.2, 0.26, "sit", { az: 2.05, w: 2.6, min: 14, max: 26, tag: "desk" });
  } },
  rack: { fp: [1.6, 1.4], tall: true, build: (f, k) => {
    const M = k.M; f.b(0, 0, 0.004, 1.6, 1.4, 0.012, k.std(0x1a1c1e, 0.95), false);
    for (const a of [0.1, 1.42]) { f.b(a, 0.2, 0, 0.08, 0.08, 1.9, M.black); f.b(a, 0.9, 0, 0.08, 0.08, 1.9, M.black); } f.b(0.1, 0.2, 1.86, 1.4, 0.78, 0.05, M.black);
    const bar = new THREE.Group(), rod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 8), M.metal); rod.rotation.z = Math.PI / 2; bar.add(rod);
    for (const a of [-0.72, 0.72]) { const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20), M.ink); pl.rotation.z = Math.PI / 2; pl.position.x = a; bar.add(pl); }
    f.put(bar, 0.8, 0.58, 1.38);
    f.spot("gym", 0.8, 0.62, 0, "lift", { face: Math.PI, az: 1.85, w: 1.4, min: 8, max: 14 });
  } },
  press: { fp: [0.7, 1.6], build: (f, k) => {
    const M = k.M; f.b(0.16, 0.2, 0.36, 0.38, 1.3, 0.08, M.ink); for (const z of [0.3, 1.3]) f.b(0.31, z, 0, 0.08, 0.08, 0.36, M.metal); for (const x of [0.06, 0.58]) f.b(x, 0.2, 0, 0.06, 0.06, 0.95, M.metal);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 8), M.metal); rod.rotation.z = Math.PI / 2; f.put(rod, 0.35, 0.23, 0.97);
    for (const x of [-0.1, 0.8]) { const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 18), M.ink); pl.rotation.z = Math.PI / 2; f.put(pl, x, 0.23, 0.97); }
  } },
  libshelf: { fp: [2.6, 0.45], tall: true, build: (f, k) => {
    f.b(0, 0, 0, 2.6, 0.42, 2.05, k.M.darkwood); const cols = [0x8c2f2f, 0x2f5c8c, 0xd9c9a8, 0x2f8c4a, 0x5a3a7a, 0xc9a227];
    for (let s = 0; s < 4; s++) { let x = 0.08, i = s * 3; while (x < 2.42) { const w = 0.06 + ((i * 37) % 5) * 0.012, h = 0.3 + ((i * 13) % 4) * 0.03; f.b(x, 0.06, 0.1 + s * 0.48, w, 0.32, h, k.std(cols[i % cols.length], 0.8), false); x += w + 0.012; i++; } }
    f.b(0, 0.43, 2.0, 2.6, 0.01, 0.015, k.glow(WARM, 1.1), false);
    f.spot("read", 1.3, 0.95, 0, "look", { az: 1.4, w: 0.8, min: 7, max: 12 });
  } },
  racks: { fp: [2.3, 0.8], tall: true, build: (f, k) => {
    const M = k.M;
    for (let i = 0; i < 3; i++) {
      const x = i * 0.78; f.b(x, 0, 0, 0.7, 0.72, 1.9, M.black);
      for (let j = 0; j < 12; j++) { const col = new THREE.Color(j % 4 === 3 ? CYAN : NEON), m = k.glow(col.getHex(), 1.4, true); k.reg.blinkers.push({ m, c: col.multiplyScalar(1.6), off: Math.random() * 10, rate: 2 + Math.random() * 6 }); f.b(x + 0.08 + (j % 3) * 0.2, 0.725, 0.22 + Math.floor(j / 3) * 0.42, 0.12, 0.01, 0.03, m, false); }
      f.b(x + 0.04, 0.725, 1.78, 0.62, 0.01, 0.02, k.glow(NEON, 0.8), false);
    }
    f.spot("servers", 1.15, 1.15, 0, "work", { az: 1.65, w: 0.8, min: 6, max: 10 });
  } },
  screenin: { fp: [2.8, 0.3], tall: true, build: (f, k) => {
    f.b(0, 0, 0.3, 2.8, 0.08, 1.5, k.M.ink); screenAt(f, k.screen(3, 384, 200), 2.6, 1.3, 1.4, 0.085, 1.05);
    for (const x of [0.0, 2.6]) f.b(x, 0.02, 0, 0.2, 0.25, 0.95, k.std(0x3a1418, 0.9));
  } },
  seats: { fp: [2.4, 2.2], center: true, build: (f, k) => {
    const red = k.std(0x8e1b25, 0.85);
    for (let r = 0; r < 2; r++) {
      const z = 0.2 + r * 1.05, y0 = r * 0.18; if (r) f.b(0, z - 0.1, 0, 2.4, 0.95, y0, k.M.dark);
      for (let i = 0; i < 3; i++) { const x = 0.12 + i * 0.75; f.b(x, z, y0 + 0.2, 0.6, 0.55, 0.18, red); f.b(x, z + 0.48, y0 + 0.2, 0.6, 0.14, 0.55, red); f.b(x - 0.05, z, y0, 0.06, 0.6, 0.48, k.M.ink); }
    }
    f.spot("movie", 1.17 - 0.38, 0.48, 0.2, "sit", { ax: -0.35, az: 0.5, w: 2.4, min: 18, max: 30, night: 3 });
  } },
  saunabench: { fp: [2.6, 1.25], build: (f, k) => {
    const ced = k.std(0xb9895a, 0.8); f.b(0, 0, 0, 2.6, 0.55, 0.85, ced); f.b(0, 0.55, 0, 2.6, 0.6, 0.42, ced);
    for (let i = 0; i < 9; i++) f.b(0.05 + i * 0.29, 0.56, 0.42, 0.02, 0.6, 0.005, k.std(0x8a6440, 0.9), false);
    f.b(0, 0, 0.85, 2.6, 0.04, 1.1, ced);
    f.spot("sauna", 1.0, 0.85, 0.42, "sit", { face: Math.PI, az: 1.7, w: 1.2, min: 10, max: 16 });
  } },
  heater: { fp: [0.7, 0.7], build: (f, k) => { f.b(0.1, 0.1, 0, 0.5, 0.5, 0.5, k.M.ink); for (let i = 0; i < 9; i++) f.s(0.18 + (i % 3) * 0.17, 0.18 + Math.floor(i / 3) * 0.17, 0.56, 0.08, i % 2 ? k.M.stone : k.glow(0xff6a2a, 0.9), 6); } },
  mixdesk: { fp: [1.8, 1.65], build: (f, k) => {
    const M = k.M; f.b(0, 0.05, 0.72, 1.8, 0.75, 0.08, M.ink); for (const a of [0.05, 1.7]) f.b(a, 0.1, 0, 0.06, 0.6, 0.72, M.ink);
    for (let i = 0; i < 14; i++) f.b(0.15 + i * 0.11, 0.35, 0.81, 0.03, 0.2, 0.015, k.glow(i % 4 ? NEON : PINK, 1.2), false);
    for (const x of [0.1, 1.45]) { f.b(x, 0.05, 0.8, 0.25, 0.22, 0.4, M.black); const cone = f.c(x + 0.125, 0.28, 0.98, 0.08, 0.01, M.metal, 14); cone.rotation.x = Math.PI / 2; }
    f.b(0.65, 1.0, 0.38, 0.5, 0.48, 0.08, M.ink); f.b(0.65, 1.44, 0.38, 0.5, 0.08, 0.6, M.ink);
    f.spot("mix", 0.9, 1.2, 0.26, "sit", { az: 1.95, w: 1.2, min: 10, max: 16 });
  } },
  mic: { fp: [0.6, 0.95], build: (f, k) => { f.c(0.3, 0.3, 0, 0.14, 0.03, k.M.ink, 14); f.c(0.3, 0.3, 0, 0.015, 1.45, k.M.metal, 6); f.s(0.3, 0.3, 1.5, 0.06, k.M.black, 10); f.spot("sing", 0.3, 0.75, 0, "dance", { az: 1.3, w: 0.8, min: 6, max: 10 }); } },
  vaultdoor: { fp: [1.8, 0.45], tall: true, build: (f, k) => {
    const st = k.std(0x8a9096, 0.3, 0.9); f.b(0, 0, 0, 1.8, 0.12, 1.9, k.M.dark);
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.18, 32), st); d.rotation.x = Math.PI / 2; f.put(d, 0.9, 0.2, 0.95);
    const wheel = new THREE.Group(); for (let i = 0; i < 3; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.05), k.M.gold); sp.rotation.z = (i * Math.PI) / 3; wheel.add(sp); }
    f.put(wheel, 0.9, 0.32, 0.95); k.reg.spinners.push({ o: wheel, axis: "z", rate: 0.15 });
    f.put(new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.025, 8, 48), k.glow(GOLD, 1.5)), 0.9, 0.21, 0.95);
    f.spot("vault", 0.9, 0.85, 0, "look", { az: 1.3, w: 0.6, min: 5, max: 8 });
  } },
  workbench: { fp: [2.0, 0.75], tall: true, build: (f, k) => {
    const M = k.M; f.b(0, 0, 0.8, 2.0, 0.7, 0.07, M.darkwood); for (const a of [0.05, 1.9]) f.b(a, 0.05, 0, 0.05, 0.6, 0.8, M.white);
    f.b(0, 0, 1.1, 2.0, 0.03, 0.8, M.ink); for (let i = 0; i < 6; i++) f.b(0.15 + i * 0.3, 0.03, 1.3 + (i % 2) * 0.2, 0.05, 0.03, 0.35, i % 3 ? M.metal : k.glow(NEON, 1), false);
    f.b(0.6, 0.15, 0.87, 0.5, 0.3, 0.12, M.metal); f.b(0.8, 0.3, 1.75, 0.4, 0.12, 0.04, k.night(0xfff2d6, 0.5), false);
    f.spot("shed", 1.0, 1.0, 0, "work", { az: 1.4, w: 1, min: 8, max: 14 });
  } },
  toolwall: { fp: [2.4, 0.45], tall: true, build: (f, k) => { const M = k.M; f.b(0, 0, 0, 2.4, 0.4, 0.9, M.ink); f.b(0, 0, 1.0, 2.4, 0.03, 0.8, M.dark); for (let i = 0; i < 8; i++) f.b(0.15 + i * 0.28, 0.03, 1.15 + (i % 3) * 0.15, 0.04, 0.03, 0.3, M.metal); } },
};
/** Pieces hung on a full wall: [length, height off the floor, builder]. */
const HANGF: Record<string, [number, number, (f: Frame, k: Kit) => void]> = {
  gymmirror: [1.4, 0.3, (f, k) => { f.b(0, 0.01, 0, 1.4, 0.02, 1.5, k.std(0xd9e4ea, 0.04, 1)); f.b(0, 0.02, 1.52, 1.4, 0.01, 0.015, k.glow(NEON, 1.4), false); }],
  foam: [2.0, 0.6, (f, k) => { for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { const p = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, 4), k.std(j % 2 === i % 2 ? 0x2a2d33 : 0x3a2a4f, 0.95)); p.rotation.x = Math.PI / 2; p.rotation.y = Math.PI / 4; f.put(p, 0.2 + i * 0.4, 0.06, 0.2 + j * 0.4); } }],
};
const ROOM_FIX: Record<string, string[]> = {
  bathroom: ["shower", "toilet", "sink"], kitchen: ["kitchen"], bedroom: ["dbed"], office: ["tradewall"], gym: ["rack", "press"], library: ["libshelf"], servers: ["racks"],
  cinema: ["screenin", "seats"], sauna: ["saunabench", "heater"], studio: ["mixdesk", "mic"], vault: ["vaultdoor"], gameroom: [],
};
const ROOM_HANG: Record<string, string[]> = { gym: ["gymmirror"], studio: ["foam"] };
const TALL = new Set(["wardrobe", "shelf", "fridge", "winerack", "vending", "arcade", "jukebox", "mirror", "fireplace", "lamp", "punchbag", "pinball", "popcorn", "bust", "cattree", "miningrig", "monstera"]);
const CENTER = new Set(["rug", "coffeetable", "dining", "foosball", "pingpong", "pooltable", "vr", "hologram", "drums", "globe", "beanbag", "massage"]);
const FLAT = new Set(["rug", "yogamat"]);
/** Rooms that take overflow furniture, in order. */
const LOUNGES = ["core", "bedroom", "gameroom", "library", "kitchen", "office", "studio", "cinema", "gym"];

// ------------------------------------------------------------------ the whole house
export type HouseOut = { rooms: Room[]; door: { x: number; y: number }; placed: Set<string> };
export function buildHouse(k: Kit, c: Ctx, house: string): HouseOut {
  const H = HOUSES[house] ?? HOUSES.shack, rooms = plan(house, c.has), cr = rooms[0].r;
  const { doors, hangs } = shell(k, rooms, { trim: H.trim, glass: (r) => r.kind === "core" && !!H.glass, door: DOOR_X, led: c.has("ledstrip") });
  // the front step
  k.box(DOOR_X - 0.7, cr.y + cr.d + 0.07, -0.01, 1.4, 0.45, 0.06, k.M.white);
  const packs = new Map<string, Pack>(); for (const rm of rooms) if (rm.kind !== "hall") packs.set(rm.id, new Pack(rm, doors));
  const placed = new Set<string>();
  const inward = (side: Wall) => (side === "back" ? new THREE.Vector3(0, 0, 1) : side === "left" ? new THREE.Vector3(1, 0, 0) : side === "front" ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-1, 0, 0));

  const put = (roomId: string, fp: [number, number], o: { tall?: boolean; center?: boolean; walls?: Wall[]; flat?: boolean }, build: (f: Frame) => void) => {
    const P = packs.get(roomId); if (!P) return false;
    const walls = o.walls ? o.walls.filter((w) => !o.tall || w === "back" || w === "left") : o.tall ? (["back", "left"] as Wall[]) : (["back", "left", "right", "front"] as Wall[]);
    const at = o.center ? P.center(fp[0], fp[1]) : P.wall(fp[0], fp[1], walls);
    if (!at) return false;
    const f = k.frame(at.rect, at.wall); build(f);
    if (!o.flat) k.nav.block({ x: at.rect.x + 0.04, y: at.rect.y + 0.04, w: at.rect.w - 0.08, d: at.rect.d - 0.08 }, 0.12);
    if (!o.center) { const top = new THREE.Box3().setFromObject(f.g).max.y; P.uses.push({ side: at.wall, a: at.s, b: at.s + fp[0], top }); }
    return true;
  };
  const mount = (rm: Room, W: Hang, s: number, len: number, h: number, build: (f: Frame) => void) => {
    const r = rm.r, rect: R = W.side === "back" ? { x: r.x + s, y: r.y, w: len, d: 0.1 } : W.side === "left" ? { x: r.x, y: r.y + r.d - s - len, w: 0.1, d: len } : W.side === "front" ? { x: r.x + r.w - s - len, y: r.y + r.d - 0.1, w: len, d: 0.1 } : { x: r.x + r.w - 0.1, y: r.y + s, w: 0.1, d: len };
    const f = k.frame(rect, W.side); build(f); f.g.position.y += h; f.g.position.addScaledVector(inward(W.side), T / 2 + 0.005);
    W.used.push([s, s + len]);
  };
  const hang = (roomId: string, len: number, h: number, build: (f: Frame) => void) => {
    const rm = rooms.find((x) => x.id === roomId), P = packs.get(roomId); if (!rm || !P || h + 0.3 > rm.h + 0.4) return false;
    for (const W of hangs.filter((x) => x.room === roomId)) {
      for (let s = W.a + 0.25; s + len <= W.b - 0.25; s += 0.1) {
        if (P.uses.some((u) => u.side === W.side && u.a < s + len + 0.1 && u.b + 0.1 > s && u.top > h - 0.05) || W.used.some(([a, b]) => a < s + len + 0.15 && b + 0.15 > s)) continue;
        mount(rm, W, s, len, h, build); return true;
      }
    }
    return false;
  };

  // 1. room signs and the fixtures each room comes with
  for (const rm of rooms) if (rm.kind === "wing" && LABEL[rm.id]) hang(rm.id, 0.95, rm.h - 0.42, (f) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.24), k.sign(LABEL[rm.id], "#39ff88", 256, 64, 32, "#0b0d0c")); f.put(p, 0.475, 0.01, 0.12); });
  const coreFix = ["desk", ...(c.has("bedroom") ? [] : ["bed"]), ...(c.has("bathroom") ? [] : ["toilet"])];
  for (const id of coreFix) { const d = FIX[id]; put("core", d.fp, d, (f) => d.build(f, k, c)); }
  for (const rm of rooms) {
    for (const id of ROOM_FIX[rm.id] ?? []) { const d = FIX[id]; put(rm.id, d.fp, d, (f) => d.build(f, k, c)); }
    for (const id of ROOM_HANG[rm.id] ?? []) { const [len, h, b] = HANGF[id]; hang(rm.id, len, h, (f) => b(f, k)); }
  }
  // 2. what you bought: biggest first, in its own room if you have it, else the house, else any room with space
  const owned = ITEMS.filter((it) => it.kind === "indoor" && c.has(it.id) && !MODIFIERS.has(it.id) && INDOOR[it.id]);
  const order = (it: (typeof owned)[number]) => { const d = INDOOR[it.id]; return d.wall ? -1 : CENTER.has(it.id) ? d.fp[0] * d.fp[1] * 0.5 : d.fp[0] * d.fp[1]; };
  owned.sort((a, b) => order(b) - order(a));
  const have = rooms.filter((r) => r.kind !== "hall").map((r) => r.id);
  for (const it of owned) {
    const d = INDOOR[it.id], first = it.room && have.includes(it.room) ? it.room : "core";
    const tries = [first, ...LOUNGES.filter((x) => x !== first && have.includes(x))];
    for (const roomId of tries) {
      const ok = d.wall ? hang(roomId, d.fp[0], d.h ?? 1.2, (f) => d.build(f, k, c)) : put(roomId, d.fp, { tall: TALL.has(it.id), center: CENTER.has(it.id), flat: FLAT.has(it.id) }, (f) => d.build(f, k, c));
      if (ok) { placed.add(it.id); break; }
    }
  }
  // 3. lit windows in the free parts of the far walls (glass walls are all window already)
  for (const W of hangs) {
    const rm = rooms.find((x) => x.id === W.room)!; if (rm.kind === "core" && H.glass) continue;
    const P = packs.get(W.room)!, busy = (s: number, e: number) => P.uses.some((u) => u.side === W.side && u.a < e + 0.05 && u.b + 0.05 > s && u.top > 0.8) || W.used.some(([a, b]) => a < e + 0.1 && b + 0.1 > s);
    for (let s = W.a + 0.35; s + 0.85 <= W.b - 0.3; s += 0.1) {
      if (busy(s, s + 0.85)) continue;
      mount(rm, W, s, 0.85, 0.85, (f) => { const m = k.night(); f.b(0, 0.005, 0, 0.85, 0.012, 0.75, m, false); f.b(-0.04, 0.01, -0.05, 0.93, 0.03, 0.05, k.M.ink, false); f.b(0.41, 0.012, 0, 0.03, 0.02, 0.75, k.M.ink, false); f.b(-0.04, 0.01, 0.75, 0.93, 0.03, 0.04, k.M.ink, false); });
      s += 1.6;
    }
  }
  // 4. the chandelier hangs from two open beams over the house
  if (c.has("chandelier")) {
    const h = H.h; for (const x of [cr.x + cr.w * 0.35, cr.x + cr.w * 0.65]) k.box(x - 0.06, cr.y, h - 0.12, 0.12, cr.d, 0.12, k.M.darkwood);
    const g = new THREE.Group(); const p = k.W(cr.x + cr.w / 2, cr.y + cr.d / 2); g.position.set(p.x, h - 0.75, p.z);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 32), k.M.gold); ring.rotation.x = Math.PI / 2; g.add(ring);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, cry = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), k.night(0xfff6e0, 0.9)); cry.position.set(Math.cos(a) * 0.42, -0.08, Math.sin(a) * 0.42); g.add(cry); }
    g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), k.night(0xfff6e0, 1)));
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.65, 6), k.M.gold); rod.position.y = 0.33; g.add(rod);
    const L = new THREE.PointLight(0xffe7c0, 0, 7); g.add(L); k.reg.lamps.push(L); k.root.add(g);
  }
  return { rooms, door: { x: DOOR_X, y: cr.y + cr.d + 0.6 }, placed };
}

/** Unbuilt rooms as marked-out lots on the ground with the name, level and price. */
export function drawLots(k: Kit, list: ReturnType<typeof nextLots>) {
  const line = k.glow(0x6f7a74, 0.55);
  for (const l of list) {
    const r = l.r;
    for (let x = r.x; x < r.x + r.w - 0.1; x += 0.5) { k.box(x, r.y, 0.005, 0.3, 0.04, 0.004, line, false); k.box(x, r.y + r.d - 0.04, 0.005, 0.3, 0.04, 0.004, line, false); }
    for (let y = r.y; y < r.y + r.d - 0.1; y += 0.5) { k.box(r.x, y, 0.005, 0.04, 0.3, 0.004, line, false); k.box(r.x + r.w - 0.04, y, 0.005, 0.04, 0.3, 0.004, line, false); }
    for (const [x, y] of [[r.x, r.y], [r.x + r.w - 0.08, r.y], [r.x, r.y + r.d - 0.08], [r.x + r.w - 0.08, r.y + r.d - 0.08]]) k.box(x, y, 0, 0.08, 0.08, 0.28, k.glow(NEON, 0.9), false);
    const t = k.tex(512, 256, (g) => { g.textAlign = "center"; g.fillStyle = "rgba(220,228,224,0.85)"; let fs = 56; do { g.font = `600 ${fs}px 'Space Grotesk', sans-serif`; fs -= 4; } while (g.measureText(l.name.toUpperCase()).width > 470 && fs > 20); g.fillText(l.name.toUpperCase(), 256, 120); g.fillStyle = "rgba(57,255,136,0.85)"; g.font = "500 38px 'JetBrains Mono', monospace"; g.fillText(`LV ${l.level} · ${l.cost.toLocaleString("en-US")} BRICKS`, 256, 185); });
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }); (m as unknown as { toneMapped: boolean }).toneMapped = false;
    const sz = Math.min(r.w - 0.4, 3.4), pl = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz / 2), m); pl.rotation.x = -Math.PI / 2; const p = k.W(r.x + r.w / 2, r.y + r.d / 2); pl.position.set(p.x, 0.012, p.z); k.root.add(pl);
  }
}

// ------------------------------------------------------------------ garden buildings
/** Builds one garden building; returns where the car parks (the garage) if anything. */
export function gardenBuilding(k: Kit, c: Ctx, id: string): { park?: { x: number; y: number; yaw: number } } {
  const r = GARDEN_ROOMS[id], M = k.M; if (!r) return {};
  const room = (floor: number, wall: number): Room => ({ id, r: { x: r.x, y: r.y, w: r.w, d: r.d }, floor, wall, h: r.h, kind: "wing" });
  if (id === "shed" || id === "garage") {
    const rm = room(id === "shed" ? 0x3a2f26 : 0x1d2124, id === "shed" ? 0x6b5a48 : 0x343a44);
    const { doors, hangs } = shell(k, [rm], { trim: NEON, glass: () => false, led: false, open: id === "garage" ? { garage: ["right"] } : undefined });
    const P = new Pack(rm, doors);
    const fix = id === "shed" ? FIX.workbench : FIX.toolwall, at = P.wall(fix.fp[0], fix.fp[1], id === "shed" ? ["back"] : ["left", "back"]);
    if (at) { const f = k.frame(at.rect, at.wall); fix.build(f, k, c); k.nav.block(at.rect, 0.1); }
    const W = hangs.find((h) => h.side === "back"); if (W) { const f = k.frame({ x: r.x + 0.3, y: r.y, w: 0.9, d: 0.1 }, "back"); f.put(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), k.sign(LABEL[id], "#39ff88", 256, 64, 32, "#0b0d0c")), 0.45, 0.08, r.h - 0.32); }
    if (id === "garage") { k.box(r.x + 0.4, r.y + r.d / 2 - 0.02, r.h - 0.12, r.w - 0.8, 0.04, 0.02, k.glow(NEON, 1.6), false); for (const y of [r.y, r.y + r.d - 0.06]) k.box(r.x + r.w - 0.06, y, 0, 0.06, 0.06, r.h - 0.1, M.white); return { park: { x: r.x + r.w / 2 + 0.4, y: r.y + r.d / 2 + 0.3, yaw: Math.PI / 2 } }; }
    return {};
  }
  if (id === "greenhouse") {
    k.box(r.x, r.y, -0.05, r.w, r.d, 0.06, k.std(0x101513, 0.3, 0.3), false);
    const G = k.glass(0.18), dx = r.x + r.w / 2;
    for (const [x, y, w, d] of [[r.x, r.y, r.w, 0.03], [r.x, r.y, 0.03, r.d], [r.x + r.w - 0.03, r.y, 0.03, r.d], [r.x, r.y + r.d - 0.03, dx - 0.5 - r.x, 0.03], [dx + 0.5, r.y + r.d - 0.03, r.x + r.w - dx - 0.5, 0.03]]) { k.box(x, y, 0.06, w, d, 1.8, G, false); k.nav.block({ x, y, w, d }, 0.15); }
    for (const [x, y] of [[r.x, r.y], [r.x + r.w - 0.06, r.y], [r.x, r.y + r.d - 0.06], [r.x + r.w - 0.06, r.y + r.d - 0.06]]) k.box(x, y, 0, 0.06, 0.06, 2.1, M.white);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(r.d / 2, r.d / 2, r.w, 3, 1, true, 0, Math.PI), G); roof.rotation.z = Math.PI / 2; roof.scale.set(1, 1, 0.55); const p = k.W(r.x + r.w / 2, r.y + r.d / 2); roof.position.set(p.x, 1.88, p.z); k.root.add(roof);
    k.box(r.x, r.y - 0.02, 1.86, r.w, 0.04, 0.04, k.glow(NEON, 1.3), false);
    for (let i = 0; i < 2; i++) {
      const y = r.y + 0.3 + i * 1.4; k.box(r.x + 0.3, y, 0, r.w - 0.9, 0.55, 0.45, M.ink); k.nav.block({ x: r.x + 0.3, y, w: r.w - 0.9, d: 0.55 });
      for (let j = 0; j < 5; j++) { const pl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17 + (j % 2) * 0.05, 0), j % 2 ? M.leaf : M.leaf2); const q = k.W(r.x + 0.55 + j * ((r.w - 1.3) / 4), y + 0.27); pl.position.set(q.x, 0.62, q.z); pl.castShadow = true; k.root.add(pl); if (j % 2 === 0) { const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), k.glow([0xff7ab8, 0xffd84d, 0xffffff][(i + j) % 3], 1.1)); fl.position.set(q.x, 0.82, q.z); k.root.add(fl); } }
    }
    k.reg.spots.push({ act: "greenhouse", at: { x: dx, y: r.y + r.d + 0.6 }, pose: { x: dx - 0.3, y: r.y + 1.0, z: 0.02, yaw: Math.PI, kind: "work" }, min: 7, max: 12, w: 1 });
    return {};
  }
  if (id === "observatory") {
    const cx = r.x + r.w / 2, cy = r.y + r.d / 2, R0 = r.w / 2, p = k.W(cx, cy);
    k.cyl(cx, cy, 0, R0, 0.3, M.white, 40); k.cyl(cx, cy, 0.3, R0 - 0.05, 0.02, k.std(0x101312, 0.3, 0.4), 40);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R0, 0.02, 6, 64), k.glow(NEON, 1.6)); ring.rotation.x = Math.PI / 2; ring.position.set(p.x, 0.3, p.z); k.root.add(ring);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R0 - 0.08, 40, 20, Math.PI * 0.5, Math.PI * 1.15, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe4e7e5, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide })); dome.position.set(p.x, 1.1, p.z); dome.rotation.y = Math.PI * 0.12; dome.castShadow = true; k.root.add(dome);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R0 - 0.08, R0 - 0.08, 0.8, 40, 1, true, Math.PI * 0.62, Math.PI * 1.15), new THREE.MeshStandardMaterial({ color: 0xd8dbd9, roughness: 0.6, side: THREE.DoubleSide })); wall.position.set(p.x, 0.7, p.z); k.root.add(wall);
    const tg = new THREE.Group(); tg.position.set(p.x, 0.3, p.z); k.root.add(tg);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.8, 12), M.ink); leg.position.y = 0.4; tg.add(leg);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 1.3, 20), M.black); tube.position.set(0, 1.05, -0.2); tube.rotation.x = -0.75; tube.castShadow = true; tg.add(tube);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20), k.glow(CYAN, 1.6)); lens.position.set(0, 1.5, -0.62); lens.rotation.x = -0.75; tg.add(lens);
    k.nav.blockCircle({ x: cx, y: cy }, 0.25);
    for (let a = Math.PI * 0.62; a < Math.PI * 1.77; a += 0.12) k.nav.blockCircle({ x: cx + Math.cos(a) * (R0 - 0.1), y: cy - Math.sin(a) * (R0 - 0.1) }, 0.12);
    k.reg.spots.push({ act: "observatory", at: { x: cx + 0.2, y: cy + R0 + 0.5 }, pose: { x: cx + 0.05, y: cy + 0.55, z: 0.3, yaw: Math.PI, kind: "look" }, min: 8, max: 14, w: 0.9, night: 3 });
    return {};
  }
  if (id === "helipad") {
    const cx = r.x + r.w / 2, cy = r.y + r.d / 2, p = k.W(cx, cy);
    k.box(r.x, r.y, 0, r.w, r.d, 0.22, M.black);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r.w * 0.36, r.w * 0.39, 64), k.glow(0xffffff, 0.9)); ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, 0.225, p.z); k.root.add(ring);
    const hm = k.glow(0xffffff, 0.9); k.box(cx - 0.55, cy - 0.65, 0.222, 0.2, 1.3, 0.005, hm, false); k.box(cx + 0.35, cy - 0.65, 0.222, 0.2, 1.3, 0.005, hm, false); k.box(cx - 0.35, cy - 0.1, 0.222, 0.7, 0.2, 0.005, hm, false);
    for (const [x, y] of [[r.x + 0.1, r.y + 0.1], [r.x + r.w - 0.2, r.y + 0.1], [r.x + 0.1, r.y + r.d - 0.2], [r.x + r.w - 0.2, r.y + r.d - 0.2]]) { const m = k.glow(NEON, 2, true); k.reg.blinkers.push({ m, c: new THREE.Color(NEON).multiplyScalar(2.2), off: 0, rate: 1.2 }); k.box(x, y, 0.22, 0.1, 0.1, 0.06, m, false); }
    const h = new THREE.Group(); h.position.set(p.x - 0.3, 0.22, p.z - 0.3); h.rotation.y = 0.6; k.root.add(h);
    const paint = k.std(0xeef1ef, 0.3, 0.3);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), paint); body.scale.set(1.4, 0.85, 0.85); body.position.y = 0.7; body.castShadow = true; h.add(body);
    const win = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 12, 0, Math.PI, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x0b1416, roughness: 0.05, metalness: 0.4, clearcoat: 1 })); win.scale.set(1.4, 0.9, 0.95); win.position.set(0.15, 0.72, 0); win.rotation.y = -Math.PI / 2; h.add(win);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 1.4, 10), paint); boom.rotation.z = Math.PI / 2; boom.position.set(-1.25, 0.8, 0); h.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.35, 0.03), k.glow(NEON, 1.4)); fin.position.set(-1.9, 0.95, 0); h.add(fin);
    for (const z of [-0.35, 0.35]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.04), M.ink); sk.position.set(0, 0.08, z); h.add(sk); for (const x of [-0.35, 0.35]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03), M.ink); st.position.set(x, 0.24, z * 0.8); h.add(st); } }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8), M.ink); mast.position.y = 1.2; h.add(mast);
    const rotor = new THREE.Group(); rotor.position.y = 1.33; h.add(rotor); for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.015, 0.1), M.ink); b.rotation.y = (i * Math.PI) / 2; rotor.add(b); }
    k.reg.spinners.push({ o: rotor, axis: "y", rate: 0.6 });
    k.nav.blockCircle({ x: cx - 0.3, y: cy - 0.3 }, 0.95);
    k.reg.spots.push({ act: "helipad", at: { x: cx + 0.9, y: r.y + r.d + 0.5 }, pose: { x: cx + 1.0, y: cy + 1.1, z: 0.22, yaw: Math.PI * 0.85, kind: "look" }, min: 6, max: 10, w: 0.6 });
    return {};
  }
  if (id === "treehouse") {
    const cx = r.x + r.w / 2, cy = r.y + r.d / 2, H0 = 2.4, p = k.W(cx, cy);
    k.cyl(cx, cy, 0, 0.32, 4.8, M.darkwood, 10, 0.2);
    for (const [ox, oy, oz, rad, m] of [[0, 5.2, 0, 1.6, M.leaf], [0.9, 4.6, 0.5, 1.1, M.leaf2], [-0.8, 4.8, -0.4, 1.1, M.leaf2], [0.2, 6.1, 0.1, 1.0, M.leaf]] as [number, number, number, number, THREE.Material][]) { const cr = new THREE.Mesh(new THREE.IcosahedronGeometry(rad, 1), m); cr.position.set(p.x + ox, oy, p.z + oz); cr.castShadow = true; k.root.add(cr); }
    k.box(r.x, r.y, H0, r.w, r.d, 0.12, M.wood);
    for (const [x, y] of [[r.x, r.y], [r.x + r.w - 0.12, r.y], [r.x, r.y + r.d - 0.12], [r.x + r.w - 0.12, r.y + r.d - 0.12]]) { k.box(x, y, 0, 0.12, 0.12, H0, M.darkwood); k.nav.block({ x, y, w: 0.12, d: 0.12 }, 0.14); }
    for (const [x, y, w, d] of [[r.x, r.y, r.w, 0.06], [r.x, r.y, 0.06, r.d], [r.x + r.w - 0.06, r.y, 0.06, r.d]]) k.box(x, y, H0 + 0.12, w, d, 0.5, M.darkwood);
    k.box(r.x + 0.3, r.y + 0.15, H0 + 0.12, 1.4, 1.1, 1.0, k.std(0x9c6b3e, 0.8));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.7, 4), M.red); roof.rotation.y = Math.PI / 4; const q = k.W(r.x + 1.0, r.y + 0.7); roof.position.set(q.x, H0 + 1.47, q.z); roof.castShadow = true; k.root.add(roof);
    k.box(r.x + 0.8, r.y + 1.24, H0 + 0.35, 0.4, 0.02, 0.6, k.night(), false);
    // rope ladder down the front
    for (const x of [cx - 0.25, cx + 0.25]) k.box(x, r.y + r.d + 0.05, 0, 0.03, 0.03, H0 + 0.1, k.std(0xd9c9a8, 0.9));
    for (let i = 0; i < 7; i++) k.box(cx - 0.25, r.y + r.d + 0.04, 0.25 + i * 0.32, 0.53, 0.05, 0.04, M.wood);
    k.nav.blockCircle({ x: cx, y: cy }, 0.4);
    k.reg.spots.push({ act: "treehouse", at: { x: cx, y: r.y + r.d + 0.7 }, pose: { x: cx + 0.6, y: r.y + r.d - 0.45, z: H0 + 0.12, yaw: 0, kind: "look" }, min: 10, max: 16, w: 1.2 });
    return {};
  }
  return {};
}
