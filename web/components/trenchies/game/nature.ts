/**
 * The land itself: grass, the ring road with its street lamps, stone paths, the forest down the left side (with a
 * big old oak at its edge), the pond with koi and a dock to sit on, grass and wild flowers, and the butterflies that
 * drift around the garden (moths at night).
 */
import * as THREE from "three";
import { CYAN, GOLD, NEON, type Kit } from "./kit";
import { CHOP, DOCK, DOOR_X, FOREST, LAND, POND, ROAD } from "./layout";
import type { Pt, R } from "./nav";
import { poolMaterial, poolTexture } from "./wilds";

const rnd = (() => { let s = 4242; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const inR = (p: Pt, r: R, pad = 0) => p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.d + pad;

// ------------------------------------------------------------------ ground, road, lamps
let GRASS: THREE.Texture | null = null;
function grassTex() {
  if (GRASS) return GRASS;
  const S = 256, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d")!;
  g.fillStyle = "#16301f"; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) { const v = rnd(); g.fillStyle = v < 0.5 ? "rgba(40,84,52,0.55)" : v < 0.85 ? "rgba(22,52,32,0.6)" : "rgba(64,110,64,0.4)"; g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 2 + rnd() * 4); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(9, 9); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; GRASS = t; return t;
}
export function ground(k: Kit, pools: THREE.MeshBasicMaterial[]) {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(LAND, 0.1, LAND), new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 0.95 }));
  slab.position.set(0, -0.06, 0); slab.receiveShadow = true; k.root.add(slab);
  const rim = k.glow(NEON, 1.4);
  for (const [x, y, w, d] of [[0, 0, LAND, 0.05], [0, LAND - 0.05, LAND, 0.05], [0, 0, 0.05, LAND], [LAND - 0.05, 0, 0.05, LAND]]) k.box(x, y, -0.01, w, d, 0.03, rim, false);
  const asphalt = k.std(0x15181c, 0.9, 0.1), RW = 1.25, a0 = ROAD - RW / 2;
  for (const [x, y, w, d] of [[a0, a0, LAND - 2 * a0, RW], [a0, LAND - a0 - RW, LAND - 2 * a0, RW], [a0, a0 + RW, RW, LAND - 2 * a0 - 2 * RW], [LAND - a0 - RW, a0 + RW, RW, LAND - 2 * a0 - 2 * RW]]) k.box(x, y, -0.01, w, d, 0.02, asphalt, false).castShadow = false;
  const dash = k.glow(0xffffff, 0.55);
  for (let q = 2; q < LAND - 2; q += 1.2) { k.box(q, ROAD - 0.03, 0.011, 0.55, 0.06, 0.004, dash, false); k.box(q, LAND - ROAD - 0.03, 0.011, 0.55, 0.06, 0.004, dash, false); k.box(ROAD - 0.03, q, 0.011, 0.06, 0.55, 0.004, dash, false); k.box(LAND - ROAD - 0.03, q, 0.011, 0.06, 0.55, 0.004, dash, false); }
  const edge = k.glow(NEON, 0.9), ie = a0 + RW;
  for (const [x, y, w, d] of [[ie, ie, LAND - 2 * ie, 0.03], [ie, LAND - ie - 0.03, LAND - 2 * ie, 0.03], [ie, ie, 0.03, LAND - 2 * ie], [LAND - ie - 0.03, ie, 0.03, LAND - 2 * ie]]) k.box(x, y, 0.012, w, d, 0.004, edge, false);
  const tex = poolTexture(), pole = k.std(0x2c3036, 0.5, 0.6), head = k.glow(0xffd9a0, 1.6);
  const lamp = (x: number, y: number) => {
    k.cyl(x, y, 0, 0.045, 1.9, pole, 8); k.box(x - 0.13, y - 0.06, 1.88, 0.26, 0.12, 0.06, head, false);
    const pm = poolMaterial(tex, 0.5); pools.push(pm); const pl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), pm); pl.rotation.x = -Math.PI / 2; const p = k.W(x, y); pl.position.set(p.x, 0.02, p.z); pl.renderOrder = 1; k.root.add(pl);
    k.nav.blockCircle({ x, y }, 0.06);
  };
  for (let q = 3; q < LAND - 2; q += 6.5) { lamp(q, 1.85); lamp(1.85, q + 1.2); lamp(LAND - 1.85, q + 1.2); if (Math.abs(q - DOOR_X) > 2.4) lamp(q, LAND - 1.85); }
  return lamp;
}

