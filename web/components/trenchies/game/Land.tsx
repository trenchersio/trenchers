"use client";
import { useEffect, useRef, useState } from "react";
import { loadArt } from "@/lib/art-vector";
import { NET_EVERY } from "@/lib/trenchies-catalog";
import { Icon } from "./icons";
import type { Grow, Look } from "./types";
import type { Sky } from "./weather";

export type Guest = { name: string; nft: number; level: number; x?: string | null };
export type ChatMsg = { id: number; by: string; nft: number; text: string; at: number };
type Props = {
  look: Look; nft: number; celebrate?: number; grow: Grow; now: number;
  /** Your own land: the trading desk and the butterflies can be used. */
  mine: boolean;
  /** Catch butterflies (every 20 minutes): when the net is ready again, and what was caught last. */
  netAt?: number; onNet?: () => void; netted?: { got: string[]; n: number } | null; busy?: "net" | null;
  /** The trading desk: opening it, whether it's open (the Trenchie sits at its desk), and live prices for its screens. */
  onDesk?: () => void; atDesk?: boolean; ticker?: [number, number][];
  /** Placing a garden piece: the next tap on the ground comes back here. */
  onPick?: ((x: number, y: number) => void) | null;
  /** The weather over this land (checked every minute). */
  onSky?: (s: Sky) => void;
  /** Members on this land right now (their Trenchies walk around), and who the camera follows. */
  guests?: Guest[]; follow?: string | null;
  /** The land's chat: new lines show as bubbles over whoever said them. */
  chat?: ChatMsg[];
};

