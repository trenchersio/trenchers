/**
 * Trenchies world in 3D. A big black-glass plot (26 x 26) ringed by a road, with the main house in the middle, a
 * building for every room you add (bathroom, shed, bedroom, office, garage, gym, servers, greenhouse, observatory,
 * helipad), a front garden for the outdoor items, and one tree and one rock you can gather from.
 *
 * Your Trenchie walks on a navigation grid (smooth curved routes, eased speed), uses what you own (desk, bed, couch,
 * gym, pool…), rides its vehicle around the ring road, and chops or mines when you gather. The nameplate, speech
 * bubble and the tree/rock tags are HTML pinned to 3D points every frame.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";
import { drawArt } from "@/lib/art-vector";
import { GATHER, item as catItem, type Resource } from "@/lib/trenchies-catalog";
import { makeWilds, poolMaterial, poolTexture, type Wilds } from "./wilds";
import { makeTrenchie } from "./trenchie3d";
import { makeVehicle, rollWheels } from "./vehicles";
import { Nav, along, lengths, smooth, type Pt, type R } from "./nav";
import type { Grow, Look, Pins } from "./types";

export const LAND = 26;
const NEON = 0x39ff88, CYAN = 0x6ee7ff, GOLD = 0xffcf3a, HT = 0.95; // Trenchie height
const ROAD = 0.95; // road centre line, in from the edge
const DOOR_X = 13.5;

type House = { w: number; d: number; h: number; windows: number; wall: number; floor: number; trim: number; glass?: boolean };
const HOUSES: Record<string, House> = {
  shack: { w: 4.6, d: 4.3, h: 2.0, windows: 1, wall: 0x3b4049, floor: 0x15181a, trim: NEON },
  cabin: { w: 5.4, d: 4.7, h: 2.1, windows: 1, wall: 0x4a3d33, floor: 0x16191a, trim: NEON },
  house: { w: 6.4, d: 5.2, h: 2.2, windows: 2, wall: 0x2c3547, floor: 0x121517, trim: NEON },
  loft: { w: 7.2, d: 5.6, h: 2.6, windows: 0, wall: 0xe2e4e3, floor: 0x1b1f1e, trim: NEON, glass: true },
  villa: { w: 8.0, d: 6.0, h: 2.4, windows: 3, wall: 0xe8eae9, floor: 0x161918, trim: NEON, glass: true },
  mansion: { w: 9.0, d: 6.4, h: 2.8, windows: 4, wall: 0x0f1211, floor: 0x0a0c0b, trim: GOLD, glass: true },
};
const HOUSE_Y = 2.5;
const ROOMS: Record<string, R & { h: number }> = {
  shed: { x: 2.3, y: 2.7, w: 2.6, d: 2.6, h: 1.9 },
  bathroom: { x: 5.5, y: 2.7, w: 3.0, d: 3.0, h: 2.0 },
  gym: { x: 2.3, y: 6.6, w: 3.2, d: 2.8, h: 2.0 },
  servers: { x: 6.0, y: 6.8, w: 2.6, d: 2.4, h: 2.0 },
  bedroom: { x: 19.3, y: 2.7, w: 3.9, d: 3.2, h: 2.1 },
  office: { x: 19.3, y: 7.1, w: 3.9, d: 3.0, h: 2.1 },
  garage: { x: 19.6, y: 11.4, w: 4.2, d: 3.3, h: 2.2 },
  greenhouse: { x: 2.3, y: 11.0, w: 4.0, d: 3.0, h: 2.1 },
  observatory: { x: 2.4, y: 16.5, w: 3.4, d: 3.4, h: 0 },
  helipad: { x: 19.2, y: 18.4, w: 4.4, d: 4.4, h: 0 },
};
const TREE = { x: 4.4, y: 22.0 }, ROCK = { x: 8.6, y: 22.5 };
const POOL: R = { x: 14.9, y: 10.6, w: 3.6, d: 2.2 };

type Kind = "stand" | "sit" | "lie" | "work" | "lift" | "swim" | "look" | "dance" | "chop" | "mine";
type Spot = { act: string; at: Pt; pose: { x: number; y: number; z: number; yaw: number; kind: Kind }; min: number; max: number; w: number; night?: number };
const LINES: Record<string, string[]> = {
  desk: ["checking the charts", "my picks look good", "volume first, then I buy", "is this the dip?", "one more chart", "gm to the trench"],
  office: ["four screens, four charts", "reading the order book", "deep work mode"],
  bed: ["zzz", "dreaming of green candles", "zzz… top 3…"], toilet: ["best ideas come here", "reading the whitepaper", "…"],
  shower: ["fresh for the next candle", "la la la"], couch: ["charts on the big screen", "five more minutes"], swim: ["pool day", "ahh"],
  gym: ["one more rep", "strong hands", "leg day"], shed: ["fixing the bike", "building something"], servers: ["the nodes are humming", "all green"],
  greenhouse: ["grow, little plant", "watering the gains"], observatory: ["looking for the moon", "is that a comet?"], helipad: ["waiting for my ride", "nice view up here"],
  ride: ["touching grass", "brb", "taking it for a spin"], idle: ["gm", "nice night in the trench", "need a bigger house", "what are you picking?", "wagmi", "my land is growing"],
  pet: ["good boy", "who's a good dog"], dance: ["LET'S GO!", "top 3!", "XP!"], chop: ["timber!", "good wood"], mine: ["solid rock", "stone for the build"],
  bench: ["thinking about entries", "nice breeze"], hammock: ["nap time", "do not disturb"], firepit: ["warm glow", "campfire charts"], hoop: ["nothing but net", "swish"],
  hottub: ["bubbles and charts"], arcade: ["high score", "one more game"], piano: ["playing in green major"], aquarium: ["fish don't panic sell"], coffee: ["fuel"], fridge: ["snack break"], vinyl: ["lo-fi to trade to"], fountain: ["make a wish: 100x"], statue: ["looking good in stone"],
};

// tile (x, y) on the plot → world (x, z)
const W = (x: number, y: number) => new THREE.Vector3(x - LAND / 2, 0, y - LAND / 2);
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const angLerp = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
type Wall = "back" | "left" | "front" | "right";

/** Smooth path following with eased speed. */
class Walker {
  x: number; y: number; yaw = 0; v = 0; s = 0; path: Pt[] | null = null; L: number[] = []; vmax: number; back = false;
  constructor(x: number, y: number, vmax: number) { this.x = x; this.y = y; this.vmax = vmax; }
  go(p: Pt[], vmax = this.vmax, back = false) { this.path = p; this.L = lengths(p); this.s = 0; this.vmax = vmax; this.back = back; }
  get rem() { return this.path ? this.L[this.L.length - 1] - this.s : 0; }
  /** Moves along the path; returns the distance covered. */
  step(dt: number, acc = 2.4, dec = 2.2) {
    if (!this.path) { this.v = Math.max(0, this.v - acc * dt); return 0; }
    const want = Math.min(this.vmax, Math.sqrt(2 * dec * Math.max(0, this.rem)) + 0.04);
    this.v += Math.max(-dec * 2 * dt, Math.min(acc * dt, want - this.v));
    const ds = Math.min(this.rem, this.v * dt); this.s += ds;
    const a = along(this.path, this.L, this.s), ahead = along(this.path, this.L, this.s + 0.25);
    this.x = a.x; this.y = a.y;
    if (Math.hypot(ahead.x - a.x, ahead.y - a.y) > 0.02) { const target = Math.atan2(ahead.x - a.x, ahead.y - a.y) + (this.back ? Math.PI : 0); this.yaw = angLerp(this.yaw, target, Math.min(1, dt * 7)); }
    if (this.rem <= 0.002) { this.path = null; this.v = 0; }
    return ds;
  }
}

