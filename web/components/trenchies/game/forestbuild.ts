/**
 * What you can build where the forest used to be. Each building has its own spot inside its plot (clear of the
 * big oak and the treehouse) and faces the lawn: the local frame's x runs down the plot, z out towards the garden.
 */
import * as THREE from "three";
import { NEON, WARM, type Frame, type Kit } from "./kit";
import type { Pt, R } from "./nav";

type Def = { at: R; build: (f: Frame, k: Kit) => void };

/** A log: a cylinder lying along local x (along) or z (out). */
const log = (f: Frame, k: Kit, x: number, z: number, y: number, len: number, r: number, along = true) => {
  const m = f.c(x, z, y - len / 2, r, len, k.std(0x6b4a2e, 0.85), 10); m.rotation[along ? "z" : "x"] = Math.PI / 2; m.position.y = y + r;
  const cap = k.std(0xc49a6c, 0.8);
  for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 12), cap); if (along) { c.rotation.y = s * Math.PI / 2; f.put(c, x + s * (len / 2 + 0.002), z, y + r); } else { if (s < 0) c.rotation.y = Math.PI; f.put(c, x, z + s * (len / 2 + 0.002), y + r); } }
};
/** A pitched roof (a triangular prism) along local x, ridge at height `top`. */
const roof = (f: Frame, x0: number, z0: number, len: number, depth: number, base: number, rise: number, m: THREE.Material) => {
  const sh = new THREE.Shape(); sh.moveTo(-depth / 2, 0); sh.lineTo(depth / 2, 0); sh.lineTo(0, rise); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false }); g.rotateY(Math.PI / 2); g.translate(0, 0, 0);
  const mesh = new THREE.Mesh(g, m); f.put(mesh, x0, z0 + depth / 2, base); return mesh;
};
const ringTex = (k: Kit) => k.tex(128, 128, (g) => { const cols = ["#f4f1ea", "#1b1f25", "#2e86de", "#d64545", "#ffd84d"]; for (let i = 0; i < 5; i++) { g.fillStyle = cols[i]; g.beginPath(); g.arc(64, 64, 62 - i * 12, 0, 7); g.fill(); } });

