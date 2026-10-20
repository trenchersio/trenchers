"use client";
import { useEffect, useRef } from "react";
import { loadArt } from "@/lib/art-vector";
import type { Look } from "./types";

/** The living plot in 3D: built once the Trencher art is loaded (it's the Trenchie's skin), then runs every frame. */
export function Land({ look, nft, celebrate = 0, className = "" }: { look: Look; nft: number; celebrate?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const world = useRef<import("./scene3d").World3D | null>(null);
  const latest = useRef({ look, nft }); latest.current = { look, nft };
  useEffect(() => {
    const c = ref.current!; let raf = 0, alive = true, last = performance.now(), ro: ResizeObserver | null = null;
    (async () => {
      const [{ World3D }] = await Promise.all([import("./scene3d"), loadArt().catch(() => null)]);
      if (!alive) return;
      const w = (world.current = new World3D(c, latest.current.look, latest.current.nft));
      const size = () => { const r = c.getBoundingClientRect(); w.resize(Math.max(1, r.width), Math.max(1, r.height)); };
      size(); ro = new ResizeObserver(size); ro.observe(c);
      const frame = (now: number) => { if (!alive) return; const dt = Math.min(0.1, (now - last) / 1000); last = now; w.update(dt); w.render(); raf = requestAnimationFrame(frame); };
      raf = requestAnimationFrame(frame);
    })();
    let down = { x: 0, y: 0 };
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const pu = (e: PointerEvent) => { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; const r = c.getBoundingClientRect(); world.current?.click(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    c.addEventListener("pointerdown", pd); c.addEventListener("pointerup", pu);
    return () => { alive = false; cancelAnimationFrame(raf); ro?.disconnect(); c.removeEventListener("pointerdown", pd); c.removeEventListener("pointerup", pu); world.current?.dispose(); world.current = null; };
  }, []);
  useEffect(() => { world.current?.setLook(look, nft); }, [look, nft]);
  useEffect(() => { if (celebrate) world.current?.celebrate(); }, [celebrate]);
  return <canvas ref={ref} className={`tg-land ${className}`} aria-label={`${look.name}'s land`} />;
}
