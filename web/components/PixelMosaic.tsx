"use client";
import { useEffect, useRef } from "react";
import ids from "@/lib/nft-ids.json";

/**
 * Full-bleed canvas of Trenchers that assemble themselves cell by cell, the same 28x28 cell
 * grid the art is generated on, then periodically dissolve into a different Trencher.
 */
const CELLS = 28;              // 24 art cells + 2 margin on each side
const TILE_MIN = 84;           // tile size in CSS px, grows with screen width
const ASSEMBLE_MS = 1800;      // time for one tile to assemble
const SWAP_EVERY_MS = 650;     // how often some tile swaps to a new Trencher

type Tile = { img: number; prev: number; order: Uint16Array; start: number; delay: number };

export function PixelMosaic({ dim = 0.25, exiting = false }: { dim?: number; exiting?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const exitRef = useRef(exiting);
  exitRef.current = exiting;

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const images: HTMLImageElement[] = (ids as number[]).map((id) => {
      const im = new Image();
      im.src = `/nft/${id}.webp`;
      return im;
    });

    let cols = 0, rows = 0, size = 0, ox = 0, oy = 0, tiles: Tile[] = [], raf = 0, lastSwap = 0, exitAt = 0;
    const shuffled = () => {
      const a = new Uint16Array(CELLS * CELLS).map((_, i) => i);
      for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    const pick = (avoid: number) => { let n; do { n = (Math.random() * images.length) | 0; } while (n === avoid && images.length > 1); return n; };

    function layout() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth, h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      size = Math.max(TILE_MIN, Math.round(w / (w < 600 ? 4.2 : 11)));
      cols = Math.ceil(w / size) + 1; rows = Math.ceil(h / size) + 1;
      ox = (w - cols * size) / 2; oy = (h - rows * size) / 2;
      const now = performance.now();
      tiles = Array.from({ length: cols * rows }, (_, i) => {
        const c = i % cols, r = (i / cols) | 0;
        // assemble outward from the centre on first load
        const dist = Math.hypot(c - cols / 2, r - rows / 2);
        return { img: pick(-1), prev: -1, order: shuffled(), start: now, delay: reduce ? 0 : dist * 150 + Math.random() * 400 };
      });
    }

    function drawTile(t: Tile, x: number, y: number, now: number) {
      const cell = size / CELLS;
      const p = reduce ? 1 : Math.min(1, Math.max(0, (now - t.start - t.delay) / ASSEMBLE_MS));
      const shown = Math.floor(p * t.order.length);
      const im = images[t.img], prev = t.prev >= 0 ? images[t.prev] : null;
      if (prev && prev.complete && shown < t.order.length) ctx.drawImage(prev, x, y, size, size);
      if (!im.complete || !im.naturalWidth) return;
      if (shown >= t.order.length) { ctx.drawImage(im, x, y, size, size); return; }
      const s = im.naturalWidth / CELLS;
      for (let k = 0; k < shown; k++) {
        const idx = t.order[k], cr = (idx / CELLS) | 0, cc = idx % CELLS;
        ctx.drawImage(im, cc * s, cr * s, s, s, x + cc * cell, y + cr * cell, cell + 0.5, cell + 0.5);
      }
    }

    function frame(now: number) {
      const w = window.innerWidth, h = window.innerHeight;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
      if (!reduce && now - lastSwap > SWAP_EVERY_MS && tiles.length) {
        lastSwap = now;
        const t = tiles[(Math.random() * tiles.length) | 0];
        t.prev = t.img; t.img = pick(t.img); t.order = shuffled(); t.start = now; t.delay = 0;
      }
      if (exitRef.current && !exitAt) exitAt = now;
      const e = exitAt ? Math.min(1, (now - exitAt) / 700) : 0;
      const gap = Math.max(2, size * 0.04);
      for (let i = 0; i < tiles.length; i++) {
        const c = i % cols, r = (i / cols) | 0;
        let x = ox + c * size, y = oy + r * size;
        if (e) { // tiles fly outward from the centre on exit
          const dx = x + size / 2 - w / 2, dy = y + size / 2 - h / 2;
          x += dx * e * 0.6; y += dy * e * 0.6;
        }
        ctx.save();
        ctx.beginPath(); ctx.rect(x + gap / 2, y + gap / 2, size - gap, size - gap); ctx.clip();
        drawTile(tiles[i], x, y, now);
        ctx.restore();
      }
      // vignette keeps the centre readable
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.12, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, `rgba(0,0,0,${Math.min(1, dim + 0.55)})`);
      g.addColorStop(1, `rgba(0,0,0,${dim})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      if (e) { ctx.fillStyle = `rgba(0,0,0,${e})`; ctx.fillRect(0, 0, w, h); }
      raf = requestAnimationFrame(frame);
    }

    layout();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", layout);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", layout); };
  }, [dim]);

  return <canvas ref={ref} aria-hidden="true" className="mosaic" />;
}