/** Flat stepping stones along a straight line. */
export function stones(k: Kit, a: Pt, b: Pt, w = 0.95) {
  const m = k.std(0xb9bdb9, 0.85), L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.floor(L / 0.92)), hz = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t; if (hz) k.box(x - 0.4, y - w / 2, -0.01, 0.8, w, 0.03, m, false).castShadow = false; else k.box(x - w / 2, y - 0.4, -0.01, w, 0.8, 0.03, m, false).castShadow = false; }
}

// ------------------------------------------------------------------ the forest

function bigTree(k: Kit, s: number) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * s, 0.18 * s, 1.5 * s, 9), k.M.darkwood); trunk.position.y = 0.75 * s; trunk.castShadow = true; g.add(trunk);
  for (const [x, y, z, r, m] of [[0, 1.9, 0, 0.95, k.M.leaf], [0.45, 2.4, 0.15, 0.62, k.M.leaf2], [-0.4, 2.3, -0.2, 0.6, k.M.leaf], [0.05, 2.85, -0.05, 0.45, k.M.leaf2]] as [number, number, number, number, THREE.Material][]) { const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), m); c.position.set(x * s, y * s, z * s); c.castShadow = true; g.add(c); }
  return g;
}
/** Trees across the forest strip (instanced), leaving clearings where `keepOut` says, and the big oak at its edge. */
export function forest(k: Kit, keepOut: R[]) {
  const trees: THREE.Matrix4[] = [], pines: THREE.Matrix4[] = [], stumps: THREE.Matrix4[] = [];
  const m4 = (x: number, y: number, s: number, ry: number) => { const p = k.W(x, y); return new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s * (0.85 + rnd() * 0.35), s)); };
  for (let y = FOREST.y + 0.6; y < FOREST.y + FOREST.d - 0.4; y += 1.25) for (let x = FOREST.x + 0.5; x < FOREST.x + FOREST.w - 0.3; x += 1.35) {
    const p = { x: x + (rnd() - 0.5) * 0.9, y: y + (rnd() - 0.5) * 0.8 };
    if (keepOut.some((r) => inR(p, r, 0.5)) || Math.hypot(p.x - CHOP.x, p.y - CHOP.y) < 1.9) continue;
    const edge = p.x > FOREST.x + FOREST.w - 1.4; if (edge && rnd() < 0.45) continue;
    const s = 0.95 + rnd() * 0.75;
    if (rnd() < 0.08) { stumps.push(m4(p.x, p.y, 0.7 + rnd() * 0.4, rnd() * 6)); continue; }
    (rnd() < 0.38 ? pines : trees).push(m4(p.x, p.y, s, rnd() * 6));
    k.nav.blockCircle(p, 0.16 * s);
  }
  const leaf = k.flat(0x1d4428), leaf2 = k.flat(0x285c33), pine = k.flat(0x173d29), bark = k.M.darkwood;
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, list: THREE.Matrix4[], shadow = true) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, m, list.length); list.forEach((x, i) => im.setMatrixAt(i, x)); im.castShadow = shadow; im.receiveShadow = true; k.keep(im); k.root.add(im); };
  const trunk = new THREE.CylinderGeometry(0.07, 0.11, 0.9, 6); trunk.translate(0, 0.45, 0);
  const crownA = new THREE.IcosahedronGeometry(0.62, 1); crownA.translate(0, 1.2, 0);
  const crownB = new THREE.IcosahedronGeometry(0.42, 1); crownB.translate(0.22, 1.65, 0.06);
  add(trunk, bark, trees); add(crownA, leaf, trees); add(crownB, leaf2, trees, false);
  const ptrunk = new THREE.CylinderGeometry(0.06, 0.09, 0.6, 6); ptrunk.translate(0, 0.3, 0);
  const c1 = new THREE.ConeGeometry(0.62, 1.0, 7); c1.translate(0, 0.95, 0); const c2 = new THREE.ConeGeometry(0.48, 0.85, 7); c2.translate(0, 1.45, 0); const c3 = new THREE.ConeGeometry(0.32, 0.7, 7); c3.translate(0, 1.9, 0);
  add(ptrunk, bark, pines); add(c1, pine, pines); add(c2, pine, pines, false); add(c3, leaf2, pines, false);
  const st = new THREE.CylinderGeometry(0.14, 0.17, 0.22, 9); st.translate(0, 0.11, 0); add(st, k.std(0xb08d64, 0.8), stumps);
  // ferns and mushrooms on the forest floor
  const fern: THREE.Matrix4[] = []; for (let i = 0; i < 90; i++) { const p = { x: FOREST.x + rnd() * FOREST.w, y: FOREST.y + rnd() * FOREST.d }; if (keepOut.some((r) => inR(p, r))) continue; fern.push(m4(p.x, p.y, 0.6 + rnd() * 0.6, rnd() * 6)); }
  const fg = new THREE.ConeGeometry(0.16, 0.32, 5); fg.translate(0, 0.16, 0); add(fg, k.flat(0x2e6b3a), fern, false);
  // the big oak, with a bench-like root to sit on
  const g = new THREE.Group(), p = k.W(CHOP.x, CHOP.y); g.position.set(p.x, 0, p.z); k.root.add(g);
  g.add(bigTree(k, 1.15));
  k.nav.blockCircle(CHOP, 0.32);
  k.reg.spots.push({ act: "oak", at: { x: CHOP.sx, y: CHOP.sy }, pose: { x: CHOP.sx - 0.25, y: CHOP.sy - 0.15, z: 0, yaw: Math.atan2(CHOP.x - CHOP.sx, CHOP.y - CHOP.sy) + Math.PI, kind: "sit" }, min: 8, max: 14, w: 0.6 });
}

