/**
 * Walking on the land: a fine grid of free and blocked cells (walls, furniture, the pool), A* across it, then the
 * corners pulled tight and the line rounded into a smooth curve, sampled every few centimetres so the Trenchie can
 * glide along it at an eased speed.
 */
export type Pt = { x: number; y: number };
export type R = { x: number; y: number; w: number; d: number };

export class Nav {
  readonly n: number; private cell: number; private blocked: Uint8Array;
  constructor(private size: number, cell = 0.25) { this.cell = cell; this.n = Math.round(size / cell); this.blocked = new Uint8Array(this.n * this.n); }
  reset() { this.blocked.fill(0); for (let i = 0; i < this.n; i++) { this.set(i, 0); this.set(i, this.n - 1); this.set(0, i); this.set(this.n - 1, i); } }
  private set(i: number, j: number) { if (i >= 0 && j >= 0 && i < this.n && j < this.n) this.blocked[i + j * this.n] = 1; }
  private idx(p: Pt) { return [Math.max(0, Math.min(this.n - 1, Math.floor(p.x / this.cell))), Math.max(0, Math.min(this.n - 1, Math.floor(p.y / this.cell)))]; }
  /** Block a rectangle, grown by `pad` on every side (the Trenchie's own radius). */
  block(r: R, pad = 0.18) {
    const x0 = Math.floor((r.x - pad) / this.cell), x1 = Math.ceil((r.x + r.w + pad) / this.cell) - 1;
    const y0 = Math.floor((r.y - pad) / this.cell), y1 = Math.ceil((r.y + r.d + pad) / this.cell) - 1;
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) this.set(i, j);
  }
  blockCircle(c: Pt, rad: number) { this.block({ x: c.x - rad, y: c.y - rad, w: rad * 2, d: rad * 2 }, 0.12); }
  free(p: Pt) { const [i, j] = this.idx(p); return !this.blocked[i + j * this.n]; }
  /** The nearest free point (a spot can sit right against furniture). */
  nearestFree(p: Pt): Pt {
    if (this.free(p)) return p;
    for (let r = 1; r < 24; r++) for (let a = 0; a < 16; a++) { const q = { x: p.x + Math.cos((a / 16) * Math.PI * 2) * r * this.cell, y: p.y + Math.sin((a / 16) * Math.PI * 2) * r * this.cell }; if (this.free(q)) return q; }
    return p;
  }
  private los(a: Pt, b: Pt) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / (this.cell * 0.4));
    for (let k = 1; k < n; k++) if (!this.free({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })) return false;
    return true;
  }
  /** A smooth walkable route from a to b as points about 6 cm apart (falls back to a straight line). */
  route(a: Pt, b: Pt): Pt[] {
    const s = this.nearestFree(a), g = this.nearestFree(b), N = this.n;
    const [si, sj] = this.idx(s), [gi, gj] = this.idx(g), start = si + sj * N, goal = gi + gj * N;
    let corners: Pt[];
    if (this.los(s, g)) corners = [s, g];
    else {
      const gs = new Float32Array(N * N).fill(Infinity), from = new Int32Array(N * N).fill(-1), done = new Uint8Array(N * N);
      const open: number[] = [start], f = new Float32Array(N * N).fill(Infinity); gs[start] = 0;
      const h = (k: number) => { const dx = Math.abs((k % N) - gi), dy = Math.abs(Math.floor(k / N) - gj); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
      f[start] = h(start); let found = false, guard = 0;
      while (open.length && guard++ < 40000) {
        let bi = 0; for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
        const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
        if (cur === goal) { found = true; break; }
        if (done[cur]) continue; done[cur] = 1;
        const ci = cur % N, cj = Math.floor(cur / N);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue; const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nk = ni + nj * N; if (this.blocked[nk] || done[nk]) continue;
          if (di && dj && (this.blocked[ci + di + cj * N] || this.blocked[ci + (cj + dj) * N])) continue;
          const ng = gs[cur] + (di && dj ? 1.414 : 1);
          if (ng < gs[nk]) { gs[nk] = ng; from[nk] = cur; f[nk] = ng + h(nk); open.push(nk); }
        }
      }
      if (!found) corners = [s, g];
      else {
        const cells: Pt[] = []; for (let k = goal; k !== -1; k = from[k]) cells.push({ x: ((k % N) + 0.5) * this.cell, y: (Math.floor(k / N) + 0.5) * this.cell });
        cells.reverse(); cells[0] = s; cells[cells.length - 1] = g;
        corners = [s]; let i = 0;
        while (i < cells.length - 1) { let j = cells.length - 1; while (j > i + 1 && !this.los(cells[i], cells[j])) j--; corners.push(cells[j]); i = j; }
      }
    }
    return smooth([a, ...corners.slice(1, -1), b]);
  }
}

/** Rounds the corners of a polyline (quadratic fillets), then samples it evenly. */
export function smooth(p: Pt[], step = 0.06): Pt[] {
  if (p.length < 2) return p.slice();
  const out: Pt[] = [p[0]];
  const line = (a: Pt, b: Pt) => { const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / step)); for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }); };
  let cur = p[0];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y), r = Math.min(0.9, l1 * 0.45, l2 * 0.45);
    const e = { x: b.x + ((a.x - b.x) / (l1 || 1)) * r, y: b.y + ((a.y - b.y) / (l1 || 1)) * r }, x = { x: b.x + ((c.x - b.x) / (l2 || 1)) * r, y: b.y + ((c.y - b.y) / (l2 || 1)) * r };
    line(cur, e);
    const n = Math.max(2, Math.ceil((r * 1.6) / step));
    for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; out.push({ x: u * u * e.x + 2 * u * t * b.x + t * t * x.x, y: u * u * e.y + 2 * u * t * b.y + t * t * x.y }); }
    cur = x;
  }
  line(cur, p[p.length - 1]);
  return out;
}

/** Cumulative lengths along a sampled path. */
export function lengths(p: Pt[]) { const L = [0]; for (let i = 1; i < p.length; i++) L.push(L[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y)); return L; }
/** Point and heading at distance s along a sampled path. */
export function along(p: Pt[], L: number[], s: number) {
  const tot = L[L.length - 1]; s = Math.max(0, Math.min(tot, s));
  let lo = 0, hi = L.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
  const seg = L[hi] - L[lo] || 1, t = (s - L[lo]) / seg, a = p[lo], b = p[hi];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, yaw: Math.atan2(b.x - a.x, b.y - a.y) };
}
