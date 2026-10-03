/**
 * Draws a Trencher from its vector description (public/collection/art.json, exported by
 * art/vector.py from the same generator as the PNGs), so the art is crisp at any size and DPR.
 */
type Row = [string, string, string, string, string, number, number, number, number, string];

const CELLS = 28, MARGIN = 2, N = 24, GAP = 0.1;
let data: Row[] | null = null;
let loading: Promise<Row[]> | null = null;

export function loadArt(prefix = ""): Promise<Row[]> {
  if (data) return Promise.resolve(data);
  if (!loading) loading = fetch(`${prefix}collection/art.json`).then((r) => r.json()).then((d: Row[]) => (data = d));
  return loading;
}
export const artReady = () => data !== null;

/** Draws token `id` filling a size x size square at (x, y) in the context's current units. */
export function drawArt(ctx: CanvasRenderingContext2D, id: number, size: number, x = 0, y = 0) {
  if (!data) return false;
  const [bg, main, second, eye, sig, eyeType, er, ec, scan, pieces] = data[id - 1];
  const u = size / CELLS;
  const tone = [main, second, sig];
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
  const rect = (x0: number, y0: number, w: number, h: number) => ctx.fillRect(x0 * u, y0 * u, w * u, h * u);
  const disc = (x0: number, y0: number, d: number) => { ctx.beginPath(); ctx.arc((x0 + d / 2) * u, (y0 + d / 2) * u, (d / 2) * u, 0, Math.PI * 2); ctx.fill(); };
  for (let i = 0; i < pieces.length; i += 3) {
    let v = parseInt(pieces.slice(i, i + 3), 36);
    const shift = (v % 3) - 1; v = (v / 3) | 0;
    const t = v % 3; v = (v / 3) | 0;
    const circle = v % 2 === 1; v = (v / 2) | 0;
    const s = (v % 3) + 1; v = (v / 3) | 0;
    const c = v % N, r = (v / N) | 0;
    ctx.fillStyle = tone[t];
    const x0 = c + MARGIN + shift + GAP, y0 = r + MARGIN + GAP, d = s - 2 * GAP;
    if (circle) disc(x0, y0, d); else rect(x0, y0, d, d);
  }
  // the eye: 2x2 cells
  const ex = ec + MARGIN, ey = er + MARGIN;
  ctx.fillStyle = eye;
  if (eyeType === 0) rect(ex + GAP, ey + GAP, 2 - 2 * GAP, 2 - 2 * GAP);
  else if (eyeType === 1) disc(ex + GAP, ey + GAP, 2 - 2 * GAP);
  else if (eyeType === 2) { disc(ex + GAP, ey + GAP, 2 - 2 * GAP); ctx.fillStyle = bg; disc(ex + 0.45, ey + 0.45, 2 - 0.9); }
  else { rect(ex + GAP, ey + GAP, 2 - 2 * GAP, 2 - 2 * GAP); ctx.fillStyle = bg; rect(ex + 0.4, ey + 0.4, 1.2, 1.2); ctx.fillStyle = eye; rect(ex + 0.75, ey + 0.75, 0.5, 0.5); }
  if (scan >= 0) { ctx.fillStyle = "rgba(57,255,136,0.235)"; rect(MARGIN, scan + MARGIN, N, 1); }
  ctx.restore();
  return true;
}

/** Background colour of a token (for placeholders before the art data loads). */
export const artBg = (id: number) => (data ? data[id - 1][0] : "#151917");
