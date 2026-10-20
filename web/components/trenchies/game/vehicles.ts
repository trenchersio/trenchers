/**
 * Trenchies rides, modelled properly: cars are extruded from a side profile (with bevelled edges, clear-coat paint,
 * tinted glass, rims and lights), the bike is a tube frame on thin spoked wheels, the moped a rounded shell.
 * Every vehicle faces +x, sits on y = 0 and is about life-size next to a Trenchie.
 */
import * as THREE from "three";

const NEON = 0x39ff88;
const glow = (c: number, s = 1.6) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(s) }); (m as unknown as { toneMapped: boolean }).toneMapped = false; return m; };
const paint = (c: number, rough = 0.28) => new THREE.MeshPhysicalMaterial({ color: c, roughness: rough, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x0a0b0b, roughness: 0.9 });
const chrome = new THREE.MeshStandardMaterial({ color: 0xc8cccb, roughness: 0.22, metalness: 1 });
const tint = new THREE.MeshPhysicalMaterial({ color: 0x0b1416, roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.88, clearcoat: 1 });

/** A tube between two points. */
function tube(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) {
  const d = new THREE.Vector3().subVectors(b, a), L = d.length();
  const g = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 10), m);
  g.position.copy(a).addScaledVector(d, 0.5); g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.castShadow = true; return g;
}
function profile(pts: [number, number][], width: number, mat: THREE.Material, bevel = 0.06) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) s.lineTo(x, y); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 12 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m;
}
function carWheel(x: number, z: number, r: number, w: number, accent: number) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28), rubber); tire.rotation.x = Math.PI / 2; tire.castShadow = true; g.add(tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, w + 0.01, 24), chrome); rim.rotation.x = Math.PI / 2; g.add(rim);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.68, 0.012, 6, 32), glow(accent, 1.8)); ring.position.z = (w / 2 + 0.006) * Math.sign(z || 1); g.add(ring);
  g.position.set(x, r, z); g.userData.spin = true; return g;
}

type Car = { len: number; wid: number; r: number; body: [number, number][]; glass: [number, number][]; color: number; accent: number; wheels: [number, number]; hover?: boolean };
const CARS: Record<string, Car> = {
  hatch: { len: 1.9, wid: 0.9, r: 0.17, color: 0xe9eceb, accent: NEON, wheels: [-0.6, 0.62],
    body: [[-0.95, 0.12], [0.95, 0.12], [0.98, 0.42], [0.62, 0.52], [0.25, 0.86], [-0.7, 0.88], [-0.95, 0.62]],
    glass: [[0.52, 0.55], [0.22, 0.82], [-0.66, 0.84], [-0.86, 0.6]] },
  suv: { len: 2.2, wid: 1.0, r: 0.22, color: 0x2a2f2d, accent: NEON, wheels: [-0.72, 0.72],
    body: [[-1.1, 0.16], [1.1, 0.16], [1.12, 0.56], [0.72, 0.66], [0.45, 1.06], [-1.02, 1.08], [-1.1, 0.8]],
    glass: [[0.62, 0.69], [0.42, 1.0], [-0.96, 1.02], [-1.03, 0.74]] },
  sports: { len: 2.2, wid: 0.95, r: 0.17, color: 0x0b0d0c, accent: NEON, wheels: [-0.72, 0.74],
    body: [[-1.1, 0.12], [1.1, 0.12], [1.12, 0.3], [0.55, 0.42], [0.05, 0.68], [-0.55, 0.68], [-1.1, 0.46]],
    glass: [[0.42, 0.45], [0.04, 0.64], [-0.5, 0.64], [-0.82, 0.5]] },
  super: { len: 2.35, wid: 1.0, r: 0.16, color: 0xf2f4f3, accent: NEON, wheels: [-0.8, 0.8],
    body: [[-1.18, 0.1], [1.18, 0.1], [1.2, 0.22], [0.45, 0.4], [-0.05, 0.6], [-0.7, 0.58], [-1.18, 0.38]],
    glass: [[0.36, 0.42], [-0.06, 0.57], [-0.62, 0.55]] },
  hover: { len: 2.2, wid: 1.0, r: 0.0, color: 0x0b0d0c, accent: 0x6ee7ff, wheels: [0, 0], hover: true,
    body: [[-1.1, 0.12], [1.1, 0.12], [1.14, 0.26], [0.4, 0.42], [0.0, 0.66], [-0.75, 0.62], [-1.1, 0.4]],
    glass: [[0.32, 0.45], [-0.02, 0.62], [-0.68, 0.58]] },
};

