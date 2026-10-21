/**
 * Trenchies world in 3D. A 44 x 44 land ringed by a road: the house along the back (rooms built on as wings, no
 * roofs so you see in), the forest down the left (chop the big oak), the quarry on the right (mine the boulder), the
 * pond with its dock in the middle (fish), and a garden that fills with everything you build. Butterflies by day,
 * moths and fireflies at night.
 *
 * Your Trenchie walks a navigation grid on smooth curved routes, uses what you own (desk, bed, swing, cinema, pool,
 * trampoline...), rides its vehicle round the road, and goes to its trading desk when you trade. Tap the ground to walk
 * it there, tap something to use it; after 30 seconds on its own it goes back to living its life. Its outfit is built on it. The
 * nameplate, speech bubble and the forest, quarry, pond and butterfly tags are HTML pinned to 3D points every frame.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass";
import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils";
import { artPalette, drawArt } from "@/lib/art-vector";
import { BUTTERFLIES, ITEMS, ROOM_SLOTS } from "@/lib/trenchies-catalog";
import { makeWilds, type Wilds } from "./wilds";
import { makeTrenchie } from "./trenchie3d";
import { makeVehicle, rollWheels } from "./vehicles";
import { Nav, along, lengths, smooth, type Pt, type R } from "./nav";
import { CYAN, GOLD, Kit, NEON, newRegistry, type Kind, type Registry, type Spot } from "./kit";
import { CHOP, DOCK, DOOR_X, FIXED, FOREST, GARDEN_FP, GARDEN_ROOMS, LAND, PARK, POND, ROAD, Packer, core } from "./layout";
import { buildHouse, drawLots, gardenBuilding, nextLots } from "./rooms";
import { GARDEN } from "./garden";
import type { Ctx } from "./indoor";
import { Butterflies, forest, ground, meadow, pond, stones, type Pond } from "./nature";
import { STATUES } from "./statues";
import { Weather, skyFor, type Sky } from "./weather";
import { FLYERS, WALKERS, animatePet, makePet, type Pet } from "./pets";
import { animateWear, dress } from "./wear";
import type { Grow, Look, Pins } from "./types";

export { LAND };
const HT = 0.95; // Trenchie height
const SWING = 1.7; // swing timing (rad/s), shared by the swings and whoever sits on them
const NET = { x: 15.6, y: 26.4 }; // where butterflies are chased when there's no butterfly garden

const LINES: Record<string, string[]> = {
  desk: ["checking the charts", "my picks look good", "volume first, then I buy", "is this the dip?", "one more chart", "gm to the trench"],
  office: ["four screens, four charts", "reading the order book", "deep work mode"],
  bed: ["zzz", "dreaming of green candles", "zzz… top 3…"], toilet: ["best ideas come here", "reading the whitepaper", "…"],
  shower: ["fresh for the next candle", "la la la"], couch: ["charts on the big screen", "five more minutes"], sofa: ["comfy", "five more minutes"], swim: ["pool day", "ahh"],
  gym: ["one more rep", "strong hands", "leg day"], shed: ["fixing the bike", "building something"], servers: ["the nodes are humming", "all green"],
  greenhouse: ["grow, little plant", "watering the gains"], observatory: ["looking for the moon", "is that a comet?"], helipad: ["waiting for my ride", "nice view up here"],
  ride: ["touching grass", "brb", "taking it for a spin"], idle: ["gm", "nice night in the trench", "need a bigger house", "what are you picking?", "wagmi", "my land is growing"],
  pet: ["good boy", "who's a good one"], dance: ["LET'S GO!", "top 3!", "XP!"], chop: ["timber!", "good wood"], mine: ["solid rock", "stone for the build"], fishing: ["something's biting", "patience…", "got one!"],
  bench: ["thinking about entries", "nice breeze"], hammock: ["nap time", "do not disturb"], firepit: ["warm glow", "campfire charts"], hoop: ["nothing but net", "swish"],
  hottub: ["bubbles and charts"], arcade: ["high score", "one more game"], piano: ["playing in green major"], aquarium: ["fish don't panic sell"], coffee: ["fuel"], fridge: ["snack break"], vinyl: ["lo-fi to trade to"], fountain: ["make a wish: 100x"], statue: ["looking good in stone"],
  swing: ["wheee", "higher!", "this is the life"], movie: ["popcorn time", "no spoilers", "best film ever"], trampoline: ["boing", "to the moon"], bugs: ["got you!", "so pretty", "one for the collection"], net: ["here, butterfly…", "almost!"],
  blanket: ["cloud watching", "that one looks like a candle"], tent: ["camping out"], cook: ["chef mode", "smells green"], read: ["reading the whitepaper", "one more chapter"], sauna: ["so warm", "detox"],
  mix: ["dropping a beat", "mixing the pump"], sing: ["la la la", "mic check"], movie2: ["shh"], treehouse: ["view from the top", "my fort"], vault: ["counting bricks"], stars: ["so many stars"], zen: ["breathe in…"],
};

const W = (x: number, y: number) => new THREE.Vector3(x - LAND / 2, 0, y - LAND / 2);
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const angLerp = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const inR = (p: Pt, r: R, pad = 0) => p.x > r.x - pad && p.x < r.x + r.w + pad && p.y > r.y - pad && p.y < r.y + r.d + pad;

/** Smooth path following with eased speed. */
class Walker {
  x: number; y: number; yaw = 0; v = 0; s = 0; path: Pt[] | null = null; L: number[] = []; vmax: number; back = false;
  constructor(x: number, y: number, vmax: number) { this.x = x; this.y = y; this.vmax = vmax; }
  go(p: Pt[], vmax = this.vmax, back = false) { this.path = p; this.L = lengths(p); this.s = 0; this.vmax = vmax; this.back = back; }
  get rem() { return this.path ? this.L[this.L.length - 1] - this.s : 0; }
  step(dt: number, acc = 2.0, dec = 1.8) {
    if (!this.path) { this.v = Math.max(0, this.v - acc * dt); return 0; }
    const want = Math.min(this.vmax, Math.sqrt(2 * dec * Math.max(0, this.rem)) + 0.05);
    this.v += Math.max(-dec * 2 * dt, Math.min(acc * dt, want - this.v));
    const ds = Math.min(this.rem, this.v * dt); this.s += ds;
    const a = along(this.path, this.L, this.s), ahead = along(this.path, this.L, this.s + 0.35);
    this.x = a.x; this.y = a.y;
    if (Math.hypot(ahead.x - a.x, ahead.y - a.y) > 0.02) { const target = Math.atan2(ahead.x - a.x, ahead.y - a.y) + (this.back ? Math.PI : 0); this.yaw = angLerp(this.yaw, target, 1 - Math.exp(-dt * 6)); }
    if (this.rem <= 0.002) { this.path = null; this.v = 0; }
    return ds;
  }
}

