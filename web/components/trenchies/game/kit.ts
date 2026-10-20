/**
 * The building kit for the Trenchies world: cached materials, boxes and cylinders placed in tile coordinates, a
 * "local frame" for anything that stands against a wall or faces a direction, and the registries the world animates
 * every frame (glowing windows, lamps, spinning parts, blinking lights, screens, water).
 *
 * Tile (x, y) is the ground plan, y towards the camera; world X = x - LAND/2, world Z = y - LAND/2, Y is up.
 */
import * as THREE from "three";
import type { Nav, Pt, R } from "./nav";

export const NEON = 0x39ff88, CYAN = 0x6ee7ff, GOLD = 0xffcf3a, PINK = 0xff4fd8, WARM = 0xffd59a;
export type Wall = "back" | "left" | "front" | "right";
export type Kind = "stand" | "sit" | "lie" | "work" | "lift" | "swim" | "look" | "dance" | "chop" | "mine" | "fish" | "swing" | "bounce" | "net";
export type Spot = { act: string; at: Pt; pose: { x: number; y: number; z: number; yaw: number; kind: Kind }; min: number; max: number; w: number; night?: number; tag?: string;
  /** Sitting on a swing: the seat hangs `L` below the pivot and swings by `amp` radians (same timing as the spinner). */
  swing?: { L: number; amp: number; off: number } };

export type Registry = {
  nightMats: THREE.MeshBasicMaterial[]; lamps: THREE.PointLight[]; pools: THREE.MeshBasicMaterial[];
  blinkers: { m: THREE.MeshBasicMaterial; c: THREE.Color; off: number; rate: number }[];
  spinners: { o: THREE.Object3D; axis: "x" | "y" | "z"; rate: number; swing?: number; off?: number }[];
  bobbers: { o: THREE.Object3D; base: number; amp: number; rate: number; off: number }[];
  screens: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; off: number; kind: number }[];
  water: THREE.MeshBasicMaterial[]; spots: Spot[]; anim: THREE.Object3D[];
};
export const newRegistry = (): Registry => ({ nightMats: [], lamps: [], pools: [], blinkers: [], spinners: [], bobbers: [], screens: [], water: [], spots: [], anim: [] });

export type Frame = {
  g: THREE.Group; len: number; depth: number; yawIn: number;
  /** local (along the wall, out from the wall) to tile coordinates */
  T: (lx: number, lz: number) => Pt;
  /** a box: x along, z out, y up; w, d, h its size */
  b: (x: number, z: number, y: number, w: number, d: number, h: number, m: THREE.Material, shadow?: boolean) => THREE.Mesh;
  /** a cylinder standing at (x, z) */
  c: (x: number, z: number, y: number, r: number, h: number, m: THREE.Material, seg?: number, rTop?: number) => THREE.Mesh;
  /** a sphere */
  s: (x: number, z: number, y: number, r: number, m: THREE.Material, seg?: number) => THREE.Mesh;
  /** any mesh at a local position */
  put: <T extends THREE.Object3D>(o: T, x: number, z: number, y: number) => T;
  /** a spot to use this thing: approach at (ax, az), use at (px, pz) height y, facing back to the wall (or `face` radians from that) */
  spot: (act: string, px: number, pz: number, y: number, kind: Kind, o?: { ax?: number; az?: number; face?: number; min?: number; max?: number; w?: number; night?: number; swing?: Spot["swing"]; tag?: string }) => void;
};