export const FOREST_BUILD: Record<string, Def> = {
  // Birch Grove: an open saw shed, a spinning blade, logs and planks
  lumbermill: {
    at: { x: 6.6, y: 13.6, w: 4.6, d: 3.6 },
    build: (f, k) => {
      const wood = k.std(0x8a6038, 0.8), dark = k.M.darkwood;
      f.b(0.2, 0.3, 0, 3.2, 2.6, 0.12, k.std(0x5c4430, 0.9));
      for (const [x, z] of [[0.35, 0.45], [3.25, 0.45], [0.35, 2.75], [3.25, 2.75]]) f.c(x, z, 0.12, 0.07, 1.7, dark, 8);
      const r = f.b(0.05, 0.2, 1.82, 3.5, 2.85, 0.08, k.std(0x3b4a3d, 0.7)); r.rotation.x = 0.12;
      f.b(1.2, 1.2, 0.12, 1.3, 0.7, 0.62, wood); f.b(1.15, 1.15, 0.74, 1.4, 0.8, 0.05, k.std(0xb08d64, 0.7));
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 24), k.M.metal); blade.rotation.x = Math.PI / 2;
      const bg = new THREE.Group(); bg.add(blade); f.put(bg, 1.85, 1.55, 0.86); k.keep(bg); k.reg.spinners.push({ o: bg, axis: "z", rate: 9 });
      f.b(1.4, 1.5, 0.79, 0.6, 0.12, 0.08, k.std(0xd8b483, 0.7));
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3 - i; j++) log(f, k, 0.7 + j * 0.42 + i * 0.21, 3.6, i * 0.34, 1.6, 0.17, false);
      for (let i = 0; i < 5; i++) f.b(2.6, 3.1, i * 0.06, 0.8, 1.2, 0.05, k.std(i % 2 ? 0xd8b483 : 0xc9a271, 0.7));
      f.b(3.0, 0.7, 0.12, 0.3, 0.3, 0.3, k.std(0x2f6bd8, 0.6));
      f.b(0.4, 0.6, 1.3, 0.2, 0.06, 0.18, k.night(WARM, 0.9), false);
      f.spot("mill", 1.85, 2.2, 0, "work", { az: 3.0, face: Math.PI, w: 0.9, min: 6, max: 10 });
    },
  },
  // Pine Stand: three straw targets, a shooting line, hay bales and a bow rack
  archery: {
    at: { x: 2.8, y: 18.4, w: 6.2, d: 3.4 },
    build: (f, k) => {
      f.b(0.2, 5.8, 0.005, 3.0, 0.08, 0.01, k.std(0xf2f2ea, 0.6), false);
      const face = new THREE.MeshStandardMaterial({ map: ringTex(k), roughness: 0.8 });
      for (const x of [0.55, 1.7, 2.85]) {
        for (const dx of [-0.25, 0.25]) { const leg = f.c(x + dx, 0.75, 0, 0.035, 1.2, k.M.darkwood, 6); leg.rotation.x = -0.25; }
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.12, 24), [k.std(0xd8c27a, 0.95), face, k.std(0xd8c27a, 0.95)]); t.rotation.x = Math.PI / 2; t.rotation.y = 0; f.put(t, x, 0.7, 0.85);
        const arrow = f.c(x + 0.08, 0.95, 0.9, 0.012, 0.4, k.M.darkwood, 4); arrow.rotation.x = Math.PI / 2 - 0.1;
      }
      for (let i = 0; i < 4; i++) f.b(0.1 + i * 0.8, 0.1, 0, 0.7, 0.4, 0.4, k.std(0xd8c27a, 0.95));
      f.b(3.0, 6.0, 0, 0.12, 0.12, 1.1, k.M.darkwood); f.b(3.0, 5.9, 0.9, 0.12, 0.35, 0.06, k.M.darkwood);
      for (let i = 0; i < 3; i++) { const bow = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.02, 6, 16, Math.PI), k.std(0x6b3a22, 0.7)); bow.rotation.y = Math.PI / 2; f.put(bow, 3.06, 5.82 + i * 0.1, 0.62); }
      f.spot("archery", 1.7, 5.4, 0, "look", { az: 6.2, face: Math.PI, w: 1.0, min: 6, max: 10 });
    },
  },
  // Old Oaks: a log cabin with a porch, a warm window and a chimney
  logcabin: {
    at: { x: 7.8, y: 23.0, w: 3.4, d: 3.8 },
    build: (f, k) => {
      const logM = k.std(0x7a5232, 0.85);
      f.b(0.3, 0.2, 0, 3.2, 2.3, 0.15, k.M.stone);
      for (let i = 0; i < 6; i++) { const y = 0.15 + i * 0.25; for (const z of [0.25, 2.4]) { const m = f.c(1.9, z, y, 0.13, 3.3, logM, 10); m.rotation.z = Math.PI / 2; m.position.y = y + 0.13; } for (const x of [0.3, 3.5]) { const m = f.c(x, 1.32, y + 0.12, 0.13, 2.3, logM, 10); m.rotation.x = Math.PI / 2; m.position.y = y + 0.25; } }
      f.b(0.35, 0.3, 0.15, 3.1, 2.1, 1.5, k.std(0x5a3c24, 0.9));
      roof(f, 0.05, 0.05, 3.7, 2.6, 1.68, 1.0, k.std(0x3a2a22, 0.75));
      f.b(2.6, 0.9, 1.9, 0.38, 0.38, 1.1, k.M.stone);
      f.b(1.55, 2.4, 0.15, 0.6, 0.06, 1.05, k.std(0x3a2618, 0.8));
      for (const x of [0.75, 2.75]) { f.b(x, 2.41, 0.75, 0.55, 0.04, 0.45, k.night(WARM, 0.9), false); f.b(x - 0.04, 2.42, 0.71, 0.63, 0.03, 0.06, k.M.darkwood); }
      f.b(0.2, 2.45, 0, 3.4, 1.0, 0.12, k.std(0x8a6038, 0.8));
      for (const x of [0.3, 3.4]) f.c(x, 3.35, 0.12, 0.06, 1.25, k.M.darkwood, 8);
      const pr = f.b(0.1, 2.35, 1.37, 3.6, 1.15, 0.06, k.std(0x3a2a22, 0.75)); pr.rotation.x = -0.18;
      f.b(0.6, 2.9, 0.12, 0.5, 0.45, 0.06, k.M.wood); f.b(0.6, 2.9, 0.18, 0.5, 0.06, 0.45, k.M.wood);
      for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.12 + i * 0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xbfc4c2, transparent: true, opacity: 0.35 - i * 0.08, depthWrite: false })); const g = new THREE.Group(); g.add(p); f.put(g, 2.8, 1.1, 3.1 + i * 0.35); k.keep(g); k.reg.bobbers.push({ o: g, base: g.position.y, amp: 0.12, rate: 1.2 + i * 0.3, off: i }); }
      f.spot("porch", 0.85, 3.05, 0.2, "sit", { az: 3.8, face: Math.PI, w: 1.2, min: 10, max: 16, night: 0.4 });
    },
  },
  // Fern Hollow: tents round a big fire, logs to sit on, a lantern
  campground: {
    at: { x: 4.0, y: 27.8, w: 6.8, d: 4.0 },
    build: (f, k) => {
      const cx = 2.0, cz = 4.2;
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; f.put(new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), k.M.stone), cx + Math.cos(a) * 0.42, cz + Math.sin(a) * 0.42, 0.06); }
      for (let i = 0; i < 4; i++) { const m = f.c(cx, cz, 0.05, 0.05, 0.6, k.M.darkwood, 6); m.rotation.set(0.9, (i / 4) * Math.PI * 2, 0); }
      for (let i = 0; i < 3; i++) { const fl = new THREE.Mesh(new THREE.ConeGeometry(0.16 - i * 0.04, 0.45 - i * 0.08, 7), k.glow([0xff8a3d, 0xffb84d, 0xfff2c0][i], 1.8)); const g = new THREE.Group(); g.add(fl); f.put(g, cx + (i - 1) * 0.06, cz, 0.25); k.keep(g); k.reg.bobbers.push({ o: g, base: g.position.y, amp: 0.04, rate: 9 + i * 3, off: i }); }
      const light = new THREE.PointLight(0xff9a4d, 0, 6, 2); light.position.set(cx, 0.8, cz); f.g.add(light); k.reg.lamps.push(light);
      for (const [x, z, rot] of [[cx - 1.1, cz, 0], [cx + 1.1, cz, 0], [cx, cz - 1.1, 1], [cx, cz + 1.1, 1]] as [number, number, number][]) log(f, k, x, z, 0, 1.0, 0.13, rot === 1);
      const tent = (x: number, z: number, col: number, ry: number) => { const t = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.15, 4), k.std(col, 0.8)); t.rotation.y = Math.PI / 4 + ry; f.put(t, x, z, 0.58); const door = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.5), k.std(0x1b1f25, 0.9)); door.position.set(x, 0.25, z + 0.58); f.g.add(door); };
      tent(0.9, 1.3, 0x2f7a5e, 0); tent(3.1, 1.2, 0xd2843a, 0.2); tent(3.3, 6.0, 0x3b6bb0, 0);
      f.c(0.4, 6.0, 0, 0.04, 1.6, k.M.darkwood, 6); f.b(0.32, 5.92, 1.5, 0.16, 0.16, 0.2, k.night(WARM, 1.0), false);
      f.b(0.6, 2.6, 0, 0.5, 0.35, 0.3, k.std(0x2f6bd8, 0.6)); f.b(0.6, 2.6, 0.3, 0.5, 0.35, 0.05, k.M.white);
      f.spot("camp", cx - 1.1, cz, 0.26, "sit", { ax: cx - 1.1, az: cz + 0.8, face: -Math.PI / 2, w: 1.3, min: 10, max: 18, night: 0.6 });
    },
  },
  // High Ridge: a timber tower with a ladder and a lookout deck
  lookout: {
    at: { x: 6.0, y: 32.8, w: 3.6, d: 3.6 },
    build: (f, k) => {
      const t = k.std(0x6b4a2e, 0.85), H = 2.8;
      for (const [x, z] of [[0.8, 0.8], [2.8, 0.8], [0.8, 2.8], [2.8, 2.8]]) f.c(x, z, 0, 0.08, H + 0.9, t, 8);
      for (const y of [0.9, 1.9]) { f.b(0.8, 0.76, y, 2.0, 0.08, 0.08, t); f.b(0.8, 2.76, y, 2.0, 0.08, 0.08, t); f.b(0.76, 0.8, y, 0.08, 2.0, 0.08, t); f.b(2.76, 0.8, y, 0.08, 2.0, 0.08, t); }
      f.b(0.55, 0.55, H, 2.5, 2.5, 0.12, k.std(0x8a6038, 0.8));
      for (const [x, z, w, d] of [[0.55, 0.55, 2.5, 0.06], [0.55, 2.99, 2.5, 0.06], [0.55, 0.55, 0.06, 2.5], [2.99, 0.55, 0.06, 2.5]]) f.b(x, z, H + 0.5, w, d, 0.06, t);
      const r = roof(f, 0.35, 0.35, 2.9, 2.9, H + 0.9, 0.8, k.std(0x2f4a3a, 0.75)); void r;
      for (let i = 0; i < 9; i++) f.b(1.5, 2.95, 0.2 + i * 0.3, 0.6, 0.05, 0.05, t);
      for (const x of [1.5, 2.05]) f.b(x, 2.95, 0, 0.05, 0.05, H, t);
      f.b(1.6, 1.6, H + 0.12, 0.3, 0.3, 0.3, k.night(WARM, 0.8), false);
      f.spot("lookout", 1.8, 1.8, H + 0.12, "look", { ax: 1.8, az: 3.6, face: Math.PI, w: 1.0, min: 10, max: 16, night: 0.3 });
    },
  },
  // Deep Woods: standing stones round an altar, runes glowing after dark
  stonecircle: {
    at: { x: 4.2, y: 37.4, w: 4.8, d: 4.0 },
    build: (f, k) => {
      const cx = 2.0, cz = 2.4, st = k.std(0x8a908c, 0.95);
      f.c(cx, cz, 0, 1.9, 0.03, k.std(0x5b6b55, 1), 32);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, x = cx + Math.cos(a) * 1.55, z = cz + Math.sin(a) * 1.55, h = 0.9 + ((i * 37) % 5) * 0.12;
        const s = f.b(x - 0.18, z - 0.12, 0, 0.36, 0.24, h, st); s.rotation.y = -a; s.position.set(x, h / 2, z);
        const rune = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.3), k.night(NEON, 1.3)); rune.position.set(x - Math.cos(a) * 0.125, h * 0.55, z - Math.sin(a) * 0.125); rune.rotation.y = -a - Math.PI / 2; f.g.add(rune);
      }
      f.b(cx - 0.45, cz - 0.3, 0, 0.9, 0.6, 0.45, st);
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), k.glow(NEON, 1.4)); const og = new THREE.Group(); og.add(orb); f.put(og, cx, cz, 0.75); k.keep(og); k.reg.bobbers.push({ o: og, base: og.position.y, amp: 0.08, rate: 1.4, off: 0 }); k.reg.spinners.push({ o: og, axis: "y", rate: 0.8 });
      f.spot("stones", cx, cz + 0.75, 0, "look", { az: cz + 2.2, face: 0, w: 0.8, min: 8, max: 12, night: 0.4 });
    },
  },
};

/** Where the front of a forest building is (for the path to it). */
export const forestDoor = (id: string): Pt | null => { const d = FOREST_BUILD[id]; if (!d) return null; return { x: d.at.x + d.at.w + 0.5, y: d.at.y + d.at.d / 2 }; };