// ------------------------------------------------------------------ the pond
export type Pond = { g: THREE.Group; fish: { m: THREE.Object3D; a: number; r: number; v: number }[] };
export function pond(k: Kit): Pond {
  const c = POND, g = new THREE.Group(), p = k.W(c.x, c.y); g.position.set(p.x, 0, p.z); k.root.add(k.keep(g));
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.12, 64), k.std(0x2a2f2e, 0.85, 0.1)); rim.scale.set(c.rx + 0.25, 1, c.ry + 0.25); rim.position.y = 0.05; rim.receiveShadow = true; g.add(rim);
  const wm = k.glow(0x1f8fb0, 0.75, true); k.reg.water.push(wm);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.02, 64), wm); water.scale.set(c.rx, 1, c.ry); water.position.y = 0.11; g.add(water);
  const deep = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0x0b3a4f, transparent: true, opacity: 0.45, depthWrite: false })); deep.rotation.x = -Math.PI / 2; deep.scale.set(c.rx * 0.6, c.ry * 0.6, 1); deep.position.y = 0.122; g.add(deep);
  for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2, st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + (i % 3) * 0.04, 0), k.std(0x3a3f3e, 0.85, 0.1)); st.position.set(Math.cos(a) * (c.rx + 0.22), 0.12, Math.sin(a) * (c.ry + 0.22)); st.rotation.set(i, i * 2, 0); st.castShadow = true; g.add(st); }
  for (const [x, z, r] of [[1.1, -0.9, 0.22], [-0.6, 1.0, 0.18], [2.0, 0.6, 0.16], [0.3, -1.4, 0.15], [-1.6, -0.5, 0.2]] as [number, number, number][]) { const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 14, 0.3, Math.PI * 1.8), k.std(0x1f4a2c, 0.7)); pad.rotation.x = -Math.PI / 2; pad.position.set(x, 0.125, z); g.add(pad); }
  for (const [x, z] of [[1.1, -0.9], [-1.6, -0.5]]) { const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), k.glow(0xff7ab8, 1.3)); fl.position.set(x, 0.17, z); g.add(fl); }
  for (let i = 0; i < 6; i++) { const reed = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7 + rnd() * 0.4, 4), k.flat(0x3c7a45)); const a = 2.2 + rnd() * 1.2; reed.position.set(Math.cos(a) * (c.rx - 0.1) + rnd() * 0.3, 0.45, Math.sin(a) * (c.ry - 0.1)); g.add(reed); const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), k.std(0x6b4a2a, 0.9)); tip.position.set(reed.position.x, 0.85 + rnd() * 0.15, reed.position.z); g.add(tip); }
  const fish: Pond["fish"] = [];
  for (let i = 0; i < 7; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 6), k.glow([0xff8a3d, 0xffffff, 0xff8a3d, GOLD, 0xff5a3d, 0xffffff, 0xff8a3d][i], 1.3)); f.rotation.z = Math.PI / 2; const fg = new THREE.Group(); fg.add(f); fg.position.y = 0.09; g.add(fg); fish.push({ m: fg, a: rnd() * 6, r: 0.4 + rnd() * 1.3, v: (0.22 + rnd() * 0.3) * (i % 2 ? 1 : -1) }); }
  // the dock: from the bank out over the water
  const wood = k.std(0x6b5238, 0.85), plank = k.std(0x4a3a2c, 0.9), L = DOCK.x1 - DOCK.x0;
  k.box(DOCK.x0, DOCK.y - 0.36, 0.16, L, 0.72, 0.05, wood); for (let i = 0; i < Math.floor(L / 0.21); i++) k.box(DOCK.x0 + i * 0.21, DOCK.y - 0.37, 0.21, 0.015, 0.74, 0.005, plank, false);
  for (let x = DOCK.x0 + 0.1; x < DOCK.x1; x += 0.95) for (const dy of [-0.34, 0.28]) k.box(x, DOCK.y + dy, -0.05, 0.07, 0.07, 0.26, wood);
  k.box(DOCK.x1 - 0.1, DOCK.y - 0.36, 0.21, 0.08, 0.08, 0.3, wood); const lan = k.night(0xffd59a, 0.9); k.box(DOCK.x1 - 0.13, DOCK.y - 0.39, 0.51, 0.14, 0.14, 0.16, lan, false);
  // keep walkers off the water (the dock is reached by stepping onto it)
  for (let a = 0; a < Math.PI * 2; a += 0.2) for (const f of [0.35, 0.7, 1]) k.nav.blockCircle({ x: c.x + Math.cos(a) * c.rx * f, y: c.y + Math.sin(a) * c.ry * f }, 0.6);
  // sit on the end of the dock, feet over the water
  k.reg.spots.push({ act: "dock", at: { x: DOCK.x0 - 0.5, y: DOCK.y }, pose: { x: DOCK.x1 - 0.3, y: DOCK.y, z: 0.21, yaw: Math.PI / 2, kind: "sit" }, min: 10, max: 18, w: 0.9, night: 0.5 });
  return { g, fish };
}

