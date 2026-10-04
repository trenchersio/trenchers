import { drawArt, loadArt } from "./art-vector";

/**
 * Agent PnL card: a 1200 x 675 image (X's large-card ratio) in the Trenchers style, drawn on a
 * canvas so it can be downloaded or copied. Art comes from the same vectors as the collection.
 */
export type PnlCardData = {
  id: number;
  returnPct: number;          // total return, %
  pnlEth: number;             // profit in ETH
  balanceEth: number;         // agent wallet value
  biggest: { sym: string; pct: number } | null;
  strategy: string;           // short strategy name, e.g. "Guided · rule v3" or "Launch Flipper"
  rank?: { pos: number; of: number } | null;
  period?: string;            // e.g. "This week"
};

export const CARD_W = 1200, CARD_H = 675;
const C = { bg: "#0B0D0C", fog: "#E8ECE9", quiet: "#8A938E", line: "#232826", green: "#39FF88", red: "#FF5C5C", dark: "#0B0D0C", violet: "#B98CFF" };
const SANS = "'Space Grotesk', system-ui, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, monospace";

const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
const ethTxt = (v: number) => (Math.abs(v) >= 1 ? v.toFixed(3) : Math.abs(v) >= 0.01 ? v.toFixed(4) : v.toFixed(6));

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

let logo: HTMLImageElement | null = null;
function loadLogo(prefix: string) {
  if (logo?.complete) return Promise.resolve(logo);
  return new Promise<HTMLImageElement>((resolve) => {
    const img = new Image(); img.onload = () => { logo = img; resolve(img); }; img.onerror = () => resolve(img);
    img.src = `${prefix}brand/lockup.svg`;
  });
}

