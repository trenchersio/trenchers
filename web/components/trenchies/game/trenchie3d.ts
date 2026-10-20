/**
 * The Trenchie: one smooth body (a signed distance field turned into a mesh with surface nets), toon-shaded,
 * with its Trencher's own art as the skin, a plain white belly and a dark ink outline.
 * Ported from the character study; the geometry is built once and shared by every Trenchie on screen.
 */
import * as THREE from "three";
import { drawArt } from "@/lib/art-vector";
import type { Palette } from "./types";

type P3 = [number, number, number];
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const ellip = (p: P3, c: P3, r: P3) => { const x = (p[0] - c[0]) / r[0], y = (p[1] - c[1]) / r[1], z = (p[2] - c[2]) / r[2]; const k0 = Math.hypot(x, y, z); const k1 = Math.hypot(x / r[0], y / r[1], z / r[2]); return k1 === 0 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1; };
const limbSeg = (p: P3, a: P3, b: P3, ra: number, rb: number) => { const pa = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const h = Math.max(0, Math.min(1, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2]))); return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - (ra + (rb - ra) * h); };
const A: P3 = [0.46, 1.98, -0.03], B: P3 = [1.1, 1.86, 0.0], C: P3 = [1.1, 1.06, 0.1];
const bez = (t: number): P3 => [0, 1, 2].map((k) => (1 - t) * (1 - t) * A[k] + 2 * (1 - t) * t * B[k] + t * t * C[k]) as P3;
function sdf(p: P3) {
  const q: P3 = [Math.abs(p[0]), p[1], p[2]];
  let d = ellip(p, [0, 1.18, 0.04], [0.84, 0.9, 0.78]);
  d = smin(d, ellip(p, [0, 1.8, -0.03], [0.66, 0.52, 0.56]), 0.4);
  d = smin(d, ellip(p, [0, 2.4, 0.03], [0.45, 0.45, 0.45]), 0.26);
  let arm = 1e9; const N = 10;
  for (let n = 0; n < N; n++) { const t0 = n / N, t1 = (n + 1) / N; arm = Math.min(arm, limbSeg(q, bez(t0), bez(t1), 0.24 - 0.05 * t0 + 0.03 * t0 ** 3, 0.24 - 0.05 * t1 + 0.03 * t1 ** 3)); }
  const ks = Math.min(1, Math.max(0, (p[1] - 1.2) / 0.85)), k = 0.08 + 0.32 * ks * ks * (3 - 2 * ks);
  d = smin(d, arm, k);
  let leg = limbSeg(q, [0.32, 0.72, 0.0], [0.35, 0.3, 0.03], 0.23, 0.22);
  leg = smin(leg, ellip(q, [0.37, 0.14, 0.15], [0.25, 0.14, 0.37]), 0.14);
  return smin(d, leg, 0.18);
}