// ------------------------------------------------------------------ grass, flowers
export function meadow(k: Kit, area: R, keepOut: R[], n = 420) {
  const tufts: THREE.Matrix4[] = [], flowers: { m: THREE.Matrix4; c: THREE.Color }[] = [], cols = [0xffffff, 0xff7ab8, 0xffd84d, 0xb388ff, 0xff8a65];
  for (let i = 0; i < n; i++) {
    const p = { x: area.x + rnd() * area.w, y: area.y + rnd() * area.d }; if (keepOut.some((r) => inR(p, r, 0.15))) continue;
    const w = k.W(p.x, p.y), s = 0.5 + rnd() * 0.8;
    if (rnd() < 0.22) flowers.push({ m: new THREE.Matrix4().compose(w.setY(0.18 * s), new THREE.Quaternion(), new THREE.Vector3(s, s, s)), c: new THREE.Color(cols[Math.floor(rnd() * cols.length)]) });
    else tufts.push(new THREE.Matrix4().compose(w, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), new THREE.Vector3(s, s * (0.7 + rnd() * 0.6), s)));
  }
  const tg = new THREE.ConeGeometry(0.07, 0.26, 4); tg.translate(0, 0.13, 0);
  const tm = new THREE.InstancedMesh(tg, k.flat(0x2f6a3b), Math.max(1, tufts.length)); tufts.forEach((m, i) => tm.setMatrixAt(i, m)); tm.count = tufts.length; k.keep(tm); k.root.add(tm);
  const fm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.05, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, flowers.length));
  flowers.forEach((f, i) => { fm.setMatrixAt(i, f.m); fm.setColorAt(i, f.c.multiplyScalar(0.85)); }); fm.count = flowers.length; k.keep(fm); k.root.add(fm);
}

