/**
 * What your Trenchie wears: a hat, eyewear, something round the neck, something on the back, an aura at its feet and
 * the colour of its outline. Built in the Trenchie's own body units (it is 3.3 tall before scaling: feet at 0, head
 * centred at y 2.4, face towards +z), so the pieces move and scale with it.
 */
import * as THREE from "three";
import { cosmetic, type Slot } from "@/lib/trenchies-catalog";

export type Wear = Partial<Record<Slot, string>>;
type Anim = { o: THREE.Object3D; kind: "spin" | "flap" | "sway" | "bob" | "flame" | "aura" | "rise"; base?: number };

const std = (c: number, r = 0.5, m = 0.05) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
const glow = (c: number, s = 1.5, opacity = 1) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(s), transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }); (m as unknown as { toneMapped: boolean }).toneMapped = false; return m; };
const GOLDM = () => std(0xffcf3a, 0.25, 0.9);
const AURA: Record<string, number> = { "aura-green": 0x39ff88, "aura-cyan": 0x6ee7ff, "aura-pink": 0xff4fd8, "aura-gold": 0xffcf3a, "aura-rainbow": 0xffffff, "aura-fire": 0xff7a2a, "aura-snow": 0xe8f6ff, "aura-bolt": 0x8fb8ff };

function mesh(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; g.add(o); return o; }

