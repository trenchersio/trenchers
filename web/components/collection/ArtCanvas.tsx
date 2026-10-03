"use client";
import { useEffect, useRef } from "react";
import { drawArt, loadArt } from "@/lib/art-vector";

const PREFIX = "";

/** A Trencher drawn as vectors on a canvas sized for the screen's pixel density: always sharp. */
export function ArtCanvas({ id, size, className, label }: { id: number; size: number; className?: string; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const c = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = Math.round(size * dpr); c.height = Math.round(size * dpr);
    loadArt(PREFIX).then(() => {
      if (!alive) return;
      const ctx = c.getContext("2d")!;
      drawArt(ctx, id, c.width);
    });
    return () => { alive = false; };
  }, [id, size]);
  return <canvas ref={ref} className={className} style={{ width: size, height: size }} role="img" aria-label={label ?? `Trencher #${id}`} />;
}