const left = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`; };

/** The living land in 3D, with HTML pinned onto it: nameplates, speech bubbles, and the desk and butterfly tags. */
export function Land({ look, nft, celebrate = 0, grow, now, mine, netAt = 0, onNet, netted, busy, onDesk, atDesk = false, ticker, onPick = null, onSky, guests = [], follow = null, chat, className = "" }: Props & { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const plate = useRef<HTMLDivElement>(null), bubble = useRef<HTMLDivElement>(null), pop = useRef<HTMLDivElement>(null), desk = useRef<HTMLDivElement>(null), net = useRef<HTMLDivElement>(null), layer = useRef<HTMLDivElement>(null);
  const world = useRef<import("./scene3d").World3D | null>(null);
  const latest = useRef({ look, nft, grow, guests, follow, onPick, onSky, atDesk, onDeskTap: mine ? onDesk : undefined }); latest.current = { look, nft, grow, guests, follow, onPick, onSky, atDesk, onDeskTap: mine ? onDesk : undefined };
  const seen = useRef<number>(-1);
  useEffect(() => {
    const c = ref.current!; let raf = 0, alive = true, last = performance.now(), ro: ResizeObserver | null = null, skyT = 0;
    // phones: a lighter renderer and at most ~40 frames a second (a hidden tab doesn't draw at all)
    const slow = window.matchMedia?.("(max-width: 720px)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
    (async () => {
      const [{ World3D }] = await Promise.all([import("./scene3d"), loadArt().catch(() => null)]);
      if (!alive) return;
      const w = (world.current = new World3D(c, latest.current.look, latest.current.nft, { lite: slow }));
      w.setGrow(latest.current.grow);
      w.attach({ plate: plate.current, bubble: bubble.current, pop: pop.current, desk: desk.current, net: net.current, layer: layer.current });
      w.setGuests(latest.current.guests, latest.current.follow);
      w.setDesk(latest.current.atDesk);
      if (latest.current.onPick) w.onGround = (x, y) => latest.current.onPick?.(x, y);
      w.onDesk = () => latest.current.onDeskTap?.();
      const size = () => { const r = c.getBoundingClientRect(); w.resize(Math.max(1, r.width), Math.max(1, r.height)); };
      size(); ro = new ResizeObserver(size); ro.observe(c);
      const frame = (t: number) => {
        if (!alive) return; raf = requestAnimationFrame(frame);
        if (document.hidden) { last = t; return; }
        const dt = Math.min(0.1, (t - last) / 1000); last = t;
        w.update(dt); w.render();
        if (!skyT || t - skyT > 60_000) { skyT = t; latest.current.onSky?.(w.weatherNow); }
      };
      raf = requestAnimationFrame(frame);
    })();
    let down = { x: 0, y: 0 };
    const pd = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const pu = (e: PointerEvent) => { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return; const r = c.getBoundingClientRect(); world.current?.click(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    c.addEventListener("pointerdown", pd); c.addEventListener("pointerup", pu);
    return () => { alive = false; cancelAnimationFrame(raf); ro?.disconnect(); c.removeEventListener("pointerdown", pd); c.removeEventListener("pointerup", pu); world.current?.dispose(); world.current = null; };
  }, []);
  useEffect(() => { world.current?.setLook(look, nft); }, [look, nft]);
  useEffect(() => { world.current?.setGrow(grow); }, [grow]);
  useEffect(() => { if (celebrate) world.current?.celebrate(); }, [celebrate]);
  useEffect(() => { if (netted) world.current?.net(netted.got); }, [netted]);
  useEffect(() => { world.current?.setDesk(atDesk); }, [atDesk]);
  useEffect(() => { if (ticker) world.current?.setTicker(ticker); }, [ticker]);
  useEffect(() => { if (world.current) world.current.onGround = onPick ? (x, y) => latest.current.onPick?.(x, y) : null; }, [onPick]);
  const gkey = guests.map((g) => `${g.name}:${g.level}`).join();
  useEffect(() => { world.current?.setGuests(latest.current.guests, latest.current.follow); }, [gkey, follow]);
  useEffect(() => {
    // the first load just remembers where the chat is; lines after that get bubbles
    if (!chat) return;
    const top = chat.length ? chat[chat.length - 1].id : 0;
    if (seen.current >= 0) for (const m of chat) if (m.id > seen.current && m.by) world.current?.sayAs(m.by, m.text);
    seen.current = Math.max(seen.current, top);
  }, [chat]);

  // direct control: arrow keys or WASD on a computer, a joystick on touch screens (your own land only)
  const [touch, setTouch] = useState(false), [hint, setHint] = useState(false);
  useEffect(() => { const t = window.matchMedia?.("(pointer: coarse)").matches ?? false; setTouch(t); if (!t && mine) { setHint(true); const h = setTimeout(() => setHint(false), 9000); return () => clearTimeout(h); } }, [mine]);
  useEffect(() => {
    if (!mine) return;
    const keys = new Set<string>(), K: Record<string, string> = { ArrowUp: "u", w: "u", W: "u", ArrowDown: "d", s: "d", S: "d", ArrowLeft: "l", a: "l", A: "l", ArrowRight: "r", d: "r", D: "r" };
    const set = () => { if (world.current) world.current.stick = { x: (keys.has("r") ? 1 : 0) - (keys.has("l") ? 1 : 0), y: (keys.has("u") ? 1 : 0) - (keys.has("d") ? 1 : 0) }; };
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); };
    const dn = (e: KeyboardEvent) => { const k = K[e.key]; if (!k || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return; e.preventDefault(); keys.add(k); set(); setHint(false); };
    const up = (e: KeyboardEvent) => { const k = K[e.key]; if (k) { keys.delete(k); set(); } };
    const clear = () => { keys.clear(); set(); };
    window.addEventListener("keydown", dn); window.addEventListener("keyup", up); window.addEventListener("blur", clear);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); window.removeEventListener("blur", clear); clear(); };
  }, [mine]);

  const ready = !netAt || netAt <= now * 1000;
  return (
    <div className={`tg-landwrap ${className}${onPick ? " picking" : ""}`}>
      <canvas ref={ref} className="tg-land" aria-label={`${look.name}'s land`} />
      <div className="tg-pins" ref={layer}>
        <div ref={desk} className="tg-pin tg-pin-tag">{mine && onDesk && !atDesk && (
          <div className="tg-pin-in"><button type="button" className="tg-tag3 desk" onClick={onDesk}>
            <span className="tg-tag3-ic"><Icon n="chart" size={15} /></span>
            <span className="tg-tag3-t"><small>Trading desk</small><b>BTC up or down</b></span>
            <span className="tg-tag3-go">Trade</span>
          </button><i className="tg-tag3-stem" /><i className="tg-tag3-dot" /></div>)}</div>
        <div ref={net} className="tg-pin tg-pin-tag">{mine && (
          <div className="tg-pin-in"><div className="tg-tag3 net">
            <span className="tg-tag3-ic"><Icon n="bug" size={15} /></span>
            <span className="tg-tag3-t"><small>Butterflies · every {NET_EVERY / 60} min</small><b>{ready ? "Ready to catch" : left(netAt - now * 1000)}</b></span>
            {ready && <button type="button" className="tg-tag3-go" disabled={busy === "net"} onClick={() => onNet?.()}>{busy === "net" ? "…" : "Catch"}</button>}
          </div><i className="tg-tag3-stem" /><i className="tg-tag3-dot" /></div>)}</div>
        <div ref={plate} className="tg-pin"><div className="tg-plate"><span className="tg-plate-lv">Lv {look.level ?? 1}</span><b>{look.name}</b>{look.x && <span className="tg-plate-x"><Icon n="x" size={9} />{look.x}</span>}</div></div>
        <div className="tg-pin tg-bubble" ref={bubble} />
        <div className="tg-pin tg-pop" ref={pop} />
      </div>
      {mine && touch && !onPick && !atDesk && <Stick onMove={(x, y) => { if (world.current) world.current.stick = { x, y }; }} />}
      {hint && !atDesk && <p className="tg-movehint"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys to walk · click the ground to go there</p>}
    </div>
  );
}

/** A thumb joystick for phones: drag from the middle, let go to stop. */
function Stick({ onMove }: { onMove: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null), [k, setK] = useState({ x: 0, y: 0, on: false }), R = 38;
  const at = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect(); let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(x, y); if (d > R) { x *= R / d; y *= R / d; }
    setK({ x, y, on: true }); onMove(x / R, -y / R);
  };
  const stop = () => { setK({ x: 0, y: 0, on: false }); onMove(0, 0); };
  return (
    <div ref={base} className={`tg-stick${k.on ? " on" : ""}`} aria-label="Walk" role="application"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }} onPointerMove={(e) => { if (k.on) at(e); }} onPointerUp={stop} onPointerCancel={stop}>
      <i style={{ transform: `translate(${k.x}px, ${k.y}px)` }} />
    </div>
  );
}