function hat(id: string, g: THREE.Group, A: Anim[]) {
  const top = 2.8;
  switch (id) {
    case "cap": { const m = std(0x39ff88, 0.6); mesh(g, new THREE.SphereGeometry(0.43, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 2.55, 0.02).scale.y = 0.75; mesh(g, new THREE.BoxGeometry(0.5, 0.04, 0.38), m, 0, 2.56, 0.5); mesh(g, new THREE.SphereGeometry(0.05, 8, 6), std(0x0b0d0c), 0, 2.88, 0.02); break; }
    case "beanie": { const m = std(0xc0392b, 0.95); const d = mesh(g, new THREE.SphereGeometry(0.46, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 2.5, 0.02); d.scale.y = 0.9; mesh(g, new THREE.TorusGeometry(0.44, 0.07, 8, 24), m, 0, 2.52, 0.02, Math.PI / 2); mesh(g, new THREE.SphereGeometry(0.11, 10, 8), std(0xf2f2ee, 1), 0, 2.95, 0.02); break; }
    case "headphones": { const m = std(0x111312, 0.4); mesh(g, new THREE.TorusGeometry(0.47, 0.04, 8, 24, Math.PI), m, 0, 2.42, 0.02); for (const s of [-1, 1]) { mesh(g, new THREE.CylinderGeometry(0.15, 0.15, 0.1, 18), m, 0.47 * s, 2.42, 0.02, 0, 0, Math.PI / 2); mesh(g, new THREE.CylinderGeometry(0.1, 0.1, 0.02, 18), glow(0x39ff88, 1.4), 0.53 * s, 2.42, 0.02, 0, 0, Math.PI / 2); } break; }
    case "partyhat": { const t = new THREE.CanvasTexture((() => { const c = document.createElement("canvas"); c.width = 64; c.height = 64; const x = c.getContext("2d")!; for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? "#ff4fd8" : "#ffd84d"; x.fillRect(0, i * 8, 64, 8); } return c; })()); mesh(g, new THREE.ConeGeometry(0.24, 0.62, 20), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }), 0.05, top + 0.22, 0.02, 0, 0, -0.12); mesh(g, new THREE.SphereGeometry(0.07, 10, 8), std(0x6ee7ff, 0.8), 0.1, top + 0.55, 0.02); break; }
    case "cowboy": { const m = std(0x8a5a32, 0.9); mesh(g, new THREE.CylinderGeometry(0.78, 0.8, 0.04, 28), m, 0, 2.72, 0.02); mesh(g, new THREE.CylinderGeometry(0.3, 0.37, 0.36, 20), m, 0, 2.9, 0.02); mesh(g, new THREE.CylinderGeometry(0.375, 0.375, 0.06, 20), std(0x2a1a10), 0, 2.78, 0.02); break; }
    case "chef": { const w = std(0xf6f6f2, 0.9); mesh(g, new THREE.CylinderGeometry(0.34, 0.36, 0.42, 20), w, 0, 2.86, 0.02); mesh(g, new THREE.SphereGeometry(0.42, 16, 10), w, 0, 3.15, 0.02).scale.y = 0.6; break; }
    case "tophat": { const m = std(0x0e0f10, 0.4); mesh(g, new THREE.CylinderGeometry(0.58, 0.58, 0.04, 28), m, 0, 2.72, 0.02); mesh(g, new THREE.CylinderGeometry(0.33, 0.33, 0.62, 24), m, 0, 3.05, 0.02); mesh(g, new THREE.CylinderGeometry(0.335, 0.335, 0.08, 24), glow(0x39ff88, 1.2), 0, 2.8, 0.02); break; }
    case "propeller": { const a = std(0xff4fd8, 0.6), b = std(0x6ee7ff, 0.6); const d = mesh(g, new THREE.SphereGeometry(0.43, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), a, 0, 2.55, 0.02); d.scale.y = 0.75; mesh(g, new THREE.CylinderGeometry(0.02, 0.02, 0.18, 6), std(0x222222), 0, 2.95, 0.02); const p = new THREE.Group(); p.position.set(0, 3.04, 0.02); g.add(p); for (let i = 0; i < 3; i++) mesh(p, new THREE.BoxGeometry(0.5, 0.012, 0.09), i % 2 ? a : b, 0.25 * Math.cos((i * Math.PI * 2) / 3), 0, 0.25 * Math.sin((i * Math.PI * 2) / 3), 0, (-i * Math.PI * 2) / 3, 0); A.push({ o: p, kind: "spin" }); break; }
    case "viking": { const m = std(0x9aa1a5, 0.3, 0.9); mesh(g, new THREE.SphereGeometry(0.47, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 2.48, 0.02); mesh(g, new THREE.TorusGeometry(0.46, 0.04, 6, 24), std(0x8a6a3a, 0.6), 0, 2.5, 0.02, Math.PI / 2); for (const s of [-1, 1]) mesh(g, new THREE.ConeGeometry(0.08, 0.45, 10), std(0xf1ead8, 0.6), 0.5 * s, 2.85, 0.02, 0, 0, -0.7 * s); break; }
    case "wizard": { const m = std(0x4b2a8a, 0.7); mesh(g, new THREE.CylinderGeometry(0.66, 0.68, 0.04, 28), m, 0, 2.7, 0.02); mesh(g, new THREE.ConeGeometry(0.4, 1.1, 22), m, 0.04, 3.25, 0.02, 0, 0, -0.1); for (let i = 0; i < 4; i++) mesh(g, new THREE.OctahedronGeometry(0.05, 0), glow(0xffd84d, 1.6), 0.25 * Math.cos(i * 1.7), 2.95 + i * 0.15, 0.25 * Math.sin(i * 1.7) + 0.05); break; }
    case "crown": { const m = GOLDM(); mesh(g, new THREE.CylinderGeometry(0.36, 0.38, 0.2, 24, 1, true), m, 0, 2.82, 0.02).material = Object.assign(m, { side: THREE.DoubleSide }); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; mesh(g, new THREE.ConeGeometry(0.06, 0.2, 6), m, Math.cos(a) * 0.36, 3.0, Math.sin(a) * 0.36 + 0.02); mesh(g, new THREE.OctahedronGeometry(0.035, 0), glow([0xff3b5c, 0x6ee7ff, 0x39ff88][i % 3], 1.4), Math.cos(a) * 0.38, 2.82, Math.sin(a) * 0.38 + 0.02); } break; }
    case "bucket": { const m = std(0x6b7a4a, 0.9); mesh(g, new THREE.CylinderGeometry(0.4, 0.46, 0.32, 20), m, 0, 2.74, 0.02); mesh(g, new THREE.CylinderGeometry(0.62, 0.66, 0.05, 24), m, 0, 2.6, 0.02); break; }
    case "beret": { const m = std(0x8e1b25, 0.9); const b = mesh(g, new THREE.SphereGeometry(0.45, 20, 10), m, 0.08, 2.78, 0.02, 0, 0, -0.25); b.scale.y = 0.3; mesh(g, new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), m, 0.05, 2.92, 0.02); break; }
    case "catears": { const m = std(0x1a1d1c, 0.6), p = std(0xf2a6b8, 0.6); for (const s of [-1, 1]) { mesh(g, new THREE.ConeGeometry(0.14, 0.3, 4), m, 0.24 * s, 2.86, 0.05, 0, 0, -0.35 * s); mesh(g, new THREE.ConeGeometry(0.08, 0.18, 4), p, 0.24 * s, 2.84, 0.1, 0, 0, -0.35 * s); } mesh(g, new THREE.TorusGeometry(0.44, 0.025, 6, 24, Math.PI), m, 0, 2.45, 0.02); break; }
    case "flowercrown": { for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; mesh(g, new THREE.IcosahedronGeometry(0.07, 0), glow([0xff7ab8, 0xffd84d, 0xffffff, 0xb388ff][i % 4], 0.9), Math.cos(a) * 0.4, 2.72, Math.sin(a) * 0.4 + 0.02); mesh(g, new THREE.SphereGeometry(0.045, 6, 4), std(0x3c8a45, 0.8), Math.cos(a + 0.2) * 0.42, 2.7, Math.sin(a + 0.2) * 0.42 + 0.02); } break; }
    case "pirate": { const m = std(0x141414, 0.6); const h = mesh(g, new THREE.CylinderGeometry(0.62, 0.62, 0.32, 3), m, 0, 2.85, 0.02, 0, Math.PI / 2, 0); h.scale.set(1, 1, 0.6); mesh(g, new THREE.CylinderGeometry(0.38, 0.4, 0.3, 20), m, 0, 2.8, 0.02); mesh(g, new THREE.CircleGeometry(0.1, 12), std(0xf2f2ee, 0.6), 0, 2.88, 0.43); break; }
    case "samurai": { const m = std(0x2a2a30, 0.3, 0.6); mesh(g, new THREE.SphereGeometry(0.48, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 2.5, 0.02); mesh(g, new THREE.TorusGeometry(0.5, 0.06, 6, 24), std(0x8e1b25, 0.5), 0, 2.5, 0.02, Math.PI / 2); for (const s of [-1, 1]) mesh(g, new THREE.BoxGeometry(0.06, 0.5, 0.06), std(0xffcf3a, 0.3, 0.9), 0.18 * s, 3.05, 0.25, 0, 0, s * 0.5); break; }
    case "astronaut": { const shell = mesh(g, new THREE.SphereGeometry(0.62, 24, 16), new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, depthWrite: false }), 0, 2.42, 0.03); shell.castShadow = false; mesh(g, new THREE.TorusGeometry(0.5, 0.07, 8, 32), std(0xf2f2ee, 0.4), 0, 1.95, 0.02, Math.PI / 2); break; }
    case "horns": { const m = std(0xffcf3a, 0.2, 0.9); for (const s of [-1, 1]) { const h = mesh(g, new THREE.ConeGeometry(0.09, 0.55, 10), m, 0.4 * s, 2.9, 0.02, 0, 0, -0.9 * s); void h; } break; }
    case "halo": { const h = mesh(g, new THREE.TorusGeometry(0.36, 0.035, 8, 32), glow(0xffe28a, 1.8), 0, 3.25, 0.02, Math.PI / 2); A.push({ o: h, kind: "bob", base: 3.25 }); break; }
  }
}
function eyes(id: string, g: THREE.Group) {
  const y = 2.46, z = 0.48;
  const pair = (m: THREE.Material, geo: () => THREE.BufferGeometry) => { for (const s of [-1, 1]) mesh(g, geo(), m, 0.17 * s, y, z); mesh(g, new THREE.BoxGeometry(0.1, 0.025, 0.02), std(0x111111), 0, y + 0.02, z + 0.01); for (const s of [-1, 1]) mesh(g, new THREE.BoxGeometry(0.02, 0.025, 0.42), std(0x111111), 0.33 * s, y + 0.02, z - 0.2); };
  switch (id) {
    case "shades": pair(std(0x050607, 0.1, 0.6), () => new THREE.BoxGeometry(0.24, 0.12, 0.03)); break;
    case "nerd": pair(std(0x111111, 0.5), () => new THREE.TorusGeometry(0.1, 0.022, 6, 18)); break;
    case "hearts": pair(glow(0xff4f8a, 1.2), () => new THREE.CircleGeometry(0.11, 20)); break;
    case "glasses3d": { for (const [s, c] of [[-1, 0xff3b3b], [1, 0x3bd7ff]] as [number, number][]) mesh(g, new THREE.BoxGeometry(0.22, 0.12, 0.02), glow(c, 1, 0.75), 0.17 * s, y, z); mesh(g, new THREE.BoxGeometry(0.62, 0.17, 0.015), std(0xf6f6f2, 0.8), 0, y, z - 0.012); break; }
    case "monocle": { mesh(g, new THREE.TorusGeometry(0.11, 0.018, 6, 20), GOLDM(), 0.17, y, z); mesh(g, new THREE.CircleGeometry(0.1, 18), new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, roughness: 0.05 }), 0.17, y, z); mesh(g, new THREE.CylinderGeometry(0.006, 0.006, 0.5, 4), GOLDM(), 0.25, y - 0.27, z - 0.02, 0, 0, 0.3); break; }
    case "aviators": pair(std(0x3a2a14, 0.1, 0.8), () => new THREE.CircleGeometry(0.12, 18)); break;
    case "starshades": pair(glow(0xffcf3a, 1.2), () => new THREE.CircleGeometry(0.12, 5)); break;
    case "pixel": { for (let i = 0; i < 5; i++) mesh(g, new THREE.BoxGeometry(0.07, 0.07, 0.03), std(0x050505, 0.3), -0.2 + i * 0.07, y + (i % 2 ? 0 : -0.03), z); for (let i = 0; i < 5; i++) mesh(g, new THREE.BoxGeometry(0.07, 0.07, 0.03), std(0x050505, 0.3), 0.06 + i * 0.07, y + (i % 2 ? 0 : -0.03), z); mesh(g, new THREE.BoxGeometry(0.7, 0.04, 0.03), std(0x050505), 0, y + 0.05, z); break; }
    case "goggles": { mesh(g, new THREE.BoxGeometry(0.62, 0.24, 0.16), std(0x1b1f25, 0.3, 0.4), 0, y, z - 0.03); mesh(g, new THREE.BoxGeometry(0.56, 0.16, 0.01), glow(0x6ee7ff, 1.3), 0, y, z + 0.055); mesh(g, new THREE.TorusGeometry(0.47, 0.03, 4, 24), std(0x1b1f25), 0, y, 0.03, Math.PI / 2); break; }
    case "visor": { mesh(g, new THREE.TorusGeometry(0.47, 0.05, 6, 30, Math.PI * 0.8), glow(0x6ee7ff, 1.6), 0, y, 0.03, Math.PI / 2, 0, Math.PI * 0.1).scale.set(1, 1, 1.4); break; }
  }
}
function neck(id: string, g: THREE.Group, A: Anim[]) {
  const y = 2.02;
  switch (id) {
    case "scarf": { const m = std(0xc0392b, 0.95); mesh(g, new THREE.TorusGeometry(0.56, 0.1, 10, 28), m, 0, y, 0.0, Math.PI / 2); const t = mesh(g, new THREE.BoxGeometry(0.18, 0.55, 0.06), m, 0.22, y - 0.3, 0.55, 0.15); A.push({ o: t, kind: "sway" }); break; }
    case "bowtie": { const m = std(0xd8322c, 0.6); for (const s of [-1, 1]) mesh(g, new THREE.ConeGeometry(0.1, 0.2, 4), m, 0.1 * s, y - 0.04, 0.6, 0, 0, (Math.PI / 2) * s); mesh(g, new THREE.SphereGeometry(0.04, 8, 6), m, 0, y - 0.04, 0.62); break; }
    case "bandana": { const m = std(0x2f6fdb, 0.9); mesh(g, new THREE.TorusGeometry(0.57, 0.05, 8, 26), m, 0, y, 0, Math.PI / 2); mesh(g, new THREE.ConeGeometry(0.28, 0.4, 3), m, 0, y - 0.22, 0.52, Math.PI, 0, 0).scale.z = 0.25; break; }
    case "lei": { for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; mesh(g, new THREE.IcosahedronGeometry(0.075, 0), glow([0xff7ab8, 0xffd84d, 0xffffff, 0xff8a65][i % 4], 0.9), Math.cos(a) * 0.58, y - 0.05 - Math.max(0, Math.sin(a)) * 0.12, Math.sin(a) * 0.58); } break; }
    case "medal": { const r = std(0x2f6fdb, 0.8); for (const s of [-1, 1]) mesh(g, new THREE.BoxGeometry(0.08, 0.5, 0.02), r, 0.12 * s, y - 0.25, 0.62, -0.25, 0, -0.35 * s); mesh(g, new THREE.CylinderGeometry(0.13, 0.13, 0.03, 20), GOLDM(), 0, y - 0.52, 0.72, Math.PI / 2 - 0.25); break; }
    case "tie": { const m = std(0x2f6fdb, 0.5); mesh(g, new THREE.BoxGeometry(0.12, 0.1, 0.05), m, 0, y - 0.06, 0.6); const t = mesh(g, new THREE.BoxGeometry(0.14, 0.55, 0.03), m, 0, y - 0.38, 0.66, -0.2); void t; break; }
    case "headset": { mesh(g, new THREE.TorusGeometry(0.47, 0.03, 6, 24, Math.PI), std(0x111312, 0.4), 0, 2.42, 0.02); mesh(g, new THREE.SphereGeometry(0.1, 10, 8), std(0x111312), 0.47, 2.4, 0.02); const arm = mesh(g, new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), std(0x111312), 0.36, 2.27, 0.3, 0.9, 0, 0.5); void arm; mesh(g, new THREE.SphereGeometry(0.04, 8, 6), glow(0x39ff88, 1.6), 0.2, 2.2, 0.47); break; }
    case "diamondchain": { const ice = new THREE.MeshPhysicalMaterial({ color: 0xdff8ff, roughness: 0, metalness: 0.3, emissive: new THREE.Color(0x6ee7ff), emissiveIntensity: 0.4 }); for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; mesh(g, new THREE.OctahedronGeometry(0.045, 0), ice, Math.cos(a) * 0.6, y - 0.1 - Math.max(0, Math.sin(a)) * 0.2, Math.sin(a) * 0.6 + 0.04); } mesh(g, new THREE.OctahedronGeometry(0.13, 0), ice, 0, y - 0.45, 0.68); break; }
    case "chain": { mesh(g, new THREE.TorusGeometry(0.6, 0.025, 6, 32), GOLDM(), 0, y - 0.08, 0.04, Math.PI / 2 - 0.25); mesh(g, new THREE.CylinderGeometry(0.11, 0.11, 0.03, 20), GOLDM(), 0, y - 0.38, 0.66, Math.PI / 2 - 0.3); mesh(g, new THREE.CircleGeometry(0.07, 16), glow(0x39ff88, 1.4), 0, y - 0.38, 0.685, -0.3); break; }
  }
}
function back(id: string, g: THREE.Group, A: Anim[]) {
  switch (id) {
    case "backpack": { const m = std(0x2f6e9e, 0.8); mesh(g, new THREE.BoxGeometry(0.75, 0.85, 0.35), m, 0, 1.5, -0.8); mesh(g, new THREE.BoxGeometry(0.55, 0.35, 0.12), std(0x24577d, 0.8), 0, 1.3, -1.0); for (const s of [-1, 1]) mesh(g, new THREE.TorusGeometry(0.3, 0.03, 4, 16, Math.PI), std(0x1a1a1a), 0.25 * s, 1.8, -0.5, 0, Math.PI / 2, 0); break; }
    case "cape": { const geo = new THREE.PlaneGeometry(1.25, 1.9, 6, 8); geo.translate(0, -0.95, 0); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, -Math.pow(Math.abs(p.getX(i)) / 0.65, 2) * 0.15 - (-p.getY(i)) * 0.18); p.needsUpdate = true; geo.computeVertexNormals(); const c = mesh(g, geo, new THREE.MeshStandardMaterial({ color: 0x8e1b25, roughness: 0.8, side: THREE.DoubleSide }), 0, 2.05, -0.62); A.push({ o: c, kind: "sway" }); break; }
    case "rod": { mesh(g, new THREE.CylinderGeometry(0.025, 0.035, 2.4, 8), std(0x6b4a2a, 0.6), 0.1, 1.7, -0.82, 0, 0, 0.6); mesh(g, new THREE.CylinderGeometry(0.08, 0.08, 0.1, 12), std(0x9aa1a5, 0.3, 0.9), -0.3, 1.2, -0.85, 0, 0, Math.PI / 2 + 0.6); break; }
    case "wings": case "angel": {
      const angel = id === "angel";
      for (const s of [-1, 1]) {
        const w = new THREE.Group(); w.position.set(0.15 * s, 1.75, -0.7); g.add(w);
        if (angel) { for (let i = 0; i < 4; i++) mesh(w, new THREE.SphereGeometry(0.3 - i * 0.04, 12, 8), std(0xf6f6f2, 0.9), (0.3 + i * 0.28) * s, 0.15 - i * 0.12, -0.05).scale.set(1.3, 0.55, 0.25); }
        else { const m = new THREE.MeshBasicMaterial({ color: 0x6ee7ff, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }); const up = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), m); up.position.set(0.5 * s, 0.25, 0); up.scale.y = 0.8; w.add(up); const lo = new THREE.Mesh(new THREE.CircleGeometry(0.38, 18), new THREE.MeshBasicMaterial({ color: 0xff4fd8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })); lo.position.set(0.38 * s, -0.35, 0.02); w.add(lo); }
        w.userData.side = s; A.push({ o: w, kind: "flap" });
      }
      break;
    }
    case "guitarback": { const m = std(0xc0392b, 0.35); const b = mesh(g, new THREE.CylinderGeometry(0.32, 0.36, 0.12, 20), m, 0.1, 1.2, -0.86, Math.PI / 2, 0, 0.3); void b; mesh(g, new THREE.BoxGeometry(0.08, 0.9, 0.05), std(0x4a3424, 0.8), -0.12, 1.85, -0.86, 0, 0, 0.3); break; }
    case "surfboard": { const b = mesh(g, new THREE.SphereGeometry(0.5, 16, 10), std(0x2bd4ff, 0.3), 0, 1.5, -0.9, 0, 0, 0.15); b.scale.set(0.42, 2.0, 0.08); mesh(g, new THREE.BoxGeometry(0.03, 1.6, 0.085), std(0xffffff), 0, 1.5, -0.9, 0, 0, 0.15); break; }
    case "balloons": { const g2 = new THREE.Group(); g2.position.set(0.3, 2.0, -0.6); g.add(g2); for (let i = 0; i < 3; i++) { const b = mesh(g2, new THREE.SphereGeometry(0.22, 14, 10), std([0xff4f8a, 0x39ff88, 0x6ee7ff][i], 0.3), -0.25 + i * 0.25, 1.4 + (i % 2) * 0.25, 0); b.scale.y = 1.15; mesh(g2, new THREE.CylinderGeometry(0.006, 0.006, 1.3, 4), std(0xffffff), -0.12 + i * 0.12, 0.65, 0); } A.push({ o: g2, kind: "sway" }); break; }
    case "sword": { mesh(g, new THREE.BoxGeometry(0.06, 1.5, 0.02), std(0xdfe6ea, 0.15, 1), 0.1, 1.7, -0.85, 0, 0, -0.6); mesh(g, new THREE.BoxGeometry(0.08, 0.35, 0.08), std(0x1a1a1a), 0.55, 2.35, -0.85, 0, 0, -0.6); mesh(g, new THREE.BoxGeometry(0.25, 0.04, 0.08), std(0xffcf3a, 0.3, 0.9), 0.45, 2.2, -0.85, 0, 0, -0.6); break; }
    case "dragonwings": {
      for (const s of [-1, 1]) { const w = new THREE.Group(); w.position.set(0.15 * s, 1.8, -0.7); g.add(w); const m = new THREE.MeshStandardMaterial({ color: 0x5a1a2a, roughness: 0.6, side: THREE.DoubleSide }); const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(1.1 * s, 0.6); shape.lineTo(1.0 * s, -0.1); shape.lineTo(0.7 * s, -0.4); shape.lineTo(0.4 * s, -0.2); shape.closePath(); w.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), m)); w.userData.side = s; A.push({ o: w, kind: "flap" }); }
      break;
    }
    case "jetpack": { const m = std(0x9aa1a5, 0.3, 0.8); for (const s of [-1, 1]) { mesh(g, new THREE.CylinderGeometry(0.17, 0.17, 0.85, 16), m, 0.2 * s, 1.5, -0.85); mesh(g, new THREE.ConeGeometry(0.17, 0.22, 16), std(0xd8322c, 0.5), 0.2 * s, 2.03, -0.85); const f = mesh(g, new THREE.ConeGeometry(0.12, 0.45, 12), glow(0xff8a3d, 1.8, 0.85), 0.2 * s, 0.85, -0.85, Math.PI, 0, 0); A.push({ o: f, kind: "flame" }); } mesh(g, new THREE.BoxGeometry(0.2, 0.5, 0.1), std(0x222222), 0, 1.55, -0.72); break; }
  }
}
function aura(id: string, g: THREE.Group, A: Anim[]) {
  const c = AURA[id]; if (c === undefined) return;
  const rainbow = id === "aura-rainbow";
  const ring = mesh(g, new THREE.RingGeometry(1.1, 1.3, 48), glow(c, 1.3, 0.8), 0, 0.04, 0, -Math.PI / 2); ring.castShadow = false; A.push({ o: ring, kind: "aura" });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 2.2, 32, 1, true), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); col.position.y = 1.1; g.add(col);
  for (let i = 0; i < 10; i++) { const p = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), glow(rainbow ? new THREE.Color().setHSL(i / 10, 1, 0.6).getHex() : c, 1.6)); const a = (i / 10) * Math.PI * 2; p.position.set(Math.cos(a) * 1.1, (i * 0.37) % 2.4, Math.sin(a) * 1.1); p.userData.a = a; g.add(p); A.push({ o: p, kind: "rise" }); }
}

