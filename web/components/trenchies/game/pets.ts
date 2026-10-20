/**
 * Pets. Walkers (dog, cat, robot dog, bunny, turtle, fox, penguin) follow your Trenchie around on the ground;
 * flyers (parrot, owl, dragon, drone) circle above and land on things. Every pet faces +x and sits on y = 0.
 */
import * as THREE from "three";

const NEON = 0x39ff88, CYAN = 0x6ee7ff;
const std = (c: number, r = 0.55, m = 0.05) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
const glow = (c: number, s = 1.6) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(s) }); (m as unknown as { toneMapped: boolean }).toneMapped = false; return m; };

export type Pet = { kind: string; g: THREE.Group; legs: THREE.Object3D[]; tail: THREE.Object3D | null; wings: THREE.Object3D[]; fly: boolean; speed: number; hop: boolean; size: number };
export const WALKERS = ["dog", "cat", "robodog", "bunny", "turtle", "fox", "penguin"];
export const FLYERS = ["parrot", "owl", "dragon", "drone"];

export function makePet(kind: string): Pet {
  const g = new THREE.Group(), legs: THREE.Object3D[] = [], wings: THREE.Object3D[] = [], ink = std(0x07090a, 0.4);
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D = g) => { const s = new THREE.Mesh(geo, m); s.position.set(x, y, z); s.castShadow = true; parent.add(s); return s; };
  const sph = (r: number) => new THREE.SphereGeometry(r, 16, 12);
  const eyes = (x: number, y: number, z: number, r = 0.018, m: THREE.Material = ink) => { for (const s of [-1, 1]) add(new THREE.SphereGeometry(r, 8, 6), x, y, z * s, m); };
  const fourLegs = (sx: number, sz: number, h: number, r: number, m: THREE.Material) => { for (const [x, z] of [[-sx, -sz], [-sx, sz], [sx, -sz], [sx, sz]]) { const l = new THREE.Group(); l.position.set(x, h, z); add(new THREE.CylinderGeometry(r, r * 0.85, h, 8), 0, -h / 2, 0, m, l); g.add(l); legs.push(l); } };
  let tail: THREE.Object3D | null = null, fly = false, speed = 1.6, hop = false, size = 1;

  if (kind === "dog" || kind === "cat" || kind === "robodog" || kind === "fox") {
    const robo = kind === "robodog", cat = kind === "cat", fox = kind === "fox";
    const w = robo ? std(0xd9dcda, 0.25, 0.85) : cat ? std(0x1a1d1c, 0.6) : fox ? std(0xd8642a, 0.6) : std(0xf1f3f2, 0.55);
    const sc = cat ? 0.78 : fox ? 0.9 : 1; size = sc;
    const body = add(sph(0.16 * sc), 0, 0.3 * sc, 0, w); body.scale.set(1.7, 1, 1);
    add(sph(0.12 * sc), 0.27 * sc, 0.42 * sc, 0, w);
    const snout = add(sph(0.06 * sc), 0.37 * sc, 0.39 * sc, 0, fox ? std(0xf4efe8, 0.6) : w); snout.scale.set(1.3, 0.8, 0.9);
    add(new THREE.SphereGeometry(0.025 * sc, 8, 6), 0.43 * sc, 0.4 * sc, 0, ink);
    for (const z of [-0.06, 0.06]) { const e = add(new THREE.ConeGeometry(0.045 * sc, (cat || fox ? 0.12 : 0.08) * sc, 6), 0.25 * sc, 0.55 * sc, z * sc, cat || fox ? w : ink); if (!cat && !fox) e.rotation.x = z > 0 ? 0.5 : -0.5; }
    if (robo) add(new THREE.BoxGeometry(0.03, 0.04, 0.16), 0.38, 0.45, 0, glow(CYAN, 2)); else eyes(0.36 * sc, 0.46 * sc, 0.05 * sc);
    fourLegs(0.16 * sc, 0.08 * sc, 0.22 * sc, 0.035 * sc, robo ? ink : w);
    const tg = new THREE.Group(); tg.position.set(-0.28 * sc, 0.38 * sc, 0); g.add(tg);
    const t = add(new THREE.CylinderGeometry(fox ? 0.06 : 0.02, 0.012, (cat ? 0.32 : fox ? 0.3 : 0.18) * sc, 8), -0.06 * sc, 0.06 * sc, 0, w, tg); t.rotation.z = cat ? 0.3 : 0.9;
    if (fox) { const tip = add(sph(0.045), -0.16, 0.12, 0, std(0xf4efe8, 0.6), tg); void tip; }
    tail = tg;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.1 * sc, 0.012, 6, 16), glow(robo ? CYAN : NEON, 1.4)); collar.position.set(0.2 * sc, 0.38 * sc, 0); collar.rotation.y = Math.PI / 2; collar.rotation.x = 0.4; g.add(collar);
    speed = cat ? 0.75 : fox ? 1.9 : 1.6;
  } else if (kind === "bunny") {
    const w = std(0xf4f1ec, 0.7), pink = std(0xf2a6b8, 0.7); size = 0.7;
    const body = add(sph(0.13), 0, 0.15, 0, w); body.scale.set(1.3, 1, 1);
    add(sph(0.09), 0.13, 0.27, 0, w); eyes(0.2, 0.3, 0.04, 0.014);
    for (const z of [-0.035, 0.035]) { const e = add(new THREE.CylinderGeometry(0.02, 0.03, 0.18, 6), 0.1, 0.42, z, w); e.rotation.x = z * 4; add(new THREE.CylinderGeometry(0.01, 0.015, 0.14, 6), 0.105, 0.42, z * 1.05, pink).rotation.x = z * 4; }
    add(sph(0.045), -0.16, 0.16, 0, w);
    for (const [x, z] of [[0.08, -0.06], [0.08, 0.06]]) { const l = new THREE.Group(); l.position.set(x, 0.06, z); add(sph(0.035), 0, -0.03, 0, w, l); g.add(l); legs.push(l); }
    speed = 1.2; hop = true;
  } else if (kind === "turtle") {
    const shell = std(0x3d7a3a, 0.5), skin = std(0x8bb36a, 0.7); size = 0.8;
    const s = add(new THREE.SphereGeometry(0.18, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.06, 0, shell); s.scale.set(1.25, 0.75, 1);
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 18), 0, 0.06, 0, std(0xc7b37a, 0.8)).scale.set(1.15, 1, 0.95);
    for (let i = 0; i < 5; i++) add(new THREE.CylinderGeometry(0.04, 0.04, 0.012, 6), -0.08 + (i % 3) * 0.08, 0.19, (i < 3 ? -0.05 : 0.05), std(0x2f5f2d, 0.5)).rotation.x = 0.1;
    add(sph(0.06), 0.24, 0.1, 0, skin); eyes(0.28, 0.13, 0.03, 0.01);
    fourLegs(0.13, 0.11, 0.07, 0.03, skin);
    speed = 0.35;
  } else if (kind === "penguin") {
    const blk = std(0x14181b, 0.5), wht = std(0xf2f2ee, 0.6), org = std(0xf29a2e, 0.6); size = 0.85;
    const b = add(sph(0.14), 0, 0.2, 0, blk); b.scale.set(0.95, 1.4, 0.9);
    const belly = add(sph(0.12), 0.04, 0.19, 0, wht); belly.scale.set(0.9, 1.3, 0.82);
    add(sph(0.09), 0.01, 0.43, 0, blk); add(new THREE.ConeGeometry(0.025, 0.07, 6), 0.1, 0.42, 0, org).rotation.z = -Math.PI / 2; eyes(0.07, 0.46, 0.035, 0.012, wht);
    for (const z of [-0.12, 0.12]) { const w = new THREE.Group(); w.position.set(0, 0.3, z); add(new THREE.BoxGeometry(0.06, 0.18, 0.02), 0, -0.08, 0, blk, w); g.add(w); wings.push(w); }
    for (const z of [-0.05, 0.05]) { const l = new THREE.Group(); l.position.set(0.02, 0.03, z); add(new THREE.BoxGeometry(0.08, 0.02, 0.05), 0.02, -0.02, 0, org, l); g.add(l); legs.push(l); }
    speed = 0.7;
  } else if (kind === "parrot" || kind === "owl" || kind === "dragon") {
    fly = true;
    const parrot = kind === "parrot", owl = kind === "owl";
    const c1 = parrot ? std(0xd8322c, 0.5) : owl ? std(0x7a5a3e, 0.8) : std(0x3d9a5a, 0.4, 0.2), c2 = parrot ? std(0x2f6fdb, 0.5) : owl ? std(0xd9c4a0, 0.8) : std(0x8a4ad8, 0.4, 0.2);
    size = kind === "dragon" ? 1.2 : 0.8;
    const b = add(sph(0.11), 0, 0, 0, c1); b.scale.set(1.3, 1, 0.9);
    add(sph(0.08), 0.12, 0.08, 0, owl ? c2 : c1);
    if (owl) { for (const s of [-1, 1]) { add(new THREE.SphereGeometry(0.03, 10, 8), 0.18, 0.1, 0.035 * s, std(0xffcf3a, 0.3)); add(new THREE.SphereGeometry(0.014, 6, 4), 0.205, 0.1, 0.035 * s, ink); add(new THREE.ConeGeometry(0.02, 0.06, 5), 0.11, 0.17, 0.04 * s, c1); } }
    else eyes(0.17, 0.11, 0.04, 0.014);
    add(new THREE.ConeGeometry(0.025, 0.07, 6), 0.21, 0.06, 0, kind === "dragon" ? std(0xf2e6c0, 0.6) : std(0xf2c14a, 0.5)).rotation.z = -Math.PI / 2;
    if (kind === "dragon") { for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.018, 0.08, 5), 0.08, 0.16, 0.03 * s, std(0xf2e6c0, 0.6)); for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(0.02, 0.05, 4), -0.05 - i * 0.05, 0.1 - i * 0.015, 0, c2); }
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(0, 0.04, 0.06 * s); g.add(w); wings.push(w);
      const sh = kind === "dragon" ? new THREE.ConeGeometry(0.12, 0.3, 3) : new THREE.BoxGeometry(0.16, 0.015, 0.2);
      const m = add(sh, -0.02, 0, 0.1 * s, parrot ? (s > 0 ? c2 : c2) : c2, w); if (kind === "dragon") { m.rotation.x = (Math.PI / 2) * s; m.scale.set(1, 1, 0.2); }
    }
    const tg = new THREE.Group(); tg.position.set(-0.13, 0, 0); g.add(tg); add(kind === "dragon" ? new THREE.ConeGeometry(0.04, 0.3, 6) : new THREE.BoxGeometry(0.16, 0.012, 0.07), -0.1, -0.02, 0, parrot ? c2 : c1, tg).rotation.z = kind === "dragon" ? Math.PI / 2 : 0.2;
    tail = tg; speed = 2.4;
  } else { // drone
    fly = true; size = 0.9;
    add(new THREE.BoxGeometry(0.22, 0.06, 0.22), 0, 0, 0, ink);
    add(new THREE.SphereGeometry(0.04, 10, 8), 0.1, -0.04, 0, glow(NEON, 2));
    for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) { add(new THREE.BoxGeometry(0.03, 0.02, 0.03), x / 2, 0, z / 2, std(0xe2e5e3)); const p = new THREE.Group(); p.position.set(x, 0.04, z); add(new THREE.BoxGeometry(0.2, 0.005, 0.03), 0, 0, 0, std(0xe2e5e3), p); g.add(p); wings.push(p); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.006, 4, 20), glow(NEON, 1.2)); ring.rotation.x = Math.PI / 2; ring.position.copy(p.position); g.add(ring); }
    speed = 2.6;
  }
  return { kind, g, legs, tail, wings, fly, speed, hop, size };
}

/** Moves a pet's legs, wings and tail. `move` is how fast it's going (0..1), `t` the clock. */
export function animatePet(p: Pet, t: number, phase: number, move: number) {
  if (p.kind === "drone") { for (const w of p.wings) w.rotation.y += 0.9; return; }
  if (p.fly) { const f = Math.sin(t * (p.kind === "owl" ? 9 : p.kind === "dragon" ? 7 : 16)) * (move > 0.05 ? 0.9 : 0.15); p.wings.forEach((w, i) => (w.rotation.x = i ? f : -f)); if (p.tail) p.tail.rotation.z = Math.sin(t * 3) * 0.2; return; }
  if (p.kind === "penguin") { p.g.rotation.x = Math.sin(phase) * 0.12 * move; p.wings.forEach((w, i) => (w.rotation.x = (i ? 1 : -1) * (0.15 + Math.abs(Math.sin(phase)) * 0.3 * move))); return; }
  p.legs.forEach((l, i) => { l.rotation.z = Math.sin(phase + (i % 2 ? Math.PI : 0)) * 0.55 * move; });
  if (p.tail) p.tail.rotation.y = Math.sin(t * (p.kind === "cat" ? 2 : 11)) * 0.5;
}