export class Kit {
  readonly mats = new Map<string, THREE.Material>();
  constructor(public land: number, public root: THREE.Group, public nav: Nav, public reg: Registry) {}
  W(x: number, y: number) { return new THREE.Vector3(x - this.land / 2, 0, y - this.land / 2); }
  std(color: number, rough = 0.55, metal = 0.08) { const k = `s${color}:${rough}:${metal}`; let m = this.mats.get(k); if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); this.mats.set(k, m); } return m as THREE.MeshStandardMaterial; }
  flat(color: number, rough = 0.8) { const k = `f${color}:${rough}`; let m = this.mats.get(k); if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true }); this.mats.set(k, m); } return m as THREE.MeshStandardMaterial; }
  glow(color: number, strength = 1, own = false) {
    const k = `g${color}:${strength}`; let m = own ? undefined : this.mats.get(k);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength) }); (m as unknown as { toneMapped: boolean }).toneMapped = false; if (!own) this.mats.set(k, m); }
    return m as THREE.MeshBasicMaterial;
  }
  /** A warm light that brightens at night (windows, lamp shades, bulbs). */
  night(color = WARM, s = 0.6) { const m = this.glow(color, s, true); this.reg.nightMats.push(m); return m; }
  glass(opacity = 0.2) { const k = `glass${opacity}`; let m = this.mats.get(k); if (!m) { m = new THREE.MeshPhysicalMaterial({ color: 0xbfd6e0, roughness: 0.05, metalness: 0.1, transparent: true, opacity, depthWrite: false }); this.mats.set(k, m); } return m; }
  get M() {
    return {
      white: this.std(0xe2e5e3, 0.55, 0.05), soft: this.std(0xc4c8c6, 0.6), black: this.std(0x0e100f, 0.3, 0.5), ink: this.std(0x08090a, 0.45, 0.3),
      metal: this.std(0xa4aaa7, 0.28, 0.9), gold: this.std(GOLD, 0.25, 0.9), dark: this.std(0x1b1f1d, 0.6, 0.2), wood: this.std(0x7a5536, 0.75, 0.05),
      darkwood: this.std(0x4a3424, 0.8, 0.05), leaf: this.flat(0x2a5a36), leaf2: this.flat(0x3c7a45), stone: this.flat(0x6d726f, 0.9), red: this.std(0xc8323a, 0.5), fabric: this.std(0x3a4a5a, 0.9),
    };
  }
  /** A box with its min corner at tile (x, y), height z, size w (x), d (y), h (up). */
  box(x: number, y: number, z: number, w: number, d: number, h: number, mat: THREE.Material, shadow = true, g: THREE.Object3D = this.root) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const p = this.W(x + w / 2, y + d / 2); m.position.set(p.x, z + h / 2, p.z); m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
  }
  cyl(x: number, y: number, z: number, r: number, h: number, mat: THREE.Material, seg = 20, rTop = r, g: THREE.Object3D = this.root) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, r, h, seg), mat); const p = this.W(x, y); m.position.set(p.x, z + h / 2, p.z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }
  tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")!);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  }
  /** A glowing text sign (room names, neon). */
  sign(text: string, color = "#39ff88", w = 256, h = 64, font = 30, bg = "") {
    const t = this.tex(w, h, (g) => { if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } g.font = `700 ${font}px 'Space Grotesk', sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.shadowColor = color; g.shadowBlur = 10; g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 2); });
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: !bg }); (m as unknown as { toneMapped: boolean }).toneMapped = false; return m;
  }
  /** Marks an object (and everything in it) as moving, so it is never merged into the static meshes. */
  keep<T extends THREE.Object3D>(o: T) { this.reg.anim.push(o); return o; }
  /** A live chart screen (redrawn by the world a few times a second). */
  screen(kind = 0, w = 256, h = 150) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d")!, tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    this.reg.screens.push({ ctx, tex, off: Math.random() * 10, kind });
    const m = new THREE.MeshBasicMaterial({ map: tex }); (m as unknown as { toneMapped: boolean }).toneMapped = false; return m;
  }
  /**
   * A group standing in rect r with its back against one side: local x runs along that side (0..len), local z out
   * of it (0..depth), y up. Facing "into the room" means facing +z.
   */
  frame(r: R, wall: Wall, parent: THREE.Object3D = this.root): Frame {
    const g = new THREE.Group();
    const o = wall === "back" ? this.W(r.x, r.y) : wall === "left" ? this.W(r.x, r.y + r.d) : wall === "front" ? this.W(r.x + r.w, r.y + r.d) : this.W(r.x + r.w, r.y);
    g.position.copy(o); g.rotation.y = { back: 0, left: Math.PI / 2, front: Math.PI, right: -Math.PI / 2 }[wall];
    const T = (lx: number, lz: number): Pt => wall === "back" ? { x: r.x + lx, y: r.y + lz } : wall === "left" ? { x: r.x + lz, y: r.y + r.d - lx } : wall === "front" ? { x: r.x + r.w - lx, y: r.y + r.d - lz } : { x: r.x + r.w - lz, y: r.y + lx };
    const yawIn = { back: Math.PI, left: -Math.PI / 2, front: 0, right: Math.PI / 2 }[wall]; // facing the wall
    const len = wall === "back" || wall === "front" ? r.w : r.d, depth = wall === "back" || wall === "front" ? r.d : r.w;
    const put = <T extends THREE.Object3D>(m: T, x: number, z: number, y: number) => { m.position.set(x, y, z); m.traverse((o2) => { const mm = o2 as THREE.Mesh; if (mm.isMesh) { mm.castShadow = true; mm.receiveShadow = true; } }); g.add(m); return m; };
    const b: Frame["b"] = (x, z, y, w, d, h, m, shadow = true) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x + w / 2, y + h / 2, z + d / 2); mesh.castShadow = shadow; mesh.receiveShadow = true; g.add(mesh); return mesh; };
    const c: Frame["c"] = (x, z, y, rad, h, m, seg = 18, rTop = rad) => { const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rad, h, seg), m); mesh.position.set(x, y + h / 2, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
    const s: Frame["s"] = (x, z, y, rad, m, seg = 14) => { const mesh = new THREE.Mesh(new THREE.SphereGeometry(rad, seg, Math.max(6, seg >> 1)), m); mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh; };
    const spot: Frame["spot"] = (act, px, pz, y, kind, o = {}) => {
      const P = T(px, pz), A = T(o.ax ?? px, o.az ?? pz + 0.6);
      this.reg.spots.push({ act, at: A, pose: { x: P.x, y: P.y, z: y, yaw: yawIn + (o.face ?? 0), kind }, min: o.min ?? 6, max: o.max ?? 12, w: o.w ?? 0.8, night: o.night, swing: o.swing, tag: o.tag });
    };
    parent.add(g);
    return { g, len, depth, yawIn, T, b, c, s, put, spot };
  }
}

/** Wall-facing: which way something should face to look at a point (used for garden items facing the path). */
export const faceToward = (x: number, cx: number): Wall => (x < cx ? "left" : "right");
