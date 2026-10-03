"use client";
import { useEffect, useRef } from "react";
import ids from "@/lib/nft-ids.json";

/** One large Trencher that dissolves cell by cell into the next one. */
export function ArtCycler({ every = 3200 }: { every?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext("2d")!;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const list = (ids as number[]).filter((i) => i > 5);
    const CELLS = 28, S = 560;
    canvas.width = S; canvas.height = S;
    ctx.imageSmoothingEnabled = false;
    const load = (id: number) => { const im = new Image(); im.src = `/nft/${id}.webp`; return im; };
    let idx = Math.floor(Math.random() * list.length);
    let cur = load(list[idx]), prev: HTMLImageElement | null = null;
    let order = Array.from({ length: CELLS * CELLS }, (_, i) => i), start = performance.now(), raf = 0, last = start;
    const shuffle = () => order.sort(() => Math.random() - 0.5);
    const setLabel = () => { if (label.current) label.current.textContent = `#${list[idx]}`; };
    setLabel();
    function frame(now: number) {
      if (!reduce && now - last > every) {
        last = now; prev = cur; idx = (idx + 1) % list.length; cur = load(list[idx]); shuffle(); start = now; setLabel();
      }
      const p = reduce ? 1 : Math.min(1, (now - start) / 900);
      const shown = Math.floor(p * order.length), cell = S / CELLS;
      if (prev?.complete) ctx.drawImage(prev, 0, 0, S, S);
      if (cur.complete && cur.naturalWidth) {
        if (shown >= order.length) ctx.drawImage(cur, 0, 0, S, S);
        else {
          const s = cur.naturalWidth / CELLS;
          for (let k = 0; k < shown; k++) {
            const o = order[k], r = (o / CELLS) | 0, c = o % CELLS;
            ctx.drawImage(cur, c * s, r * s, s, s, c * cell, r * cell, cell + 0.5, cell + 0.5);
          }
        }
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [every]);
  return (
    <figure className="cycler">
      <canvas ref={ref} aria-label="Rotating preview of Trenchers" />
      <figcaption className="mono"><span ref={label} /> <span className="live-dot" /> agent preview</figcaption>
    </figure>
  );
}
