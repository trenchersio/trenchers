/**
 * The Trenchie on a turntable, for the profile and wardrobe: drag to spin it, it turns slowly on its own, and it
 * wears whatever you try on.
 */
import * as THREE from "three";
import { makeTrenchie } from "./trenchie3d";
import { animateWear, dress, type Wear } from "./wear";
import type { Palette } from "./types";

export class Preview3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private tr: THREE.Group | null = null;
  private stage = new THREE.Group();
  private yaw = 0.5; private spin = 0.35; private drag: number | null = null; private t = 0; private raf = 0; private last = 0;
  private wear: Wear = {};
  constructor(private canvas: HTMLCanvasElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }));
    r.outputEncoding = THREE.sRGBEncoding; r.toneMapping = THREE.ACESFilmicToneMapping; r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera.position.set(0, 1.25, 4.4); this.camera.lookAt(0, 0.72, 0);
    const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(2, 4, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    const rim = new THREE.DirectionalLight(0x6ee7ff, 0.6); rim.position.set(-3, 2, -2);
    this.scene.add(key, rim, new THREE.HemisphereLight(0xcfe0ff, 0x1a2a20, 0.55), this.stage);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.08, 48), new THREE.MeshStandardMaterial({ color: 0x14181a, roughness: 0.4, metalness: 0.3 })); disc.position.y = -0.04; disc.receiveShadow = true; this.scene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.012, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x39ff88).multiplyScalar(1.4) })); ring.rotation.x = Math.PI / 2; this.scene.add(ring);
    const down = (e: PointerEvent) => { this.drag = e.clientX; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { if (this.drag === null) return; this.yaw += (e.clientX - this.drag) * 0.012; this.drag = e.clientX; };
    const up = () => { this.drag = null; };
    canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move); canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    this.cleanup = () => { canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up); };
  }
  private cleanup: () => void;
  setTrenchie(nft: number, palette: Palette) {
    if (this.tr) this.stage.remove(this.tr);
    this.tr = makeTrenchie(nft, palette, 1.45); this.stage.add(this.tr); dress(this.tr, this.wear);
  }
  setWear(w: Wear) { this.wear = { ...w }; if (this.tr) dress(this.tr, this.wear); }
  resize(w: number, h: number) { this.renderer.setSize(w, h, false); this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix(); }
  start() {
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - (this.last || now)) / 1000); this.last = now; this.t += dt;
      if (this.drag === null) this.yaw += dt * this.spin;
      if (this.tr) { this.tr.rotation.y = this.yaw; this.tr.position.y = Math.abs(Math.sin(this.t * 1.6)) * 0.03; animateWear(this.tr, this.t, 0); }
      this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }
  /** One still frame as a PNG (for sharing). */
  snapshot() { this.renderer.render(this.scene, this.camera); return this.canvas.toDataURL("image/png"); }
  dispose() { cancelAnimationFrame(this.raf); this.cleanup(); this.renderer.dispose(); }
}