export class World3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -200, 400);
  private controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private key = new THREE.DirectionalLight(0xffffff, 1.1);
  private hemi = new THREE.HemisphereLight(0x9fb6d8, 0x0d1611, 0.45);
  private statics = new THREE.Group();
  private dyn = new THREE.Group();
  private nav = new Nav(LAND);
  private mats = new Map<string, THREE.Material>();
  private screens: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; off: number; kind: number }[] = [];
  private nightMats: THREE.MeshBasicMaterial[] = [];
  private lamps: THREE.PointLight[] = [];
  private blinkers: { m: THREE.MeshBasicMaterial; c: THREE.Color; off: number; rate: number }[] = [];
  private spinners: { o: THREE.Object3D; axis: "x" | "y" | "z"; rate: number }[] = [];
  private fish: { m: THREE.Object3D; base: THREE.Vector3; off: number }[] = [];
  private water: THREE.MeshBasicMaterial[] = [];
  private cuts: { r: R; parts: THREE.Object3D[]; mats: THREE.Material[]; o: number }[] = [];
  private pools: THREE.MeshBasicMaterial[] = [];
  private wilds: Wilds;
  private poolTex = poolTexture();
  private spots: Spot[] = [];
  private trenchie: THREE.Group | null = null;
  private tool: THREE.Group | null = null;
  private vehicle: THREE.Group | null = null;
  private park = { x: 16.2, y: 23.5, yaw: Math.PI / 2, garage: false };
  private pets: { kind: string; g: THREE.Group; w: Walker; wait: number; legs?: THREE.Object3D[] }[] = [];
  private drone: THREE.Group | null = null;
  private treeG = new THREE.Group(); private rockG = new THREE.Group(); private treeRing: THREE.MeshBasicMaterial | null = null; private rockRing: THREE.MeshBasicMaterial | null = null;
  private zs: { s: THREE.Sprite; t: number }[] = [];
  private confetti: { m: THREE.Mesh; v: THREE.Vector3; t: number }[] = [];
  private chips: { m: THREE.Mesh; v: THREE.Vector3; t: number }[] = [];
  private look: Look; private nft: number; private t = 0; private lastScreen = 0;
  private grow: Grow = { wood: 0, stone: 0 };
  private felling: Partial<Record<Resource, number>> = {}; // t when the fall started
  private busy: Partial<Record<Resource, boolean>> = {};
  private pins: Pins = {};
  private me: Walker;
  private mode: "idle" | "walk" | "enter" | "do" | "exit" | "ride" | "party" = "idle";
  private spot: Spot | null = null; private until = 2; private blend = 0; private hop = 0; private step = 0;
  private onArrive: (() => void) | null = null;
  private car: Walker | null = null; private ridePhase = 0; private rideBack: Pt[] | null = null; private carYaw = 0;
  private pose = { x: 0, y: 0, z: 0, yaw: 0, rx: 0, rz: 0, sy: 1 };
  private bubbleUntil = 0; private popUntil = 0;
  private raycaster = new THREE.Raycaster();
  private v3 = new THREE.Vector3();
  private intro = 0;
  private W = 1; private H = 1;
  hourOverride: number | null = null;
  onGathered: ((res: Resource) => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, look: Look, nft: number) {
    this.look = look; this.nft = nft;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }));
    r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene.background = new THREE.Color(0x07100c);
    this.scene.fog = new THREE.Fog(0x07100c, 40, 105);
    this.wilds = makeWilds(LAND / 2); this.scene.add(this.wilds.group);
    this.camera.position.set(26, 24, 26); this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enablePan: false, enableDamping: true, dampingFactor: 0.08, minZoom: 0.42, maxZoom: 2.6, minPolarAngle: 0.5, maxPolarAngle: 1.15, rotateSpeed: 0.5, zoomSpeed: 0.8, autoRotate: true, autoRotateSpeed: 0.18 });
    this.key.position.set(10, 26, 6); this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048);
    Object.assign(this.key.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 80 }); this.key.shadow.bias = -0.0006;
    this.scene.add(this.key, this.key.target, this.hemi, new THREE.AmbientLight(0xffffff, 0.12));
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.4, 0.86);
    this.composer.addPass(this.bloom);
    this.scene.add(this.statics, this.dyn);
    const d = this.door(); this.me = new Walker(d.x, d.y + 1.4, 1.25); this.me.yaw = 0;
    this.build();
    this.camera.zoom = 0.5; this.camera.updateProjectionMatrix();
    this.focus(true);
  }

  // ------------------------------------------------------------------ helpers
  private get HS() { return HOUSES[this.look.house] ?? HOUSES.shack; }
  private get HR(): R { const h = this.HS; return { x: DOOR_X - h.w / 2, y: HOUSE_Y, w: h.w, d: h.d }; }
  private has(id: string) { return this.look.items.includes(id); }
  hour() { if (this.hourOverride !== null) return this.hourOverride; const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  private night() { const h = this.hour(); return h >= 22.5 || h < 6.5; }
  private std(color: number, rough = 0.5, metal = 0.1) { const k = `s${color}:${rough}:${metal}`; let m = this.mats.get(k); if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); this.mats.set(k, m); } return m as THREE.MeshStandardMaterial; }
  private glow(color: number, strength = 1, own = false) {
    const k = `g${color}:${strength}`; let m = own ? undefined : this.mats.get(k);
    if (!m) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength) }); (m as unknown as { toneMapped: boolean }).toneMapped = false; if (!own) this.mats.set(k, m); }
    return m as THREE.MeshBasicMaterial;
  }
  private get M() {
    return {
      white: this.std(0xdfe2e0, 0.55, 0.05), soft: this.std(0xc4c8c6, 0.6), black: this.std(0x0b0d0c, 0.3, 0.55), ink: this.std(0x060708, 0.45, 0.3),
      metal: this.std(0xa4aaa7, 0.28, 0.9), gold: this.std(GOLD, 0.25, 0.9), dark: this.std(0x1a1e1c, 0.6, 0.2), leaf: this.std(0x0d1210, 0.55, 0.3),
      glass: this.mats.get("glass") ?? (() => { const m = new THREE.MeshPhysicalMaterial({ color: 0xbfd6e0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.18, depthWrite: false }); this.mats.set("glass", m); return m; })(),
    };
  }
  /** A box with its min corner at tile (x, y), height z, size w (x), d (y), h (up). */
  private box(g: THREE.Object3D, x: number, y: number, z: number, w: number, d: number, h: number, mat: THREE.Material, shadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    const p = W(x + w / 2, y + d / 2); m.position.set(p.x, z + h / 2, p.z); m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
  }
  private cyl(g: THREE.Object3D, x: number, y: number, z: number, r: number, h: number, mat: THREE.Material, seg = 24, r2 = r) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, h, seg), mat); const p = W(x, y); m.position.set(p.x, z + h / 2, p.z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }
  private canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")!);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  }
  private screen(kind = 0) {
    const c = document.createElement("canvas"); c.width = 256; c.height = 150;
    const ctx = c.getContext("2d")!, tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    this.screens.push({ ctx, tex, off: Math.random() * 10, kind });
    const m = new THREE.MeshBasicMaterial({ map: tex }); (m as unknown as { toneMapped: boolean }).toneMapped = false; return m;
  }
  private drawScreens() {
    for (const s of this.screens) {
      const { ctx } = s, W2 = ctx.canvas.width, H2 = ctx.canvas.height;
      ctx.fillStyle = "#03100a"; ctx.fillRect(0, 0, W2, H2);
      ctx.strokeStyle = "rgba(57,255,136,0.10)"; ctx.lineWidth = 1; for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, (H2 * i) / 5); ctx.lineTo(W2, (H2 * i) / 5); ctx.stroke(); }
      if (s.kind === 1) { // candles
        for (let i = 0; i < 18; i++) { const v = Math.sin(i * 1.7 + s.off + this.t * 0.4), up = v > -0.2, x = 8 + i * 13.5, y = H2 * 0.5 - Math.sin(i * 0.35 + this.t * 0.3 + s.off) * 30; ctx.fillStyle = up ? "#39ff88" : "#ff5470"; ctx.fillRect(x, y - 14 * Math.abs(v), 7, 10 + 20 * Math.abs(v)); ctx.fillRect(x + 3, y - 24, 1, 46); }
      } else {
        ctx.beginPath(); for (let i = 0; i <= 48; i++) { const f = i / 48, v = 0.22 + 0.55 * ((Math.sin(f * 9 + this.t * 0.9 + s.off) + 1) / 2) * (0.45 + f * 0.55); const px = f * W2, py = H2 - v * H2; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
        ctx.strokeStyle = "#39ff88"; ctx.lineWidth = 3; ctx.stroke();
        ctx.lineTo(W2, H2); ctx.lineTo(0, H2); ctx.closePath(); ctx.fillStyle = "rgba(57,255,136,0.10)"; ctx.fill();
      }
      ctx.fillStyle = "rgba(57,255,136,0.85)"; ctx.font = "600 13px 'JetBrains Mono', monospace"; ctx.fillText(`+${(12 + Math.sin(this.t * 0.2 + s.off) * 8).toFixed(1)}%`, 10, 20);
      s.tex.needsUpdate = true;
    }
  }
  /** A group laid against one wall of rect r: local x runs along the wall, local z out into the room. */
  private wallFrame(r: R, wall: Wall) {
    const g = new THREE.Group();
    const o = wall === "back" ? W(r.x, r.y) : wall === "left" ? W(r.x, r.y + r.d) : wall === "front" ? W(r.x + r.w, r.y + r.d) : W(r.x + r.w, r.y);
    g.position.copy(o); g.rotation.y = { back: 0, left: Math.PI / 2, front: Math.PI, right: -Math.PI / 2 }[wall];
    const T = (lx: number, lz: number): Pt => wall === "back" ? { x: r.x + lx, y: r.y + lz } : wall === "left" ? { x: r.x + lz, y: r.y + r.d - lx } : wall === "front" ? { x: r.x + r.w - lx, y: r.y + r.d - lz } : { x: r.x + r.w - lz, y: r.y + lx };
    const yawIn = { back: Math.PI, left: -Math.PI / 2, front: 0, right: Math.PI / 2 }[wall]; // facing the wall
    const lb = (x: number, z: number, y: number, w: number, d: number, h: number, m: THREE.Material, shadow = true) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x + w / 2, y + h / 2, z + d / 2); b.castShadow = shadow; b.receiveShadow = true; g.add(b); return b; };
    this.statics.add(g);
    return { g, T, yawIn, lb, len: wall === "back" || wall === "front" ? r.w : r.d };
  }
  private addSpot(act: string, at: Pt, pose: Spot["pose"], min: number, max: number, w = 1, night = 0) { this.spots.push({ act, at, pose, min, max, w, night }); }

  // ------------------------------------------------------------------ static world
  private sky() {
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 45 + Math.random() * 60; pos[3 * i] = Math.cos(a) * r; pos[3 * i + 1] = -12 + Math.random() * 60; pos[3 * i + 2] = Math.sin(a) * r; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, transparent: true, opacity: 0.5 })));
  }
  setLook(l: Look, nft: number) {
    const skin = nft !== this.nft || l.palette.main !== this.look.palette.main || l.palette.bg !== this.look.palette.bg;
    const rebuild = skin || l.house !== this.look.house || l.vehicle !== this.look.vehicle || l.items.join() !== this.look.items.join() || l.name !== this.look.name || l.level !== this.look.level;
    this.look = l; this.nft = nft;
    if (skin && this.trenchie) { this.dyn.remove(this.trenchie); this.trenchie = null; }
    if (rebuild) { this.build(); if (this.mode !== "ride" && this.mode !== "party") this.choose(); }
  }
  setGrow(g: Grow) { this.grow = g; }
  attach(p: Pins) { this.pins = p; }
  private clear(g: THREE.Group) {
    g.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mm = m.material as THREE.Material | THREE.Material[] | undefined; const own = (x: THREE.Material) => ![...this.mats.values()].includes(x); if (Array.isArray(mm)) mm.forEach((x) => own(x) && x.dispose()); else if (mm && own(mm)) { (mm as THREE.MeshBasicMaterial).map?.dispose(); mm.dispose(); } });
    g.clear();
  }
  private build() {
    this.clear(this.statics); this.screens = []; this.nightMats = []; this.lamps = []; this.blinkers = []; this.spinners = []; this.fish = []; this.water = []; this.spots = []; this.cuts = []; this.pools = [];
    this.nav.reset();
    const S = this.statics, M = this.M;
    // the plot: black glass slab, faint grid, neon rim, road ring with a dashed centre line
    const slab = this.box(S, 0, 0, -0.1, LAND, LAND, 0.1, this.std(0x122019, 0.95, 0), false); slab.castShadow = false;
    const grid = new THREE.GridHelper(LAND, LAND, 0x24402f, 0x1b3124); grid.position.y = 0.004; const gm = grid.material as THREE.Material; gm.transparent = true; gm.opacity = 0.35; S.add(grid);
    const rim = this.glow(NEON, 1.4);
    for (const [x, y, w, d] of [[0, 0, LAND, 0.05], [0, LAND - 0.05, LAND, 0.05], [0, 0, 0.05, LAND], [LAND - 0.05, 0, 0.05, LAND]]) this.box(S, x, y, 0, w, d, 0.03, rim, false);
    const asphalt = this.std(0x15181c, 0.9, 0.1), RW = 1.25, a0 = ROAD - RW / 2;
    for (const [x, y, w, d] of [[a0, a0, LAND - 2 * a0, RW], [a0, LAND - a0 - RW, LAND - 2 * a0, RW], [a0, a0 + RW, RW, LAND - 2 * a0 - 2 * RW], [LAND - a0 - RW, a0 + RW, RW, LAND - 2 * a0 - 2 * RW]]) this.box(S, x, y, 0, w, d, 0.02, asphalt, false).castShadow = false;
    const dash = this.glow(0xffffff, 0.55);
    for (let k = 2; k < LAND - 2; k += 1.2) { this.box(S, k, ROAD - 0.03, 0.021, 0.55, 0.06, 0.005, dash, false); this.box(S, k, LAND - ROAD - 0.03, 0.021, 0.55, 0.06, 0.005, dash, false); this.box(S, ROAD - 0.03, k, 0.021, 0.06, 0.55, 0.005, dash, false); this.box(S, LAND - ROAD - 0.03, k, 0.021, 0.06, 0.55, 0.005, dash, false); }
    const edge = this.glow(NEON, 0.9), ie = a0 + RW;
    for (const [x, y, w, d] of [[ie, ie, LAND - 2 * ie, 0.03], [ie, LAND - ie - 0.03, LAND - 2 * ie, 0.03], [ie, ie, 0.03, LAND - 2 * ie], [LAND - ie - 0.03, ie, 0.03, LAND - 2 * ie]]) this.box(S, x, y, 0.022, w, d, 0.006, edge, false);
    // street lamps round the drive and along the path, each with a warm pool of light
    const lamp = (x: number, y: number) => { this.cyl(S, x, y, 0, 0.045, 1.9, this.std(0x2c3036, 0.5, 0.6), 8); const hm = this.glow(0xffd9a0, 1.6); this.box(S, x - 0.13, y - 0.06, 1.88, 0.26, 0.12, 0.06, hm, false); const pm = poolMaterial(this.poolTex, 0.5); this.pools.push(pm); const pl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), pm); pl.rotation.x = -Math.PI / 2; const p = W(x, y); pl.position.set(p.x, 0.03, p.z); S.add(pl); this.nav.blockCircle({ x, y }, 0.06); };
    for (let k = 3; k < LAND - 2; k += 5.5) { lamp(k, 1.85); lamp(1.85, k + 1.2); lamp(LAND - 1.85, k + 1.2); if (Math.abs(k - DOOR_X) > 2.4) lamp(k, LAND - 1.85); }
    for (let y = HOUSE_Y + this.HS.d + 2.6; y < LAND - 3; y += 4.4) lamp(DOOR_X + 0.85, y);
    this.park = this.has("garage") ? { x: 21.0, y: ROOMS.garage.y + ROOMS.garage.d / 2, yaw: Math.PI / 2, garage: true } : { x: 16.2, y: 23.5, yaw: Math.PI / 2, garage: false };
    this.house();
    for (const id of Object.keys(ROOMS)) if (this.has(id)) this.room(id);
    this.outdoor();
    this.gatherables();
    this.lots();
    // vehicle, pets, Trenchie
    if (this.vehicle) { this.dyn.remove(this.vehicle); this.clear(this.vehicle); }
    this.vehicle = makeVehicle(this.look.vehicle); this.vehicle.traverse((o) => { o.castShadow = true; }); this.dyn.add(this.vehicle);
    if (this.mode !== "ride") this.placeCar(this.park.x, this.park.y, this.park.yaw);
    this.nav.block({ x: this.park.x - 1.25, y: this.park.y - 0.55, w: 2.5, d: 1.1 }, 0.1);
    for (const p of this.pets) { this.dyn.remove(p.g); this.clear(p.g); } this.pets = [];
    for (const k of ["dog", "robodog", "cat"]) if (this.has(k)) { const g = this.makePet(k); this.dyn.add(g); const st = k === "cat" ? { x: this.HR.x + 1.5, y: this.HR.y + this.HR.d - 1 } : { x: DOOR_X + 1.5 + Math.random(), y: this.HR.y + this.HR.d + 2 }; this.pets.push({ kind: k, g, w: new Walker(st.x, st.y, k === "cat" ? 0.7 : 1.6), wait: 1 + Math.random() * 3 }); }
    if (this.drone) { this.dyn.remove(this.drone); this.clear(this.drone); this.drone = null; }
    if (this.has("drone")) { this.drone = this.makeDrone(); this.dyn.add(this.drone); }
    if (!this.trenchie) { this.trenchie = makeTrenchie(this.nft, this.look.palette, HT); this.dyn.add(this.trenchie); this.tool = null; }
  }

  // ------------------------------------------------------------------ buildings
  private shell(r: R, h: number, o: { wall: number; floor: number; trim: number; windows?: number; glass?: boolean; walls?: boolean; openRight?: boolean; door?: number }) {
    const S = this.statics, M = this.M;
    this.box(S, r.x, r.y, 0, r.w, r.d, 0.1, this.std(o.floor, 0.22, 0.45));
    const wall = this.std(o.wall, 0.7, o.wall < 0x404040 ? 0.25 : 0.05), trim = this.glow(o.trim, 1.4);
    if (o.walls === false) return;
    // back and left walls stay; the front, right and roof cut away when you look inside
    if (o.glass) {
      this.box(S, r.x - 0.12, r.y - 0.12, 0, r.w + 0.12, 0.12, 0.35, wall); this.box(S, r.x - 0.12, r.y - 0.12, h - 0.22, r.w + 0.12, 0.12, 0.22, wall);
      this.box(S, r.x - 0.1, r.y - 0.1, 0.35, r.w + 0.1, 0.04, h - 0.57, M.glass, false);
      const n = Math.max(2, Math.round(r.w / 1.4)); for (let i = 0; i <= n; i++) this.box(S, r.x - 0.12 + (r.w + 0.08) * (i / n), r.y - 0.12, 0, 0.06, 0.12, h, M.ink);
      const glowM = this.glow(0xffd59a, 0.35, true); glowM.userData.k = 0.28; this.nightMats.push(glowM); this.box(S, r.x - 0.04, r.y - 0.05, 0.35, r.w, 0.01, h - 0.57, glowM, false);
    } else this.box(S, r.x - 0.12, r.y - 0.12, 0, r.w + 0.12, 0.12, h, wall);
    this.box(S, r.x - 0.12, r.y, 0, 0.12, r.d, h, wall);
    this.box(S, r.x - 0.12, r.y - 0.14, h, r.w + 0.12, 0.04, 0.035, trim, false); this.box(S, r.x - 0.14, r.y, h, 0.04, r.d, 0.035, trim, false);
    this.nav.block({ x: r.x - 0.12, y: r.y - 0.12, w: r.w + 0.12, d: 0.12 }); this.nav.block({ x: r.x - 0.12, y: r.y, w: 0.12, d: r.d });
    for (let i = 0; i < (o.windows ?? 0); i++) {
      const ww = 0.95, wx = r.x + (r.w / ((o.windows ?? 1) + 1)) * (i + 1) - ww / 2;
      const m = this.glow(0xffd59a, 0.6, true); this.nightMats.push(m);
      this.box(S, wx, r.y + 0.001, 0.85, ww, 0.02, 0.85, m, false); this.box(S, wx - 0.04, r.y, 0.8, ww + 0.08, 0.025, 0.05, M.ink, false); this.box(S, wx + ww / 2 - 0.015, r.y + 0.004, 0.85, 0.03, 0.02, 0.85, M.ink, false);
    }
    const cut = new THREE.Group(); S.add(cut);
    const mats: THREE.Material[] = [];
    const own = <T extends THREE.Material>(m: T, base = 1) => { const c = m.clone() as T; c.transparent = true; c.userData.base = base; c.opacity = base; mats.push(c); return c; };
    const wm = o.glass ? own(M.glass, 0.22) : own(wall), rm = own(this.std(0x1b1f25, 0.85, 0.1)), lip = own(this.std(0x2a2f36, 0.7, 0.2)), tm = own(trim), inkM = own(M.ink);
    const dx = o.door ?? r.x + r.w / 2, fy = r.y + r.d, DW = 1.05, DH = Math.min(1.75, h - 0.25);
    const seg = (x0: number, x1: number) => { if (x1 - x0 > 0.01) { this.box(cut, x0, fy, 0, x1 - x0, 0.12, h, wm); this.nav.block({ x: x0, y: fy, w: x1 - x0, d: 0.12 }); } };
    seg(r.x - 0.12, dx - DW / 2); seg(dx + DW / 2, r.x + r.w + 0.12);
    this.box(cut, dx - DW / 2, fy, DH, DW, 0.12, h - DH, wm);
    this.box(cut, dx - DW / 2 - 0.04, fy + 0.12, DH, DW + 0.08, 0.02, 0.03, tm, false);
    if (!o.openRight) { this.box(cut, r.x + r.w, r.y - 0.12, 0, 0.12, r.d + 0.24, h, wm); this.nav.block({ x: r.x + r.w, y: r.y - 0.12, w: 0.12, d: r.d + 0.24 }); }
    else this.box(cut, r.x + r.w, r.y - 0.12, DH + 0.2, 0.12, r.d + 0.24, h - DH - 0.2, wm);
    // warm windows on the outside walls
    if (!o.glass) {
      const win = (x: number, y: number, along: "x" | "y") => { const m = own(this.glow(0xffd59a, 0.6, true)) as THREE.MeshBasicMaterial; this.nightMats.push(m); if (along === "x") { this.box(cut, x, y, 0.85, 0.8, 0.02, 0.75, m, false); this.box(cut, x - 0.04, y, 0.8, 0.88, 0.04, 0.05, inkM, false); } else { this.box(cut, x, y, 0.85, 0.02, 0.8, 0.75, m, false); this.box(cut, x, y - 0.04, 0.8, 0.04, 0.88, 0.05, inkM, false); } };
      for (let x = r.x + 0.5; x + 0.8 < r.x + r.w - 0.3; x += 1.6) if (x + 0.8 < dx - DW / 2 - 0.15 || x > dx + DW / 2 + 0.15) win(x, fy + 0.125, "x");
      if (!o.openRight) for (let y = r.y + 0.5; y + 0.8 < r.y + r.d - 0.3; y += 1.6) win(r.x + r.w + 0.125, y, "y");
    }
    // flat roof with a lip, trim and rooftop units
    this.box(cut, r.x - 0.2, r.y - 0.2, h, r.w + 0.44, r.d + 0.44, 0.12, rm);
    this.box(cut, r.x - 0.2, r.y + r.d + 0.16, h + 0.12, r.w + 0.44, 0.08, 0.1, lip); this.box(cut, r.x + r.w + 0.16, r.y - 0.2, h + 0.12, 0.08, r.d + 0.44, 0.1, lip);
    this.box(cut, r.x - 0.2, r.y + r.d + 0.24, h + 0.04, r.w + 0.44, 0.02, 0.03, tm, false); this.box(cut, r.x + r.w + 0.24, r.y - 0.2, h + 0.04, 0.02, r.d + 0.44, 0.03, tm, false);
    const units = Math.max(1, Math.round(r.w / 3.5)); for (let i = 0; i < units; i++) this.box(cut, r.x + 0.5 + (units > 1 ? i * ((r.w - 1.6) / (units - 1)) : 0), r.y + 0.5, h + 0.12, 0.8, 0.6, 0.4, lip);
    this.cuts.push({ r, parts: [cut], mats, o: 1 });
  }

  private house() {
    const S = this.statics, M = this.M, H = this.HS, r = this.HR;
    this.shell(r, H.h, { wall: H.wall, floor: H.floor, trim: H.trim, windows: H.windows, glass: H.glass });
    // step at the door + the path to the road
    const dy = r.y + r.d;
    this.box(S, DOOR_X - 0.7, dy, 0, 1.4, 0.45, 0.06, M.white);
    for (let y = dy + 0.55; y < LAND - ROAD - 0.7; y += 0.92) { this.box(S, DOOR_X - 0.48, y, 0, 0.96, 0.8, 0.025, M.soft, false); }
    const reserve: R[] = [];
    const bath = this.has("bathroom"), gold = this.has("goldtoilet");
    // desk on the left wall
    const desk = this.wallFrame({ x: r.x, y: r.y + 0.3, w: 0.8, d: 1.4 }, "left");
    this.deskSet(desk, 1.4, this.has("monitors"), this.has("chair"), 0);
    reserve.push({ x: r.x, y: r.y + 0.2, w: 1.8, d: 1.6 });
    // bed in the back right corner
    const bx = r.x + r.w - 1.45, by = r.y + 0.12;
    this.bed(bx, by, 1.3, 1.95, false);
    reserve.push({ x: bx - 0.45, y: r.y, w: 1.95, d: 2.2 });
    // toilet (moves to the bathroom when there is one)
    if (!bath) { const tx = r.x + 0.12, ty = r.y + r.d - 0.82; this.toilet(tx, ty, gold); this.addSpot("toilet", { x: tx + 0.95, y: ty + 0.28 }, { x: tx + 0.33, y: ty + 0.28, z: 0.17, yaw: Math.PI / 2, kind: "sit" }, 5, 9, 0.7); reserve.push({ x: r.x, y: ty - 0.2, w: 1.2, d: 1.1 }); }
    reserve.push({ x: DOOR_X - 0.7, y: r.y + r.d - 1.3, w: 1.4, d: 1.3 });
    if (this.has("trophies")) { const n = Math.max(1, Math.min(5, this.look.trophies ?? 1)); this.box(S, bx + 0.05, r.y + 0.0, 1.45, 1.2, 0.22, 0.04, M.ink); for (let i = 0; i < n; i++) { this.cyl(S, bx + 0.2 + i * 0.22, r.y + 0.11, 1.49, 0.05, 0.05, M.gold, 12); this.cyl(S, bx + 0.2 + i * 0.22, r.y + 0.11, 1.54, 0.07, 0.12, M.gold, 12, 0.03); } }
    if (this.has("neon")) { const t = this.canvasTex(256, 128, (g) => { g.font = "700 84px 'Space Grotesk', sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.shadowColor = "#39ff88"; g.shadowBlur = 16; g.fillStyle = "#c8ffe0"; g.fillText("GM", 128, 68); }); const m = new THREE.MeshBasicMaterial({ map: t, transparent: true }); (m as unknown as { toneMapped: boolean }).toneMapped = false; const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), m); const p = W(r.x + 2.1, r.y + 0.02); pl.position.set(p.x, 1.65, p.z); S.add(pl); }
    if (this.has("art")) this.artFrame(this.wallFrame({ x: r.x, y: r.y + 2.0, w: 0.1, d: 0.8 }, "left"), 0.8, 1.25);
    if (this.has("rug")) { const rw = Math.min(2.6, r.w - 3.2), rd = Math.min(1.8, r.d - 2.4); if (rw > 0.8) { const rx = r.x + (r.w - rw) / 2 - 0.2, ry = r.y + 2.0; this.box(S, rx, ry, 0.1, rw, rd, 0.01, M.dark, false); for (const [a, b, c, d] of [[0, 0, rw, 0.025], [0, rd - 0.025, rw, 0.025], [0, 0, 0.025, rd], [rw - 0.025, 0, 0.025, rd]]) this.box(S, rx + a, ry + b, 0.111, c, d, 0.004, this.glow(NEON, 1), false); } }
    // the rest is packed against the walls, biggest first
    const want: [string, number, number][] = ([["tv", 1.9, 2.3], ["fridge", 1.8, 0.62], ["piano", 1.4, 0.75], ["aquarium", 1.1, 0.48], ["shelf", 1.0, 0.38], ["arcade", 0.62, 0.62], ["vinyl", 0.65, 0.45], ["coffee", 0.6, 0.45], ["plant", 0.45, 0.45], ["lamp", 0.38, 0.38]] as [string, number, number][]).filter(([k]) => this.has(k));
    for (const [k, fw, fd] of want) { const slot = this.pack(r, fw, fd, reserve, k === "tv" ? ["back", "left"] : ["back", "left", "right", "front"]); if (!slot) continue; reserve.push(slot.rect); this.indoor(k, slot.rect, slot.wall); }
    this.addSpot("desk", { x: r.x + 2.05, y: r.y + 1.0 }, { x: r.x + 1.18, y: r.y + 1.0, z: 0.25, yaw: -Math.PI / 2, kind: "sit" }, 12, 26, this.has("office") ? 2 : 3.4);
    this.addSpot("bed", { x: bx - 0.3, y: by + 1.25 }, { x: bx + 0.65, y: by + 0.3 + HT, z: 0.6, yaw: 0, kind: "lie" }, 25, 45, 0.3, this.has("bedroom") ? 4 : 9);
    for (const f of reserve.slice(0, 2)) this.nav.block({ x: f.x + 0.15, y: f.y + 0.15, w: f.w - 0.6, d: f.d - 0.5 }, 0.05);
    this.nav.block({ x: bx, y: by, w: 1.3, d: 1.95 }, 0.12);
  }
  /** First free place along a wall of r for a fw x fd footprint (fd is depth out of the wall). */
  private pack(r: R, fw: number, fd: number, reserve: R[], walls: Wall[]) {
    const hit = (a: R) => reserve.some((b) => a.x < b.x + b.w + 0.25 && a.x + a.w + 0.25 > b.x && a.y < b.y + b.d + 0.25 && a.y + a.d + 0.25 > b.y);
    for (const wall of walls) {
      const along = wall === "back" || wall === "front" ? r.w : r.d;
      for (let s = 0.15; s + fw <= along - 0.1; s += 0.1) {
        const rect: R = wall === "back" ? { x: r.x + s, y: r.y + 0.04, w: fw, d: fd } : wall === "front" ? { x: r.x + r.w - s - fw, y: r.y + r.d - fd - 0.1, w: fw, d: fd } : wall === "left" ? { x: r.x + 0.04, y: r.y + r.d - s - fw, w: fd, d: fw } : { x: r.x + r.w - fd - 0.1, y: r.y + s, w: fd, d: fw };
        if (!hit(rect)) return { rect, wall };
      }
    }
    return null;
  }
  private indoor(k: string, rect: R, wall: Wall) {
    const f = this.wallFrame(rect, wall), M = this.M, len = f.len, at = (lx: number, lz: number) => f.T(lx, lz);
    const spot = (act: string, lx: number, lz: number, kind: Kind = "stand", min = 6, max = 12, w = 0.8) => { const p = at(lx, lz); this.addSpot(act, p, { x: p.x, y: p.y, z: 0, yaw: f.yawIn, kind }, min, max, w); };
    this.nav.block(rect, 0.12);
    if (k === "tv") {
      const sm = this.screen(1); f.lb(len / 2 - 0.75, 0, 0.75, 1.5, 0.05, 0.85, M.ink); const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.76), sm); scr.position.set(len / 2, 1.18, 0.06); f.g.add(scr);
      f.lb(len / 2 - 0.6, 0.06, 0, 1.2, 0.3, 0.32, M.ink); f.lb(len / 2 - 0.58, 0.07, 0.32, 1.16, 0.02, 0.01, this.glow(NEON, 1.2), false);
      const cz = 1.45; f.lb(len / 2 - 0.9, cz, 0.1, 1.8, 0.7, 0.24, M.white); f.lb(len / 2 - 0.9, cz + 0.52, 0.34, 1.8, 0.18, 0.4, M.white); f.lb(len / 2 - 1.0, cz, 0.1, 0.12, 0.7, 0.42, M.white); f.lb(len / 2 + 0.88, cz, 0.1, 0.12, 0.7, 0.42, M.white);
      for (const s of [-0.45, 0.45]) f.lb(len / 2 + s - 0.3, cz + 0.05, 0.34, 0.6, 0.45, 0.06, M.soft);
      const p = at(len / 2, cz + 0.3), q = at(len / 2 + 1.2, cz + 0.35);
      this.addSpot("couch", q, { x: p.x, y: p.y, z: 0.13, yaw: f.yawIn, kind: "sit" }, 10, 18, 1.6);
      this.nav.block(rect, 0.05);
    } else if (k === "fridge") {
      f.lb(0, 0, 0, 0.62, 0.62, 1.9, M.white); f.lb(0.6, 0.02, 1.9, 0.02, 0.02, 0.01, M.ink); f.lb(0.05, 0.63, 1.1, 0.02, 0.02, 0.5, M.metal);
      f.lb(0.66, 0, 0, len - 0.66, 0.6, 0.86, M.ink); f.lb(0.66, 0, 0.86, len - 0.66, 0.62, 0.05, M.white); f.lb(0.7, 0.6, 0.6, len - 0.74, 0.01, 0.015, this.glow(NEON, 1.2), false);
      const k2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.2, 14), M.black); k2.position.set(len - 0.3, 1.01, 0.3); f.g.add(k2);
      spot("fridge", len / 2, 1.05);
    } else if (k === "piano") {
      f.lb(0, 0, 0, len, 0.45, 1.1, M.black); f.lb(0, 0.45, 0.7, len, 0.25, 0.06, M.black);
      for (let i = 0; i < 18; i++) f.lb(0.05 + i * ((len - 0.1) / 18), 0.47, 0.76, (len - 0.1) / 18 - 0.01, 0.2, 0.012, i % 3 === 1 ? M.ink : M.white, false);
      f.lb(len / 2 - 0.35, 0.85, 0, 0.7, 0.3, 0.42, M.ink);
      const p = at(len / 2, 1.0), q = at(len / 2, 1.5); this.addSpot("piano", q, { x: p.x, y: p.y, z: 0.22, yaw: f.yawIn, kind: "work" }, 8, 14, 0.9);
    } else if (k === "aquarium") {
      f.lb(0, 0, 0, len, 0.45, 0.5, M.ink);
      const water = new THREE.MeshPhysicalMaterial({ color: CYAN, transparent: true, opacity: 0.32, roughness: 0.05, emissive: new THREE.Color(CYAN), emissiveIntensity: 0.45 });
      f.lb(0, 0, 0.5, len, 0.45, 0.55, water, false); f.lb(0, 0, 1.05, len, 0.45, 0.03, M.ink, false);
      for (let i = 0; i < 4; i++) { const fm = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 6), this.glow([0xff9f43, 0xffffff, NEON, CYAN][i], 1.2)); fm.rotation.z = Math.PI / 2; const base = new THREE.Vector3(0.2, 0.62 + i * 0.1, 0.22); fm.position.copy(base); f.g.add(fm); this.fish.push({ m: fm, base, off: i * 1.7 }); (fm.userData as { len: number }).len = len; }
      spot("aquarium", len / 2, 0.95);
    } else if (k === "shelf") {
      f.lb(0, 0, 0, len, 0.36, 1.5, M.ink); for (let s = 0; s < 3; s++) for (let b = 0; b < 5; b++) f.lb(0.08 + b * 0.18, 0.04, 0.1 + s * 0.48, 0.1, 0.28, 0.3 - (b % 2) * 0.06, (b + s) % 3 ? M.white : this.glow(NEON, 0.8), false);
    } else if (k === "arcade") {
      f.lb(0, 0, 0, len, 0.6, 1.1, M.black); f.lb(0, 0, 1.1, len, 0.35, 0.55, M.black); f.lb(0.04, 0.6, 0.98, len - 0.08, 0.02, 0.02, this.glow(NEON, 1.6), false);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.14, 0.4), this.screen(0)); scr.position.set(len / 2, 1.32, 0.36); f.g.add(scr);
      f.lb(0.05, 0.38, 0.9, len - 0.1, 0.25, 0.04, M.ink); f.lb(len - 0.06, 0.6, 1.6, 0.02, 0.02, 0.02, this.glow(0xff5470, 2), false);
      spot("arcade", len / 2, 1.0, "work", 6, 12, 1);
    } else if (k === "vinyl") {
      f.lb(0, 0, 0, len, 0.45, 0.62, M.white); f.lb(0.03, 0.03, 0.62, len - 0.06, 0.39, 0.03, M.ink); const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.01, 28), M.black); disc.position.set(len / 2, 0.66, 0.22); f.g.add(disc); this.spinners.push({ o: disc, axis: "y", rate: 3.4 });
      const lab = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 16), this.glow(NEON, 1.3)); lab.position.set(len / 2, 0.665, 0.22); f.g.add(lab);
      spot("vinyl", len / 2, 0.85, "dance", 5, 9, 0.6);
    } else if (k === "coffee") {
      f.lb(0, 0, 0, len, 0.45, 0.85, M.ink); f.lb(0.12, 0.05, 0.85, 0.36, 0.3, 0.42, M.metal); f.lb(0.16, 0.34, 1.0, 0.28, 0.02, 0.1, this.glow(NEON, 1.4), false);
      spot("coffee", len / 2, 0.85, "stand", 4, 7, 0.7);
    } else if (k === "plant") {
      f.lb(0.07, 0.07, 0, 0.32, 0.32, 0.34, M.white);
      const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), M.leaf); leaf.position.set(0.23, 0.66, 0.23); leaf.castShadow = true; f.g.add(leaf);
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.29, 0)), new THREE.LineBasicMaterial({ color: NEON })); wire.position.copy(leaf.position); f.g.add(wire);
    } else if (k === "lamp") {
      f.lb(0.16, 0.16, 0, 0.05, 0.05, 1.25, M.white); f.lb(0.06, 0.06, 0, 0.26, 0.26, 0.03, M.ink);
      const m = this.glow(0xfff2d6, 0.4, true); this.nightMats.push(m); f.lb(0.02, 0.02, 1.2, 0.34, 0.34, 0.26, m, false);
      const L = new THREE.PointLight(0xffe2b0, 0, 6); L.position.set(0.19, 1.25, 0.19); f.g.add(L); this.lamps.push(L);
    }
  }
  private deskSet(f: ReturnType<World3D["wallFrame"]>, len: number, triple: boolean, gaming: boolean, kind: number) {
    const M = this.M;
    f.lb(0, 0, 0.7, len, 0.75, 0.05, M.ink); for (const [a, b] of [[0.04, 0.04], [len - 0.08, 0.04], [0.04, 0.66], [len - 0.08, 0.66]]) f.lb(a, b, 0, 0.04, 0.04, 0.7, M.white);
    const mons = triple ? [-0.48, 0, 0.48] : [0];
    for (const off of mons) {
      f.lb(len / 2 + off - 0.04, 0.12, 0.75, 0.08, 0.06, 0.18, M.ink);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.28), this.screen(kind)); scr.position.set(len / 2 + off, 1.07, 0.19); if (triple && off) scr.rotation.y = -Math.sign(off) * 0.25; f.g.add(scr);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.3, 0.03), M.ink); back.position.set(len / 2 + off, 1.07, 0.17); back.rotation.y = scr.rotation.y; f.g.add(back);
    }
    f.lb(len / 2 - 0.22, 0.38, 0.75, 0.44, 0.14, 0.015, M.dark); // keyboard
    const c = gaming ? M.ink : M.white;
    f.lb(len / 2 - 0.27, 0.95, 0.36, 0.54, 0.5, 0.08, c); f.lb(len / 2 - 0.27, 1.4, 0.36, 0.54, 0.08, gaming ? 0.78 : 0.45, c); f.lb(len / 2 - 0.04, 1.15, 0, 0.08, 0.08, 0.36, M.ink);
    if (gaming) { f.lb(len / 2 - 0.27, 1.485, 0.5, 0.54, 0.01, 0.55, this.glow(NEON, 1.4), false); f.lb(len / 2 - 0.3, 0.95, 0.44, 0.04, 0.5, 0.18, M.ink); f.lb(len / 2 + 0.26, 0.95, 0.44, 0.04, 0.5, 0.18, M.ink); }
  }
  private bed(x: number, y: number, w: number, d: number, dbl: boolean) {
    const S = this.statics, M = this.M;
    this.box(S, x, y, 0, w, d, 0.26, M.ink); this.box(S, x + 0.05, y + 0.05, 0.26, w - 0.1, d - 0.1, 0.14, M.white);
    const pw = dbl ? (w - 0.3) / 2 : w - 0.24; for (let i = 0; i < (dbl ? 2 : 1); i++) this.box(S, x + 0.12 + i * (pw + 0.06), y + 0.1, 0.4, pw, 0.38, 0.11, M.white);
    this.box(S, x + 0.05, y + d * 0.34, 0.4, w - 0.1, d * 0.62, 0.06, M.black); this.box(S, x + 0.05, y + d * 0.34, 0.46, w - 0.1, 0.03, 0.01, this.glow(NEON, 1.3), false);
    this.box(S, x - 0.02, y, 0, w + 0.04, 0.08, 0.86, M.ink);
  }
  private toilet(x: number, y: number, gold: boolean) {
    const S = this.statics, m = gold ? this.M.gold : this.M.white;
    this.box(S, x + 0.12, y + 0.06, 0, 0.36, 0.44, 0.34, m); this.box(S, x, y + 0.03, 0.34, 0.16, 0.5, 0.42, m); this.cyl(S, x + 0.33, y + 0.28, 0.34, 0.2, 0.04, m, 20);
  }
  private artFrame(f: ReturnType<World3D["wallFrame"]>, len: number, z: number) {
    const tex = this.canvasTex(256, 256, (g) => { if (!drawArt(g, this.nft, 256)) { g.fillStyle = this.look.palette.main; g.fillRect(0, 0, 256, 256); } });
    f.lb(0, 0, z - 0.04, len, 0.04, len + 0.08, this.M.ink);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.1, len - 0.1), new THREE.MeshBasicMaterial({ map: tex })); pic.position.set(len / 2, z + len / 2, 0.045); f.g.add(pic);
    f.lb(0.02, 0.04, z + len + 0.02, len - 0.04, 0.01, 0.01, this.glow(NEON, 1.4), false);
  }

  private room(id: string) {
    const r = ROOMS[id], S = this.statics, M = this.M;
    if (id === "observatory") return this.observatory(r);
    if (id === "helipad") return this.helipad(r);
    if (id === "greenhouse") return this.greenhouse(r);
    this.shell(r, r.h, { wall: 0x343a44, floor: 0x14171a, trim: NEON, windows: id === "bedroom" ? 1 : 0, openRight: id === "garage" });
    this.box(S, r.x + r.w / 2 - 0.5, r.y + r.d, 0, 1.0, 0.3, 0.05, M.white);
    const sign = (txt: string) => { const t = this.canvasTex(256, 64, (g) => { g.fillStyle = "#0b0d0c"; g.fillRect(0, 0, 256, 64); g.font = "600 30px 'JetBrains Mono', monospace"; g.fillStyle = "#39ff88"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt.toUpperCase(), 128, 34); }); const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: t })); (m.material as unknown as { toneMapped: boolean }).toneMapped = false; const p = W(r.x + 0.55, r.y - 0.05); m.position.set(p.x, r.h - 0.3, p.z); S.add(m); };
    if (id === "bathroom") {
      sign("bath");
      this.toilet(r.x + 0.04, r.y + r.d - 0.9, this.has("goldtoilet"));
      this.addSpot("toilet", { x: r.x + 1.0, y: r.y + r.d - 0.62 }, { x: r.x + 0.25, y: r.y + r.d - 0.62, z: 0.17, yaw: Math.PI / 2, kind: "sit" }, 5, 9, 0.8);
      // shower in the back right
      const sx = r.x + r.w - 1.1, sy = r.y + 0.05; this.box(S, sx, sy, 0.1, 1.05, 1.05, 0.05, M.soft); this.box(S, sx, sy + 1.03, 0.1, 1.05, 0.03, 1.9, M.glass, false); this.box(S, sx, sy, 0.1, 0.03, 1.05, 1.9, M.glass, false);
      this.box(S, sx + 0.45, sy + 0.02, 1.85, 0.12, 0.3, 0.03, M.metal); this.box(S, sx + 0.02, sy + 1.02, 2.0, 1.03, 0.03, 0.02, this.glow(NEON, 1.2), false);
      this.addSpot("shower", { x: sx - 0.3, y: sy + 1.4 }, { x: sx + 0.52, y: sy + 0.5, z: 0.15, yaw: 0, kind: "stand" }, 6, 10, 0.6);
      // sink and mirror
      const f = this.wallFrame({ x: r.x + 0.3, y: r.y, w: 0.8, d: 0.5 }, "back"); f.lb(0, 0, 0.75, 0.8, 0.48, 0.1, M.white); f.lb(0.1, 0, 0, 0.6, 0.38, 0.75, M.ink); f.lb(0.05, 0.01, 1.05, 0.7, 0.02, 0.7, this.std(0xd9e4ea, 0.05, 1)); f.lb(0.05, 0.02, 1.75, 0.7, 0.01, 0.015, this.glow(NEON, 1.4), false);
      this.nav.block({ x: r.x + 0.3, y: r.y, w: 0.8, d: 0.5 }); this.nav.block({ x: sx, y: sy + 1.0, w: 1.05, d: 0.06 }, 0.1); this.nav.block({ x: sx, y: sy, w: 0.06, d: 1.05 }, 0.1);
    } else if (id === "shed") {
      sign("shed");
      const f = this.wallFrame({ x: r.x + 0.2, y: r.y, w: 2.0, d: 0.7 }, "back"); f.lb(0, 0, 0.8, 2.0, 0.7, 0.07, M.dark); for (const a of [0.05, 1.9]) f.lb(a, 0.05, 0, 0.05, 0.6, 0.8, M.white);
      f.lb(0, 0, 1.1, 2.0, 0.03, 0.8, M.ink); for (let i = 0; i < 6; i++) f.lb(0.15 + i * 0.3, 0.03, 1.3 + (i % 2) * 0.2, 0.05, 0.03, 0.35, i % 3 ? M.metal : this.glow(NEON, 1), false);
      f.lb(0.6, 0.15, 0.87, 0.5, 0.3, 0.12, M.metal);
      const m = this.glow(0xfff2d6, 0.5, true); this.nightMats.push(m); f.lb(0.8, 0.3, 1.75, 0.4, 0.12, 0.04, m, false);
      this.nav.block({ x: r.x + 0.2, y: r.y, w: 2.0, d: 0.7 });
      this.addSpot("shed", { x: r.x + 1.2, y: r.y + 1.7 }, { x: r.x + 1.2, y: r.y + 1.05, z: 0, yaw: Math.PI, kind: "work" }, 8, 14, 1);
      if (this.look.vehicle === "bike") { /* the bike lives out front; the shed has a spare wheel */ const wh = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 8, 28), M.ink); const p = W(r.x + 0.15, r.y + 1.6); wh.position.set(p.x, 0.5, p.z); wh.rotation.y = Math.PI / 2; S.add(wh); }
    } else if (id === "bedroom") {
      sign("sleep");
      const bx = r.x + r.w / 2 - 0.8; this.bed(bx, r.y + 0.08, 1.6, 2.0, true); this.nav.block({ x: bx, y: r.y + 0.08, w: 1.6, d: 2.0 }, 0.1);
      for (const nx of [bx - 0.5, bx + 1.65]) { this.box(S, nx, r.y + 0.05, 0, 0.42, 0.4, 0.45, M.ink); const m = this.glow(0xfff2d6, 0.5, true); this.nightMats.push(m); this.cyl(S, nx + 0.21, r.y + 0.25, 0.45, 0.09, 0.22, m, 16); this.nav.block({ x: nx, y: r.y + 0.05, w: 0.42, d: 0.4 }); }
      const f = this.wallFrame({ x: r.x, y: r.y + 1.0, w: 0.6, d: 1.4 }, "left"); f.lb(0, 0, 0, 1.4, 0.6, 1.9, M.white); f.lb(0.69, 0.6, 0.2, 0.02, 0.01, 1.5, M.ink); f.lb(0.05, 0.61, 1.85, 1.3, 0.01, 0.015, this.glow(NEON, 1.2), false); this.nav.block({ x: r.x, y: r.y + 1.0, w: 0.6, d: 1.4 });
      this.addSpot("bed", { x: bx + 0.8, y: r.y + 2.5 }, { x: bx + 0.5, y: r.y + 0.38 + HT, z: 0.6, yaw: 0, kind: "lie" }, 25, 45, 0.4, 9);
    } else if (id === "office") {
      sign("office");
      const f = this.wallFrame({ x: r.x + 0.5, y: r.y, w: 2.8, d: 0.8 }, "back");
      f.lb(0, 0, 0.72, 2.8, 0.78, 0.05, M.ink); for (const a of [0.05, 2.7]) f.lb(a, 0.05, 0, 0.05, 0.7, 0.72, M.white);
      for (let i = 0; i < 4; i++) { const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.36), this.screen(i % 2)); scr.position.set(0.7 + (i % 2) * 0.7 + (i > 1 ? 0 : 0), 1.1 + Math.floor(i / 2) * 0.42, 0.06); scr.position.x = 0.7 + (i % 2) * 0.7 + 0.35; f.g.add(scr); }
      f.lb(0.6, 0.02, 0.85, 1.6, 0.03, 0.9, M.ink);
      f.lb(1.2, 0.95, 0.38, 0.5, 0.48, 0.08, M.ink); f.lb(1.2, 1.38, 0.38, 0.5, 0.08, 0.7, M.ink); f.lb(1.2, 1.455, 0.5, 0.5, 0.01, 0.5, this.glow(NEON, 1.3), false);
      this.nav.block({ x: r.x + 0.5, y: r.y, w: 2.8, d: 0.8 });
      this.addSpot("office", { x: r.x + 1.95, y: r.y + 2.0 }, { x: r.x + 1.95, y: r.y + 1.2, z: 0.25, yaw: Math.PI, kind: "sit" }, 14, 26, 2.6);
      const pl = this.wallFrame({ x: r.x + r.w - 0.55, y: r.y + 0.05, w: 0.45, d: 0.45 }, "back"); this.indoorLite(pl, "plant");
    } else if (id === "garage") {
      sign("garage");
      const strip = this.glow(NEON, 1.6); this.box(S, r.x + 0.4, r.y + r.d / 2 - 0.02, r.h - 0.12, r.w - 0.8, 0.04, 0.02, strip, false);
      this.box(S, r.x + r.w - 0.06, r.y, 0, 0.06, 0.06, r.h - 0.1, M.white); this.box(S, r.x + r.w - 0.06, r.y + r.d - 0.06, 0, 0.06, 0.06, r.h - 0.1, M.white);
      const f = this.wallFrame({ x: r.x, y: r.y + 0.4, w: 0.4, d: 2.4 }, "left"); f.lb(0, 0, 0, 2.4, 0.4, 0.9, M.ink); f.lb(0, 0, 1.0, 2.4, 0.03, 0.8, M.dark); for (let i = 0; i < 8; i++) f.lb(0.15 + i * 0.28, 0.03, 1.15 + (i % 3) * 0.15, 0.04, 0.03, 0.3, M.metal);
      this.nav.block({ x: r.x, y: r.y + 0.4, w: 0.4, d: 2.4 });
    } else if (id === "gym") {
      sign("gym");
      const f = this.wallFrame({ x: r.x + 0.2, y: r.y, w: 1.6, d: 1.2 }, "back"); // squat rack
      for (const a of [0.1, 1.4]) { f.lb(a, 0.2, 0, 0.08, 0.08, 1.9, M.black); f.lb(a, 0.9, 0, 0.08, 0.08, 1.9, M.black); }
      f.lb(0.0, 0.55, 1.35, 1.6, 0.04, 0.04, M.metal); for (const a of [0.02, 1.48]) { const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 20), M.ink); pl.rotation.z = Math.PI / 2; pl.position.set(a + 0.05, 1.37, 0.57); f.g.add(pl); }
      this.nav.block({ x: r.x + 0.2, y: r.y, w: 1.6, d: 1.2 });
      this.addSpot("gym", { x: r.x + 1.0, y: r.y + 1.75 }, { x: r.x + 1.0, y: r.y + 0.58, z: 0, yaw: 0, kind: "lift" }, 8, 14, 1.4);
      // bench
      const bx = r.x + 2.3, by = r.y + 0.5; this.box(S, bx, by, 0.32, 0.38, 1.3, 0.08, M.ink); for (const yy of [by + 0.1, by + 1.1]) this.box(S, bx + 0.15, yy, 0, 0.08, 0.08, 0.32, M.metal);
      this.box(S, bx - 0.4, by + 0.25, 0.9, 1.18, 0.04, 0.04, M.metal); this.nav.block({ x: bx, y: by, w: 0.38, d: 1.3 });
      // mirror on the left wall
      const mf = this.wallFrame({ x: r.x, y: r.y + 1.1, w: 0.05, d: 1.4 }, "left"); mf.lb(0, 0.01, 0.3, 1.4, 0.02, 1.5, this.std(0xd9e4ea, 0.04, 1)); mf.lb(0, 0.02, 1.82, 1.4, 0.01, 0.015, this.glow(NEON, 1.4), false);
    } else if (id === "servers") {
      sign("nodes");
      for (let i = 0; i < 3; i++) {
        const x = r.x + 0.15 + i * 0.75; this.box(S, x, r.y + 0.04, 0, 0.65, 0.7, 1.85, M.black); this.nav.block({ x, y: r.y + 0.04, w: 0.65, d: 0.7 });
        for (let j = 0; j < 9; j++) { const c = new THREE.Color(j % 4 === 3 ? CYAN : NEON), m = this.glow(c.getHex(), 1.4, true); this.blinkers.push({ m, c: c.multiplyScalar(1.6), off: Math.random() * 10, rate: 2 + Math.random() * 6 }); this.box(S, x + 0.08 + (j % 3) * 0.18, r.y + 0.745, 0.25 + Math.floor(j / 3) * 0.5, 0.1, 0.01, 0.03, m, false); }
        this.box(S, x + 0.04, r.y + 0.745, 1.7, 0.57, 0.01, 0.02, this.glow(NEON, 0.8), false);
      }
      this.addSpot("servers", { x: r.x + 1.3, y: r.y + 1.8 }, { x: r.x + 1.3, y: r.y + 1.15, z: 0, yaw: Math.PI, kind: "work" }, 6, 10, 0.8);
    }
  }
  private indoorLite(f: ReturnType<World3D["wallFrame"]>, k: string) {
    const M = this.M;
    if (k === "plant") { f.lb(0.07, 0.07, 0, 0.32, 0.32, 0.34, M.white); const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), M.leaf); leaf.position.set(0.23, 0.66, 0.23); f.g.add(leaf); const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.29, 0)), new THREE.LineBasicMaterial({ color: NEON })); wire.position.copy(leaf.position); f.g.add(wire); }
  }
  private greenhouse(r: R) {
    const S = this.statics, M = this.M;
    this.box(S, r.x, r.y, 0, r.w, r.d, 0.08, this.std(0x101513, 0.3, 0.3));
    for (const [x, y, w, d] of [[r.x, r.y, r.w, 0.03], [r.x, r.y, 0.03, r.d], [r.x + r.w - 0.03, r.y, 0.03, r.d]]) this.box(S, x, y, 0.08, w, d, 1.8, M.glass, false);
    for (const [x, y] of [[r.x, r.y], [r.x + r.w - 0.06, r.y], [r.x, r.y + r.d - 0.06], [r.x + r.w - 0.06, r.y + r.d - 0.06]]) this.box(S, x, y, 0, 0.06, 0.06, 2.1, M.white);
    // pitched glass roof
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(r.d / 2, r.d / 2, r.w, 3, 1, true, 0, Math.PI), M.glass); roof.rotation.z = Math.PI / 2; roof.rotation.y = 0; roof.scale.set(1, 1, 0.55); const p = W(r.x + r.w / 2, r.y + r.d / 2); roof.position.set(p.x, 1.88, p.z); S.add(roof);
    this.box(S, r.x, r.y + r.d / 2 - 0.03, 2.08 + 0.2, r.w, 0.06, 0.04, M.white);
    this.box(S, r.x, r.y - 0.02, 1.86, r.w, 0.04, 0.04, this.glow(NEON, 1.3), false);
    for (let i = 0; i < 2; i++) {
      const y = r.y + 0.3 + i * 1.5; this.box(S, r.x + 0.3, y, 0, r.w - 0.9, 0.55, 0.45, M.ink); this.nav.block({ x: r.x + 0.3, y, w: r.w - 0.9, d: 0.55 });
      for (let k = 0; k < 5; k++) { const pl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17 + (k % 2) * 0.05, 0), M.leaf); const q = W(r.x + 0.55 + k * ((r.w - 1.3) / 4), y + 0.27); pl.position.set(q.x, 0.62, q.z); pl.castShadow = true; S.add(pl); const wl = new THREE.LineSegments(new THREE.EdgesGeometry(pl.geometry), new THREE.LineBasicMaterial({ color: NEON })); wl.position.copy(pl.position); S.add(wl); }
    }
    this.nav.block({ x: r.x, y: r.y, w: r.w, d: 0.05 }); this.nav.block({ x: r.x, y: r.y, w: 0.05, d: r.d }); this.nav.block({ x: r.x + r.w - 0.05, y: r.y, w: 0.05, d: r.d });
    this.addSpot("greenhouse", { x: r.x + r.w / 2, y: r.y + r.d + 0.5 }, { x: r.x + r.w / 2 - 0.3, y: r.y + 1.15, z: 0.08, yaw: Math.PI, kind: "work" }, 7, 12, 1);
  }
  private observatory(r: R) {
    const S = this.statics, M = this.M, cx = r.x + r.w / 2, cy = r.y + r.d / 2, R0 = r.w / 2;
    this.cyl(S, cx, cy, 0, R0, 0.3, M.white, 40); this.cyl(S, cx, cy, 0.3, R0 - 0.05, 0.02, this.std(0x101312, 0.3, 0.4), 40);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R0, 0.02, 6, 64), this.glow(NEON, 1.6)); ring.rotation.x = Math.PI / 2; const p = W(cx, cy); ring.position.set(p.x, 0.3, p.z); S.add(ring);
    this.cyl(S, cx, cy, 0.3, R0 - 0.08, 1.0, M.white, 40, R0 - 0.08).visible = false;
    // the back half of the dome (cutaway so you can see the telescope)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(R0 - 0.08, 40, 20, Math.PI * 0.5, Math.PI * 1.15, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe4e7e5, roughness: 0.4, metalness: 0.1, side: THREE.DoubleSide })); dome.position.set(p.x, 1.1, p.z); dome.rotation.y = Math.PI * 0.12; dome.castShadow = true; S.add(dome);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(R0 - 0.08, R0 - 0.08, 0.8, 40, 1, true, Math.PI * 0.62, Math.PI * 1.15), new THREE.MeshStandardMaterial({ color: 0xd8dbd9, roughness: 0.6, side: THREE.DoubleSide })); wall.position.set(p.x, 0.7, p.z); S.add(wall);
    const tg = new THREE.Group(); tg.position.set(p.x, 0.3, p.z); S.add(tg);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.8, 12), M.ink); leg.position.y = 0.4; tg.add(leg);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 1.3, 20), M.black); tube.position.set(0, 1.05, -0.2); tube.rotation.x = -0.75; tube.castShadow = true; tg.add(tube);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20), this.glow(CYAN, 1.6)); lens.position.set(0, 1.5, -0.62); lens.rotation.x = -0.75; tg.add(lens);
    this.nav.blockCircle({ x: cx, y: cy }, 0.25);
    for (let a = Math.PI * 0.62; a < Math.PI * 1.77; a += 0.12) this.nav.blockCircle({ x: cx + Math.cos(a) * (R0 - 0.1), y: cy - Math.sin(a) * (R0 - 0.1) }, 0.12);
    this.addSpot("observatory", { x: cx + 0.2, y: cy + R0 + 0.4 }, { x: cx + 0.05, y: cy + 0.55, z: 0.3, yaw: Math.PI, kind: "look" }, 8, 14, 0.9, 3);
  }
  private helipad(r: R) {
    const S = this.statics, M = this.M, cx = r.x + r.w / 2, cy = r.y + r.d / 2;
    this.box(S, r.x, r.y, 0, r.w, r.d, 0.22, M.black);
    const ring = new THREE.Mesh(new THREE.RingGeometry(r.w * 0.36, r.w * 0.39, 64), this.glow(0xffffff, 0.9)); ring.rotation.x = -Math.PI / 2; const p = W(cx, cy); ring.position.set(p.x, 0.225, p.z); S.add(ring);
    const hm = this.glow(0xffffff, 0.9); this.box(S, cx - 0.55, cy - 0.65, 0.222, 0.2, 1.3, 0.005, hm, false); this.box(S, cx + 0.35, cy - 0.65, 0.222, 0.2, 1.3, 0.005, hm, false); this.box(S, cx - 0.35, cy - 0.1, 0.222, 0.7, 0.2, 0.005, hm, false);
    for (const [x, y] of [[r.x + 0.1, r.y + 0.1], [r.x + r.w - 0.2, r.y + 0.1], [r.x + 0.1, r.y + r.d - 0.2], [r.x + r.w - 0.2, r.y + r.d - 0.2]]) { const m = this.glow(NEON, 2, true); this.blinkers.push({ m, c: new THREE.Color(NEON).multiplyScalar(2.2), off: 0, rate: 1.2 }); this.box(S, x, y, 0.22, 0.1, 0.1, 0.06, m, false); }
    // a small helicopter
    const h = new THREE.Group(); h.position.set(p.x - 0.3, 0.22, p.z - 0.3); h.rotation.y = 0.6; S.add(h);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), this.std(0xeef1ef, 0.3, 0.3)); body.scale.set(1.4, 0.85, 0.85); body.position.y = 0.7; body.castShadow = true; h.add(body);
    const win = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 12, 0, Math.PI, 0, Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0x0b1416, roughness: 0.05, metalness: 0.4, clearcoat: 1 })); win.scale.set(1.4, 0.9, 0.95); win.position.set(0.15, 0.72, 0); win.rotation.y = -Math.PI / 2; h.add(win);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 1.4, 10), this.std(0xeef1ef, 0.3, 0.3)); boom.rotation.z = Math.PI / 2; boom.position.set(-1.25, 0.8, 0); h.add(boom);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.35, 0.03), this.glow(NEON, 1.4)); fin.position.set(-1.9, 0.95, 0); h.add(fin);
    for (const z of [-0.35, 0.35]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.04), M.ink); sk.position.set(0, 0.08, z); h.add(sk); for (const x of [-0.35, 0.35]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.03), M.ink); st.position.set(x, 0.24, z * 0.8); h.add(st); } }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25, 8), M.ink); mast.position.y = 1.2; h.add(mast);
    const rotor = new THREE.Group(); rotor.position.y = 1.33; h.add(rotor); for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.015, 0.1), M.ink); b.rotation.y = (i * Math.PI) / 2; rotor.add(b); }
    this.spinners.push({ o: rotor, axis: "y", rate: 0.6 });
    this.nav.blockCircle({ x: cx - 0.3, y: cy - 0.3 }, 0.95);
    this.addSpot("helipad", { x: cx + 0.9, y: r.y + r.d + 0.4 }, { x: cx + 1.0, y: cy + 1.1, z: 0.22, yaw: Math.PI * 0.85, kind: "look" }, 6, 10, 0.6);
  }

  // ------------------------------------------------------------------ outside
  private outdoor() {
    const S = this.statics, M = this.M, r = this.HR, dy = r.y + r.d;
    if (this.has("mailbox")) {
      const mx = DOOR_X - 1.35, my = LAND - ROAD - 1.25; this.box(S, mx + 0.12, my + 0.12, 0, 0.06, 0.06, 0.75, M.white); this.box(S, mx, my, 0.75, 0.3, 0.45, 0.26, M.ink); this.box(S, mx + 0.29, my + 0.05, 0.8, 0.02, 0.06, 0.18, this.glow(0xff5470, 1.6), false);
      const t = this.canvasTex(256, 64, (g) => { g.fillStyle = "#eef1ef"; g.fillRect(0, 0, 256, 64); g.font = "600 30px 'Space Grotesk', sans-serif"; g.fillStyle = "#0b0d0c"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(this.look.name.slice(0, 14), 128, 34); });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.105), new THREE.MeshBasicMaterial({ map: t })); const p = W(mx + 0.15, my + 0.455); pl.position.set(p.x, 0.88, p.z); S.add(pl);
      this.nav.block({ x: mx, y: my, w: 0.3, d: 0.45 });
    }
    if (this.has("lights")) for (let y = dy + 1.4; y < LAND - ROAD - 1; y += 2.2) for (const x of [DOOR_X - 0.75, DOOR_X + 0.69]) { this.box(S, x, y, 0, 0.06, 0.06, 0.45, M.ink); const m = this.glow(0xfff2d6, 0.5, true); this.nightMats.push(m); this.box(S, x - 0.03, y - 0.03, 0.45, 0.12, 0.12, 0.08, m, false); }
    if (this.has("garden")) for (const x of [DOOR_X - 1.75, DOOR_X + 0.85]) { const y0 = dy + 1.2; this.box(S, x, y0, 0, 0.9, 3.4, 0.22, M.ink); this.nav.block({ x, y: y0, w: 0.9, d: 3.4 }); for (let k = 0; k < 7; k++) { const c = [0xffffff, NEON, 0xff7ab8, 0xffd84d][k % 4]; this.cyl(S, x + 0.25 + (k % 2) * 0.4, y0 + 0.25 + k * 0.45, 0.22, 0.012, 0.18, M.leaf, 6); const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), this.glow(c, c === 0xffffff ? 0.9 : 1.2)); const q = W(x + 0.25 + (k % 2) * 0.4, y0 + 0.25 + k * 0.45); fl.position.set(q.x, 0.45, q.z); S.add(fl); } }
    if (this.has("fence")) {
      const ie = ROAD + 0.72, gap = (a: number, b: number, c: number) => a > b - c && a < b + c;
      const post = (x: number, y: number) => this.box(S, x - 0.05, y - 0.05, 0, 0.1, 0.1, 0.55, M.white);
      for (let x = ie; x <= LAND - ie + 0.01; x += 1.0) { if (!gap(x, DOOR_X, 1.0) && !gap(x, this.park.x + 2.6, 1.4)) { post(x, LAND - ie); if (x + 1 <= LAND - ie + 0.01 && !gap(x + 0.5, DOOR_X, 1.0) && !gap(x + 0.5, this.park.x + 2.6, 1.4)) { this.box(S, x, LAND - ie - 0.02, 0.38, 1.0, 0.04, 0.05, M.white); this.box(S, x, LAND - ie - 0.02, 0.18, 1.0, 0.04, 0.05, M.white); } } post(x, ie); if (x + 1 <= LAND - ie + 0.01) this.box(S, x, ie - 0.02, 0.38, 1.0, 0.04, 0.05, M.white); }
      for (let y = ie; y <= LAND - ie + 0.01; y += 1.0) { post(ie, y); if (y + 1 <= LAND - ie + 0.01) this.box(S, ie - 0.02, y, 0.38, 0.04, 1.0, 0.05, M.white); if (!(this.has("garage") && gap(y, ROOMS.garage.y + ROOMS.garage.d / 2 + 0.8, 1.6))) { post(LAND - ie, y); if (y + 1 <= LAND - ie + 0.01 && !(this.has("garage") && gap(y + 0.5, ROOMS.garage.y + ROOMS.garage.d / 2 + 0.8, 1.6))) this.box(S, LAND - ie - 0.02, y, 0.38, 0.04, 1.0, 0.05, M.white); } }
      this.box(S, ie, LAND - ie - 0.01, 0.5, LAND - 2 * ie, 0.02, 0.01, this.glow(NEON, 0.6), false);
    }
    if (this.has("trees")) for (const [tx, ty, s] of [[6.9, 16.6, 1], [11.0, 23.3, 0.85], [23.6, 23.6, 1.1], [23.7, 6.3, 0.8], [10.6, 16.4, 0.7], [1.9, 10.2, 0.75]] as [number, number, number][]) this.tree(tx, ty, s, false);
    if (this.has("bench")) { const bx = DOOR_X + 1.9, by = dy + 4.6; this.box(S, bx, by, 0.36, 0.45, 1.5, 0.06, M.white); this.box(S, bx + 0.38, by, 0.42, 0.07, 1.5, 0.4, M.white); for (const yy of [by + 0.1, by + 1.3]) this.box(S, bx + 0.1, yy, 0, 0.3, 0.08, 0.36, M.ink); this.nav.block({ x: bx, y: by, w: 0.45, d: 1.5 }); this.addSpot("bench", { x: bx - 0.55, y: by + 0.75 }, { x: bx + 0.22, y: by + 0.75, z: 0.17, yaw: -Math.PI / 2, kind: "sit" }, 8, 14, 1); }
    const pool = this.has("pool") && ["villa", "mansion"].includes(this.look.house);
    if (pool) { this.box(S, POOL.x - 0.2, POOL.y - 0.2, 0, POOL.w + 0.4, POOL.d + 0.4, 0.14, M.white); const w2 = this.glow(0x2bd4ff, 0.9, true); this.water.push(w2); this.box(S, POOL.x, POOL.y, 0.141, POOL.w, POOL.d, 0.01, w2, false); this.box(S, POOL.x + POOL.w - 0.3, POOL.y - 0.25, 0.14, 0.04, 0.04, 0.6, M.metal); this.nav.block(POOL, 0.1); this.addSpot("swim", { x: POOL.x - 0.5, y: POOL.y + POOL.d / 2 }, { x: POOL.x + 1.4, y: POOL.y + 1.1, z: -0.3, yaw: Math.PI / 2, kind: "swim" }, 8, 14, 1.2); }
    if (this.has("hottub")) { const cx = DOOR_X - 3.2, cy = dy + 2.4; this.cyl(S, cx, cy, 0, 0.85, 0.45, M.ink, 32); const w2 = this.glow(CYAN, 0.9, true); this.water.push(w2); this.cyl(S, cx, cy, 0.451, 0.72, 0.01, w2, 32); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.02, 6, 48), this.glow(NEON, 1.4)); ring.rotation.x = Math.PI / 2; const p = W(cx, cy); ring.position.set(p.x, 0.46, p.z); S.add(ring); this.nav.blockCircle({ x: cx, y: cy }, 0.85); this.addSpot("hottub", { x: cx + 1.2, y: cy + 0.6 }, { x: cx + 0.25, y: cy + 0.1, z: 0.05, yaw: -Math.PI / 2, kind: "swim" }, 8, 14, 0.9); }
    if (this.has("fountain")) { const cx = 8.6, cy = dy + 6.2; this.cyl(S, cx, cy, 0, 1.0, 0.32, M.white, 40); const w2 = this.glow(CYAN, 0.8, true); this.water.push(w2); this.cyl(S, cx, cy, 0.321, 0.88, 0.01, w2, 40); this.cyl(S, cx, cy, 0.3, 0.12, 0.9, M.white, 16); this.cyl(S, cx, cy, 1.2, 0.4, 0.08, M.white, 24); const jet = this.cyl(S, cx, cy, 1.28, 0.05, 0.35, this.glow(CYAN, 1.4), 8); this.spinners.push({ o: jet, axis: "y", rate: 2 }); this.nav.blockCircle({ x: cx, y: cy }, 1.0); this.addSpot("fountain", { x: cx + 1.4, y: cy + 0.4 }, { x: cx + 1.4, y: cy + 0.4, z: 0, yaw: -Math.PI / 2, kind: "stand" }, 4, 8, 0.6); }
    if (this.has("firepit")) { const cx = 11.6, cy = 20.2; this.cyl(S, cx, cy, 0, 0.55, 0.18, M.dark, 20); const fire = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 7), this.glow(0xff8a3d, 1.8)); const p = W(cx, cy); fire.position.set(p.x, 0.43, p.z); S.add(fire); this.spinners.push({ o: fire, axis: "y", rate: 5 }); const L = new THREE.PointLight(0xff9a50, 0, 5); L.position.set(p.x, 0.8, p.z); S.add(L); this.lamps.push(L); for (const [ox, oy, alongX] of [[-1.05, 0, 0], [1.05, 0, 0], [0, 1.05, 1]] as [number, number, number][]) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 10), this.std(0x2a2522, 0.8)); const q = W(cx + ox, cy + oy); lg.position.set(q.x, 0.14, q.z); if (alongX) lg.rotation.z = Math.PI / 2; else lg.rotation.x = Math.PI / 2; lg.castShadow = true; S.add(lg); } this.nav.blockCircle({ x: cx, y: cy }, 0.6); this.addSpot("firepit", { x: cx + 1.05, y: cy + 0.7 }, { x: cx + 1.05, y: cy, z: 0.1, yaw: -Math.PI / 2, kind: "sit" }, 10, 18, 1, 2); }
    if (this.has("hoop")) { const cx = 19.6, cy = 16.4; this.box(S, cx - 1.2, cy - 0.2, 0, 2.6, 2.1, 0.015, M.dark, false); this.box(S, cx - 1.18, cy - 0.18, 0.016, 2.56, 0.02, 0.003, this.glow(0xffffff, 0.7), false); this.box(S, cx + 1.2, cy + 0.5, 0, 0.1, 0.1, 2.0, M.white); this.box(S, cx + 1.1, cy + 0.2, 1.75, 0.04, 0.8, 0.55, M.white); const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.015, 6, 20), this.glow(0xff8a3d, 1.6)); rim.rotation.x = Math.PI / 2; const p = W(cx + 0.88, cy + 0.6); rim.position.set(p.x, 1.85, p.z); S.add(rim); this.nav.block({ x: cx + 1.1, y: cy + 0.2, w: 0.2, d: 0.8 }); this.addSpot("hoop", { x: cx - 0.3, y: cy + 0.6 }, { x: cx - 0.2, y: cy + 0.6, z: 0, yaw: Math.PI / 2, kind: "dance" }, 6, 10, 0.9); }
    if (this.has("hammock")) { const x0 = 19.9, x1 = 23.1, y = 15.5; for (const x of [x0, x1]) this.box(S, x, y, 0, 0.12, 0.12, 1.2, M.white); const sag = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, x1 - x0 - 0.2, 16, 1, true, Math.PI * 0.75, Math.PI * 0.5), new THREE.MeshStandardMaterial({ color: 0xeef1ef, roughness: 0.8, side: THREE.DoubleSide })); sag.rotation.z = Math.PI / 2; const p = W((x0 + x1) / 2 + 0.06, y + 0.06); sag.position.set(p.x, 1.0, p.z); sag.castShadow = true; S.add(sag); this.nav.block({ x: x0, y, w: x1 - x0 + 0.12, d: 0.12 }); this.addSpot("hammock", { x: (x0 + x1) / 2, y: y + 0.8 }, { x: (x0 + x1) / 2 + HT / 2, y: y + 0.06, z: 0.62, yaw: Math.PI / 2, kind: "lie" }, 12, 20, 0.9); }
    if (this.has("solar")) for (let i = 0; i < 3; i++) { const x = 2.4 + i * 1.25, y = 14.55; this.box(S, x + 0.5, y + 0.45, 0, 0.06, 0.06, 0.45, M.metal); const pan = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.9), this.std(0x0a1b2a, 0.2, 0.7)); const p = W(x + 0.55, y + 0.5); pan.position.set(p.x, 0.55, p.z); pan.rotation.x = -0.45; pan.castShadow = true; S.add(pan); const ed = new THREE.LineSegments(new THREE.EdgesGeometry(pan.geometry), new THREE.LineBasicMaterial({ color: CYAN })); ed.position.copy(pan.position); ed.rotation.copy(pan.rotation); S.add(ed); this.nav.block({ x, y, w: 1.1, d: 1.0 }, 0.05); }
    if (this.has("turbine")) { const x = 7.6, y = 12.2; this.cyl(S, x, y, 0, 0.08, 4.2, M.white, 12, 0.05); const hub = new THREE.Group(); const p = W(x, y); hub.position.set(p.x, 4.25, p.z + 0.1); S.add(hub); for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.03), M.white); b.position.y = 0.75; const arm = new THREE.Group(); arm.rotation.z = (i * Math.PI * 2) / 3; arm.add(b); hub.add(arm); } const nose = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), this.glow(NEON, 1.4)); hub.add(nose); this.spinners.push({ o: hub, axis: "z", rate: 1.4 }); this.nav.blockCircle({ x, y }, 0.15); }
    if (this.has("statue")) { const cx = 16.9, cy = dy + 7.6; this.box(S, cx - 0.6, cy - 0.6, 0, 1.2, 1.2, 0.6, M.white); this.box(S, cx - 0.62, cy - 0.62, 0.6, 1.24, 1.24, 0.04, this.glow(NEON, 1.2), false); const st = makeTrenchie(this.nft, this.look.palette, 1.9); st.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.material && (m.material as THREE.Material).type === "MeshToonMaterial") m.material = this.std(0xd7dad8, 0.45, 0.1); }); const p = W(cx, cy); st.position.set(p.x, 0.64, p.z); st.rotation.y = Math.PI / 4; S.add(st); this.nav.block({ x: cx - 0.6, y: cy - 0.6, w: 1.2, d: 1.2 }); this.addSpot("statue", { x: cx, y: cy + 1.3 }, { x: cx, y: cy + 1.3, z: 0, yaw: Math.PI, kind: "look" }, 4, 7, 0.5); }
    if (this.has("billboard")) {
      const bx = DOOR_X - 2.2, by = 1.62; for (const x of [bx + 0.6, bx + 3.6]) this.box(S, x, by, 0, 0.14, 0.14, 3.0, M.ink);
      const t = this.canvasTex(800, 400, (g) => { g.fillStyle = "#050606"; g.fillRect(0, 0, 800, 400); g.save(); g.beginPath(); g.roundRect(30, 30, 340, 340, 24); g.clip(); g.translate(30, 30); if (!drawArt(g, this.nft, 340)) { g.fillStyle = this.look.palette.main; g.fillRect(0, 0, 400, 400); } g.restore(); g.translate(0, 0); g.fillStyle = "#39ff88"; g.font = "500 30px 'JetBrains Mono', monospace"; g.fillText(`LEVEL ${this.look.level ?? 1}`, 410, 120); g.fillStyle = "#ffffff"; g.font = "700 72px 'Space Grotesk', sans-serif"; g.fillText(this.look.name.slice(0, 12), 410, 205); g.fillStyle = "#8b938f"; g.font = "500 26px 'JetBrains Mono', monospace"; g.fillText(this.look.x ? `@${this.look.x}` : "trenchers.io", 410, 260); g.strokeStyle = "#39ff88"; g.lineWidth = 6; g.strokeRect(3, 3, 794, 394); });
      const bill = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.2), new THREE.MeshBasicMaterial({ map: t })); (bill.material as unknown as { toneMapped: boolean }).toneMapped = false; const p = W(bx + 2.2, by + 0.16); bill.position.set(p.x, 3.4, p.z); S.add(bill);
      this.box(S, bx, by + 0.02, 2.28, 4.4, 0.12, 2.24, M.ink);
    }
  }
  private tree(x: number, y: number, s: number, big: boolean) {
    const g = new THREE.Group(), p = W(x, y); g.position.set(p.x, 0, p.z);
    const leaf = this.mats.get("leafA") ?? (() => { const m = new THREE.MeshStandardMaterial({ color: 0x1f3d2a, roughness: 0.8, flatShading: true }); this.mats.set("leafA", m); return m; })();
    const leaf2 = this.mats.get("leafB") ?? (() => { const m = new THREE.MeshStandardMaterial({ color: 0x2a5238, roughness: 0.8, flatShading: true }); this.mats.set("leafB", m); return m; })();
    const k = big ? 1.5 : 1;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * s * k, 0.11 * s * k, 0.9 * s * k, 7), this.std(0x3a2c22, 0.9)); trunk.position.y = 0.45 * s * k; trunk.castShadow = true; g.add(trunk);
    const crowns: [number, number, number, number, THREE.Material][] = big ? [[0, 1.3, 0, 0.75, leaf], [0.35, 1.75, 0.1, 0.5, leaf2], [-0.3, 1.65, -0.15, 0.48, leaf], [0.05, 2.1, -0.05, 0.36, leaf2]] : [[0, 1.05, 0, 0.55, leaf], [0.2, 1.45, 0.05, 0.38, leaf2]];
    for (const [cx, cy, cz, cr, m] of crowns) { const c = new THREE.Mesh(new THREE.IcosahedronGeometry(cr * s * (big ? 1.25 : 1), 1), m); c.position.set(cx * s * k, cy * s * (big ? 1.2 : 1), cz * s * k); c.castShadow = true; c.receiveShadow = true; g.add(c); }
    if (!big) { this.statics.add(g); this.nav.blockCircle({ x, y }, 0.15 * s); }
    return g;
  }
  /** Rooms you haven't built yet show as marked-out lots with what goes there. */
  private lots() {
    const S = this.statics, line = this.glow(0x6f7a74, 0.55);
    for (const [id, r] of Object.entries(ROOMS)) {
      if (this.has(id)) continue;
      const it = catItem(id); if (!it) continue;
      for (let x = r.x; x < r.x + r.w - 0.1; x += 0.5) { this.box(S, x, r.y, 0.005, 0.3, 0.04, 0.004, line, false); this.box(S, x, r.y + r.d - 0.04, 0.005, 0.3, 0.04, 0.004, line, false); }
      for (let y = r.y; y < r.y + r.d - 0.1; y += 0.5) { this.box(S, r.x, y, 0.005, 0.04, 0.3, 0.004, line, false); this.box(S, r.x + r.w - 0.04, y, 0.005, 0.04, 0.3, 0.004, line, false); }
      for (const [x, y] of [[r.x, r.y], [r.x + r.w - 0.08, r.y], [r.x, r.y + r.d - 0.08], [r.x + r.w - 0.08, r.y + r.d - 0.08]]) this.box(S, x, y, 0, 0.08, 0.08, 0.28, this.glow(NEON, 0.9), false);
      const t = this.canvasTex(512, 256, (g) => { g.textAlign = "center"; g.fillStyle = "rgba(220,228,224,0.85)"; let fs = 56; do { g.font = `600 ${fs}px 'Space Grotesk', sans-serif`; fs -= 4; } while (g.measureText(it.name.toUpperCase()).width > 470 && fs > 20); g.fillText(it.name.toUpperCase(), 256, 120); g.fillStyle = "rgba(57,255,136,0.85)"; g.font = "500 38px 'JetBrains Mono', monospace"; g.fillText(`LV ${it.level} · ${it.cost.toLocaleString("en-US")} BRICKS`, 256, 185); });
      const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }); (m as unknown as { toneMapped: boolean }).toneMapped = false;
      const sz = Math.min(r.w - 0.4, 3.4); const pl = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz / 2), m); pl.rotation.x = -Math.PI / 2; const p = W(r.x + r.w / 2, r.y + r.d / 2); pl.position.set(p.x, 0.01, p.z); S.add(pl);
    }
  }
  private gatherables() {
    // the tree
    this.treeG = new THREE.Group(); const p = W(TREE.x, TREE.y); this.treeG.position.set(p.x, 0, p.z); this.statics.add(this.treeG);
    const full = this.tree(0, 0, 1.25, true); full.position.set(0, 0, 0); full.name = "full"; this.treeG.add(full);
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.22, 12), this.M.white); stump.position.y = 0.11; stump.name = "stump"; this.treeG.add(stump);
    const ringT = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.12, 48), (this.treeRing = this.glow(NEON, 1.2, true))); ringT.rotation.x = -Math.PI / 2; ringT.position.y = 0.012; this.treeG.add(ringT);
    this.nav.blockCircle(TREE, 0.3);
    // the rock: a faceted stone with white edges
    this.rockG = new THREE.Group(); const q = W(ROCK.x, ROCK.y); this.rockG.position.set(q.x, 0, q.z); this.statics.add(this.rockG);
    const rock = new THREE.Group(); rock.name = "full"; this.rockG.add(rock);
    for (const [ox, oz, s, h] of [[0, 0, 0.62, 0.7], [0.5, 0.25, 0.36, 0.42], [-0.42, 0.3, 0.3, 0.32]] as [number, number, number, number][]) { const gm = new THREE.DodecahedronGeometry(s, 0); const m = new THREE.Mesh(gm, this.std(0x1c201e, 0.75, 0.15)); m.scale.set(1.1, h / s, 1); m.position.set(ox, h * 0.85, oz); m.rotation.set(ox * 2, oz * 3, 0.3); m.castShadow = true; rock.add(m); const e = new THREE.LineSegments(new THREE.EdgesGeometry(gm), new THREE.LineBasicMaterial({ color: 0xd9dcda, transparent: true, opacity: 0.6 })); e.scale.copy(m.scale); e.position.copy(m.position); e.rotation.copy(m.rotation); rock.add(e); }
    const vein = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), this.glow(CYAN, 1.8)); vein.position.set(0.05, 0.7, 0.5); vein.rotation.z = 0.5; rock.add(vein);
    const rubble = new THREE.Group(); rubble.name = "stump"; this.rockG.add(rubble);
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + (i % 3) * 0.04, 0), this.std(0x1c201e, 0.75, 0.15)); m.position.set(Math.cos(i * 1.3) * 0.35, 0.08, Math.sin(i * 1.3) * 0.3); rubble.add(m); }
    const ringR = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.12, 48), (this.rockRing = this.glow(CYAN, 1.2, true))); ringR.rotation.x = -Math.PI / 2; ringR.position.y = 0.012; this.rockG.add(ringR);
    this.nav.blockCircle(ROCK, 0.7);
  }
  private makePet(kind: string) {
    const g = new THREE.Group(), robo = kind === "robodog", cat = kind === "cat";
    const w = robo ? this.std(0xd9dcda, 0.25, 0.85) : cat ? this.std(0x1a1d1c, 0.6) : this.std(0xf1f3f2, 0.55), k = this.std(0x07090a, 0.4);
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, m: THREE.Material) => { const s = new THREE.Mesh(geo, m); s.position.set(x, y, z); s.castShadow = true; g.add(s); return s; };
    const sc = cat ? 0.75 : 1;
    const body = add(new THREE.SphereGeometry(0.16, 18, 12), 0, 0.3 * sc, 0, w); body.scale.set(1.7, 1, 1);
    const head = add(new THREE.SphereGeometry(0.12, 18, 12), 0.27 * sc, 0.42 * sc, 0, w);
    add(new THREE.SphereGeometry(0.035, 8, 6), 0.38 * sc, 0.42 * sc, 0, k);
    for (const z of [-0.06, 0.06]) { const e = add(new THREE.ConeGeometry(0.04, cat ? 0.1 : 0.08, 6), 0.25 * sc, 0.55 * sc, z, cat ? w : k); if (!cat) e.rotation.x = z > 0 ? 0.5 : -0.5; }
    if (robo) { const vis = add(new THREE.BoxGeometry(0.03, 0.04, 0.16), 0.38, 0.45, 0, this.glow(CYAN, 2)); vis.rotation.y = 0; }
    else for (const z of [-0.05, 0.05]) add(new THREE.SphereGeometry(0.018, 6, 4), 0.37 * sc, 0.46 * sc, z, robo ? this.glow(CYAN, 2) : k);
    const legs: THREE.Object3D[] = [];
    for (const [x, z] of [[-0.16, -0.08], [-0.16, 0.08], [0.16, -0.08], [0.16, 0.08]]) { const l = add(new THREE.CylinderGeometry(0.035, 0.03, 0.22 * sc, 8), x * sc, 0.11 * sc, z * sc, robo ? k : w); legs.push(l); }
    const tail = add(new THREE.CylinderGeometry(0.02, 0.012, cat ? 0.32 : 0.18, 6), -0.3 * sc, 0.42 * sc, 0, w); tail.rotation.z = cat ? 0.3 : 0.9; g.userData.tail = tail;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 16), this.glow(robo ? CYAN : NEON, 1.4)); collar.position.set(0.2 * sc, 0.38 * sc, 0); collar.rotation.y = Math.PI / 2; collar.rotation.x = 0.4; g.add(collar);
    g.userData.legs = legs; void head;
    return g;
  }
  private makeDrone() {
    const g = new THREE.Group(), M = this.M;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.22), M.ink); g.add(body);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), this.glow(NEON, 2)); eye.position.set(0, -0.04, 0.1); g.add(eye);
    for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.03), M.white); arm.position.set(x / 2, 0, z / 2); g.add(arm); const p = new THREE.Group(); p.position.set(x, 0.04, z); const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.005, 0.03), M.white); p.add(b); g.add(p); this.spinners.push({ o: p, axis: "y", rate: 40 }); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.006, 4, 20), this.glow(NEON, 1.2)); ring.rotation.x = Math.PI / 2; ring.position.copy(p.position); g.add(ring); }
    return g;
  }
  private placeCar(x: number, y: number, yaw: number) { if (!this.vehicle) return; const p = W(x, y); this.vehicle.position.set(p.x, this.vehicle.userData.hover ? 0.18 : 0, p.z); this.vehicle.rotation.y = yaw - Math.PI / 2; this.carYaw = yaw; }

  // ------------------------------------------------------------------ behaviour
  private door() { return { x: DOOR_X, y: HOUSE_Y + this.HS.d }; }
  private choose() {
    if (this.mode === "ride" || this.mode === "party") return;
    const night = this.night(), sp = this.spots;
    let pick: Spot | null = null;
    const opts: [Spot | "wander" | "ride" | "pet", number][] = [];
    for (const s of sp) opts.push([s, night ? (s.night ?? 0) + (s.act === "toilet" ? 0.4 : 0) + (s.act === "desk" ? 0.3 : 0) : s.w]);
    if (!night) { opts.push(["wander", 1.4], ["ride", 1.3]); if (this.pets.some((p) => p.kind !== "cat")) opts.push(["pet", 0.6]); }
    let k = Math.random() * opts.reduce((a, b) => a + b[1], 0), choice: Spot | string = "wander";
    for (const [o, n] of opts) { if ((k -= n) < 0) { choice = o; break; } }
    if (this.spot && choice === this.spot && Math.random() < 0.6) choice = "wander";
    if (choice === "ride") return this.startRide();
    if (choice === "wander") { const r = this.HR; const q = this.nav.nearestFree({ x: 3 + Math.random() * 20, y: r.y + r.d + 1.2 + Math.random() * (LAND - r.y - r.d - 4) }); pick = { act: "idle", at: q, pose: { x: q.x, y: q.y, z: 0, yaw: Math.random() * Math.PI * 2, kind: "stand" }, min: 3, max: 6, w: 0 }; }
    else if (choice === "pet") { const d = this.pets.find((p) => p.kind !== "cat")!; const q = this.nav.nearestFree({ x: d.w.x + 0.6, y: d.w.y }); pick = { act: "pet", at: q, pose: { x: q.x, y: q.y, z: 0, yaw: Math.atan2(d.w.x - q.x, d.w.y - q.y), kind: "stand" }, min: 4, max: 6, w: 0 }; d.wait = 7; }
    else pick = choice as Spot;
    this.walkTo(pick);
  }
  private walkTo(s: Spot, then?: () => void) {
    if (this.mode === "do" || this.mode === "enter") { this.pendingSpot = s; this.pendingThen = then ?? null; this.mode = "exit"; this.blend = 0; return; }
    this.onArrive = then ?? null; this.walkToNow(s);
  }
  say(text?: string) {
    const pool = LINES[this.spot?.act ?? "idle"] ?? LINES.idle; const s = text ?? pool[Math.floor(Math.random() * pool.length)];
    const b = this.pins.bubble; if (!b) return;
    b.textContent = s; b.classList.remove("on"); void b.offsetWidth; b.classList.add("on"); this.bubbleUntil = this.t + 3.4;
  }
  celebrate() {
    if (this.mode === "ride") return;
    this.mode = "party"; this.until = this.t + 5; this.say("LET'S GO!");
    const cols = [NEON, 0xffffff, CYAN, GOLD];
    for (let i = 0; i < 110; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.015), this.glow(cols[i % 4], 1.4)); const p = W(this.pose.x, this.pose.y); m.position.set(p.x, 1.0, p.z); this.dyn.add(m); this.confetti.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 3.6, 2 + Math.random() * 3, (Math.random() - 0.5) * 3.6), t: 2.4 }); }
  }
  poke() { if (this.spot?.pose.kind === "lie" && this.mode === "do") { this.say("zzz… five more minutes"); return; } this.say(); this.hop = 0.35; }
  click(nx: number, ny: number) {
    if (!this.trenchie) return;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    if (this.raycaster.intersectObject(this.trenchie, true).length) this.poke();
  }
  /** Walk over and chop the tree / mine the rock (the server has already paid out). */
  gather(res: Resource, got: number) {
    if (this.mode === "ride") this.endRide();
    const c = res === "wood" ? TREE : ROCK, side = res === "wood" ? { x: c.x + 0.95, y: c.y + 0.35 } : { x: c.x + 1.15, y: c.y + 0.45 };
    const yaw = Math.atan2(c.x - side.x, c.y - side.y);
    this.busy[res] = true;
    const s: Spot = { act: res === "wood" ? "chop" : "mine", at: side, pose: { x: side.x, y: side.y, z: 0, yaw, kind: res === "wood" ? "chop" : "mine" }, min: 3.2, max: 3.2, w: 0 };
    this.walkTo(s, () => {
      this.felling[res] = this.t; this.busy[res] = false;
      const pop = this.pins.pop; if (pop) { pop.textContent = `+${got} ${res}`; pop.classList.remove("on"); void pop.offsetWidth; pop.classList.add("on"); this.popUntil = this.t + 2.2; }
      this.onGathered?.(res);
    });
  }
  private loopPts(dir: number) {
    const a = ROAD, b = LAND - ROAD, rr = 1.4, pts: Pt[] = [];
    const corners = [{ x: b - rr, y: b - rr, a0: 0 }, { x: a + rr, y: b - rr, a0: Math.PI / 2 }, { x: a + rr, y: a + rr, a0: Math.PI }, { x: b - rr, y: a + rr, a0: (3 * Math.PI) / 2 }];
    for (const c of corners) for (let k = 0; k <= 8; k++) { const t = c.a0 + (k / 8) * (Math.PI / 2); pts.push({ x: c.x + Math.cos(t) * rr, y: c.y + Math.sin(t) * rr }); }
    return dir > 0 ? pts : pts.reverse();
  }
  private startRide() {
    if (!this.vehicle) return;
    const pk = this.park, side = { x: pk.x - 0.2, y: pk.y + 0.85 };
    const s: Spot = { act: "ride", at: side, pose: { x: side.x, y: side.y, z: 0, yaw: Math.PI, kind: "stand" }, min: 0.3, max: 0.3, w: 0 };
    this.walkTo(s, () => {
      // build the drive: out of the spot, onto the ring road, once round, then back into the spot in reverse
      const out = { x: pk.x + Math.sin(this.carYaw) * 2.2, y: pk.y + Math.cos(this.carYaw) * 2.2 };
      const J = pk.garage ? { x: LAND - ROAD, y: pk.y + 1.6 } : { x: pk.x + 3.2, y: LAND - ROAD };
      const heading = { x: J.x - out.x, y: J.y - out.y };
      let loop = this.loopPts(1); let ji = 0, best = 1e9; loop.forEach((p, i) => { const d = Math.hypot(p.x - J.x, p.y - J.y); if (d < best) { best = d; ji = i; } });
      const nxt = loop[(ji + 1) % loop.length], dot = (nxt.x - loop[ji].x) * heading.x + (nxt.y - loop[ji].y) * heading.y;
      if (dot < 0) { loop = this.loopPts(-1); ji = loop.length - 1 - ji; }
      const ring: Pt[] = []; for (let i = 1; i <= loop.length; i++) ring.push(loop[(ji + i) % loop.length]);
      const ext = loop[(ji + 2) % loop.length];
      const fwd = smooth([{ x: pk.x, y: pk.y }, out, J, ...ring, J, ext], 0.08);
      const back = smooth([ext, J, out, { x: pk.x, y: pk.y }], 0.06);
      this.rideBack = back; this.ridePhase = 0;
      this.car = new Walker(pk.x, pk.y, this.speed()); this.car.yaw = this.carYaw; this.car.go(fwd, this.speed());
      this.mode = "ride";
      if (Math.random() < 0.5) this.say();
    });
  }
  private speed() { return ({ bike: 2.4, moped: 3.2, hatch: 4.2, suv: 4.2, sports: 5.6, super: 6.6, hover: 6.2 } as Record<string, number>)[this.look.vehicle] ?? 3; }
  private endRide() { this.car = null; this.rideBack = null; this.placeCar(this.park.x, this.park.y, this.park.yaw); this.me.x = this.park.x - 0.2; this.me.y = this.park.y + 0.85; this.mode = "idle"; this.until = this.t + 1; this.spot = null; }

  update(dt: number) {
    this.t += dt; this.hop = Math.max(0, this.hop - dt * 1.4);
    if (this.intro < 1) { this.intro = Math.min(1, this.intro + dt / 2.2); this.camera.zoom = 0.5 + 0.5 * ease(this.intro); this.camera.updateProjectionMatrix(); }
    const s = this.spot;
    switch (this.mode) {
      case "walk": { const d = this.me.step(dt); this.step += d * 7.5; if (!this.me.path) { this.mode = "enter"; this.blend = 0; } break; }
      case "enter": this.blend = Math.min(1, this.blend + dt / 0.45); if (this.blend >= 1) { this.mode = "do"; this.until = this.t + (s ? s.min + Math.random() * (s.max - s.min) : 2); if (s && s.act !== "ride" && (Math.random() < 0.4 || s.act === "chop" || s.act === "mine")) this.say(); } break;
      case "do":
        if (this.t >= this.until) {
          const cb = this.onArrive; this.onArrive = null;
          if (cb) { cb(); if (this.mode !== "do") break; }
          if (s?.pose.kind === "lie" && this.night() && Math.random() < 0.85) { this.until = this.t + 30; break; }
          this.mode = "exit"; this.blend = 0;
        }
        break;
      case "exit": this.blend = Math.min(1, this.blend + dt / 0.35); if (this.blend >= 1) { if (s) { this.me.x = s.at.x; this.me.y = s.at.y; } this.me.yaw = this.pose.yaw; this.mode = "idle"; this.until = 0; if (this.pendingSpot) { const p = this.pendingSpot; this.onArrive = this.pendingThen; this.pendingSpot = null; this.pendingThen = null; this.walkToNow(p); } } break;
      case "ride": this.drive(dt); break;
      case "party": if (this.t > this.until) { this.mode = "idle"; this.until = 0; } break;
      case "idle": if (this.t >= this.until) this.choose(); break;
    }
    this.pets.forEach((p) => this.petStep(p, dt));
    this.sync(dt);
  }
  private pendingSpot: Spot | null = null; private pendingThen: (() => void) | null = null;
  private walkToNow(s: Spot) { this.me.go(this.nav.route({ x: this.me.x, y: this.me.y }, s.at), 1.45); this.spot = s; this.mode = "walk"; }
  private drive(dt: number) {
    const c = this.car; if (!c) { this.endRide(); return; }
    const d = c.step(dt, this.ridePhase === 1 ? 1.2 : 2.6, this.ridePhase === 1 ? 1.4 : 2.4);
    if (this.vehicle) { rollWheels(this.vehicle, this.ridePhase === 1 ? -d : d); this.placeCar(c.x, c.y, c.yaw); if (this.vehicle.userData.hover) this.vehicle.position.y = 0.18 + Math.sin(this.t * 3) * 0.04; }
    if (!c.path) {
      if (this.ridePhase === 0 && this.rideBack) { this.ridePhase = 1; c.go(this.rideBack, 1.3, true); }
      else { this.car = null; this.placeCar(this.park.x, this.park.y, this.park.yaw); this.me.x = this.park.x - 0.2; this.me.y = this.park.y + 0.85; this.me.yaw = Math.PI; this.pose.x = this.me.x; this.pose.y = this.me.y; this.mode = "idle"; this.until = this.t + 0.8; this.spot = null; }
    }
  }
  private petStep(p: World3D["pets"][number], dt: number) {
    p.wait -= dt;
    if (p.wait <= 0 && !p.w.path) {
      let target: Pt;
      if (p.kind === "cat") { const r = this.HR; target = Math.random() < 0.5 ? { x: this.pose.x + 0.5, y: this.pose.y + 0.4 } : { x: r.x + 0.8 + Math.random() * (r.w - 1.6), y: r.y + 1 + Math.random() * (r.d - 1.6) }; }
      else { const near = Math.random() < 0.7 && this.mode !== "ride"; target = near ? { x: this.pose.x + (Math.random() - 0.5) * 2.2, y: this.pose.y + 0.8 + Math.random() * 0.8 } : { x: 4 + Math.random() * 18, y: 11 + Math.random() * 11 }; }
      target.x = Math.max(2, Math.min(LAND - 2, target.x)); target.y = Math.max(2, Math.min(LAND - 2, target.y));
      if (Math.hypot(target.x - p.w.x, target.y - p.w.y) > 0.6) p.w.go(this.nav.route({ x: p.w.x, y: p.w.y }, target), p.kind === "cat" ? 0.7 : 1.7);
      p.wait = 2.5 + Math.random() * 5;
    }
    const d = p.w.step(dt, 3, 3);
    const pos = W(p.w.x, p.w.y); p.g.position.set(pos.x, Math.abs(Math.sin(this.t * 12)) * 0.02 * Math.min(1, p.w.v), pos.z); p.g.rotation.y = p.w.yaw - Math.PI / 2;
    const legs = p.g.userData.legs as THREE.Object3D[]; p.g.userData.ph = (p.g.userData.ph ?? 0) + d * 14; legs.forEach((l, i) => { l.rotation.z = Math.sin(p.g.userData.ph + (i % 2 ? Math.PI : 0)) * 0.5 * Math.min(1, p.w.v * 2); });
    (p.g.userData.tail as THREE.Object3D).rotation.y = Math.sin(this.t * (p.kind === "cat" ? 2 : 12)) * 0.5;
  }

  // ------------------------------------------------------------------ per-frame visuals
  private targetPose() {
    const s = this.spot, m = this.me, o = { x: m.x, y: m.y, z: 0, yaw: m.yaw, rx: 0, rz: 0, sy: 1 };
    if (this.mode === "walk") { const v = m.v; o.z = Math.abs(Math.sin(this.step)) * 0.035 * Math.min(1, v * 1.5); o.rz = Math.sin(this.step) * 0.06 * Math.min(1, v); o.rx = 0.07 * Math.min(1, v); return o; }
    if (!s || this.mode === "idle" || this.mode === "party") { o.sy = 1 + Math.sin(this.t * 2.2) * 0.015; if (this.mode === "party") { o.z = Math.abs(Math.sin(this.t * 9)) * 0.3; o.yaw = m.yaw + this.t * 4; } return o; }
    const P = s.pose, at = { x: s.at.x, y: s.at.y };
    const target = { x: P.x, y: P.y, z: P.z, yaw: P.yaw, rx: P.kind === "lie" ? -Math.PI / 2 : P.kind === "look" ? -0.22 : 0, rz: 0, sy: 1 };
    const k = this.mode === "enter" ? ease(this.blend) : this.mode === "exit" ? 1 - ease(this.blend) : 1;
    const r = { x: at.x + (target.x - at.x) * k, y: at.y + (target.y - at.y) * k, z: target.z * k, yaw: angLerp(m.yaw, target.yaw, Math.min(1, k * 1.4)), rx: target.rx * k, rz: 0, sy: 1 };
    if (this.mode === "do") {
      const t = this.t;
      if (P.kind === "sit" || P.kind === "stand" || P.kind === "look") r.sy = 1 + Math.sin(t * 2) * 0.015;
      if (P.kind === "lie") r.sy = 1 + Math.sin(t * 1.3) * 0.02;
      if (P.kind === "work") { r.z += Math.abs(Math.sin(t * 7)) * 0.012; r.rx = 0.12 + Math.sin(t * 3.1) * 0.04; r.yaw += Math.sin(t * 0.9) * 0.15; }
      if (P.kind === "lift") { const u = (Math.sin(t * 2.6) + 1) / 2; r.sy = 1 - u * 0.16; r.z = 0; }
      if (P.kind === "swim") { r.z = P.z + Math.sin(t * 2) * 0.03; r.yaw = P.yaw + Math.sin(t * 0.5) * 0.6; }
      if (P.kind === "dance") { r.z = Math.abs(Math.sin(t * 6)) * 0.18; r.yaw = P.yaw + Math.sin(t * 3) * 0.6; }
      if (P.kind === "chop" || P.kind === "mine") { const u = Math.sin(t * 6); r.rx = 0.18 + u * 0.18; r.z = Math.max(0, -u) * 0.02; }
    }
    return r;
  }
  private sync(dt: number) {
    const night = this.night(), tr = this.trenchie;
    // day / night
    const h = this.hour(), day = h < 5 ? 0 : h < 8 ? (h - 5) / 3 : h < 18 ? 1 : h < 21.5 ? 1 - (h - 18) / 3.5 : 0;
    this.key.intensity = 0.32 + 0.5 * day; this.hemi.intensity = 0.16 + 0.16 * day;
    (this.scene.background as THREE.Color).setRGB(0.012 + 0.02 * day, 0.026 + 0.03 * day, 0.02 + 0.025 * day); (this.scene.fog as THREE.Fog).color.copy(this.scene.background as THREE.Color);
    this.bloom.strength = 0.55 + 0.35 * (1 - day);
    for (const mm of this.nightMats) { const k = (mm.userData.k as number) ?? 1; mm.color.setRGB(night ? 1.8 : 0.62 + 0.5 * (1 - day), night ? 1.3 : 0.5 + 0.35 * (1 - day), night ? 0.62 : 0.32 + 0.1 * (1 - day)).multiplyScalar(k); }
    for (const pm of this.pools) pm.opacity = 0.18 + 0.5 * (1 - day);
    this.wilds.update(1 - day);
    // cut away the front walls and roof of the building your Trenchie is in (or all of them when zoomed right in)
    const zoomed = this.camera.zoom > 1.45;
    for (const c of this.cuts) {
      const inside = this.mode !== "ride" && this.pose.x > c.r.x - 0.3 && this.pose.x < c.r.x + c.r.w + 0.3 && this.pose.y > c.r.y - 0.3 && this.pose.y < c.r.y + c.r.d + 0.3;
      const goal = inside || zoomed ? 0 : 1; c.o += (goal - c.o) * Math.min(1, dt * 5);
      for (const m of c.mats) { m.opacity = ((m.userData.base as number) ?? 1) * c.o; m.depthWrite = c.o > 0.95; }
      for (const p of c.parts) p.visible = c.o > 0.02;
    }
    for (const l of this.lamps) l.intensity = night ? 1.3 : 0;
    for (const b of this.blinkers) { const on = Math.sin(this.t * b.rate + b.off) > -0.3; b.m.color.copy(b.c).multiplyScalar(on ? 1 : 0.15); }
    for (const s of this.spinners) s.o.rotation[s.axis] += dt * s.rate;
    for (const w of this.water) { const k = 0.8 + Math.sin(this.t * 1.5) * 0.08; w.color.setRGB(0.17 * k, 0.83 * k, 1 * k); }
    this.fish.forEach((f) => { const L = (f.m.userData as { len: number }).len ?? 1, u = ((this.t * 0.12 + f.off) % 2); const x = 0.12 + (u < 1 ? u : 2 - u) * (L - 0.24); f.m.position.set(x, f.base.y + Math.sin(this.t + f.off) * 0.03, f.base.z); f.m.rotation.y = u < 1 ? 0 : Math.PI; });
    if (this.t - this.lastScreen > 0.15) { this.lastScreen = this.t; this.drawScreens(); }
    // tree and rock: grown, felled, or growing back
    const now = Date.now();
    const frac = (res: Resource) => { const nx = this.grow[res]; if (!nx || nx <= now) return 1; return Math.max(0, 1 - (nx - now) / (GATHER[res].every * 1000)); };
    for (const [res, g, ring] of [["wood", this.treeG, this.treeRing], ["stone", this.rockG, this.rockRing]] as [Resource, THREE.Group, THREE.MeshBasicMaterial | null][]) {
      const full = g.getObjectByName("full")!, stump = g.getObjectByName("stump")!;
      const fell = this.felling[res], f = this.busy[res] ? 1 : frac(res);
      if (fell !== undefined && this.t - fell < 1.1 && res === "wood") { const k = ease((this.t - fell) / 1.1); full.visible = true; stump.visible = true; full.rotation.z = -k * Math.PI / 2.1; full.scale.setScalar(1 - k * 0.15); (full as THREE.Group).position.y = k * 0.1; continue; }
      if (fell !== undefined && this.t - fell < 0.6 && res === "stone") { const k = (this.t - fell) / 0.6; full.visible = true; stump.visible = true; full.scale.setScalar(1 - ease(k)); continue; }
      full.rotation.z = 0; full.position.y = 0;
      const ready = f >= 1;
      full.visible = f > 0.06; stump.visible = !ready; full.scale.setScalar(ready ? 1 + Math.sin(this.t * 2) * 0.006 : 0.25 + 0.75 * f);
      if (ring) { const k = ready ? 1.1 + Math.sin(this.t * 3) * 0.5 : 0.25; ring.color.set(res === "wood" ? NEON : CYAN).multiplyScalar(k); }
    }
    // the Trenchie
    if (tr) {
      const want = this.mode === "ride" ? this.pose : this.targetPose();
      const riding = this.mode === "ride" && this.car && this.vehicle;
      if (riding) {
        const seat = this.vehicle!.userData.seat as THREE.Vector3 | null;
        tr.visible = !!seat;
        if (seat) { const v = this.vehicle!; v.updateMatrixWorld(); const wp = seat.clone(); v.localToWorld(wp); tr.position.set(wp.x, wp.y - HT * 0.32, wp.z); tr.rotation.set(0, this.car!.yaw, 0, "YXZ"); }
        this.pose.x = this.car!.x; this.pose.y = this.car!.y;
      } else {
        tr.visible = true;
        const k = Math.min(1, dt * 14);
        this.pose.x += (want.x - this.pose.x) * k; this.pose.y += (want.y - this.pose.y) * k; this.pose.z += (want.z - this.pose.z) * k;
        this.pose.yaw = angLerp(this.pose.yaw, want.yaw, Math.min(1, dt * 10)); this.pose.rx += (want.rx - this.pose.rx) * k; this.pose.rz += (want.rz - this.pose.rz) * k; this.pose.sy += (want.sy - this.pose.sy) * k;
        const hopZ = this.hop > 0 ? Math.sin((1 - this.hop / 0.35) * Math.PI) * 0.3 : 0;
        const p = W(this.pose.x, this.pose.y); tr.position.set(p.x, this.pose.z + hopZ, p.z);
        tr.rotation.set(this.pose.rx, this.pose.yaw, this.pose.rz, "YXZ");
        const inner = tr.userData.inner as THREE.Group; inner.scale.y = (HT / 3.3) * this.pose.sy;
      }
      // tool in hand while gathering
      const kind = this.spot?.pose.kind, gathering = (kind === "chop" || kind === "mine") && (this.mode === "do" || this.mode === "enter");
      if (gathering && !this.tool) { this.tool = this.makeTool(kind!); tr.add(this.tool); }
      if (!gathering && this.tool) { tr.remove(this.tool); this.tool = null; }
      if (this.tool) { this.tool.rotation.x = -0.6 + Math.sin(this.t * 6) * 1.0; if (this.mode === "do" && Math.sin(this.t * 6) < -0.97 && Math.random() < 0.5) this.chip(kind === "chop"); }
    }
    this.chips = this.chips.filter((c) => { c.t -= dt; c.v.y -= 7 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += dt * 9; if (c.t <= 0 || c.m.position.y < 0.02) { this.dyn.remove(c.m); c.m.geometry.dispose(); return false; } return true; });
    // drone follows above
    if (this.drone && tr) { const tgt = new THREE.Vector3(tr.position.x - 0.5, 1.75 + Math.sin(this.t * 1.7) * 0.08, tr.position.z - 0.4); this.drone.position.lerp(tgt, Math.min(1, dt * 1.6)); this.drone.rotation.y += dt * 0.6; }
    // zzz while asleep
    const asleep = this.mode === "do" && this.spot?.pose.kind === "lie" && night;
    if (asleep && Math.random() < dt * 0.6) { const s = this.zSprite(); this.dyn.add(s); this.zs.push({ s, t: 0 }); }
    this.zs = this.zs.filter((z) => { z.t += dt; const p = W(this.pose.x + z.t * 0.3, this.pose.y - 0.4); z.s.position.set(p.x, 0.9 + z.t * 0.45, p.z); (z.s.material as THREE.SpriteMaterial).opacity = 1 - z.t / 2.6; if (z.t > 2.6) { this.dyn.remove(z.s); return false; } return true; });
    this.confetti = this.confetti.filter((c) => { c.t -= dt; c.v.y -= 6 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += dt * 8; c.m.rotation.z += dt * 6; if (c.t <= 0 || c.m.position.y < 0) { this.dyn.remove(c.m); c.m.geometry.dispose(); return false; } return true; });
    this.focus(false, dt);
  }
  private makeTool(kind: string) {
    const g = new THREE.Group(), M = this.M; g.position.set(0.33, 0.55, 0.12);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 8), this.std(0x2a2522, 0.8)); handle.position.y = 0.27; g.add(handle);
    if (kind === "chop") { const head = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.16), M.metal); head.position.set(0, 0.52, 0.07); g.add(head); }
    else { const head = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 6, 16, Math.PI), M.metal); head.position.set(0, 0.48, 0); head.rotation.y = Math.PI / 2; g.add(head); }
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, 0.02), this.glow(NEON, 1.6)); tip.position.set(0, 0.56, kind === "chop" ? 0.15 : 0.14); g.add(tip);
    return g;
  }
  private chip(wood: boolean) {
    const c = wood ? TREE : ROCK;
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), wood ? this.std(0xd9c7a8, 0.8) : this.glow(CYAN, 1.2)); const p = W(c.x + 0.45, c.y + 0.2); m.position.set(p.x, 0.5, p.z); this.dyn.add(m); this.chips.push({ m, v: new THREE.Vector3(0.5 + Math.random(), 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5), t: 1.2 }); }
  }
  private zSprite() {
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!; g.font = "600 44px 'Space Grotesk', sans-serif"; g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("z", 32, 34);
    const t = new THREE.CanvasTexture(c); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.scale.set(0.3, 0.3, 1); return s;
  }
  /** Keep the camera on the Trenchie (eased), and the shadow camera on the camera target. */
  private focus(snap: boolean, dt = 1) {
    const goal = W(this.pose.x || this.me.x, this.pose.y || this.me.y); goal.y = 0.6;
    goal.x = goal.x * 0.75; goal.z = goal.z * 0.75;
    const k = snap ? 1 : Math.min(1, dt * 1.6), t = this.controls.target, dx = (goal.x - t.x) * k, dy = (goal.y - t.y) * k, dz = (goal.z - t.z) * k;
    t.set(t.x + dx, t.y + dy, t.z + dz); this.camera.position.set(this.camera.position.x + dx, this.camera.position.y + dy, this.camera.position.z + dz);
    this.key.position.set(t.x + 10, 26, t.z + 6); this.key.target.position.copy(t);
  }
  /** Pins HTML onto 3D points: nameplate over the head, bubble above it, tags on the tree and rock. */
  private pinAll() {
    const tr = this.trenchie, P = this.pins, place = (el: HTMLElement | null | undefined, v: THREE.Vector3, show = true) => {
      if (!el) return; v.project(this.camera);
      const vis = show && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.transform = `translate3d(${((v.x + 1) / 2) * this.W}px, ${((1 - v.y) / 2) * this.H}px, 0)`; el.style.opacity = vis ? "" : "0";
    };
    if (tr) {
      const lying = this.mode === "do" && this.spot?.pose.kind === "lie";
      const inCar = this.mode === "ride" && !(this.vehicle?.userData.seat);
      const head = inCar && this.vehicle ? this.vehicle.position.clone().setY(1.5) : tr.position.clone().setY(tr.position.y + (lying ? 0.55 : HT * this.pose.sy + 0.12));
      place(P.plate, head.clone()); place(P.bubble, head.clone().setY(head.y + 0.05), this.t < this.bubbleUntil);
      if (P.bubble && this.t >= this.bubbleUntil) P.bubble.classList.remove("on");
      place(P.pop, head.clone().setY(head.y + 0.2), this.t < this.popUntil);
    }
    place(P.tree, W(TREE.x, TREE.y).setY(2.9)); place(P.rock, W(ROCK.x, ROCK.y).setY(1.5));
  }

  resize(w: number, h: number) {
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.bloom.setSize(w, h);
    const ppu = Math.max(34, Math.min(64, Math.max(w * 0.9, h * 0.55) / 19)); // pixels per world unit at zoom 1
    Object.assign(this.camera, { left: -w / 2 / ppu, right: w / 2 / ppu, top: h / 2 / ppu, bottom: -h / 2 / ppu });
    this.camera.updateProjectionMatrix();
  }
  render() { this.controls.update(); this.composer.render(); this.pinAll(); }
  dispose() { this.controls.dispose(); this.clear(this.statics); this.clear(this.dyn); this.renderer.dispose(); }
}
