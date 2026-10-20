"use client";
import { useEffect, useRef } from "react";
import { loadArt } from "@/lib/art-vector";
import { GATHER, type Resource } from "@/lib/trenchies-catalog";
import { Icon } from "./icons";
import type { Grow, Look } from "./types";

type Props = {
  look: Look; nft: number; celebrate?: number; grow: Grow; now: number;
  /** Your own land: the tree and the rock can be gathered. */
  mine: boolean; onGather?: (res: Resource) => void;
  /** Bumped by the game after a successful gather, so the Trenchie walks over and does it. */
  gathered?: { res: Resource; got: number; n: number } | null;
  busy?: Resource | null;
};

const left = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`; };

/** The living land in 3D, with HTML pinned onto it: nameplate, speech bubble, and the tree and rock cards. */
export function Land({ look, nft, celebrate = 0, grow, now, mine, onGather, gathered, busy, className = "" }: Props & { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const plate = useRef<HTMLDivElement>(null), bubble = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null), tree = useRef<HTMLDivElement>(null), rock = useRef<HTMLDivElement>(null);
  const world = useRef<import("./scene3d").World3D | null>(null);
  const latest = useRef({ look, nft, grow }); latest.current = { look, nft, grow };
  useEffect(() => {
    const c = ref.current!; let raf = 0, alive = true, last = performance.now(), ro: ResizeObserver | null = null;
    (async () => {
      const [{ World3D }] = await Promise.all([import("./scene3d"), loadArt().catch(() => null)]);
      if (!alive) return;
      const w = (world.current = new World3D(c, latest.current.look, latest.current.nft));
      w.setGrow(latest.current.grow);
      w.attach({ plate: plate.current, bubble: bubble.current, pop: pop.current, tree: tree.current, rock: rock.current });
      const size = () => { const r = c.getBoundingClientRect(); w.resize(Math.max(1, r.width), Math.max(1, r.height)); };
      size(); ro = new ResizeObserver(size); ro.observe(c);
      const frame = (t: number) => { if (!alive) return; const dt = Math.min(0.1, (t - last) / 1000); last = t; w.update(dt); w.render(); raf = requestAnimationFrame(frame); };
      raf = requestAnimationFrame(frame);
    })();
    let down = { x: 0, y: 0 };
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const pu = (e: PointerEvent) => { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; const r = c.getBoundingClientRect(); world.current?.click(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    c.addEventListener("pointerdown", pd); c.addEventListener("pointerup", pu);
    return () => { alive = false; cancelAnimationFrame(raf); ro?.disconnect(); c.removeEventListener("pointerdown", pd); c.removeEventListener("pointerup", pu); world.current?.dispose(); world.current = null; };
  }, []);
  useEffect(() => { world.current?.setLook(look, nft); }, [look, nft]);
  useEffect(() => { world.current?.setGrow(grow); }, [grow]);
  useEffect(() => { if (celebrate) world.current?.celebrate(); }, [celebrate]);
  useEffect(() => { if (gathered) world.current?.gather(gathered.res, gathered.got); }, [gathered]);

  const tag = (res: Resource) => {
    const at = grow[res], ready = !at || at <= now * 1000, g = GATHER[res];
    return (
      <div className="tg-pin-in">
        <div className={`tg-tag3 ${res}`}>
          <span className="tg-tag3-ic"><Icon n={res === "wood" ? "wood" : "stone"} size={15} /></span>
          <span className="tg-tag3-t"><small>{res === "wood" ? "Oak tree · wood" : "Stone rock · stone"}</small>
            <b>{ready ? `+${g.min}–${g.max} ${res}` : left(at - now * 1000)}</b></span>
          {mine && ready && <button type="button" className="tg-tag3-go" disabled={busy === res} onClick={() => onGather?.(res)}>{busy === res ? "…" : res === "wood" ? "Chop" : "Mine"}</button>}
          {!ready && <span className="tg-tag3-wait">regrowing</span>}
        </div>
        <i className="tg-tag3-stem" /><i className="tg-tag3-dot" />
      </div>
    );
  };
  return (
    <div className={`tg-landwrap ${className}`}>
      <canvas ref={ref} className="tg-land" aria-label={`${look.name}'s land`} />
      <div className="tg-pins" aria-hidden="false">
        <div ref={tree} className="tg-pin tg-pin-tag">{tag("wood")}</div>
        <div ref={rock} className="tg-pin tg-pin-tag">{tag("stone")}</div>
        <div ref={plate} className="tg-pin"><div className="tg-plate"><span className="tg-plate-lv">Lv {look.level ?? 1}</span><b>{look.name}</b>{look.x && <span className="tg-plate-x"><Icon n="x" size={9} />{look.x}</span>}</div></div>
        <div className="tg-pin tg-bubble" ref={bubble} />
        <div className="tg-pin tg-pop" ref={pop} />
      </div>
    </div>
  );
}