// ------------------------------------------------------------------ butterflies (moths after dark)
type Fly = { g: THREE.Group; l: THREE.Object3D; r: THREE.Object3D; home: Pt; ph: number; sp: number; rad: number; h: number; night: boolean; to: THREE.Vector3 | null; t: number };
export class Butterflies {
  flies: Fly[] = []; group = new THREE.Group();
  constructor(private k: Kit, homes: Pt[], colors: string[]) {
    const wing = new THREE.PlaneGeometry(0.24, 0.19); wing.rotateX(-Math.PI / 2); wing.translate(0.12, 0, 0);
    const mk = (home: Pt, col: string, night: boolean) => {
      const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(night ? 1.6 : 1), side: THREE.DoubleSide, transparent: true, opacity: 0.95 }); (m as unknown as { toneMapped: boolean }).toneMapped = !night;
      const l = new THREE.Mesh(wing, m), r = new THREE.Mesh(wing, m); r.rotation.y = Math.PI; const body = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 4), new THREE.MeshBasicMaterial({ color: 0x111111 })); body.rotation.x = Math.PI / 2;
      const lp = new THREE.Group(), rp = new THREE.Group(); lp.add(l); rp.add(r); g.add(lp, rp, body); g.rotation.order = "YXZ";
      this.group.add(g); this.flies.push({ g, l: lp, r: rp, home, ph: rnd() * 10, sp: 0.4 + rnd() * 0.5, rad: 0.8 + rnd() * 1.8, h: 0.5 + rnd() * 0.9, night, to: null, t: 0 });
    };
    homes.forEach((h, i) => { mk(h, colors[i % colors.length], false); if (i % 2 === 0) mk({ x: h.x + 0.6, y: h.y - 0.4 }, colors[(i + 3) % colors.length], false); });
    homes.slice(0, 6).forEach((h) => mk(h, "#39ff88", true));
    k.root.add(k.keep(this.group));
  }
  /** Some come to the net and vanish (a catch). */
  catchAt(p: THREE.Vector3, n: number) { const day = this.flies.filter((f) => !f.to && f.g.visible).sort((a, b) => a.g.position.distanceTo(p) - b.g.position.distanceTo(p)); for (const f of day.slice(0, n)) { f.to = p.clone(); f.t = 0; } }
  update(dt: number, t: number, night: number) {
    for (const f of this.flies) {
      const on = f.night ? night > 0.5 : night < 0.75; if (!on && !f.to) { f.g.visible = false; continue; }
      f.g.visible = true;
      const flap = Math.sin(t * (f.night ? 18 : 22) + f.ph) * 1.1; f.l.rotation.z = flap; f.r.rotation.z = -flap;
      if (f.to) {
        f.t += dt; const k = Math.min(1, f.t / 1.2); f.g.position.lerp(f.to, Math.min(1, dt * 3)); f.g.scale.setScalar(1 - k);
        if (k >= 1) { f.to = null; f.g.scale.setScalar(1); f.ph += 10; }
        continue;
      }
      const a = t * f.sp + f.ph, x = f.home.x + Math.cos(a) * f.rad + Math.sin(a * 2.3) * 0.4, y = f.home.y + Math.sin(a * 0.8) * f.rad * 0.7, h = f.h + Math.sin(a * 3.1) * 0.25;
      const w = this.k.W(x, y); w.y = h;
      const d = w.clone().sub(f.g.position); f.g.position.copy(w); if (d.lengthSq() > 1e-6) f.g.rotation.y = Math.atan2(d.x, d.z);
    }
  }
}