export function makeVehicle(kind: string) {
  const g = new THREE.Group(); g.userData.wheels = [] as THREE.Object3D[];
  const c = CARS[kind];
  if (c) {
    const body = profile(c.body, c.wid, paint(c.color)); g.add(body);
    const glass = profile(c.glass, c.wid + 0.02, tint, 0.03); g.add(glass);
    if (!c.hover) for (const x of c.wheels) for (const z of [-c.wid / 2 + 0.05, c.wid / 2 - 0.05]) { const w = carWheel(x, z, c.r, 0.16, c.accent); g.add(w); g.userData.wheels.push(w); }
    const front = c.body[2][0], back = c.body[0][0];
    for (const z of [-c.wid / 2 + 0.16, c.wid / 2 - 0.16]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.2), glow(0xffffff, 2.2)); hl.position.set(front + 0.02, c.body[2][1] - 0.06, z); g.add(hl);
    }
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, c.wid - 0.2), glow(0xff2d55, 2)); tl.position.set(back - 0.04, c.body[6][1] - 0.08, 0); g.add(tl);
    const under = new THREE.Mesh(new THREE.PlaneGeometry(c.len - 0.3, c.wid - 0.2), new THREE.MeshBasicMaterial({ color: c.accent, transparent: true, opacity: c.hover ? 0.55 : 0.28, depthWrite: false }));
    under.rotation.x = -Math.PI / 2; under.position.y = 0.02; (under.material as unknown as { toneMapped: boolean }).toneMapped = false; g.add(under);
    if (kind === "sports" || kind === "super") { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, c.wid - 0.1), paint(kind === "super" ? 0x0b0d0c : c.color)); sp.position.set(back + 0.08, c.body[6][1] + 0.1, 0); g.add(sp); for (const z of [-0.3, 0.3]) g.add(tube(new THREE.Vector3(back + 0.1, c.body[6][1] - 0.02, z), new THREE.Vector3(back + 0.08, c.body[6][1] + 0.09, z), 0.015, chrome)); }
    if (c.hover) { for (const [x, z] of [[-0.7, -0.35], [-0.7, 0.35], [0.7, -0.35], [0.7, 0.35]]) { const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.06, 20), glow(c.accent, 2)); pad.position.set(x, 0.1, z); g.add(pad); } g.userData.hover = true; }
    g.userData.seat = null; g.userData.hidesRider = true;
    return g;
  }
  const frameM = new THREE.MeshStandardMaterial({ color: 0xeef1ef, roughness: 0.35, metalness: 0.3 }), dark = new THREE.MeshStandardMaterial({ color: 0x111312, roughness: 0.5 });
  const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  if (kind === "moped") {
    for (const x of [-0.45, 0.48]) { const w = new THREE.Group(); const t = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.06, 10, 28), rubber); w.add(t); const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 18), chrome); hub.rotation.x = Math.PI / 2; w.add(hub); w.position.set(x, 0.23, 0); g.add(w); g.userData.wheels.push(w); }
    g.add(profile([[-0.6, 0.25], [-0.15, 0.22], [0.25, 0.22], [0.5, 0.3], [0.55, 0.75], [0.42, 0.78], [0.3, 0.4], [-0.1, 0.42], [-0.62, 0.55]], 0.32, paint(0xeef1ef, 0.3), 0.07));
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.46, 14), dark); seat.rotation.z = Math.PI / 2; seat.scale.set(1, 1, 1.4); seat.position.set(-0.28, 0.62, 0); g.add(seat);
    g.add(tube(V(0.52, 0.7), V(0.48, 0.95), 0.025, chrome)); g.add(tube(V(0.48, 0.95, -0.25), V(0.48, 0.95, 0.25), 0.022, dark));
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), glow(0xffffff, 2.2)); hl.position.set(0.56, 0.84, 0); g.add(hl);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.015, 0.34), glow(NEON, 1.6)); strip.position.set(-0.05, 0.27, 0); g.add(strip);
    g.userData.seat = V(-0.3, 0.66, 0);
    return g;
  }
  // city bike
  for (const x of [-0.5, 0.5]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.028, 8, 36), rubber));
    w.add(new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.008, 6, 36), chrome));
    for (let k = 0; k < 8; k++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.54, 4), chrome); sp.rotation.z = (k / 8) * Math.PI; w.add(sp); }
    w.position.set(x, 0.33, 0); g.add(w); g.userData.wheels.push(w);
  }
  const bb = V(-0.04, 0.33), seatT = V(-0.18, 0.86), head = V(0.38, 0.88), rearA = V(-0.5, 0.33), frontA = V(0.5, 0.33);
  for (const [a, b] of [[bb, seatT], [seatT, head], [bb, head.clone().add(V(-0.02, -0.08))], [bb, rearA], [seatT, rearA], [head, frontA]] as [THREE.Vector3, THREE.Vector3][]) g.add(tube(a, b, 0.025, frameM));
  const accent = tube(V(-0.12, 0.6), V(0.3, 0.75), 0.012, glow(NEON, 1.6)); g.add(accent);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.12), dark); seat.position.set(-0.2, 0.92, 0); g.add(seat);
  g.add(tube(V(0.36, 0.92, -0.24), V(0.36, 0.92, 0.24), 0.02, dark));
  g.add(tube(head, V(0.36, 0.92), 0.022, frameM));
  const crank = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 18), chrome); crank.rotation.x = Math.PI / 2; crank.position.copy(bb); g.add(crank);
  g.userData.seat = V(-0.2, 0.86, 0);
  return g;
}

/** Spins the wheels (call every frame with how far the vehicle moved). */
export function rollWheels(v: THREE.Group, dist: number) {
  for (const w of v.userData.wheels as THREE.Object3D[]) w.rotation.z -= dist / 0.25;
}
