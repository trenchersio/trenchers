/**
 * Trenchies world in 3D: a black glass island with neon edges, a white minimal house, black-and-white furniture
 * with neon accents, bloom, soft shadows and a slow orbit you can drag. Your Trenchie (the smooth 3D model in its
 * Trencher's skin) lives by your clock: desk by day, bed at night, toilet, rides, pool, the dog.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";
import { makeTrenchie } from "./trenchie3d";
import type { Look } from "./types";

const LAND = 14, RX = 1, RY = 1, NEON = 0x39ff88, CYAN = 0x6ee7ff;
type House = { w: number; d: number; h: number; windows: number; wall: number; trim: number; floor: number; glass?: boolean };
const HOUSES: Record<string, House> = {
  shack: { w: 4, d: 4, h: 2.0, windows: 0, wall: 0x8d9290, trim: 0x2a2e2c, floor: 0x121514 },
  cabin: { w: 5, d: 4.5, h: 2.1, windows: 1, wall: 0xc9ccca, trim: 0x111312, floor: 0x141716 },
  house: { w: 6, d: 5, h: 2.2, windows: 2, wall: 0xd4d7d5, trim: 0x0d0f0e, floor: 0x0f1211 },
  villa: { w: 7, d: 5.5, h: 2.3, windows: 2, wall: 0xdadddb, trim: 0x0d0f0e, floor: 0x1a1d1c, glass: true },
  mansion: { w: 8, d: 6, h: 2.6, windows: 3, wall: 0x0e1110, trim: 0xd9b45a, floor: 0x0a0c0b, glass: true },
};
type Act = "walk" | "desk" | "bed" | "toilet" | "couch" | "ride" | "idle" | "swim" | "dance" | "pet";
type Spot = { x: number; y: number; face: number; act: Act; min: number; max: number };
const LINES: Record<string, string[]> = {
  desk: ["checking the charts", "my picks look good", "volume first, then I buy", "is this the dip?", "one more chart", "gm to the trench"],
  bed: ["zzz", "dreaming of green candles", "zzz… top 3…"], toilet: ["best ideas come here", "…", "reading the whitepaper"],
  ride: ["touching grass", "brb", "taking it for a spin"], idle: ["gm", "nice night in the trench", "need a bigger house", "what are you picking?", "wagmi"],
  couch: ["charts on the big screen", "five more minutes"], swim: ["pool day", "ahh"], pet: ["good boy", "who's a good dog"], dance: ["LET'S GO!", "top 3!", "XP!"],
};

// tile (x, y) on the plot → world (x, z)
const W = (x: number, y: number) => new THREE.Vector3(x - LAND / 2, 0, y - LAND / 2);

export class World3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -100, 200);
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private key = new THREE.DirectionalLight(0xffffff, 1.1);
  private hemi = new THREE.HemisphereLight(0xdfe8ff, 0x0a0c0b, 0.45);
  private statics = new THREE.Group();
  private dyn = new THREE.Group();
  private screens: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; off: number }[] = [];
  private nightMats: THREE.MeshBasicMaterial[] = [];
  private lamps: THREE.PointLight[] = [];
  private fish: THREE.Mesh[] = [];
  private trenchie: THREE.Group | null = null;
  private vehicle: THREE.Group | null = null;
  private dogMesh: THREE.Group | null = null;
  private bubble: THREE.Sprite | null = null;
  private zs: { s: THREE.Sprite; t: number }[] = [];
  private confetti: { m: THREE.Mesh; v: THREE.Vector3; t: number }[] = [];
  private look: Look; private nft: number; private t = 0; private lastScreen = 0;
  private me = { x: 3, y: 7, face: 1, act: "idle" as Act, until: 2, path: [] as { x: number; y: number }[], next: null as Spot | null, step: 0, hop: 0, rot: 0 };
  private ride: { i: number; p: number } | null = null;
  private dog = { x: 8, y: 9, tx: 8, ty: 9, wait: 0 };
  private raycaster = new THREE.Raycaster();
  private bubbleUntil = 0;
  hourOverride: number | null = null;

  constructor(private canvas: HTMLCanvasElement, look: Look, nft: number) {
    this.look = look; this.nft = nft;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }));
    r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene.background = new THREE.Color(0x020303);
    this.scene.fog = new THREE.Fog(0x020303, 50, 110);
    this.camera.position.set(18, 17, 18); this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enablePan: false, enableDamping: true, dampingFactor: 0.08, minZoom: 0.7, maxZoom: 2.4, minPolarAngle: 0.55, maxPolarAngle: 1.12, rotateSpeed: 0.5, autoRotate: true, autoRotateSpeed: 0.25 });
    this.key.position.set(10, 22, 6); this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048);
    Object.assign(this.key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 60 }); this.key.shadow.bias = -0.0006;
    this.scene.add(this.key, this.hemi, new THREE.AmbientLight(0xffffff, 0.12));
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.4, 0.86);
    this.composer.addPass(this.bloom);
    this.scene.add(this.statics, this.dyn);
    this.sky();
    this.build();
    const d = this.door(); this.me.x = d.x; this.me.y = d.y + 1.2;
  }

  // ------------------------------------------------------------------ helpers
  private get H() { return HOUSES[this.look.house] ?? HOUSES.shack; }
  private has(id: string) { return this.look.items.includes(id); }
  hour() { if (this.hourOverride !== null) return this.hourOverride; const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  private night() { const h = this.hour(); return h >= 22.5 || h < 6.5; }
  private std(color: number, rough = 0.5, metal = 0.1) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); }
  private glow(color: number, strength = 1) { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength) }); (m as unknown as { toneMapped: boolean }).toneMapped = false; return m; }
  /** A box with its min corner at tile (x, y), height z, size w (x), d (y), h (up). */
  private box(g: THREE.Object3D, x: number, y: number, z: number, w: number, d: number, h: number, mat: THREE.Material, shadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const p = W(x + w / 2, y + d / 2); m.position.set(p.x, z + h / 2, p.z); m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
  }
  private label(text: string, color = "#ffffff", bg = "rgba(255,255,255,0.95)", size = 40) {
    const c = document.createElement("canvas"), g = c.getContext("2d")!; g.font = `${size}px 'Lilita One', sans-serif`;
    const w = Math.ceil(g.measureText(text).width) + size; c.width = w; c.height = size * 1.7;
    g.font = `${size}px 'Lilita One', sans-serif`; g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, w, c.height, c.height / 2); g.fill();
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, c.height / 2 + 2);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.renderOrder = 10;
    s.scale.set((w / c.height) * 0.62, 0.62, 1); return s;
  }
  private screen(w: number, h: number) {
    const c = document.createElement("canvas"); c.width = 256; c.height = Math.round(256 * (h / w));
    const ctx = c.getContext("2d")!, tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    this.screens.push({ ctx, tex, off: Math.random() * 10 });
    const m = new THREE.MeshBasicMaterial({ map: tex }); (m as unknown as { toneMapped: boolean }).toneMapped = false; return m;
  }
  private drawScreens() {
    for (const s of this.screens) {
      const { ctx } = s, W2 = ctx.canvas.width, H2 = ctx.canvas.height;
      ctx.fillStyle = "#04110a"; ctx.fillRect(0, 0, W2, H2);
      ctx.strokeStyle = "rgba(57,255,136,0.12)"; ctx.lineWidth = 1; for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (H2 * i) / 4); ctx.lineTo(W2, (H2 * i) / 4); ctx.stroke(); }
      ctx.beginPath(); for (let i = 0; i <= 40; i++) { const f = i / 40, v = 0.25 + 0.5 * ((Math.sin(f * 9 + this.t * 0.9 + s.off) + 1) / 2) * (0.5 + f * 0.5); const px = f * W2, py = H2 - v * H2; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.strokeStyle = "#39ff88"; ctx.lineWidth = 3; ctx.shadowColor = "#39ff88"; ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
      s.tex.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ static world
  private sky() {
    const n = 500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 30 + Math.random() * 40; pos[3 * i] = Math.cos(a) * r; pos[3 * i + 1] = -10 + Math.random() * 40; pos[3 * i + 2] = Math.sin(a) * r; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.55 })));
  }
  setLook(l: Look, nft: number) {
    const skin = nft !== this.nft || l.palette.main !== this.look.palette.main || l.palette.bg !== this.look.palette.bg;
    const rebuild = skin || l.house !== this.look.house || l.vehicle !== this.look.vehicle || l.items.join() !== this.look.items.join() || l.name !== this.look.name;
    this.look = l; this.nft = nft;
    if (skin && this.trenchie) { this.dyn.remove(this.trenchie); this.trenchie = null; }
    if (rebuild) this.build();
  }
  private clear(g: THREE.Group) {
    g.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mm = m.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(mm)) mm.forEach((x) => x.dispose()); else mm?.dispose?.(); });
    g.clear();
  }
  private build() {
    this.clear(this.statics); this.screens = []; this.nightMats = []; this.lamps.forEach((l) => l.parent?.remove(l)); this.lamps = []; this.fish = [];
    const S = this.statics, H = this.H, X = RX, Y = RY;
    const black = this.std(0x0b0d0c, 0.32, 0.55), white = this.std(0xd9dcda, 0.7), ink = this.std(0x050607, 0.4, 0.3);
    // island: black glass slab, faint grid, neon rim
    this.box(S, 0, 0, -0.9, LAND, LAND, 0.9, black, false).castShadow = false;
    const grid = new THREE.GridHelper(LAND, LAND, 0x2f7a52, 0x1d4a33); grid.position.y = 0.006; (grid.material as THREE.Material).transparent = true; (grid.material as THREE.Material).opacity = 0.7; S.add(grid);
    const rim = this.glow(NEON, 2.2);
    for (const [x, y, w, d] of [[0, 0, LAND, 0.08], [0, LAND - 0.08, LAND, 0.08], [0, 0, 0.08, LAND], [LAND - 0.08, 0, 0.08, LAND]]) this.box(S, x, y, 0, w, d, 0.05, rim, false);
    // light pylons on the corners: white posts with a neon cap and a faint beam
    for (const [x, y] of [[0.25, 0.25], [LAND - 0.55, 0.25], [0.25, LAND - 0.55], [LAND - 0.55, LAND - 0.55]]) {
      this.box(S, x, y, 0, 0.3, 0.3, 1.6, white); this.box(S, x - 0.02, y - 0.02, 1.6, 0.34, 0.34, 0.12, this.glow(NEON, 2.4), false);
      if (x > LAND / 2 && y > LAND / 2) continue; // no beam on the corner nearest the camera
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.14, 3.2, 12, 1, true), new THREE.MeshBasicMaterial({ color: NEON, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide }));
      const p = W(x + 0.15, y + 0.15); beam.position.set(p.x, 1.72 + 1.6, p.z); S.add(beam);
    }
    for (const [x, y, w, d] of [[0, LAND - 0.03, LAND, 0.03], [LAND - 0.03, 0, 0.03, LAND]]) this.box(S, x, y, -0.92, w, d, 0.03, this.glow(NEON, 0.5), false);
    // path of light from the door
    const dd = this.door();
    for (let y = Math.ceil(dd.y); y < LAND; y++) { this.box(S, dd.x - 0.45, y + 0.05, 0, 0.9, 0.9, 0.02, white, false); this.box(S, dd.x - 0.47, y + 0.03, 0, 0.94, 0.04, 0.025, this.glow(NEON, 0.9), false); }
    // floor + back walls + neon trim
    this.box(S, X, Y, 0, H.w, H.d, 0.1, this.std(H.floor, H.floor > 0x808080 ? 0.35 : 0.22, 0.4));
    const wall = this.std(H.wall, 0.6, H.wall < 0x404040 ? 0.4 : 0.05);
    this.box(S, X - 0.2, Y - 0.2, 0, H.w + 0.2, 0.2, H.h, wall);
    this.box(S, X - 0.2, Y, 0, 0.2, H.d, H.h, wall);
    const trim = this.glow(this.look.house === "mansion" ? 0xd9b45a : NEON, 1.4);
    this.box(S, X - 0.2, Y - 0.02, H.h, H.w + 0.2, 0.04, 0.04, trim, false); this.box(S, X - 0.02, Y, H.h, 0.04, H.d, 0.04, trim, false);
    this.box(S, X, Y + 0.002, 0.1, H.w, 0.02, 0.04, trim, false); this.box(S, X + 0.002, Y, 0.1, 0.02, H.d, 0.04, trim, false);
    // windows: glass panels that light up at night
    for (let i = 0; i < H.windows; i++) {
      const wx = X + (H.w / (H.windows + 1)) * (i + 1) - 0.5;
      const m = this.glow(0x9fb4c8, 0.6); this.nightMats.push(m);
      this.box(S, wx, Y + 0.001, 0.85, H.glass ? 1.1 : 0.9, 0.02, H.glass ? 1.15 : 0.8, m, false);
      this.box(S, wx - 0.05, Y + 0.0, 0.8, (H.glass ? 1.1 : 0.9) + 0.1, 0.025, 0.05, ink, false);
    }
    const P = this.look.palette;
    // desk + monitors + chair
    this.box(S, X + 0.18, Y + 0.35, 0.66, 0.75, 1.3, 0.06, ink); for (const [a, b] of [[0.2, 0.38], [0.85, 0.38], [0.2, 1.58], [0.85, 1.58]]) this.box(S, X + a, Y + b, 0, 0.05, 0.05, 0.66, white);
    const mons = this.has("monitors") ? [-0.46, 0, 0.46] : [0];
    for (const off of mons) {
      this.box(S, X + 0.3, Y + 0.95 + off - 0.04, 0.72, 0.06, 0.08, 0.16, ink);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.44), this.screen(0.72, 0.44)); const p = W(X + 0.36, Y + 0.97 + off); scr.position.set(p.x, 1.1, p.z); scr.rotation.y = Math.PI / 2; S.add(scr);
      this.box(S, X + 0.27, Y + 0.6 + off, 0.86, 0.08, 0.75, 0.5, ink);
    }
    const gaming = this.has("chair");
    this.box(S, X + 1.05, Y + 0.72, 0.36, 0.55, 0.55, 0.08, gaming ? ink : white); this.box(S, X + 1.5, Y + 0.72, 0.36, 0.08, 0.55, gaming ? 0.75 : 0.45, gaming ? ink : white); this.box(S, X + 1.28, Y + 0.95, 0, 0.08, 0.08, 0.36, ink);
    if (gaming) this.box(S, X + 1.585, Y + 0.72, 0.5, 0.01, 0.55, 0.5, this.glow(NEON, 1.4), false);
    // bed
    const bx = X + H.w - 1.5, by = Y + 0.2;
    this.box(S, bx, by, 0, 1.35, 2.0, 0.28, ink); this.box(S, bx + 0.05, by + 0.05, 0.28, 1.25, 1.9, 0.14, white);
    this.box(S, bx + 0.12, by + 0.1, 0.42, 1.1, 0.42, 0.12, white); this.box(S, bx + 0.05, by + 0.62, 0.42, 1.25, 1.33, 0.06, black);
    this.box(S, bx + 0.05, by + 0.62, 0.48, 1.25, 0.04, 0.012, this.glow(NEON, 1.3), false);
    this.box(S, bx - 0.04, by, 0, 0.08, 2.0, 0.85, ink);
    // toilet
    const gold = this.has("goldtoilet"), tm = gold ? this.std(0xffcf3a, 0.25, 0.9) : white, tx = X + 0.16, ty = Y + H.d - 0.85;
    this.box(S, tx, ty, 0, 0.42, 0.55, 0.36, tm); this.box(S, tx - 0.02, ty + 0.05, 0.36, 0.16, 0.45, 0.4, tm);
    if (this.has("rug")) { this.box(S, X + 1.4, Y + 1.5, 0.1, Math.min(2.4, H.w - 3), 1.8, 0.01, black, false); const rw = Math.min(2.4, H.w - 3); for (const [a, b, c, d] of [[0, 0, rw, 0.03], [0, 1.77, rw, 0.03], [0, 0, 0.03, 1.8], [rw - 0.03, 0, 0.03, 1.8]]) this.box(S, X + 1.4 + a, Y + 1.5 + b, 0.111, c, d, 0.006, this.glow(NEON, 1), false); }
    if (this.has("tv")) {
      this.box(S, X + H.w / 2 - 0.7, Y + 0.02, 0.85, 1.4, 0.05, 0.8, ink);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.7), this.screen(1.3, 0.7)); const p = W(X + H.w / 2, Y + 0.075); scr.position.set(p.x, 1.25, p.z); S.add(scr);
      const cx = X + H.w / 2 - 0.9, cy = Y + H.d / 2 + 0.95; this.box(S, cx, cy, 0, 1.8, 0.7, 0.3, white); this.box(S, cx, cy + 0.5, 0.3, 1.8, 0.2, 0.4, white);
    }
    if (this.has("plant")) { const px = X + H.w - 0.7, py = Y + H.d - 0.7; this.box(S, px, py, 0, 0.4, 0.4, 0.32, white); const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), this.std(0x0e1311, 0.6)); const p = W(px + 0.2, py + 0.2); leaf.position.set(p.x, 0.62, p.z); leaf.castShadow = true; S.add(leaf); const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.33, 0)), new THREE.LineBasicMaterial({ color: NEON })); wire.position.copy(leaf.position); S.add(wire); }
    if (this.has("lamp")) { const lx = X + H.w - 2.05, ly = Y + 0.3; this.box(S, lx + 0.14, ly + 0.14, 0, 0.06, 0.06, 1.15, white); const m = this.glow(0xfff2d6, 0.4); this.nightMats.push(m); this.box(S, lx, ly, 1.1, 0.34, 0.34, 0.26, m, false); const L = new THREE.PointLight(0xffe2b0, 0, 6); const p = W(lx + 0.17, ly + 0.17); L.position.set(p.x, 1.2, p.z); S.add(L); this.lamps.push(L); }
    if (this.has("shelf")) { const sx = X + 0.05, sy = Y + Math.min(2.2, H.d - 1.9); this.box(S, sx, sy, 0, 0.38, 1.0, 1.4, ink); for (let k = 0; k < 3; k++) for (let b = 0; b < 4; b++) this.box(S, sx + 0.3, sy + 0.08 + b * 0.22, 0.12 + k * 0.45, 0.06, 0.16, 0.3, (b + k) % 3 ? white : this.glow(NEON, 0.8), false); }
    if (this.has("aquarium")) { const ax = X + H.w - 0.62, ay = Y + H.d - 2.3; this.box(S, ax, ay, 0, 0.5, 1.1, 0.45, ink); const water = new THREE.MeshPhysicalMaterial({ color: CYAN, transparent: true, opacity: 0.35, roughness: 0.05, emissive: new THREE.Color(CYAN), emissiveIntensity: 0.5 }); this.box(S, ax, ay, 0.45, 0.5, 1.1, 0.55, water, false); for (let f = 0; f < 3; f++) { const fm = this.box(S, ax + 0.2, ay + 0.3, 0.6 + f * 0.12, 0.08, 0.14, 0.06, this.glow([0xff9f43, 0xffffff, 0x39ff88][f], 1.2), false); this.fish.push(fm); } }
    if (this.has("neon")) { const c = document.createElement("canvas"); c.width = 256; c.height = 128; const g = c.getContext("2d")!; g.font = "92px 'Lilita One', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.shadowColor = "#39ff88"; g.shadowBlur = 18; g.fillStyle = "#b9ffd6"; g.fillText("GM", 128, 68); const t = new THREE.CanvasTexture(c); const m = new THREE.MeshBasicMaterial({ map: t, transparent: true }); (m as unknown as { toneMapped: boolean }).toneMapped = false; const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), m); const p = W(X + 0.03, Y + 2.5); pl.position.set(p.x, 1.45, p.z); pl.rotation.y = Math.PI / 2; S.add(pl); }
    if (this.has("trophies")) { this.box(S, X + H.w - 2.7, Y + 0.02, 1.3, 1.2, 0.25, 0.05, ink); const n = Math.max(1, Math.min(4, this.look.trophies ?? 1)); for (let i = 0; i < n; i++) this.box(S, X + H.w - 2.6 + i * 0.28, Y + 0.06, 1.35, 0.14, 0.14, 0.24, this.std(0xffcf3a, 0.25, 0.9)); }
    // outside
    const pool = this.pool();
    if (pool) { this.box(S, pool.x - 0.15, pool.y - 0.15, 0, pool.w + 0.3, pool.d + 0.3, 0.12, white); const w2 = this.glow(0x2bd4ff, 0.9); this.box(S, pool.x, pool.y, 0.121, pool.w, pool.d, 0.01, w2, false); }
    if (this.has("trees")) for (const [tx, ty, s] of [[11.4, 1.3, 1], [12.7, 3.6, 0.8], [0.9, 12.3, 0.9], [12.5, 12.2, 1.1], [9.6, 1.1, 0.75]] as [number, number, number][]) {
      this.box(S, tx, ty, 0, 0.12 * s, 0.12 * s, 0.9 * s, white);
      const cn = new THREE.Mesh(new THREE.OctahedronGeometry(0.55 * s, 0), this.std(0x0c0e0d, 0.45, 0.4)); const p = W(tx + 0.06, ty + 0.06); cn.position.set(p.x, 1.25 * s, p.z); cn.castShadow = true; S.add(cn);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.56 * s, 0)), new THREE.LineBasicMaterial({ color: NEON })); e.position.copy(cn.position); S.add(e);
    }
    if (this.has("mailbox")) { const mx = dd.x + 0.8, my = 13.1; this.box(S, mx + 0.1, my + 0.1, 0, 0.06, 0.06, 0.6, white); this.box(S, mx, my, 0.6, 0.3, 0.42, 0.24, ink); const lab = this.label(this.look.name, "#0b0d0c", "rgba(241,243,242,0.95)", 34); const p = W(mx + 0.15, my + 0.2); lab.position.set(p.x, 1.15, p.z); lab.scale.multiplyScalar(0.8); S.add(lab); }
    // vehicle + dog + Trenchie
    this.vehicle?.parent?.remove(this.vehicle); this.vehicle = this.makeVehicle(this.look.vehicle); this.dyn.add(this.vehicle);
    this.dogMesh?.parent?.remove(this.dogMesh); this.dogMesh = this.has("dog") ? this.makeDog() : null; if (this.dogMesh) this.dyn.add(this.dogMesh);
    if (!this.trenchie) { this.trenchie = makeTrenchie(this.nft, P, 1.35); this.dyn.add(this.trenchie); }
  }
  private makeVehicle(v: string) {
    const g = new THREE.Group(), ink = this.std(0x07090a, 0.35, 0.6), white = this.std(0xf1f3f2, 0.4, 0.2), glow = this.glow(NEON, 1.6);
    const add = (x: number, y: number, z: number, w: number, h: number, d: number, m: THREE.Material) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; g.add(b); return b; };
    const wheel = (x: number, z: number, r: number) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.1, 18), ink); c.rotation.x = Math.PI / 2; c.position.set(x, r, z); c.castShadow = true; g.add(c); const rimM = new THREE.Mesh(new THREE.TorusGeometry(r * 0.75, 0.02, 6, 18), glow); rimM.position.set(x, r, z + 0.055); g.add(rimM); };
    if (v === "bike" || v === "scooter") {
      wheel(-0.42, 0, 0.2); wheel(0.42, 0, 0.2);
      if (v === "bike") { add(0, 0.45, 0, 0.8, 0.04, 0.04, white); add(-0.12, 0.55, 0, 0.04, 0.25, 0.04, white); add(-0.14, 0.68, 0, 0.22, 0.04, 0.1, ink); add(0.38, 0.62, 0, 0.04, 0.38, 0.04, white); add(0.38, 0.82, 0, 0.04, 0.04, 0.34, ink); }
      else { add(0, 0.3, 0, 0.9, 0.12, 0.26, white); add(0.4, 0.62, 0, 0.06, 0.6, 0.06, ink); add(0.4, 0.92, 0, 0.06, 0.06, 0.4, ink); add(-0.15, 0.42, 0, 0.4, 0.12, 0.24, ink); add(0, 0.22, 0, 0.8, 0.02, 0.2, glow); }
    } else {
      const L = v === "hatch" ? 1.5 : 1.85, Wd = 0.85, low = v === "hatch" ? 0.42 : 0.32, body = v === "super" ? white : v === "sports" ? ink : white;
      for (const [x, z] of [[-L / 2 + 0.32, -Wd / 2], [L / 2 - 0.32, -Wd / 2], [-L / 2 + 0.32, Wd / 2], [L / 2 - 0.32, Wd / 2]]) wheel(x, z, 0.17);
      add(0, 0.17 + low / 2, 0, L, low, Wd, body);
      const cab = v === "hatch" ? { x: -0.1, w: 1.0, h: 0.38 } : { x: -0.05, w: 0.8, h: 0.26 };
      add(cab.x, 0.17 + low + cab.h / 2, 0, cab.w, cab.h, Wd - 0.1, new THREE.MeshPhysicalMaterial({ color: 0x0a0d0c, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85 }));
      add(0, 0.12, 0, L - 0.2, 0.02, Wd - 0.1, this.glow(v === "super" ? 0xffffff : NEON, 2)); // underglow
      add(L / 2 + 0.005, 0.17 + low * 0.6, -Wd / 2 + 0.15, 0.01, 0.06, 0.18, this.glow(0xffffff, 2)); add(L / 2 + 0.005, 0.17 + low * 0.6, Wd / 2 - 0.15, 0.01, 0.06, 0.18, this.glow(0xffffff, 2));
      add(-L / 2 - 0.005, 0.17 + low * 0.6, 0, 0.01, 0.05, Wd - 0.2, this.glow(0xff3355, 2));
      if (v !== "hatch") add(-L / 2 + 0.1, 0.17 + low + 0.12, 0, 0.12, 0.04, Wd - 0.1, v === "super" ? glow : ink);
      if (v === "super") add(0, 0.17 + low + 0.005, 0, L * 0.7, 0.01, 0.06, glow);
    }
    return g;
  }
  private makeDog() {
    const g = new THREE.Group(), w = this.std(0xf1f3f2, 0.55), k = this.std(0x07090a, 0.4);
    const add = (x: number, y: number, z: number, a: number, b: number, c: number, m: THREE.Material) => { const s = new THREE.Mesh(new THREE.BoxGeometry(a, b, c), m); s.position.set(x, y, z); s.castShadow = true; g.add(s); return s; };
    add(0, 0.28, 0, 0.5, 0.22, 0.24, w); add(0.3, 0.42, 0, 0.22, 0.22, 0.24, w); add(0.43, 0.4, 0, 0.08, 0.08, 0.1, k);
    for (const [x, z] of [[-0.18, -0.08], [-0.18, 0.08], [0.18, -0.08], [0.18, 0.08]]) add(x, 0.09, z, 0.07, 0.18, 0.07, w);
    add(0.3, 0.56, 0.08, 0.06, 0.08, 0.04, k); add(0.3, 0.56, -0.08, 0.06, 0.08, 0.04, k);
    const tail = add(-0.29, 0.38, 0, 0.12, 0.04, 0.04, w); g.userData.tail = tail;
    add(0, 0.38, 0, 0.52, 0.02, 0.26, this.glow(NEON, 1.2)); // neon collar line
    return g;
  }

  // ------------------------------------------------------------------ behaviour (same layout as the plot)
  private door() { return { x: RX + this.H.w / 2, y: RY + this.H.d + 0.35 }; }
  private inRoom(x: number, y: number) { return x > RX && x < RX + this.H.w && y > RY && y < RY + this.H.d; }
  private pool() { return this.has("pool") && (this.look.house === "villa" || this.look.house === "mansion") ? { x: RX + 0.2, y: RY + this.H.d + 1.6, w: 3.2, d: 2.2 } : null; }
  private parked() { const dd = this.door(); return { x: dd.x + 1.8, y: dd.y + 1.4 }; }
  private loop() { return [{ x: 12.6, y: 12.6 }, { x: 12.6, y: 0.9 }, { x: 10.6, y: 0.6 }, { x: 10.4, y: 8.2 }, { x: 4, y: 12.8 }, { x: 12, y: 13 }]; }
  private spots(): Spot[] {
    const { w, d } = this.H, X = RX, Y = RY;
    const s: Spot[] = [{ x: X + 1.33, y: Y + 1.0, face: 2, act: "desk", min: 12, max: 26 }, { x: X + 0.4, y: Y + d - 0.58, face: 1, act: "toilet", min: 5, max: 9 }, { x: X + w - 0.8, y: Y + 1.2, face: 1, act: "bed", min: 25, max: 45 }];
    if (this.has("tv")) s.push({ x: X + w / 2, y: Y + d / 2 + 1.25, face: 3, act: "couch", min: 10, max: 18 });
    const p = this.pool(); if (p) s.push({ x: p.x + 1.6, y: p.y + 1.1, face: 1, act: "swim", min: 8, max: 14 });
    return s;
  }
  private choose() {
    const night = this.night(), r = Math.random(), sp = this.spots(), by = (a: Act) => sp.find((x) => x.act === a);
    let next: Spot | undefined;
    if (night) next = r < 0.8 ? by("bed") : r < 0.9 ? by("toilet") : by("desk");
    else {
      const w: [string, number][] = [["desk", 34], ["wander", 16], ["ride", 14], ["toilet", 7], ["bed", 4], ["couch", this.has("tv") ? 11 : 0], ["swim", this.pool() ? 8 : 0], ["pet", this.has("dog") ? 6 : 0]];
      let k = Math.random() * w.reduce((a, b) => a + b[1], 0), pick = "desk";
      for (const [a, n] of w) { if ((k -= n) < 0) { pick = a; break; } }
      if (pick === "wander") next = { x: 1 + Math.random() * 11.5, y: RY + this.H.d + 1 + Math.random() * (LAND - RY - this.H.d - 2), face: 1, act: "idle", min: 3, max: 6 };
      else if (pick === "ride") { const p = this.parked(); next = { x: p.x - 0.7, y: p.y + 0.6, face: 0, act: "ride", min: 0, max: 0 }; }
      else if (pick === "pet") next = { x: this.dog.x + 0.7, y: this.dog.y, face: 2, act: "pet", min: 4, max: 6 };
      else next = by(pick as Act);
    }
    next ??= { x: this.door().x, y: this.door().y + 1, face: 1, act: "idle", min: 2, max: 4 };
    const path: { x: number; y: number }[] = [], din = this.inRoom(this.me.x, this.me.y), tin = this.inRoom(next.x, next.y), dd = this.door();
    if (din !== tin) { path.push({ x: dd.x, y: dd.y - (din ? 0.6 : -0.1) }); path.push({ x: dd.x, y: dd.y + (din ? 0.4 : -0.8) }); }
    path.push({ x: next.x, y: next.y }); this.me.path = path; this.me.next = next; this.me.act = "walk";
  }
  say(text?: string) {
    const pool = LINES[this.me.act] ?? LINES.idle; const s = text ?? pool[Math.floor(Math.random() * pool.length)];
    if (this.bubble) { this.dyn.remove(this.bubble); (this.bubble.material as THREE.SpriteMaterial).map?.dispose(); this.bubble.material.dispose(); }
    this.bubble = this.label(s, "#0b0d0c"); this.dyn.add(this.bubble); this.bubbleUntil = this.t + 3.2;
  }
  celebrate() {
    this.me.act = "dance"; this.me.until = this.t + 6; this.me.path = []; this.say("LET'S GO!");
    const cols = [NEON, 0xffffff, 0x6ee7ff, 0xffcf3a];
    for (let i = 0; i < 90; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), this.glow(cols[i % 4], 1.4)); const p = W(this.me.x, this.me.y); m.position.set(p.x, 1.2, p.z); this.dyn.add(m); this.confetti.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4), t: 2.2 }); }
  }
  poke() { if (this.me.act === "bed") { this.say("zzz… five more minutes"); return; } this.say(); this.me.hop = 0.35; }
  click(nx: number, ny: number) {
    if (!this.trenchie) return;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    if (this.raycaster.intersectObject(this.trenchie, true).length) this.poke();
  }

  update(dt: number) {
    this.t += dt; const m = this.me;
    m.hop = Math.max(0, m.hop - dt * 1.4);
    if (m.act === "walk") {
      const p = m.path[0];
      if (!p) { const s = m.next!; m.act = s.act; m.face = s.face; m.until = this.t + s.min + Math.random() * (s.max - s.min); if (s.act === "ride") this.ride = { i: 0, p: 0 }; if (Math.random() < 0.45 || s.act === "bed") this.say(); }
      else { const dx = p.x - m.x, dy = p.y - m.y, dist = Math.hypot(dx, dy), sp = 1.4 * dt; m.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3; if (dist <= sp) { m.x = p.x; m.y = p.y; m.path.shift(); } else { m.x += (dx / dist) * sp; m.y += (dy / dist) * sp; } m.step += dt * 9; }
    } else if (m.act === "ride" && this.ride) {
      const L = this.loop(), a = this.ride.i === 0 ? this.parked() : L[this.ride.i - 1], b = this.ride.i < L.length ? L[this.ride.i] : this.parked();
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, speed = { bike: 2.6, scooter: 3.2, hatch: 4, sports: 5.2, super: 6.4 }[this.look.vehicle] ?? 3;
      this.ride.p += (speed * dt) / len; const f = Math.min(1, this.ride.p);
      m.x = a.x + (b.x - a.x) * f; m.y = a.y + (b.y - a.y) * f; m.face = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (b.x > a.x ? 0 : 2) : b.y > a.y ? 1 : 3;
      if (this.ride.p >= 1) { this.ride.p = 0; this.ride.i++; if (this.ride.i > L.length) { this.ride = null; const p = this.parked(); m.x = p.x - 0.7; m.y = p.y + 0.6; m.act = "idle"; m.until = this.t + 1.5; } }
    } else if (this.t >= m.until) { if (m.act === "bed" && this.night() && Math.random() < 0.85) m.until = this.t + 30; else this.choose(); }
    // dog
    if (this.has("dog")) { const dg = this.dog; dg.wait -= dt; if (dg.wait <= 0) { const near = Math.random() < 0.6 && !this.inRoom(m.x, m.y); dg.tx = near ? m.x + (Math.random() - 0.5) * 2 : 2 + Math.random() * 10; dg.ty = near ? m.y + 0.8 + Math.random() : RY + this.H.d + 1.5 + Math.random() * 6; dg.tx = Math.max(0.6, Math.min(13.4, dg.tx)); dg.ty = Math.max(RY + this.H.d + 0.8, Math.min(13.4, dg.ty)); dg.wait = 3 + Math.random() * 5; } const dx = dg.tx - dg.x, dy = dg.ty - dg.y, d2 = Math.hypot(dx, dy); if (d2 > 0.05) { const sp = Math.min(d2, 2.2 * dt); dg.x += (dx / d2) * sp; dg.y += (dy / d2) * sp; } }
    this.sync(dt);
  }

  private sync(dt: number) {
    const m = this.me, night = this.night(), tr = this.trenchie;
    // day / night
    const h = this.hour(), day = h < 5 ? 0 : h < 8 ? (h - 5) / 3 : h < 18 ? 1 : h < 21.5 ? 1 - (h - 18) / 3.5 : 0;
    this.key.intensity = 0.3 + 0.7 * day; this.hemi.intensity = 0.15 + 0.25 * day;
    (this.scene.background as THREE.Color).setRGB(0.008 + 0.012 * day, 0.01 + 0.013 * day, 0.011 + 0.014 * day);
    this.bloom.strength = 0.55 + 0.45 * (1 - day);
    for (const mm of this.nightMats) mm.color.setRGB(night ? 1.6 : 0.42, night ? 1.5 : 0.5, night ? 1.25 : 0.58);
    for (const l of this.lamps) l.intensity = night ? 1.4 : 0;
    this.fish.forEach((f, i) => { f.position.z = W(0, RY + this.H.d - 2.3 + 0.2 + ((this.t * 0.15 + i * 0.33) % 1) * 0.8).z; });
    if (this.t - this.lastScreen > 0.12) { this.lastScreen = this.t; this.drawScreens(); }
    // vehicle: parked, or under the Trenchie while riding
    const riding = m.act === "ride" && !!this.ride, rot = [Math.PI / 2, 0, -Math.PI / 2, Math.PI][m.face];
    if (this.vehicle) { const vp = riding ? { x: m.x, y: m.y } : this.parked(), p = W(vp.x, vp.y); this.vehicle.position.set(p.x, 0, p.z); this.vehicle.rotation.y = riding ? rot - Math.PI / 2 : 0; }
    // the Trenchie
    if (tr) {
      const inner = tr.userData.inner as THREE.Group;
      let x = m.x, y = m.y, z = 0, rx = 0, rz = 0;
      if (m.act === "walk") { z = Math.abs(Math.sin(m.step)) * 0.06; rz = Math.sin(m.step) * 0.14; }
      if (m.act === "desk") { x = RX + 1.33; y = RY + 1.0; z = 0.3; }
      if (m.act === "toilet") { x = RX + 0.37; y = RY + this.H.d - 0.58; z = 0.3; }
      if (m.act === "couch") z = 0.25;
      if (m.act === "bed") { x = RX + this.H.w - 0.83; y = RY + 1.25; z = 0.48; rx = -Math.PI / 2; }
      if (m.act === "ride") { const v = this.look.vehicle; z = v === "bike" ? 0.55 : v === "scooter" ? 0.4 : 0.32; }
      if (m.act === "swim") z = -0.45;
      if (m.act === "dance") { z = Math.abs(Math.sin(this.t * 9)) * 0.35; }
      if (m.act === "idle" || m.act === "pet") { inner.scale.y = (1.35 / 3.3) * (1 + Math.sin(this.t * 2.2) * 0.015); }
      z += Math.sin((1 - m.hop / 0.35) * Math.PI) * (m.hop > 0 ? 0.35 : 0);
      const p = W(x, y); tr.position.set(p.x, z, p.z);
      const target = m.act === "dance" ? this.t * 5 : m.act === "bed" ? 0 : rot;
      let d = target - m.rot; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      m.rot += d * Math.min(1, dt * 10); tr.rotation.set(rx, m.rot, rz);
      tr.visible = !(m.act === "ride" && (this.look.vehicle === "hatch" || this.look.vehicle === "sports" || this.look.vehicle === "super") && false);
    }
    // dog
    if (this.dogMesh) { const dg = this.dog, p = W(dg.x, dg.y); this.dogMesh.position.set(p.x, Math.abs(Math.sin(this.t * 10)) * 0.03, p.z); this.dogMesh.rotation.y = Math.atan2(-(dg.ty - dg.y), dg.tx - dg.x); (this.dogMesh.userData.tail as THREE.Mesh).rotation.y = Math.sin(this.t * 14) * 0.6; }
    // bubble, Zzz, confetti
    if (this.bubble) { if (this.t > this.bubbleUntil) { this.dyn.remove(this.bubble); this.bubble = null; } else { const tp = tr ? tr.position : new THREE.Vector3(); this.bubble.position.set(tp.x, tp.y + (m.act === "bed" ? 1.2 : 2.0), tp.z); } }
    if (m.act === "bed" && Math.random() < dt * 0.6) { const s = this.label("z", "#ffffff", "rgba(0,0,0,0)", 40); s.scale.multiplyScalar(0.8); this.dyn.add(s); this.zs.push({ s, t: 0 }); }
    this.zs = this.zs.filter((z) => { z.t += dt; const p = W(RX + this.H.w - 0.8 + z.t * 0.3, RY + 1.0); z.s.position.set(p.x, 0.9 + z.t * 0.5, p.z); (z.s.material as THREE.SpriteMaterial).opacity = 1 - z.t / 2.6; if (z.t > 2.6) { this.dyn.remove(z.s); return false; } return true; });
    this.confetti = this.confetti.filter((c) => { c.t -= dt; c.v.y -= 6 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += dt * 8; c.m.rotation.z += dt * 6; if (c.t <= 0 || c.m.position.y < 0) { this.dyn.remove(c.m); c.m.geometry.dispose(); return false; } return true; });
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.bloom.setSize(w, h);
    // frame the island: about 10.5 units either side across, never cropping it top to bottom
    const aspect = w / h, view = Math.max(10.6 / aspect, 6.4);
    Object.assign(this.camera, { left: -view * aspect, right: view * aspect, top: view, bottom: -view });
    this.camera.updateProjectionMatrix();
  }
  render() { this.controls.update(); this.composer.render(); }
  dispose() { this.controls.dispose(); this.clear(this.statics); this.renderer.dispose(); }
}