/** Draws the card onto `canvas` (sized to 1200 x 675 at the given scale). */
export async function renderPnlCard(canvas: HTMLCanvasElement, d: PnlCardData, opts: { scale?: number; prefix?: string } = {}) {
  const scale = opts.scale ?? 1, prefix = opts.prefix ?? "";
  await Promise.all([loadArt(prefix), loadLogo(prefix), document.fonts?.load(`700 64px ${SANS}`), document.fonts?.load(`500 20px ${MONO}`)].map((p) => p?.catch?.(() => null) ?? p));
  canvas.width = CARD_W * scale; canvas.height = CARD_H * scale;
  const g = canvas.getContext("2d")!;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  const up = d.returnPct >= 0;
  const accent = up ? C.green : C.red;

  // Background: dark, a faded wall of Trencher art on the right, a green glow.
  g.fillStyle = C.bg; g.fillRect(0, 0, CARD_W, CARD_H);
  const tile = 118, gap = 10;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    const id = ((d.id * 97 + r * 37 + c * 211) % 1995) + 6;
    const x = 560 + c * (tile + gap) - (r % 2) * 40, y = -30 + r * (tile + gap);
    g.save(); g.globalAlpha = 0.4; roundRect(g, x, y, tile, tile, 10); g.clip(); drawArt(g, id, tile, x, y); g.restore();
  }
  const fade = g.createLinearGradient(420, 0, 1200, 0);
  fade.addColorStop(0, "rgba(11,13,12,1)"); fade.addColorStop(0.45, "rgba(11,13,12,0.72)"); fade.addColorStop(1, "rgba(11,13,12,0.35)");
  g.fillStyle = fade; g.fillRect(0, 0, CARD_W, CARD_H);
  // Keep the header and footer text readable over the art wall.
  const top = g.createLinearGradient(0, 0, 0, 140); top.addColorStop(0, "rgba(11,13,12,0.85)"); top.addColorStop(1, "rgba(11,13,12,0)");
  g.fillStyle = top; g.fillRect(0, 0, CARD_W, 140);
  const bot = g.createLinearGradient(0, CARD_H - 190, 0, CARD_H); bot.addColorStop(0, "rgba(11,13,12,0)"); bot.addColorStop(1, "rgba(11,13,12,0.95)");
  g.fillStyle = bot; g.fillRect(0, CARD_H - 190, CARD_W, 190);
  const glow = g.createRadialGradient(150, 120, 0, 150, 120, 620);
  glow.addColorStop(0, up ? "rgba(57,255,136,0.16)" : "rgba(255,92,92,0.14)"); glow.addColorStop(1, "rgba(57,255,136,0)");
  g.fillStyle = glow; g.fillRect(0, 0, CARD_W, CARD_H);

  // Header: logo left, label right.
  if (logo?.naturalWidth) g.drawImage(logo, 64, 56, 288, 32);
  g.font = `500 18px ${MONO}`; g.fillStyle = C.quiet; g.textAlign = "right"; g.textBaseline = "middle";
  g.fillText(`AGENT PNL · ${(d.period ?? "ALL TIME").toUpperCase()}`, CARD_W - 64, 72);
  g.textAlign = "left";

  // Agent: art + name + strategy.
  const ax = 64, ay = 132, as = 150;
  g.save(); g.shadowColor = up ? "rgba(57,255,136,0.35)" : "rgba(255,92,92,0.3)"; g.shadowBlur = 40;
  roundRect(g, ax, ay, as, as, 16); g.fillStyle = C.bg; g.fill(); g.restore();
  g.save(); roundRect(g, ax, ay, as, as, 16); g.clip(); drawArt(g, d.id, as, ax, ay); g.restore();
  g.lineWidth = 2; g.strokeStyle = accent; roundRect(g, ax, ay, as, as, 16); g.stroke();
  g.fillStyle = C.fog; g.font = `700 46px ${SANS}`; g.fillText(`Trencher #${d.id}`, ax + as + 32, ay + 48);
  g.font = `500 20px ${MONO}`; g.fillStyle = C.quiet; g.fillText(d.strategy.length > 34 ? `${d.strategy.slice(0, 33)}…` : d.strategy, ax + as + 32, ay + 92);
  if (d.rank) {
    const t = `#${d.rank.pos} of ${d.rank.of} in the Arena`;
    g.font = `500 18px ${MONO}`; const w = g.measureText(t).width + 28;
    roundRect(g, ax + as + 32, ay + 116, w, 34, 8); g.fillStyle = "rgba(57,255,136,0.12)"; g.fill(); g.strokeStyle = "rgba(57,255,136,0.5)"; g.lineWidth = 1; g.stroke();
    g.fillStyle = C.green; g.fillText(t, ax + as + 46, ay + 134);
  }

  // The big number.
  const by = 330;
  g.font = `700 96px ${SANS}`;
  const big = `${signed(d.returnPct, Math.abs(d.returnPct) >= 100 ? 0 : 1)}%`;
  const bw = Math.max(380, g.measureText(big).width + 64);
  g.fillStyle = accent; g.fillRect(64, by, bw, 128);
  g.fillStyle = C.dark; g.fillText(big, 96, by + 68);

  // Stats.
  const rows: [string, string, string?][] = [
    ["PnL", `${signed(d.pnlEth, 4)} ETH`, accent],
    ["Balance", `${ethTxt(d.balanceEth)} ETH`],
    ["Biggest trade", d.biggest ? `${signed(d.biggest.pct, 0)}% · $${d.biggest.sym}` : "—", d.biggest ? (d.biggest.pct >= 0 ? C.green : C.red) : undefined],
  ];
  rows.forEach(([k, v, col], i) => {
    const y = by + 176 + i * 44;
    g.font = `500 26px ${SANS}`; g.fillStyle = C.quiet; g.fillText(k, 72, y);
    g.font = `500 26px ${MONO}`; g.fillStyle = col ?? C.fog; g.fillText(v, 330, y);
  });

  // Footer.
  g.font = `500 18px ${MONO}`; g.fillStyle = C.quiet; g.textAlign = "right";
  g.fillText("Self-funding trading agents with an identity", CARD_W - 64, CARD_H - 92);
  g.fillStyle = C.green; g.font = `600 24px ${MONO}`; g.fillText("trenchers.io", CARD_W - 64, CARD_H - 56);
  g.textAlign = "left";
  return canvas;
}

export function cardBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