let SHARED: { geo: THREE.BufferGeometry; outline: THREE.BufferGeometry } | null = null;
function geometry() {
  if (SHARED) return SHARED;
  const lo = [-1.75, -0.08, -1.2], hi = [1.75, 3.3, 1.3], h = 0.036;
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const val = new Float32Array(nx * ny * nz), at = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) val[at(i, j, k)] = sdf([lo[0] + i * h, lo[1] + j * h, lo[2] + k * h]);
  const cell = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), cAt = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos: number[] = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { cv[c] = val[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; if (cv[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t; n++;
    }
    cell[cAt(i, j, k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / n) * h, lo[1] + (j + sy / n) * h, lo[2] + (k + sz / n) * h);
  }
  const idx: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const s0 = val[at(i, j, k)] < 0, s1 = val[at(i + 1, j, k)] < 0; if (s0 !== s1) quad(cell[cAt(i, j - 1, k - 1)], cell[cAt(i, j, k - 1)], cell[cAt(i, j, k)], cell[cAt(i, j - 1, k)], s0); }
  for (let k = 1; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const s0 = val[at(i, j, k)] < 0, s1 = val[at(i, j + 1, k)] < 0; if (s0 !== s1) quad(cell[cAt(i - 1, j, k - 1)], cell[cAt(i - 1, j, k)], cell[cAt(i, j, k)], cell[cAt(i, j, k - 1)], s0); }
  for (let k = 0; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) { const s0 = val[at(i, j, k)] < 0, s1 = val[at(i, j, k + 1)] < 0; if (s0 !== s1) quad(cell[cAt(i - 1, j - 1, k)], cell[cAt(i, j - 1, k)], cell[cAt(i, j, k)], cell[cAt(i - 1, j, k)], s0); }
  const nv = pos.length / 3, nor = new Float32Array(nv * 3), e = 0.004;
  for (let v = 0; v < nv; v++) {
    const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
    const gx = sdf([x + e, y, z]) - sdf([x - e, y, z]), gy = sdf([x, y + e, z]) - sdf([x, y - e, z]), gz = sdf([x, y, z + e]) - sdf([x, y, z - e]);
    const l = Math.hypot(gx, gy, gz) || 1; nor[3 * v] = gx / l; nor[3 * v + 1] = gy / l; nor[3 * v + 2] = gz / l;
  }
  const P = (i: number) => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  for (let t = 0; t < idx.length; t += 3) {
    const a = P(idx[t]), b = P(idx[t + 1]), c = P(idx[t + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const fn = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const vn = idx[t] * 3; if (fn[0] * nor[vn] + fn[1] * nor[vn + 1] + fn[2] * nor[vn + 2] < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setIndex(idx);
  const outline = geo.clone(), p = outline.attributes.position, nn = outline.attributes.normal, wv = 0.035;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + nn.getX(i) * wv, p.getY(i) + nn.getY(i) * wv, p.getZ(i) + nn.getZ(i) * wv);
  p.needsUpdate = true;
  SHARED = { geo, outline };
  return SHARED;
}

const TONES = (() => { const d = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]); const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; })();
const hexRGB = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = (h: string) => { const [r, g, b] = hexRGB(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

/** The skin: the Trencher's own art, softened, with main and background swapped when the main colour is the bright one. */
function skin(nft: number, p: Palette) {
  const W = 448, c = document.createElement("canvas"); c.width = c.height = W;
  const g = c.getContext("2d")!;
  if (!drawArt(g, nft, W)) { g.fillStyle = p.main; g.fillRect(0, 0, W, W); }
  const SOFT = 0.32, swap = lum(p.main) > 0.12, bg = hexRGB(p.bg), main = hexRGB(p.main);
  const pal = [p.main, p.second, p.eye, p.sig].map(hexRGB), bgOut = swap ? main : bg;
  const d = g.getImageData(0, 0, W, W), a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    let best = pal[0], bt = 0, be = 1e9;
    for (const col of pal) {
      const dx = col[0] - bg[0], dy = col[1] - bg[1], dz = col[2] - bg[2], L = dx * dx + dy * dy + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((a[i] - bg[0]) * dx + (a[i + 1] - bg[1]) * dy + (a[i + 2] - bg[2]) * dz) / L));
      const ex = a[i] - bg[0] - dx * t, ey = a[i + 1] - bg[1] - dy * t, ez = a[i + 2] - bg[2] - dz * t, er = ex * ex + ey * ey + ez * ez;
      if (er < be) { be = er; best = col; bt = t; }
    }
    const o = swap && best === pal[0] ? bg : best;
    for (let k = 0; k < 3; k++) a[i + k] = bgOut[k] + (o[k] - bgOut[k]) * bt * SOFT;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping; t.encoding = THREE.sRGBEncoding;
  return t;
}

/** One Trenchie, about `height` world units tall, feet at y = 0, facing +z. */
export function makeTrenchie(nft: number, p: Palette, height = 1.05) {
  const { geo, outline } = geometry();
  const mat = new THREE.MeshToonMaterial({ gradientMap: TONES, map: skin(nft, p) });
  (mat as unknown as { extensions: object }).extensions = { derivatives: true };
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = "varying vec3 vOP; varying vec3 vON;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n vOP = position; vON = normal;");
    sh.fragmentShader = "varying vec3 vOP; varying vec3 vON;\n" + sh.fragmentShader.replace("#include <map_fragment>", `
      vec3 w = pow( abs( normalize( vON ) ), vec3( 24.0 ) ); w /= ( w.x + w.y + w.z );
      float s = 1.0 / 2.9;
      vec3 cF = mapTexelToLinear( texture2D( map, vec2( vOP.x * s + 0.5, vOP.y * s ) ) ).rgb;
      vec3 cS = mapTexelToLinear( texture2D( map, vec2( vOP.z * s + 0.5, vOP.y * s ) ) ).rgb;
      vec3 cT = mapTexelToLinear( texture2D( map, vec2( vOP.x * s + 0.5, vOP.z * s + 0.5 ) ) ).rgb;
      vec3 skin = cF * w.z + cS * w.x + cT * w.y;
      float be = length( vec2( vOP.x / 0.54, ( vOP.y - 1.1 ) / 0.58 ) ); float bw = fwidth( be ) * 1.2;
      float belly = ( 1.0 - smoothstep( 1.0 - bw, 1.0 + bw, be ) ) * step( 0.2, vOP.z );
      diffuseColor.rgb = mix( skin, vec3( 0.89, 0.9, 0.89 ), belly );`);
  };
  const body = new THREE.Mesh(geo, mat); body.castShadow = true;
  const ink = new THREE.Mesh(outline, new THREE.MeshBasicMaterial({ color: 0x050607, side: THREE.BackSide }));
  const inner = new THREE.Group(); inner.add(ink); inner.add(body);
  inner.scale.setScalar(height / 3.3);
  const g = new THREE.Group(); g.add(inner); g.userData.inner = inner;
  return g;
}