type PetRun = { p: Pet; w: Walker; wait: number; ph: number; perch: number; orbit: number };
type Mode = "idle" | "walk" | "move" | "enter" | "do" | "exit" | "ride" | "party";

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
  private reg: Registry = newRegistry();
  private kit: Kit;
  private wilds: Wilds;
  private pondO: Pond | null = null;
  private bugs: Butterflies | null = null;
  private trenchie: THREE.Group | null = null;
  private tool: THREE.Group | null = null;
  private vehicle: THREE.Group | null = null;
  private park = { x: PARK.x, y: PARK.y, yaw: Math.PI / 2, garage: false };
  private pets: PetRun[] = [];
  private guests = new Map<string, { tr: THREE.Group; w: Walker; wait: number; step: number; plate: HTMLElement; bubble: HTMLElement; until: number; yaw: number }>();
  private follow: string | null = null;
  private zs: { s: THREE.Sprite; t: number }[] = [];
  private confetti: { m: THREE.Mesh; v: THREE.Vector3; t: number }[] = [];
  private trail: { m: THREE.Mesh; t: number; v: THREE.Vector3 }[] = []; private trailAt = 0;
  private weather = new Weather(LAND);
  /** The last time you steered your Trenchie yourself (it goes back to living its life 30 s later). */
  private steered = -1e9;
  /** While a trading panel is open, the Trenchie sits at its desk. */
  private atDesk = false;
  /** Live Bitcoin prices for the desk screens. */
  private ticker: [number, number][] = [];
  /** Placing a garden piece: the next tap on the ground is reported here instead of walking. */
  onGround: ((x: number, y: number) => void) | null = null;
  /** Direct control (arrow keys, WASD or the joystick): -1..1, x to the right of the screen, y up the screen. */
  stick = { x: 0, y: 0 };
  /** Tapping the computer on the desk (opens the trading screen). */
  onDesk: (() => void) | null = null;  private look: Look; private nft: number; private t = 0; private lastScreen = 0;
  private grow: Grow = { wood: 0, stone: 0, fish: 0 };
  private busy: Partial<Record<"net", boolean>> = {};
  private pins: Pins = {};
  private me: Walker;
  private mode: Mode = "idle";
  private spot: Spot | null = null; private until = 2; private blend = 0; private hop = 0; private gait = 0; private enterDur = 0.45;
  private onArrive: (() => void) | null = null;
  private pendingSpot: Spot | null = null; private pendingThen: (() => void) | null = null;
  private car: Walker | null = null; private ridePhase = 0; private rideBack: Pt[] | null = null; private carYaw = 0;
  private pose = { x: 0, y: 0, z: 0, yaw: 0, rx: 0, rz: 0, sy: 1 };
  private bubbleUntil = 0; private popUntil = 0;
  private raycaster = new THREE.Raycaster();
  private intro = 0;
  private W = 1; private H = 1;
  private netAt: Pt = NET;
  private door: Pt = { x: DOOR_X, y: 9 };
  hourOverride: number | null = null;

  constructor(private canvas: HTMLCanvasElement, look: Look, nft: number, opts: { lite?: boolean } = {}) {
    this.look = look; this.nft = nft;
    const lite = !!opts.lite;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, powerPreference: "high-performance" }));
    r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.setPixelRatio(Math.min(lite ? 1.5 : 2, window.devicePixelRatio || 1));
    this.scene.background = new THREE.Color(0x07100c);
    this.scene.fog = new THREE.Fog(0x07100c, 46, 120);
    this.wilds = makeWilds(LAND / 2); this.scene.add(this.wilds.group);
    this.camera.position.set(30, 28, 30); this.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, { enablePan: false, enableDamping: true, dampingFactor: 0.08, minZoom: 0.36, maxZoom: 3, minPolarAngle: 0.5, maxPolarAngle: 1.15, minAzimuthAngle: Math.PI / 4 - 0.75, maxAzimuthAngle: Math.PI / 4 + 0.75, rotateSpeed: 0.5, zoomSpeed: 0.8 });
    this.key.position.set(10, 26, 6); this.key.castShadow = true; this.key.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
    Object.assign(this.key.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 90 }); this.key.shadow.bias = -0.0006;
    this.scene.add(this.key, this.key.target, this.hemi, new THREE.AmbientLight(0xffffff, 0.12));
    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(lite ? 256 : 512, lite ? 256 : 512), lite ? 0.45 : 0.6, 0.4, 0.86);
    this.composer.addPass(this.bloom);
    this.scene.add(this.statics, this.dyn, this.weather.group);
    this.kit = new Kit(LAND, this.statics, this.nav, this.reg);
    this.sky();
    const c = core(look.house); this.me = new Walker(DOOR_X, c.y + c.d + 1.4, 1.25);
    this.build();
    this.camera.zoom = 0.5; this.camera.updateProjectionMatrix();
    this.focus(true);
  }

  // ------------------------------------------------------------------ helpers
  private has(id: string) { return this.look.items.includes(id); }
  hour() { if (this.hourOverride !== null) return this.hourOverride; const d = new Date(); return d.getHours() + d.getMinutes() / 60; }
  private night() { const h = this.hour(); return h >= 22.5 || h < 6.5; }
  private get M() { return this.kit.M; }
  private sky() {
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, r = 55 + Math.random() * 60; pos[3 * i] = Math.cos(a) * r; pos[3 * i + 1] = -12 + Math.random() * 60; pos[3 * i + 2] = Math.sin(a) * r; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, transparent: true, opacity: 0.5 })));
  }
  setLook(l: Look, nft: number) {
    const skin = nft !== this.nft || l.palette.main !== this.look.palette.main || l.palette.bg !== this.look.palette.bg;
    const wear = JSON.stringify(l.wear ?? {}) !== JSON.stringify(this.look.wear ?? {});
    const rebuild = skin || l.house !== this.look.house || l.vehicle !== this.look.vehicle || l.items.join() !== this.look.items.join() || l.name !== this.look.name || l.level !== this.look.level;
    this.look = l; this.nft = nft;
    if (skin && this.trenchie) { this.dyn.remove(this.trenchie); this.trenchie = null; }
    if (rebuild) { this.build(); if (this.mode !== "ride" && this.mode !== "party") { this.mode = "idle"; this.spot = null; this.choose(); } }
    else if (wear && this.trenchie) dress(this.trenchie, l.wear);
  }
  setGrow(g: Grow & { net?: number }) { this.grow = g; }
  attach(p: Pins) { this.pins = p; }
  private clear(g: THREE.Group) {
    const cached = new Set(this.kit.mats.values());
    g.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mm = m.material as THREE.Material | THREE.Material[] | undefined; const drop = (x: THREE.Material) => { if (cached.has(x)) return; (x as THREE.MeshBasicMaterial).map?.dispose(); x.dispose(); }; if (Array.isArray(mm)) mm.forEach(drop); else if (mm) drop(mm); });
    g.clear();
  }

  // ------------------------------------------------------------------ building the land
  private build() {
    this.clear(this.statics);
    this.reg = newRegistry(); this.kit.reg = this.reg; this.nav.reset();
    const k = this.kit, look = this.look;
    const ctx: Ctx = { has: (id) => this.has(id), nft: this.nft, trophies: look.trophies ?? 1, art: (g, s) => drawArt(g, this.nft, s), mainColor: look.palette.main };
    ground(k, this.reg.pools);
    const house = buildHouse(k, ctx, look.house, look.items, look.layout ?? {}, look.paint ?? {}); this.door = house.door;
    let park: { x: number; y: number; yaw: number } | undefined;
    for (const id of Object.keys(GARDEN_ROOMS)) if (this.has(id)) { const o = gardenBuilding(k, ctx, id); if (o.park) park = o.park; }
    drawLots(k, nextLots(house.rooms, look.items, look.layout ?? {}, look.level ?? 1));
    // paths: front door to the road, and out to the forest, the pond and the quarry
    const fy = house.door.y - 0.3, junction = 21.2;
    stones(k, { x: DOOR_X, y: fy + 0.2 }, { x: DOOR_X, y: LAND - ROAD - 0.75 });
    stones(k, { x: CHOP.sx + 0.6, y: junction }, { x: DOOR_X - 0.6, y: junction });
    stones(k, { x: DOOR_X + 0.6, y: DOCK.y }, { x: DOCK.x0 - 0.2, y: DOCK.y });
    stones(k, { x: DOOR_X + 0.6, y: 22.7 }, { x: 36.4, y: 22.7 });
    // the drive (or the garage)
    this.park = park ? { ...park, garage: true } : { x: PARK.x, y: PARK.y, yaw: Math.PI / 2, garage: false };
    if (!park) k.box(PARK.x - 1.6, PARK.y - 0.75, -0.01, 4.4, 1.5, 0.02, k.std(0x1c2024, 0.9, 0.1), false).castShadow = false;
    // the forest, the quarry, the pond
    const keepOut: R[] = [{ x: CHOP.x - 1.2, y: CHOP.y - 1.2, w: 2.4, d: 2.4 }];
    if (this.has("treehouse")) { const t = GARDEN_ROOMS.treehouse; keepOut.push({ x: t.x - 0.6, y: t.y - 0.6, w: t.w + 1.2, d: t.d + 2.2 }, { x: t.x + t.w / 2 - 0.6, y: t.y + t.d, w: FOREST.x + FOREST.w - (t.x + t.w / 2) + 0.6, d: 1.2 }); }
    if (this.has("swing")) { const s = FIXED.swing; keepOut.push({ x: s.x - 1.6, y: s.y - 0.8, w: s.w + 2.2, d: s.d + 1.6 }); }
    forest(k, keepOut); this.pondO = pond(k);
    // the garden
    this.netAt = NET;
    this.outdoor(house.door, keepOut);
    meadow(k, { x: 12.4, y: 12.2, w: 30, d: 30 }, this.gardenBlocks(house.door), 520);
    const homes: Pt[] = [NET, { x: 19, y: 18 }, { x: 28, y: 36 }, { x: 34, y: 25 }, { x: 14, y: 39 }, { x: 25, y: 27 }, { x: 37, y: 33 }, { x: 13, y: 16 }];
    this.bugs = new Butterflies(k, homes, BUTTERFLIES.filter((b) => !b.night && b.rarity !== "legendary" && b.rarity !== "epic").map((b) => b.color));
    // the parked ride, pets, the Trenchie
    if (this.vehicle) { this.dyn.remove(this.vehicle); this.clear(this.vehicle); }
    this.vehicle = makeVehicle(this.look.vehicle); this.vehicle.traverse((o) => { o.castShadow = true; }); this.dyn.add(this.vehicle);
    if (this.mode !== "ride") this.placeCar(this.park.x, this.park.y, this.park.yaw);
    this.nav.block({ x: this.park.x - 1.25, y: this.park.y - 0.55, w: 2.5, d: 1.1 }, 0.1);
    for (const p of this.pets) { this.dyn.remove(p.p.g); this.clear(p.p.g); } this.pets = [];
    for (const kind of [...WALKERS, ...FLYERS]) if (this.has(kind)) {
      const p = makePet(kind); this.dyn.add(p.g);
      const st = { x: DOOR_X + 1.5 + Math.random() * 2, y: house.door.y + 1.5 + Math.random() * 2 };
      this.pets.push({ p, w: new Walker(st.x, st.y, p.speed), wait: 1 + Math.random() * 3, ph: Math.random() * 6, perch: 0, orbit: Math.random() * 6 });
    }
    if (!this.trenchie) { this.trenchie = makeTrenchie(this.nft, this.look.palette, HT); this.dyn.add(this.trenchie); this.tool = null; }
    dress(this.trenchie, this.look.wear);
    this.merge();
  }
  /** Areas the garden packer must leave alone (so the plan stays stable as you build more). */
  private gardenBlocks(door: Pt): R[] {
    const out: R[] = [
      ...Object.values(ROOM_SLOTS).map((r) => ({ x: r.x - 0.3, y: r.y - 0.3, w: r.w + 0.6, d: r.d + 0.6 })), { ...core("palace"), y: core("palace").y - 0.3, d: core("palace").d + 0.9 },
      ...Object.values(GARDEN_ROOMS).map((r) => ({ x: r.x - 0.4, y: r.y - 0.4, w: r.w + 0.8, d: r.d + 1.2 })),
      { x: FOREST.x, y: FOREST.y, w: FOREST.w + 0.4, d: FOREST.d },
      { x: POND.x - POND.rx - 0.7, y: POND.y - POND.ry - 0.7, w: POND.rx * 2 + 1.4, d: POND.ry * 2 + 1.4 }, { x: DOCK.x0 - 1.4, y: DOCK.y - 0.9, w: DOCK.x1 - DOCK.x0 + 1.4, d: 1.8 },
      { x: DOOR_X - 0.9, y: door.y - 1, w: 1.8, d: LAND - door.y }, { x: CHOP.sx, y: 20.3, w: DOOR_X - CHOP.sx, d: 1.8 }, { x: DOOR_X, y: 22.1, w: 36.4 - DOOR_X + 0.6, d: 1.2 }, { x: DOOR_X, y: DOCK.y - 0.6, w: DOCK.x0 - DOOR_X, d: 1.2 },
      { x: PARK.x - 2, y: PARK.y - 1.1, w: 5.4, d: 2.6 }, { x: NET.x - 1.2, y: NET.y - 1.2, w: 2.4, d: 2.4 },
      ...Object.values(FIXED).map((r) => ({ x: r.x - 0.3, y: r.y - 0.3, w: r.w + 0.6, d: r.d + 0.6 })),
    ];
    return out;
  }
  private outdoor(door: Pt, keepOut: R[]) {
    const k = this.kit, M = this.M, ctx: Ctx = { has: (id) => this.has(id), nft: this.nft, trophies: this.look.trophies ?? 1, art: (g, s) => drawArt(g, this.nft, s), mainColor: this.look.palette.main };
    void keepOut;
    // pieces with a place of their own
    for (const [id, r] of Object.entries(FIXED)) if (this.has(id) && GARDEN[id]) { const f = k.frame(r, "back"); GARDEN[id].build(f, k, ctx); if (!["letters", "billboard", "bridge"].includes(id)) k.nav.block({ x: r.x + 0.1, y: r.y + 0.1, w: r.w - 0.2, d: r.d - 0.2 }, 0.1); }
    if (this.has("statue")) this.statue(FIXED.statue);
    // the rest packed into the garden, nearest the house first
    const P = new Packer({ x: 12.6, y: 12.4, w: 29.8, d: 29.6 });
    for (const b of this.gardenBlocks(door)) P.block(b, 0.2);
    const owned = ITEMS.filter((it) => (it.kind === "outdoor" || it.kind === "statue") && this.has(it.id) && !FIXED[it.id]).sort((a, b) => a.level - b.level || a.cost - b.cost);
    const near = { x: DOOR_X + 4, y: door.y + 6 }, place = this.look.place ?? {};
    // pieces you placed yourself go first, where you put them (if they still fit there)
    owned.sort((a, b) => Number(!!place[b.id]) - Number(!!place[a.id]));
    const spotFor = (id: string, w: number, d: number) => { const at = place[id]; const r = at ? P.at({ x: at.x - w / 2, y: at.y - d / 2, w, d }, 0.3) : null; return r ?? P.place(w, d, id.startsWith("s_") ? { x: 33, y: 30 } : near, 0.7); };
    for (const it of owned) {
      if (it.kind === "statue") { const def = STATUES[it.id]; if (!def) continue; const r = spotFor(it.id, def.fp[0], def.fp[1]); if (!r) continue; def.build(k.frame(r, "back"), k, ctx); k.nav.block({ x: r.x + 0.1, y: r.y + 0.1, w: r.w - 0.2, d: r.d - 0.2 }, 0.1); continue; }
      if (it.id === "trees") { for (let i = 0; i < 5; i++) { const r = P.place(1.4, 1.4, { x: 16 + i * 5, y: 38 - (i % 2) * 14 }, 0.6); if (r) { const f = k.frame(r, "back"); f.c(0.7, 0.7, 0, 0.08, 1.0, M.darkwood, 7, 0.06); f.put(new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), k.flat(0x2a6a3a)), 0.7, 0.7, 1.2); f.put(new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), k.flat(0x3c8a45)), 0.92, 0.75, 1.62); k.nav.blockCircle({ x: r.x + 0.7, y: r.y + 0.7 }, 0.12); } } continue; }
      const def = GARDEN[it.id], fp = GARDEN_FP[it.id]; if (!def || !fp) continue;
      const r = spotFor(it.id, fp[0], fp[1]); if (!r) continue;
      const f = k.frame(r, "back"); def.build(f, k, ctx);
      if (!["flowers", "blanket", "zen", "minigolf", "tennis", "sandbox", "pumpkins", "veggies"].includes(it.id)) k.nav.block({ x: r.x + 0.15, y: r.y + 0.15, w: r.w - 0.3, d: r.d - 0.3 }, 0.08);
      if (it.id === "flowers") this.netAt = { x: r.x + fp[0] / 2, y: r.y + fp[1] + 0.9 };
    }
    // things along the path and the edge of the land
    if (this.has("mailbox")) {
      const mx = DOOR_X - 1.4, my = LAND - ROAD - 1.3; k.box(mx + 0.12, my + 0.12, 0, 0.06, 0.06, 0.75, M.white); k.box(mx, my, 0.75, 0.3, 0.45, 0.26, M.ink); k.box(mx + 0.29, my + 0.05, 0.8, 0.02, 0.06, 0.18, k.glow(0xff5470, 1.6), false);
      const t = k.tex(256, 64, (g) => { g.fillStyle = "#eef1ef"; g.fillRect(0, 0, 256, 64); g.font = "600 30px 'Space Grotesk', sans-serif"; g.fillStyle = "#0b0d0c"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(this.look.name.slice(0, 14), 128, 34); });
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.105), new THREE.MeshBasicMaterial({ map: t })); const p = W(mx + 0.15, my + 0.455); pl.position.set(p.x, 0.88, p.z); this.statics.add(pl);
      k.nav.block({ x: mx, y: my, w: 0.3, d: 0.45 });
    }
    if (this.has("lights")) for (let y = door.y + 1.4; y < LAND - ROAD - 1; y += 2.2) for (const x of [DOOR_X - 0.75, DOOR_X + 0.69]) { k.box(x, y, 0, 0.06, 0.06, 0.45, M.ink); k.box(x - 0.03, y - 0.03, 0.45, 0.12, 0.12, 0.08, k.night(0xfff2d6, 0.5), false); }
    if (this.has("garden")) for (const x of [DOOR_X - 1.85, DOOR_X + 0.95]) {
      const y0 = door.y + 0.9; k.box(x, y0, 0, 0.9, 3.4, 0.22, M.ink); k.nav.block({ x, y: y0, w: 0.9, d: 3.4 });
      for (let i = 0; i < 7; i++) { const c = [0xffffff, NEON, 0xff7ab8, 0xffd84d][i % 4]; k.cyl(x + 0.25 + (i % 2) * 0.4, y0 + 0.25 + i * 0.45, 0.22, 0.012, 0.18, M.leaf, 6); const fl = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), k.glow(c, c === 0xffffff ? 0.9 : 1.2)); const q = W(x + 0.25 + (i % 2) * 0.4, y0 + 0.25 + i * 0.45); fl.position.set(q.x, 0.45, q.z); this.statics.add(fl); }
    }
    if (this.has("fence")) {
      const ie = ROAD + 0.72, gap = (a: number, b: number, c: number) => a > b - c && a < b + c, post = (x: number, y: number) => k.box(x - 0.05, y - 0.05, 0, 0.1, 0.1, 0.55, M.white);
      const front = (x: number) => !gap(x, DOOR_X, 1.0) && !(!this.park.garage && gap(x, this.park.x + 3.2, 1.4));
      const right = (y: number) => !(this.park.garage && gap(y, this.park.y + 1.2, 1.8));
      for (let x = ie; x <= LAND - ie + 0.01; x += 1.0) {
        if (front(x)) { post(x, LAND - ie); if (x + 1 <= LAND - ie + 0.01 && front(x + 0.5)) { k.box(x, LAND - ie - 0.02, 0.38, 1.0, 0.04, 0.05, M.white); k.box(x, LAND - ie - 0.02, 0.18, 1.0, 0.04, 0.05, M.white); } }
        post(x, ie); if (x + 1 <= LAND - ie + 0.01) k.box(x, ie - 0.02, 0.38, 1.0, 0.04, 0.05, M.white);
      }
      for (let y = ie; y <= LAND - ie + 0.01; y += 1.0) { post(ie, y); if (y + 1 <= LAND - ie + 0.01) k.box(ie - 0.02, y, 0.38, 0.04, 1.0, 0.05, M.white); if (right(y)) { post(LAND - ie, y); if (y + 1 <= LAND - ie + 0.01 && right(y + 0.5)) k.box(LAND - ie - 0.02, y, 0.38, 0.04, 1.0, 0.05, M.white); } }
    }
  }
  private statue(r: R) {
    const k = this.kit, cx = r.x + r.w / 2, cy = r.y + r.d / 2;
    k.box(cx - 0.6, cy - 0.6, 0, 1.2, 1.2, 0.6, this.M.white); k.box(cx - 0.62, cy - 0.62, 0.6, 1.24, 1.24, 0.04, k.glow(NEON, 1.2), false);
    const st = makeTrenchie(this.nft, this.look.palette, 1.9); st.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.material && (m.material as THREE.Material).type === "MeshToonMaterial") m.material = k.std(0xd7dad8, 0.45, 0.1); });
    const p = W(cx, cy); st.position.set(p.x, 0.64, p.z); st.rotation.y = Math.PI / 4; this.statics.add(k.keep(st));
    k.nav.block({ x: cx - 0.6, y: cy - 0.6, w: 1.2, d: 1.2 });
    this.reg.spots.push({ act: "statue", at: { x: cx, y: cy + 1.3 }, pose: { x: cx, y: cy + 1.3, z: 0, yaw: Math.PI, kind: "look" }, min: 4, max: 7, w: 0.5 });
  }
  /** Bakes everything that never moves into one mesh per material (a land with 100+ things stays fast). */
  private merge() {
    const keep = new Set<THREE.Object3D>();
    for (const o of [...this.reg.anim, ...this.reg.spinners.map((s) => s.o), ...this.reg.bobbers.map((b) => b.o)]) o.traverse((x) => keep.add(x));
    this.statics.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.statics.matrixWorld).invert();
    const groups = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean }>();
    const drop: THREE.Mesh[] = [];
    this.statics.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || keep.has(m) || (m as unknown as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const a of Object.keys(g.attributes)) if (a !== "position" && a !== "normal" && a !== "uv") g.deleteAttribute(a);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.clearGroups(); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      const mat = m.material as THREE.Material, key = `${mat.uuid}:${m.castShadow ? 1 : 0}`;
      let e = groups.get(key); if (!e) { e = { mat, geos: [], cast: m.castShadow }; groups.set(key, e); }
      e.geos.push(g); drop.push(m);
    });
    for (const m of drop) { m.parent?.remove(m); m.geometry.dispose(); }
    for (const { mat, geos, cast } of groups.values()) {
      const merged = BufferGeometryUtils.mergeBufferGeometries(geos, false); geos.forEach((g) => g.dispose()); if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat); mesh.castShadow = cast; mesh.receiveShadow = true; this.statics.add(mesh);
    }
    // empty groups left behind
    const empty: THREE.Object3D[] = []; this.statics.traverse((o) => { if (o !== this.statics && o.type === "Group" && o.children.length === 0) empty.push(o); }); empty.forEach((o) => o.parent?.remove(o));
  }
  private placeCar(x: number, y: number, yaw: number) { if (!this.vehicle) return; const p = W(x, y); this.vehicle.position.set(p.x, this.vehicle.userData.hover ? 0.18 : 0, p.z); this.vehicle.rotation.y = yaw - Math.PI / 2; this.carYaw = yaw; }

  // ------------------------------------------------------------------ behaviour
  private deskSpot() { return this.reg.spots.find((x) => x.act === "office") ?? this.reg.spots.find((x) => x.act === "desk") ?? null; }
  private bedSpot() { return this.reg.spots.find((x) => x.act === "bed") ?? null; }
  private get steering() { return this.t - this.steered < 30; }
  private choose() {
    if (this.mode === "ride" || this.mode === "party") return;
    // you're steering it: it waits for you (for 30 s after your last tap)
    if (this.steering) { this.until = this.t + 1; return; }
    // trading: off to the desk
    if (this.atDesk) { const d = this.deskSpot(); if (d) { if (this.spot !== d || this.mode === "idle") this.walkTo(d); return; } }
    const night = this.night(), office = this.has("office");
    // at night it goes to bed and stays there
    if (night) { const b = this.bedSpot(); if (b) { this.walkTo(b); return; } }
    const opts: [Spot | "wander" | "ride" | "pet" | "bugs", number][] = [];
    for (const s of this.reg.spots) { let w = night ? (s.night ?? 0) + (s.act === "toilet" ? 0.4 : 0) : s.w; if (s.tag === "desk" && s.act === "desk" && office) w *= 0.5; opts.push([s, w]); }
    if (!night) { opts.push(["wander", 1.2], ["ride", 1.2], ["bugs", 0.7]); if (this.pets.some((p) => !p.p.fly && p.p.kind !== "cat")) opts.push(["pet", 0.6]); }
    let k = Math.random() * opts.reduce((a, b) => a + b[1], 0), choice: Spot | string = "wander";
    for (const [o, n] of opts) { if ((k -= n) < 0) { choice = o; break; } }
    if (this.spot && choice === this.spot && Math.random() < 0.7) choice = "wander";
    if (choice === "ride") return this.startRide();
    let pick: Spot;
    if (choice === "wander") { const q = this.nav.nearestFree({ x: 13 + Math.random() * 27, y: 13 + Math.random() * 27 }); pick = { act: "idle", at: q, pose: { x: q.x, y: q.y, z: 0, yaw: Math.random() * Math.PI * 2, kind: "stand" }, min: 3, max: 6, w: 0 }; }
    else if (choice === "bugs") { const q = this.nav.nearestFree(this.netAt); pick = { act: "net", at: q, pose: { x: q.x, y: q.y, z: 0, yaw: Math.random() * Math.PI * 2, kind: "net" }, min: 5, max: 7, w: 0 }; }
    else if (choice === "pet") { const d = this.pets.find((p) => !p.p.fly && p.p.kind !== "cat")!; const q = this.nav.nearestFree({ x: d.w.x + 0.6, y: d.w.y }); pick = { act: "pet", at: q, pose: { x: q.x, y: q.y, z: 0, yaw: Math.atan2(d.w.x - q.x, d.w.y - q.y), kind: "stand" }, min: 4, max: 6, w: 0 }; d.wait = 7; }
    else pick = choice as Spot;
    this.walkTo(pick);
  }
  private walkTo(s: Spot, then?: () => void) {
    if (this.mode === "do" || this.mode === "enter") { this.pendingSpot = s; this.pendingThen = then ?? null; this.mode = "exit"; this.blend = 0; return; }
    this.onArrive = then ?? null; this.walkToNow(s);
  }
  private walkToNow(s: Spot) {
    // long way: a light jog; short way: a walk (the speed eases in and out either way)
    const route = this.nav.route({ x: this.me.x, y: this.me.y }, s.at), far = lengths(route).at(-1) ?? 0;
    this.me.go(route, far > 9 ? 2.3 : far > 4 ? 1.8 : 1.4); this.spot = s; this.mode = "walk";
  }
  say(text?: string) {
    const pool = LINES[this.spot?.act ?? "idle"] ?? LINES.idle; const s = text ?? pool[Math.floor(Math.random() * pool.length)];
    const b = this.pins.bubble; if (!b) return;
    b.textContent = s; b.classList.remove("on"); void b.offsetWidth; b.classList.add("on"); this.bubbleUntil = this.t + 3.4;
  }
  private popText(text: string) { const pop = this.pins.pop; if (pop) { pop.textContent = text; pop.classList.remove("on"); void pop.offsetWidth; pop.classList.add("on"); this.popUntil = this.t + 2.2; } }
  celebrate() {
    if (this.mode === "ride") return;
    this.mode = "party"; this.until = this.t + 5; this.say("LET'S GO!");
    const cols = [NEON, 0xffffff, CYAN, GOLD];
    for (let i = 0; i < 110; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.015), this.kit.glow(cols[i % 4], 1.4)); const p = W(this.pose.x, this.pose.y); m.position.set(p.x, 1.0, p.z); this.dyn.add(m); this.confetti.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 3.6, 2 + Math.random() * 3, (Math.random() - 0.5) * 3.6), t: 2.4 }); }
  }
  /** A trading panel opened (or closed): the Trenchie goes and sits at its desk while it's open. */
  setDesk(on: boolean) {
    if (on === this.atDesk) return; this.atDesk = on;
    if (on) { this.steered = -1e9; const d = this.deskSpot(); if (d && this.mode !== "ride") { if (this.mode === "party") this.mode = "idle"; this.walkTo(d); } }
    else if (this.mode === "do") { this.mode = "exit"; this.blend = 0; }
  }
  /** Live Bitcoin prices ([seconds, price]) for the screens on the desk. */
  setTicker(series: [number, number][]) { this.ticker = series.slice(-300); }
  /** The sky over this land right now. */
  get weatherNow(): Sky { return skyFor(this.look.name); }
  poke() { if (this.spot?.pose.kind === "lie" && this.mode === "do") { this.say("zzz… five more minutes"); return; } this.say(); this.hop = 0.35; }
  /** A tap on the land: your Trenchie (says hi), something to use (it goes and uses it), or the ground (it walks there). */
  click(nx: number, ny: number) {
    if (!this.trenchie) return;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    if (!this.onGround && this.raycaster.intersectObject(this.trenchie, true).length) { this.poke(); return; }
    const hit = new THREE.Vector3(); if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return;
    // tapped something standing up (a computer, a bed, a statue): use the point on that thing, not the ground behind it
    let onThing = false;
    if (!this.onGround) { const h = this.raycaster.intersectObject(this.statics, true)[0]; if (h && h.point.y > 0.05) { hit.set(h.point.x, 0, h.point.z); onThing = true; } }
    const x = hit.x + LAND / 2, y = hit.z + LAND / 2; if (x < 0.5 || y < 0.5 || x > LAND - 0.5 || y > LAND - 0.5) return;
    if (this.onGround) { this.onGround(x, y); return; }
    if (this.mode === "ride") return;
    this.steered = this.t; this.atDesk = false;
    // a spot close to the tap: use it; otherwise just walk there
    let best: Spot | null = null, bd = onThing ? 1.7 : 1.3;
    for (const sp of this.reg.spots) { const d = Math.min(Math.hypot(sp.pose.x - x, sp.pose.y - y), Math.hypot(sp.at.x - x, sp.at.y - y)); if (d < bd) { bd = d; best = sp; } }
    // the computer: open the trading screen (the Trenchie sits down there)
    if (best && best.tag === "desk" && this.onDesk) { this.onDesk(); return; }
    const target: Spot = best ?? (() => { const q = this.nav.nearestFree({ x, y }); return { act: "idle", at: q, pose: { x: q.x, y: q.y, z: 0, yaw: this.me.yaw, kind: "stand" as Kind }, min: 30, max: 30, w: 0 }; })();
    this.marker(best ? best.pose.x : x, best ? best.pose.y : y);
    this.walkTo(target);
  }
  private markerM: THREE.Mesh | null = null; private markerT = -9;
  private marker(x: number, y: number) {
    if (!this.markerM) { this.markerM = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(NEON).multiplyScalar(1.6), transparent: true, depthWrite: false })); this.markerM.rotation.x = -Math.PI / 2; (this.markerM.material as unknown as { toneMapped: boolean }).toneMapped = false; this.dyn.add(this.markerM); }
    const p = W(x, y); this.markerM.position.set(p.x, 0.03, p.z); this.markerT = this.t;
  }
  /** Walk to the flowers and swing the net (the server has already decided what was caught). */
  net(got: string[]) {
    if (this.mode === "ride") this.endRide();
    this.busy.net = true;
    const q = this.nav.nearestFree(this.netAt);
    const s: Spot = { act: "bugs", at: q, pose: { x: q.x, y: q.y, z: 0, yaw: Math.PI * 0.75, kind: "net" }, min: 3.4, max: 3.4, w: 0 };
    this.walkTo(s, () => {
      this.busy.net = false;
      const names = got.map((id) => BUTTERFLIES.find((b) => b.id === id)?.name ?? id);
      this.popText(names.length ? `+ ${names.join(" + ")}` : "missed!");
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
      const out = { x: pk.x + Math.sin(this.carYaw) * 2.2, y: pk.y + Math.cos(this.carYaw) * 2.2 };
      const J = pk.garage ? { x: LAND - ROAD, y: pk.y + 1.2 } : { x: pk.x + 3.4, y: LAND - ROAD };
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
  private speed() { return ({ bike: 2.4, moped: 3.2, golfcart: 2.6, hatch: 4.2, quad: 3.6, motorbike: 4.8, suv: 4.2, pickup: 4.0, sports: 5.6, limo: 4.6, super: 6.6, monster: 4.2, hover: 6.2 } as Record<string, number>)[this.look.vehicle] ?? 3; }
  private endRide() { this.car = null; this.rideBack = null; this.placeCar(this.park.x, this.park.y, this.park.yaw); this.me.x = this.park.x - 0.2; this.me.y = this.park.y + 0.85; this.pose.x = this.me.x; this.pose.y = this.me.y; this.mode = "idle"; this.until = this.t + 1; this.spot = null; }

  update(dt: number) {
    this.t += dt; this.hop = Math.max(0, this.hop - dt * 1.4);
    if (this.intro < 1) { this.intro = Math.min(1, this.intro + dt / 2.2); this.camera.zoom = 0.5 + 0.45 * ease(this.intro); this.camera.updateProjectionMatrix(); }
    // direct control: walk where the keys or the joystick point, sliding along walls
    const st = this.stick, mag = Math.min(1, Math.hypot(st.x, st.y));
    if (mag > 0.12 && this.trenchie && this.mode !== "ride" && this.mode !== "party") {
      this.steered = this.t;
      if (this.mode === "do" || this.mode === "enter") { this.pendingSpot = null; this.pendingThen = null; this.onArrive = null; this.mode = "exit"; this.blend = 0.4; }
      else if (this.mode !== "exit") this.steerStep(dt, st, mag);
    } else if (this.mode === "move") {
      const m = this.me; m.v = Math.max(0, m.v - dt * 7);
      if (m.v < 0.05) { m.v = 0; this.mode = "idle"; this.until = this.t + 1; } else this.steerStep(dt, this.lastDir, 0, true);
    }
    const s = this.spot;
    switch (this.mode) {
      case "move": break;
      case "walk": { const d = this.me.step(dt); this.gait += d * (Math.PI / 0.36); if (!this.me.path) { this.mode = "enter"; this.blend = 0; this.enterDur = s ? Math.max(0.45, Math.hypot(s.pose.x - s.at.x, s.pose.y - s.at.y) / 1.1) : 0.45; } break; }
      case "enter": this.blend = Math.min(1, this.blend + dt / this.enterDur); if (s && this.enterDur > 0.6) this.gait += dt * 1.1 * (Math.PI / 0.36); if (this.blend >= 1) { this.mode = "do"; this.until = this.t + (s ? s.min + Math.random() * (s.max - s.min) : 2); if (s && s.act !== "ride" && (Math.random() < 0.4 || s.act === "chop" || s.act === "mine")) this.say(); } break;
      case "do":
        if (this.t >= this.until) {
          const cb = this.onArrive; this.onArrive = null;
          if (cb) { cb(); if (this.mode !== "do") break; }
          if (s?.act === "bed" && this.night() && !this.steering && !this.atDesk) { this.until = this.t + 30; break; }
          if (this.atDesk && s === this.deskSpot()) { this.until = this.t + 5; break; }
          this.mode = "exit"; this.blend = 0;
        }
        break;
      case "exit": this.blend = Math.min(1, this.blend + dt / Math.max(0.35, this.enterDur * 0.8)); if (this.blend >= 1) { if (s) { this.me.x = s.at.x; this.me.y = s.at.y; } this.me.yaw = this.pose.yaw; this.mode = "idle"; this.until = 0; if (this.pendingSpot) { const p = this.pendingSpot; this.onArrive = this.pendingThen; this.pendingSpot = null; this.pendingThen = null; this.walkToNow(p); } } break;
      case "ride": this.drive(dt); break;
      case "party": if (this.t > this.until) { this.mode = "idle"; this.until = 0; } break;
      case "idle": if (this.t >= this.until) this.choose(); break;
    }
    this.pets.forEach((p) => this.petStep(p, dt));
    this.guestStep(dt);
    this.sync(dt);
  }
  private lastDir = { x: 0, y: 0 };
  private steerStep(dt: number, st: { x: number; y: number }, mag: number, coast = false) {
    const cam = this.camera; cam.updateMatrixWorld();
    const r = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).setY(0).normalize(), u = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).setY(0).normalize();
    let dx = r.x * st.x + u.x * st.y, dy = r.z * st.x + u.z * st.y; const n = Math.hypot(dx, dy); if (n < 1e-4) return; dx /= n; dy /= n;
    if (!coast) this.lastDir = { x: st.x, y: st.y };
    const m = this.me; m.path = null; this.spot = null; this.mode = "move";
    if (!coast) { const want = 2.3 * mag; m.v += Math.max(-6 * dt, Math.min(4 * dt, want - m.v)); }
    const go = m.v * dt, here = this.nav.free({ x: m.x, y: m.y });
    let nx = m.x + dx * go, ny = m.y + dy * go;
    if (here && !this.nav.free({ x: nx, y: ny })) {
      if (this.nav.free({ x: nx, y: m.y })) ny = m.y; else if (this.nav.free({ x: m.x, y: ny })) nx = m.x; else { nx = m.x; ny = m.y; m.v *= 0.5; }
    }
    nx = Math.max(0.6, Math.min(LAND - 0.6, nx)); ny = Math.max(0.6, Math.min(LAND - 0.6, ny));
    this.gait += Math.hypot(nx - m.x, ny - m.y) * (Math.PI / 0.36); m.x = nx; m.y = ny;
    m.yaw = angLerp(m.yaw, Math.atan2(dx, dy), 1 - Math.exp(-dt * 12));
  }
  private drive(dt: number) {
    const c = this.car; if (!c) { this.endRide(); return; }
    const d = c.step(dt, this.ridePhase === 1 ? 1.2 : 2.6, this.ridePhase === 1 ? 1.4 : 2.4);
    if (this.vehicle) { rollWheels(this.vehicle, this.ridePhase === 1 ? -d : d); this.placeCar(c.x, c.y, c.yaw); if (this.vehicle.userData.hover) this.vehicle.position.y = 0.18 + Math.sin(this.t * 3) * 0.04; }
    if (!c.path) {
      if (this.ridePhase === 0 && this.rideBack) { this.ridePhase = 1; c.go(this.rideBack, 1.3, true); }
      else { this.endRide(); this.me.yaw = Math.PI; this.until = this.t + 0.8; }
    }
  }
  private petStep(r: PetRun, dt: number) {
    const p = r.p; r.wait -= dt;
    const tr = this.trenchie ? { x: this.pose.x, y: this.pose.y } : { x: this.me.x, y: this.me.y };
    if (p.fly) {
      // flyers: circle above, the parrot perches on your Trenchie's head now and then, the owl naps in the forest by day
      r.orbit += dt * (p.kind === "dragon" ? 0.7 : 0.9);
      const night = this.night(), owlNap = p.kind === "owl" && !night;
      if (r.wait <= 0) { r.perch = p.kind === "parrot" && Math.random() < 0.45 ? 1 : 0; r.wait = 6 + Math.random() * 8; }
      let tgt: THREE.Vector3;
      if (owlNap) tgt = W(FOREST.x + FOREST.w - 1.2, 17.2).setY(2.55);
      else if (r.perch && this.trenchie && this.mode !== "ride") tgt = W(tr.x, tr.y).setY(this.trenchie.position.y + HT * this.pose.sy + 0.02);
      else { const rad = p.kind === "drone" ? 0.6 : 1.4; tgt = W(tr.x + Math.cos(r.orbit) * rad, tr.y + Math.sin(r.orbit) * rad).setY((p.kind === "drone" ? 1.75 : p.kind === "owl" ? 2.3 : 1.9) + Math.sin(this.t * 1.7 + r.ph) * 0.12); }
      const before = p.g.position.clone(); p.g.position.lerp(tgt, 1 - Math.exp(-dt * (r.perch ? 6 : 1.8)));
      const v = p.g.position.clone().sub(before); const sp = v.length() / Math.max(dt, 1e-3);
      if (sp > 0.05) p.g.rotation.y = Math.atan2(v.x, v.z) - Math.PI / 2;
      animatePet(p, this.t, r.ph, owlNap || r.perch ? 0 : Math.min(1, sp));
      if (p.kind === "drone") p.g.rotation.y += dt * 0.6;
      return;
    }
    if (r.wait <= 0 && !r.w.path) {
      let target: Pt;
      const roam = () => ({ x: 13 + Math.random() * 27, y: 13 + Math.random() * 27 });
      if (p.kind === "cat") { const c = core(this.look.house); target = Math.random() < 0.5 ? { x: tr.x + 0.5, y: tr.y + 0.4 } : { x: c.x + 0.8 + Math.random() * (c.w - 1.6), y: c.y + 1 + Math.random() * (c.d - 1.6) }; }
      else if (p.kind === "turtle") target = { x: POND.x + (Math.random() - 0.5) * 9, y: POND.y + POND.ry + 0.8 + Math.random() * 1.2 };
      else if (p.kind === "penguin") target = this.has("pool") && Math.random() < 0.5 ? { x: FIXED.pool.x + Math.random() * FIXED.pool.w, y: FIXED.pool.y + FIXED.pool.d + 0.6 } : { x: DOCK.x0 - 1 + Math.random(), y: DOCK.y + 1.2 + Math.random() };
      else if (p.kind === "bunny") target = Math.random() < 0.6 ? { x: this.netAt.x + (Math.random() - 0.5) * 4, y: this.netAt.y + (Math.random() - 0.5) * 3 } : roam();
      else { const near = Math.random() < 0.7 && this.mode !== "ride"; target = near ? { x: tr.x + (Math.random() - 0.5) * 2.2, y: tr.y + 0.8 + Math.random() * 0.8 } : roam(); }
      target.x = Math.max(2.4, Math.min(LAND - 2.4, target.x)); target.y = Math.max(2.4, Math.min(LAND - 2.4, target.y));
      if (Math.hypot(target.x - r.w.x, target.y - r.w.y) > 0.6) r.w.go(this.nav.route({ x: r.w.x, y: r.w.y }, target), p.speed);
      r.wait = (p.kind === "turtle" ? 6 : 2.5) + Math.random() * 5;
    }
    const d = r.w.step(dt, 3, 3);
    r.ph += d * (p.hop ? 9 : 14);
    const pos = W(r.w.x, r.w.y), move = Math.min(1, r.w.v * 2);
    const lift = p.hop ? Math.abs(Math.sin(r.ph)) * 0.16 * move : Math.abs(Math.sin(r.ph)) * 0.015 * move;
    p.g.position.set(pos.x, lift, pos.z); p.g.rotation.y = r.w.yaw - Math.PI / 2;
    animatePet(p, this.t, r.ph, move);
  }

  // ------------------------------------------------------------------ per-frame visuals
  private targetPose() {
    const s = this.spot, m = this.me, o = { x: m.x, y: m.y, z: 0, yaw: m.yaw, rx: 0, rz: 0, sy: 1 };
    const gaitPose = (v: number, k = 1) => { const ph = this.gait, mv = Math.min(1, v * 1.3) * k; o.z = Math.pow(Math.sin(ph), 2) * 0.04 * mv; o.rz = Math.sin(ph) * 0.05 * mv; o.rx = 0.06 * mv; o.sy = 1 - Math.cos(ph * 2) * 0.012 * mv; };
    if (this.mode === "walk" || this.mode === "move") { gaitPose(m.v); return o; }
    if (!s || this.mode === "idle" || this.mode === "party") { o.sy = 1 + Math.sin(this.t * 2.2) * 0.015; if (this.mode === "party") { o.z = Math.abs(Math.sin(this.t * 9)) * 0.3; o.yaw = m.yaw + this.t * 4; } return o; }
    const P = s.pose, at = { x: s.at.x, y: s.at.y };
    const target = { x: P.x, y: P.y, z: P.z, yaw: P.yaw, rx: P.kind === "lie" ? -Math.PI / 2 : P.kind === "look" ? -0.22 : 0, rz: 0, sy: 1 };
    const k = this.mode === "enter" ? ease(this.blend) : this.mode === "exit" ? 1 - ease(this.blend) : 1;
    const walkIn = this.enterDur > 0.6 && (this.mode === "enter" || this.mode === "exit");
    const headYaw = walkIn && k < 0.85 ? Math.atan2(P.x - at.x, P.y - at.y) + (this.mode === "exit" ? Math.PI : 0) : target.yaw;
    const r = { x: at.x + (target.x - at.x) * k, y: at.y + (target.y - at.y) * k, z: target.z * ease(walkIn ? Math.max(0, (k - 0.7) / 0.3) : k), yaw: walkIn ? headYaw : angLerp(m.yaw, target.yaw, Math.min(1, k * 1.4)), rx: target.rx * k, rz: 0, sy: 1 };
    if (walkIn && k < 0.9) { const ph = this.gait; r.z += Math.pow(Math.sin(ph), 2) * 0.04; r.rz = Math.sin(ph) * 0.05; }
    if (this.mode === "do") {
      const t = this.t;
      if (P.kind === "sit" || P.kind === "stand" || P.kind === "look") r.sy = 1 + Math.sin(t * 2) * 0.015;
      if (P.kind === "lie") r.sy = 1 + Math.sin(t * 1.3) * 0.02;
      if (P.kind === "work") { r.z += Math.abs(Math.sin(t * 7)) * 0.012; r.rx = 0.12 + Math.sin(t * 3.1) * 0.04; r.yaw += Math.sin(t * 0.9) * 0.15; }
      if (P.kind === "lift") { const u = (Math.sin(t * 2.6) + 1) / 2; r.sy = 1 - u * 0.16; r.z = 0; }
      if (P.kind === "swim") { r.z = P.z + Math.sin(t * 2) * 0.03; r.yaw = P.yaw + Math.sin(t * 0.5) * 0.6; }
      if (P.kind === "dance") { r.z = Math.abs(Math.sin(t * 6)) * 0.18; r.yaw = P.yaw + Math.sin(t * 3) * 0.6; }
      if (P.kind === "fish") { r.sy = 1 + Math.sin(t * 2) * 0.012; r.rx = -0.05; }
      if (P.kind === "chop" || P.kind === "mine") { const u = Math.sin(t * 6); r.rx = 0.18 + u * 0.18; r.z = Math.max(0, -u) * 0.02; }
      if (P.kind === "bounce") { const u = Math.abs(Math.sin(t * 3.6)); r.z = P.z + u * 0.75; r.sy = u < 0.15 ? 0.88 : 1; r.rx = Math.sin(t * 1.8) * 0.15; }
      if (P.kind === "net") { const u = Math.sin(t * 4.2); r.yaw = P.yaw + Math.sin(t * 1.3) * 1.1; r.rx = 0.1 + u * 0.12; r.z = Math.max(0, Math.sin(t * 2.6)) * 0.08; }
      if (P.kind === "swing" && s.swing) {
        const th = Math.sin(t * SWING + s.swing.off) * s.swing.amp, L = s.swing.L, fx = Math.sin(P.yaw), fy = Math.cos(P.yaw);
        r.x = P.x - fx * L * Math.sin(th); r.y = P.y - fy * L * Math.sin(th); r.z = P.z + L - L * Math.cos(th); r.rx = -th;
      }
    } else if (P.kind === "swing" && s.swing && this.mode === "enter") { const th = Math.sin(this.t * SWING + s.swing.off) * s.swing.amp, L = s.swing.L; r.x -= Math.sin(P.yaw) * L * Math.sin(th) * k; r.y -= Math.cos(P.yaw) * L * Math.sin(th) * k; }
    return r;
  }
  private sync(dt: number) {
    const night = this.night(), tr = this.trenchie;
    const h = this.hour(), day = h < 5 ? 0 : h < 8 ? (h - 5) / 3 : h < 18 ? 1 : h < 21.5 ? 1 - (h - 18) / 3.5 : 0;
    this.weather.update(dt, this.controls.target, this.weatherNow);
    const gloom = this.weather.gloom, dawn = h >= 5 && h < 8 ? 1 - Math.abs(h - 6.5) / 1.5 : h >= 18 && h < 21.5 ? 1 - Math.abs(h - 19.5) / 2 : 0;
    this.key.intensity = (0.32 + 0.55 * day) * (1 - gloom * 0.6); this.hemi.intensity = (0.16 + 0.18 * day) * (1 - gloom * 0.3);
    this.key.color.setRGB(1, 1 - dawn * 0.25, 1 - dawn * 0.45);
    const bg = this.scene.background as THREE.Color;
    bg.setRGB(0.012 + 0.03 * day + dawn * 0.05, 0.026 + 0.04 * day + dawn * 0.02, 0.02 + 0.05 * day); bg.lerp(new THREE.Color(0.05, 0.055, 0.06), gloom * 0.5); (this.scene.fog as THREE.Fog).color.copy(bg);
    this.bloom.strength = 0.55 + 0.35 * (1 - day);
    if (this.markerM) { const a = Math.max(0, 1 - (this.t - this.markerT) / 1.2); (this.markerM.material as THREE.MeshBasicMaterial).opacity = a; this.markerM.scale.setScalar(1 + (1 - a) * 0.8); this.markerM.visible = a > 0; }
    for (const mm of this.reg.nightMats) { const k = (mm.userData.k as number) ?? 1; mm.color.setRGB(night ? 1.8 : 0.62 + 0.5 * (1 - day), night ? 1.3 : 0.5 + 0.35 * (1 - day), night ? 0.62 : 0.32 + 0.1 * (1 - day)).multiplyScalar(k); }
    for (const pm of this.reg.pools) pm.opacity = 0.18 + 0.5 * (1 - day);
    this.wilds.update(1 - day);
    for (const l of this.reg.lamps) l.intensity = night ? 1.3 : 0;
    for (const b of this.reg.blinkers) { const on = Math.sin(this.t * b.rate + b.off) > -0.3; b.m.color.copy(b.c).multiplyScalar(on ? 1 : 0.15); }
    for (const s of this.reg.spinners) { if (s.swing) s.o.rotation[s.axis] = Math.sin(this.t * SWING + (s.off ?? 0)) * s.swing; else s.o.rotation[s.axis] += dt * s.rate; }
    for (const b of this.reg.bobbers) b.o.position.y = b.base + Math.sin(this.t * b.rate + b.off) * b.amp;
    for (const w of this.reg.water) { const k = 0.8 + Math.sin(this.t * 1.5) * 0.08; w.color.setRGB(0.17 * k, 0.83 * k, 1 * k); }
    if (this.t - this.lastScreen > 0.15) { this.lastScreen = this.t; this.drawScreens(); }
    this.bugs?.update(dt, this.t, 1 - day);
    if (this.pondO) for (const f of this.pondO.fish) { f.a += f.v * dt; f.m.position.set(Math.cos(f.a) * f.r * 1.4, 0.09 + Math.sin(this.t * 2 + f.r) * 0.01, Math.sin(f.a) * f.r * 0.8); f.m.rotation.y = -f.a - (f.v > 0 ? 0 : Math.PI); }
    // the Trenchie
    if (tr) {
      const riding = this.mode === "ride" && this.car && this.vehicle;
      if (riding) {
        const seat = this.vehicle!.userData.seat as THREE.Vector3 | null;
        tr.visible = !!seat;
        if (seat) { const v = this.vehicle!; v.updateMatrixWorld(); const wp = seat.clone(); v.localToWorld(wp); tr.position.set(wp.x, wp.y - HT * 0.32, wp.z); tr.rotation.set(0, this.car!.yaw, 0, "YXZ"); }
        this.pose.x = this.car!.x; this.pose.y = this.car!.y; this.pose.yaw = this.car!.yaw;
      } else {
        tr.visible = true;
        const want = this.targetPose();
        if (this.mode === "walk" || this.mode === "move") {
          // walking: follow the path exactly (no lag), turn smoothly, sway with each step
          this.pose.x = want.x; this.pose.y = want.y; this.pose.z = want.z; this.pose.rx = want.rx; this.pose.rz = want.rz; this.pose.sy = want.sy;
          this.pose.yaw = angLerp(this.pose.yaw, want.yaw, 1 - Math.exp(-dt * 10));
        } else {
          const k = 1 - Math.exp(-dt * 12);
          this.pose.x += (want.x - this.pose.x) * k; this.pose.y += (want.y - this.pose.y) * k; this.pose.z += (want.z - this.pose.z) * k;
          this.pose.yaw = angLerp(this.pose.yaw, want.yaw, 1 - Math.exp(-dt * 9)); this.pose.rx += (want.rx - this.pose.rx) * k; this.pose.rz += (want.rz - this.pose.rz) * k; this.pose.sy += (want.sy - this.pose.sy) * k;
        }
        const hopZ = this.hop > 0 ? Math.sin((1 - this.hop / 0.35) * Math.PI) * 0.3 : 0;
        const p = W(this.pose.x, this.pose.y); tr.position.set(p.x, this.pose.z + hopZ, p.z);
        tr.rotation.set(this.pose.rx, this.pose.yaw, this.pose.rz, "YXZ");
        const inner = tr.userData.inner as THREE.Group; inner.scale.y = (HT / 3.3) * this.pose.sy;
      }
      animateWear(tr, this.t, this.mode === "walk" || this.mode === "move" ? Math.min(1, this.me.v) : 0);
      // tools: axe, pickaxe, rod, net
      const kind = this.spot?.pose.kind, gathering = kind === "net" && (this.mode === "do" || this.mode === "enter");
      if (gathering && (!this.tool || this.tool.userData.kind !== kind)) { if (this.tool) tr.remove(this.tool); this.tool = this.makeTool(kind!); tr.add(this.tool); }
      if (!gathering && this.tool) { tr.remove(this.tool); this.tool = null; }
      if (this.tool && kind === "net") { this.tool.rotation.x = -0.4 + Math.sin(this.t * 4.2) * 0.9; this.tool.rotation.z = Math.sin(this.t * 2.1) * 0.4; }
      if (kind === "net" && this.mode === "do" && this.bugs && Math.random() < dt * 0.8) this.bugs.catchAt(W(this.pose.x, this.pose.y).setY(1.0), 1);
      this.trailStep(dt);
    }
    const asleep = this.mode === "do" && this.spot?.pose.kind === "lie" && night;
    if (asleep && Math.random() < dt * 0.6) { const s = this.zSprite(); this.dyn.add(s); this.zs.push({ s, t: 0 }); }
    this.zs = this.zs.filter((z) => { z.t += dt; const p = W(this.pose.x + z.t * 0.3, this.pose.y - 0.4); z.s.position.set(p.x, 0.9 + this.pose.z + z.t * 0.45, p.z); (z.s.material as THREE.SpriteMaterial).opacity = 1 - z.t / 2.6; if (z.t > 2.6) { this.dyn.remove(z.s); return false; } return true; });
    this.confetti = this.confetti.filter((c) => { c.t -= dt; c.v.y -= 6 * dt; c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += dt * 8; c.m.rotation.z += dt * 6; if (c.t <= 0 || c.m.position.y < 0) { this.dyn.remove(c.m); c.m.geometry.dispose(); return false; } return true; });
    this.focus(false, dt);
  }
  private drawScreens() {
    for (const s of this.reg.screens) {
      const { ctx } = s, W2 = ctx.canvas.width, H2 = ctx.canvas.height;
      if (s.kind === 3) { // a film: sky, hills, a sun going down, and a little figure walking
        const t = this.t * 0.25 + s.off, hue = (t * 20) % 360;
        const sky = ctx.createLinearGradient(0, 0, 0, H2); sky.addColorStop(0, `hsl(${hue} 70% 35%)`); sky.addColorStop(1, `hsl(${(hue + 40) % 360} 80% 60%)`); ctx.fillStyle = sky; ctx.fillRect(0, 0, W2, H2);
        ctx.fillStyle = "rgba(255,230,160,0.9)"; ctx.beginPath(); ctx.arc(W2 * 0.7, H2 * (0.35 + Math.sin(t) * 0.1), H2 * 0.14, 0, Math.PI * 2); ctx.fill();
        for (let l = 0; l < 3; l++) { ctx.fillStyle = `rgba(10,${30 + l * 20},${25 + l * 10},${0.6 + l * 0.15})`; ctx.beginPath(); ctx.moveTo(0, H2); for (let x = 0; x <= W2; x += 8) ctx.lineTo(x, H2 * (0.62 + l * 0.1) - Math.sin(x * 0.02 + t * (l + 1) * 0.6 + l) * 14); ctx.lineTo(W2, H2); ctx.fill(); }
        const fx = ((t * 40) % (W2 + 40)) - 20; ctx.fillStyle = "#39ff88"; ctx.beginPath(); ctx.arc(fx, H2 * 0.78 - Math.abs(Math.sin(t * 8)) * 6, 7, 0, Math.PI * 2); ctx.fill();
        s.tex.needsUpdate = true; continue;
      }
      ctx.fillStyle = "#03100a"; ctx.fillRect(0, 0, W2, H2);
      if (s.kind === 2) { // ticker
        ctx.font = `600 ${Math.floor(H2 * 0.62)}px 'JetBrains Mono', monospace`; ctx.textBaseline = "middle"; const items = ["$TRENCHERS +12.4%", "$PONS +8.1%", "$GM +31.0%", "$WAGMI -2.2%", "$DIP +5.5%"]; let x = -((this.t * 60 + s.off * 100) % 700);
        for (let i = 0; i < 12; i++) { const it = items[i % items.length]; ctx.fillStyle = it.includes("-") ? "#ff5470" : "#39ff88"; ctx.fillText(it, x, H2 / 2); x += ctx.measureText(it).width + 30; }
        s.tex.needsUpdate = true; continue;
      }
      ctx.strokeStyle = "rgba(57,255,136,0.10)"; ctx.lineWidth = 1; for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, (H2 * i) / 5); ctx.lineTo(W2, (H2 * i) / 5); ctx.stroke(); }
      if ((s.kind === 0 || s.kind === 1) && this.ticker.length > 10) { // the live Bitcoin price
        const pts = this.ticker, lo = Math.min(...pts.map((x) => x[1])), hi = Math.max(...pts.map((x) => x[1])), span = hi - lo || 1, up = pts[pts.length - 1][1] >= pts[0][1];
        ctx.beginPath(); pts.forEach(([, v], i) => { const px = (i / (pts.length - 1)) * W2, py = H2 - 14 - ((v - lo) / span) * (H2 - 40); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
        ctx.strokeStyle = up ? "#39ff88" : "#ff5470"; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = up ? "#39ff88" : "#ff5470"; ctx.font = "600 15px 'JetBrains Mono', monospace"; ctx.fillText(`BTC $${Math.round(pts[pts.length - 1][1]).toLocaleString("en-US")}`, 10, 22);
        s.tex.needsUpdate = true; continue;
      }
      if (s.kind === 1) {
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
  /** Your trail cosmetic: little things left behind as you walk. */
  private trailStep(dt: number) {
    const kind = this.look.wear?.trail, tr = this.trenchie;
    if (kind && tr && (this.mode === "walk" || this.mode === "move") && this.me.v > 0.3 && this.t - this.trailAt > 0.09) {
      this.trailAt = this.t;
      const look: Record<string, [THREE.BufferGeometry, number, number]> = {
        "trail-dust": [new THREE.SphereGeometry(0.06, 6, 4), 0xc9c2b4, 0.9], "trail-leaves": [new THREE.CircleGeometry(0.06, 5), 0x6fbf4a, 1], "trail-hearts": [new THREE.OctahedronGeometry(0.06, 0), 0xff4f8a, 1.4],
        "trail-coins": [new THREE.CylinderGeometry(0.06, 0.06, 0.015, 12), 0xffcf3a, 1.3], "trail-sparkle": [new THREE.OctahedronGeometry(0.05, 0), 0xffffff, 2], "trail-fire": [new THREE.ConeGeometry(0.05, 0.14, 6), 0xff8a3d, 1.8], "trail-candles": [new THREE.BoxGeometry(0.05, 0.16, 0.05), 0x39ff88, 1.6],
      };
      const [g, c, s] = look[kind] ?? look["trail-dust"];
      const m = new THREE.Mesh(g, this.kit.glow(c, s)); m.position.copy(tr.position).setY(0.06); m.rotation.set(Math.random() * 3, Math.random() * 3, 0); this.dyn.add(m);
      this.trail.push({ m, t: 0, v: new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4) });
    }
    this.trail = this.trail.filter((p) => { p.t += dt; p.m.position.addScaledVector(p.v, dt); p.m.rotation.y += dt * 4; p.m.scale.setScalar(Math.max(0.01, 1 - p.t / 1.1)); if (p.t > 1.1) { this.dyn.remove(p.m); p.m.geometry.dispose(); return false; } return true; });
  }
  private makeTool(kind: string) {
    const g = new THREE.Group(), M = this.M; g.position.set(0.33, 0.55, 0.12); g.userData.kind = kind;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 8), this.kit.std(0x2a2522, 0.8)); handle.position.y = 0.27; g.add(handle);
    if (kind === "fish") { handle.scale.set(0.7, 2.4, 0.7); handle.position.y = 0.66; const tip = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), this.kit.glow(NEON, 1.6)); tip.position.y = 1.32; g.add(tip); return g; }
    if (kind === "net") { handle.scale.set(0.8, 1.7, 0.8); handle.position.y = 0.47; const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 6, 20), M.white); hoop.position.y = 1.07; hoop.rotation.y = Math.PI / 2; g.add(hoop); const bag = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.3, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, wireframe: true })); bag.rotation.z = Math.PI / 2; bag.position.set(0.15, 1.07, 0); g.add(bag); return g; }
    if (kind === "chop") { const head = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.16), M.metal); head.position.set(0, 0.52, 0.07); g.add(head); }
    else { const head = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 6, 16, Math.PI), M.metal); head.position.set(0, 0.48, 0); head.rotation.y = Math.PI / 2; g.add(head); }
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, 0.02), this.kit.glow(NEON, 1.6)); tip.position.set(0, 0.56, kind === "chop" ? 0.15 : 0.14); g.add(tip);
    return g;
  }
  private zSprite() {
    const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!; g.font = "600 44px 'Space Grotesk', sans-serif"; g.fillStyle = "#ffffff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("z", 32, 34);
    const t = new THREE.CanvasTexture(c); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })); s.scale.set(0.3, 0.3, 1); return s;
  }
  /** Keep the camera on the Trenchie (eased), and the shadow camera on the camera target. */
  private focus(snap: boolean, dt = 1) {
    const fg = this.follow ? this.guests.get(this.follow) : null;
    const goal = fg ? W(fg.w.x, fg.w.y) : W(this.pose.x || this.me.x, this.pose.y || this.me.y); goal.y = 0.6;
    goal.x *= 0.8; goal.z *= 0.8;
    const k = snap ? 1 : 1 - Math.exp(-dt * 1.5), t = this.controls.target, dx = (goal.x - t.x) * k, dy = (goal.y - t.y) * k, dz = (goal.z - t.z) * k;
    t.set(t.x + dx, t.y + dy, t.z + dz); this.camera.position.set(this.camera.position.x + dx, this.camera.position.y + dy, this.camera.position.z + dz);
    // the sun follows the camera in whole shadow-map texels, so shadows stay still instead of shimmering
    const tex = 44 / this.key.shadow.mapSize.x, sx = Math.round(t.x / tex) * tex, sz = Math.round(t.z / tex) * tex;
    this.key.position.set(sx + 10, 26, sz + 6); this.key.target.position.set(sx, t.y, sz);
  }
  /** Pins HTML onto 3D points: nameplate over the head, bubble above it, tags on the forest, quarry, pond and flowers. */
  private pinAll() {
    const tr = this.trenchie, P = this.pins, place = (el: HTMLElement | null | undefined, v: THREE.Vector3, show = true) => {
      if (!el) return; v.project(this.camera);
      const vis = show && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.transform = `translate3d(${((v.x + 1) / 2) * this.W}px, ${((1 - v.y) / 2) * this.H}px, 0)`; el.style.opacity = vis ? "" : "0";
    };
    if (tr) {
      const lying = this.mode === "do" && this.spot?.pose.kind === "lie";
      const inCar = this.mode === "ride" && !(this.vehicle?.userData.seat);
      const head = inCar && this.vehicle ? this.vehicle.position.clone().setY(1.5) : tr.position.clone().setY(tr.position.y + (lying ? 0.55 : HT * this.pose.sy + 0.12 + (this.look.wear?.hat ? 0.2 : 0)));
      place(P.plate, head.clone()); place(P.bubble, head.clone().setY(head.y + 0.05), this.t < this.bubbleUntil);
      if (P.bubble && this.t >= this.bubbleUntil) P.bubble.classList.remove("on");
      place(P.pop, head.clone().setY(head.y + 0.2), this.t < this.popUntil);
    }
    const desk = this.reg.spots.find((x) => x.tag === "desk"); if (desk) place(P.desk, W(desk.pose.x, desk.pose.y).setY(2.1));
    place(P.net, W(this.netAt.x, this.netAt.y).setY(1.3));
    for (const g of this.guests.values()) { const h = g.tr.position.clone().setY(HT + 0.12); place(g.plate, h.clone()); place(g.bubble, h.clone(), this.t < g.until); if (this.t >= g.until) g.bubble.classList.remove("on"); }
  }

  // ------------------------------------------------------------------ other Trenchies on this land
  setGuests(list: { name: string; nft: number; level: number; x?: string | null }[], follow: string | null = null) {
    const layer = this.pins.layer; this.follow = follow;
    const keep = new Set(list.map((g) => g.name));
    for (const [n, g] of this.guests) if (!keep.has(n)) { this.dyn.remove(g.tr); g.plate.remove(); g.bubble.remove(); this.guests.delete(n); }
    for (const x of list) {
      if (this.guests.has(x.name) || !layer) continue;
      const pal = artPalette(x.nft) ?? this.look.palette, tr = makeTrenchie(x.nft, pal, HT); this.dyn.add(tr);
      const d = this.door, w = new Walker(d.x + (Math.random() - 0.5) * 2, d.y + 1.2 + Math.random(), 1.3);
      const plate = document.createElement("div"); plate.className = "tg-pin";
      const pl = document.createElement("div"); pl.className = `tg-plate guest${x.name === follow ? " you" : ""}`;
      const lv = document.createElement("span"); lv.className = "tg-plate-lv"; lv.textContent = `Lv ${x.level}`; const nm = document.createElement("b"); nm.textContent = x.name === follow ? `${x.name} (you)` : x.name;
      pl.append(lv, nm); plate.append(pl);
      const bubble = document.createElement("div"); bubble.className = "tg-pin tg-bubble";
      layer.append(plate, bubble);
      this.guests.set(x.name, { tr, w, wait: 0.5, step: 0, plate, bubble, until: 0, yaw: 0 });
    }
  }
  sayAs(name: string, text: string) {
    const g = this.guests.get(name);
    if (!g) { if (name === this.look.name) this.say(text); return; }
    g.bubble.textContent = text; g.bubble.classList.remove("on"); void g.bubble.offsetWidth; g.bubble.classList.add("on"); g.until = this.t + 4.5;
  }
  private guestStep(dt: number) {
    for (const g of this.guests.values()) {
      g.wait -= dt;
      if (g.wait <= 0 && !g.w.path) {
        const near = Math.random() < 0.55;
        const t = near ? { x: this.pose.x + (Math.random() - 0.5) * 3, y: this.pose.y + 0.8 + Math.random() * 1.5 } : { x: 13 + Math.random() * 27, y: 13 + Math.random() * 27 };
        t.x = Math.max(2.4, Math.min(LAND - 2.4, t.x)); t.y = Math.max(2.4, Math.min(LAND - 2.4, t.y));
        g.w.go(this.nav.route({ x: g.w.x, y: g.w.y }, t), 1.3); g.wait = 3 + Math.random() * 6;
      }
      const d = g.w.step(dt); g.step += d * (Math.PI / 0.36);
      const p = W(g.w.x, g.w.y), v = Math.min(1, g.w.v * 1.3);
      g.tr.position.set(p.x, Math.pow(Math.sin(g.step), 2) * 0.04 * v, p.z);
      g.yaw = angLerp(g.yaw, g.w.yaw, 1 - Math.exp(-dt * 10));
      g.tr.rotation.set(0.06 * v, g.yaw, Math.sin(g.step) * 0.05 * v, "YXZ");
    }
  }

  resize(w: number, h: number) {
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.bloom.setSize(w, h);
    const ppu = Math.max(30, Math.min(60, Math.max(w * 0.9, h * 0.55) / 21));
    Object.assign(this.camera, { left: -w / 2 / ppu, right: w / 2 / ppu, top: h / 2 / ppu, bottom: -h / 2 / ppu });
    this.camera.updateProjectionMatrix();
  }
  render() { this.controls.update(); this.composer.render(); this.pinAll(); }
  dispose() { for (const g of this.guests.values()) { g.plate.remove(); g.bubble.remove(); } this.guests.clear(); this.controls.dispose(); this.clear(this.statics); this.clear(this.dyn); this.renderer.dispose(); }
}
