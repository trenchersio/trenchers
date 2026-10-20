/**
 * Around your land: no neighbours, just a dark meadow and a forest that thickens into the fog, so the land never
 * floats in a void. Also the shared bits: lit-window textures for building walls and soft light pools for lamps.
 */
import * as THREE from "three";

const rnd = (() => { let s = 1337; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

export function windowTextures(n: number) {
  const out: { map: THREE.Texture; em: THREE.Texture }[] = [];
  for (let k = 0; k < n; k++) {
    const S = 256, c = 32;
    const a = document.createElement("canvas"); a.width = a.height = S; const g = a.getContext("2d")!;
    const b = document.createElement("canvas"); b.width = b.height = S; const e = b.getContext("2d")!;
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, S, S); e.fillStyle = "#000"; e.fillRect(0, 0, S, S);
    const lit = 0.25 + k * 0.12;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const x = i * c + 7, y = j * c + 8, w = c - 14, h = c - 13;
      g.fillStyle = "#5d636b"; g.fillRect(x - 1, y - 1, w + 2, h + 2);
      g.fillStyle = "#2a2f36"; g.fillRect(x, y, w, h);
      if (rnd() < lit) { e.fillStyle = rnd() < 0.82 ? `hsl(${38 + rnd() * 10} 95% ${58 + rnd() * 14}%)` : "#cfe8ff"; e.fillRect(x, y, w, h); g.fillStyle = "#ffe6a8"; g.fillRect(x, y, w, h); }
      g.fillStyle = "#c9ccd0"; g.fillRect(x - 2, y + h + 1, w + 4, 2); // sill
    }
    const map = new THREE.CanvasTexture(a), em = new THREE.CanvasTexture(b);
    for (const t of [map, em]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; }
    out.push({ map, em });
  }
  return out;
}
/** A soft round glow for light pools on the ground. */
export function poolTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, "rgba(255,214,140,0.85)"); r.addColorStop(0.35, "rgba(255,190,110,0.35)"); r.addColorStop(1, "rgba(255,170,90,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t;
}
export function poolMaterial(tex: THREE.Texture, opacity = 1) {
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }); (m as unknown as { toneMapped: boolean }).toneMapped = false; return m;
}

/** Scales a box's side-face UVs so one texture cell = one window (1 wide, 0.9 tall). Faces: +x −x +y −y +z −z. */
export function windowUV(g: THREE.BoxGeometry, w: number, h: number, d: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute, ou = Math.floor(rnd() * 8) / 8, ov = Math.floor(rnd() * 8) / 8;
  for (let f = 0; f < 6; f++) { if (f === 2 || f === 3) continue; const along = f < 2 ? d : w; for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * (along / 8) + ou, uv.getY(i) * (h / 7.2) + ov); } }
  uv.needsUpdate = true;
}

export type Wilds = { group: THREE.Group; update: (night: number) => void };

/** Round low-poly trees, instanced: returns the meshes for a list of placements. */
export function treeMeshes(list: THREE.Matrix4[]) {
  const leaf = new THREE.MeshStandardMaterial({ color: 0x173023, roughness: 0.8, flatShading: true }), leaf2 = new THREE.MeshStandardMaterial({ color: 0x1f4130, roughness: 0.8, flatShading: true });
  const trunkG = new THREE.CylinderGeometry(0.06, 0.09, 0.7, 6); trunkG.translate(0, 0.35, 0);
  const crownG = new THREE.IcosahedronGeometry(0.55, 1); crownG.translate(0, 1.05, 0);
  const crown2 = new THREE.IcosahedronGeometry(0.38, 1); crown2.translate(0.2, 1.45, 0.05);
  const out: THREE.InstancedMesh[] = [];
  for (const [g, m, sh] of [[trunkG, new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.9 }), false], [crownG, leaf, true], [crown2, leaf2, false]] as [THREE.BufferGeometry, THREE.Material, boolean][]) {
    const im = new THREE.InstancedMesh(g, m, Math.max(1, list.length)); list.forEach((x, i) => im.setMatrixAt(i, x)); im.count = list.length; im.castShadow = sh; im.receiveShadow = true; out.push(im);
  }
  return out;
}
const m4 = (x: number, y: number, z: number, s = 1, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s * (0.85 + rnd() * 0.4), s));

/** The meadow and the forest around a plot of half-size `half` centred on the origin. */
export function makeWilds(half: number): Wilds {
  const group = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.CircleGeometry(140, 64), new THREE.MeshStandardMaterial({ color: 0x0b140e, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; group.add(ground);
  const trees: THREE.Matrix4[] = [], rocks: THREE.Matrix4[] = [], grass: THREE.Matrix4[] = [];
  for (let i = 0; i < 1400; i++) {
    const a = rnd() * Math.PI * 2, r = half + 2.2 + Math.pow(rnd(), 0.7) * 42, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.max(Math.abs(x), Math.abs(z)) < half + 1.6) continue;
    const near = r < half + 9;
    if (near && rnd() < 0.45) continue; // a clearing around your land
    trees.push(m4(x, 0, z, 0.9 + rnd() * 0.9 + (r - half) * 0.02, rnd() * 6));
  }
  for (let i = 0; i < 90; i++) { const a = rnd() * Math.PI * 2, r = half + 2 + rnd() * 20, x = Math.cos(a) * r, z = Math.sin(a) * r; if (Math.max(Math.abs(x), Math.abs(z)) < half + 1.4) continue; rocks.push(m4(x, 0.05, z, 0.25 + rnd() * 0.5, rnd() * 6)); }
  for (let i = 0; i < 500; i++) { const a = rnd() * Math.PI * 2, r = half + 1.5 + rnd() * 14, x = Math.cos(a) * r, z = Math.sin(a) * r; if (Math.max(Math.abs(x), Math.abs(z)) < half + 1.2) continue; grass.push(m4(x, 0, z, 0.6 + rnd() * 0.8, rnd() * 6)); }
  for (const m of treeMeshes(trees)) group.add(m);
  const rockG = new THREE.DodecahedronGeometry(1, 0); const rk = new THREE.InstancedMesh(rockG, new THREE.MeshStandardMaterial({ color: 0x2a2f2e, roughness: 0.9, flatShading: true }), rocks.length); rocks.forEach((x, i) => rk.setMatrixAt(i, x)); rk.castShadow = true; group.add(rk);
  const tuftG = new THREE.ConeGeometry(0.08, 0.3, 4); tuftG.translate(0, 0.15, 0); const tf = new THREE.InstancedMesh(tuftG, new THREE.MeshStandardMaterial({ color: 0x23432e, roughness: 1, flatShading: true }), grass.length); grass.forEach((x, i) => tf.setMatrixAt(i, x)); group.add(tf);
  // fireflies over the meadow at night
  const n = 160, pos = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, r = half + 2 + rnd() * 16; pos[3 * i] = Math.cos(a) * r; pos[3 * i + 1] = 0.4 + rnd() * 1.6; pos[3 * i + 2] = Math.sin(a) * r; }
  const fg = new THREE.BufferGeometry(); fg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const fm = new THREE.PointsMaterial({ color: 0xc8ff9a, size: 0.09, transparent: true, opacity: 0.0, depthWrite: false }); const flies = new THREE.Points(fg, fm); group.add(flies);
  let t = 0;
  return { group, update: (night: number) => { t += 0.016; fm.opacity = night * (0.55 + Math.sin(t * 2) * 0.2); flies.rotation.y = Math.sin(t * 0.05) * 0.05; } };
}