/** Puts the outfit on (replacing whatever it wore before). */
export function dress(tr: THREE.Group, wear: Wear = {}) {
  const inner = tr.userData.inner as THREE.Group;
  const old = inner.getObjectByName("wear"); if (old) { inner.remove(old); old.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); }); }
  const g = new THREE.Group(); g.name = "wear"; inner.add(g);
  const A: Anim[] = [];
  if (wear.hat) hat(wear.hat, g, A);
  if (wear.eyes) eyes(wear.eyes, g);
  if (wear.neck) neck(wear.neck, g, A);
  if (wear.back) back(wear.back, g, A);
  if (wear.aura) aura(wear.aura, g, A);
  const ink = inner.children[0] as THREE.Mesh, line = wear.outline ? cosmetic(wear.outline)?.color : null;
  (ink.material as THREE.MeshBasicMaterial).color.set(line ?? "#050607");
  tr.userData.wearAnim = A;
}
/** Moves the moving parts (propeller, wings, cape, flames, aura sparks). */
export function animateWear(tr: THREE.Group, t: number, moving: number) {
  for (const a of (tr.userData.wearAnim ?? []) as Anim[]) {
    switch (a.kind) {
      case "spin": a.o.rotation.y = t * 14; break;
      case "flap": a.o.rotation.y = (a.o.userData.side as number) * (0.25 + Math.sin(t * (moving > 0.1 ? 9 : 2.5)) * 0.35); break;
      case "sway": a.o.rotation.x = 0.15 + Math.sin(t * 2.2) * 0.06 + moving * 0.35; break;
      case "bob": a.o.position.y = (a.base ?? 0) + Math.sin(t * 2) * 0.05; break;
      case "flame": a.o.scale.set(1, 0.7 + Math.random() * 0.6, 1); break;
      case "aura": a.o.rotation.z = t * 0.6; break;
      case "rise": { const ang = (a.o.userData.a as number) + t * 0.5; a.o.position.set(Math.cos(ang) * 1.1, (a.o.position.y + 0.012) % 2.4, Math.sin(ang) * 1.1); a.o.rotation.y = t * 3; break; }
    }
  }
}
