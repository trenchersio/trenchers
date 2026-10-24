/**
 * Weather over a land: sunny, cloudy, rain or snow. It changes every 3 hours, picked at random but the same for
 * everyone looking at the same land at the same time (seeded by the land's name and the 3-hour block). Snow is
 * likelier in winter. Rain and snow are particles that follow the camera; clouds drift overhead.
 */
import * as THREE from "three";

export type Sky = "sun" | "clouds" | "rain" | "snow";
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 100000) / 100000; };
export function skyFor(land: string, now = Date.now()) {
  const block = Math.floor(now / (3 * 3600_000)), m = new Date(now).getMonth(), winter = m === 11 || m <= 1;
  const r = hash(`${land.toLowerCase()}:${block}`);
  const snow = winter ? 0.3 : 0.06, rain = 0.18, clouds = 0.22;
  return (r < snow ? "snow" : r < snow + rain ? "rain" : r < snow + rain + clouds ? "clouds" : "sun") as Sky;
}
export const SKY_LABEL: Record<Sky, string> = { sun: "Clear", clouds: "Cloudy", rain: "Rain", snow: "Snow" };

const N_RAIN = 1400, N_SNOW = 1100, AREA = 46, TOP = 16;
export class Weather {
  group = new THREE.Group();
  private rain: THREE.LineSegments; private rainPos: Float32Array;
  private snow: THREE.Points; private snowPos: Float32Array; private snowPh: Float32Array;
  private clouds: THREE.Group;
  private snowCover: THREE.Mesh;
  kind: Sky = "sun";
  private k = { rain: 0, snow: 0, clouds: 0 };
  constructor(land: number) {
    const rnd = Math.random;
    this.rainPos = new Float32Array(N_RAIN * 6);
    for (let i = 0; i < N_RAIN; i++) { const x = (rnd() - 0.5) * AREA, y = rnd() * TOP, z = (rnd() - 0.5) * AREA; this.rainPos.set([x, y, z, x + 0.05, y - 0.45, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xa8c8ff, transparent: true, opacity: 0, depthWrite: false })); this.rain.frustumCulled = false;
    this.snowPos = new Float32Array(N_SNOW * 3); this.snowPh = new Float32Array(N_SNOW);
    for (let i = 0; i < N_SNOW; i++) { this.snowPos.set([(rnd() - 0.5) * AREA, rnd() * TOP, (rnd() - 0.5) * AREA], i * 3); this.snowPh[i] = rnd() * 6; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(this.snowPos, 3));
    this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.11, transparent: true, opacity: 0, depthWrite: false })); this.snow.frustumCulled = false;
    this.clouds = new THREE.Group();
    // soft puffs (blurred sprites), so a cloudy day reads as haze drifting over the land, not shapes
    const puff = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d")!; const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.5, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
    const cm = new THREE.SpriteMaterial({ map: puff, color: 0xe6ebef, transparent: true, opacity: 0, depthWrite: false, fog: false });
    for (let i = 0; i < 9; i++) { const c = new THREE.Group(); for (let j = 0; j < 5; j++) { const p = new THREE.Sprite(cm); const s = 3.2 + rnd() * 2.6; p.scale.set(s, s * 0.6, 1); p.position.set(j * 1.5 - 3, rnd() * 0.6, rnd() * 1.2); c.add(p); } c.position.set((rnd() - 0.5) * land * 1.4, 13 + rnd() * 4, (rnd() - 0.5) * land * 1.4); this.clouds.add(c); }
    // a thin white layer over the land when it snows
    this.snowCover = new THREE.Mesh(new THREE.PlaneGeometry(land, land), new THREE.MeshStandardMaterial({ color: 0xf4f7fa, roughness: 1, transparent: true, opacity: 0, depthWrite: false }));
    this.snowCover.rotation.x = -Math.PI / 2; this.snowCover.position.y = 0.012; this.snowCover.renderOrder = 2;
    this.group.add(this.rain, this.snow, this.clouds, this.snowCover);
  }
  /** How much it dims the sun (0..1). */
  get gloom() { return this.k.rain * 0.45 + this.k.snow * 0.25 + this.k.clouds * 0.3; }
  update(dt: number, center: THREE.Vector3, kind: Sky) {
    this.kind = kind;
    const ease = (v: number, to: number) => v + (to - v) * Math.min(1, dt * 0.6);
    this.k.rain = ease(this.k.rain, kind === "rain" ? 1 : 0); this.k.snow = ease(this.k.snow, kind === "snow" ? 1 : 0); this.k.clouds = ease(this.k.clouds, kind === "sun" ? 0 : 1);
    (this.rain.material as THREE.LineBasicMaterial).opacity = this.k.rain * 0.5; this.rain.visible = this.k.rain > 0.02;
    (this.snow.material as THREE.PointsMaterial).opacity = this.k.snow * 0.95; this.snow.visible = this.k.snow > 0.02;
    (this.snowCover.material as THREE.MeshStandardMaterial).opacity = this.k.snow * 0.5;
    this.clouds.children.forEach((c, i) => { c.position.x += dt * (0.4 + (i % 3) * 0.15); if (c.position.x > 40) c.position.x = -40; ((c.children[0] as THREE.Sprite).material as THREE.SpriteMaterial).opacity = this.k.clouds * 0.32; c.visible = this.k.clouds > 0.02; });
    if (this.rain.visible) {
      const P = this.rainPos;
      for (let i = 0; i < N_RAIN; i++) { const o = i * 6; P[o + 1] -= dt * 22; P[o + 4] -= dt * 22; if (P[o + 4] < 0) { const x = center.x + (Math.random() - 0.5) * AREA, z = center.z + (Math.random() - 0.5) * AREA, y = TOP + Math.random() * 3; P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = x + 0.05; P[o + 4] = y - 0.45; P[o + 5] = z; } }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.snow.visible) {
      const P = this.snowPos, t = performance.now() / 1000;
      for (let i = 0; i < N_SNOW; i++) { const o = i * 3; P[o + 1] -= dt * 1.1; P[o] += Math.sin(t + this.snowPh[i]) * dt * 0.3; if (P[o + 1] < 0) { P[o] = center.x + (Math.random() - 0.5) * AREA; P[o + 1] = TOP; P[o + 2] = center.z + (Math.random() - 0.5) * AREA; } }
      (this.snow.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}
