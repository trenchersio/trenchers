"use client";
// The homepage's first screen. Behind everything: the whole collection, all 2,000 Trenchers, as one dark wall that
// drifts slowly; a torch follows the pointer and lights up the agents under it, and agents across the wall wake up
// for a moment in the colour of the part on show. In front: the line "Make it ___", one large Trencher that changes
// with every part (pixel by pixel), and a bar along the bottom with the five parts.
import { useCallback, useEffect, useRef, useState } from "react";
import { STEPS } from "@/lib/steps";
import { ROUTES, LIST_PRICE_ETH, CREDIT_LIVE } from "@/lib/constants";

const CYCLE = 5200; // ms each part stays on show
const TILE = 46, GAP = 6, COLS = 50, ROWS = 40; // the wall: 50 x 40 = 2,000
const HEROES: Record<string, number[]> = {
  trade: [1153, 862, 107], think: [599, 1314, 1869], talk: [217, 278, 1339], launch: [1464, 247, 1045], borrow: [768, 198, 1597],
};
const verbOf = (v: string) => v.replace(/^Make it /i, "");
/** The name shown here; the credit layer is called Agentic Credit on this screen. */
const nameOf = (x: { key: string; product: string }) => (x.key === "borrow" ? "Agentic Credit" : x.product);
const GLYPHS = "▓▒░#$%&@*+=";

/** The wall of all 2,000: one pre-rendered, dimmed image (public/home/wall-dim.webp) that drifts slowly. A torch
 *  follows the pointer (or wanders on its own) and brightens the agents under it, and single agents across the wall
 *  wake up for a moment in the colour of the part on show (the section's --tone). Everything moves on the GPU:
 *  transforms and a backdrop brightness, so nothing is redrawn frame by frame. */
function Wall() {
  const host = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const torch = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const el = host.current, lt = torch.current, wl = layer.current; if (!el || !lt || !wl) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, alive = true, visible = true, pointer = false, x = -1, y = -1, tx = 0, ty = 0, last = 0;
    const R = () => lt.offsetWidth / 2;
    const place = () => { lt.style.transform = `translate3d(${x - R()}px, ${y - R()}px, 0)`; };
    const tick = (t: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(tick);
      if (!visible || t - last < 30) return; // ~30 fps is plenty for a soft light
      last = t;
      const w = el.clientWidth, h = el.clientHeight;
      if (x < 0) { x = w * 0.72; y = h * 0.42; }
      if (!pointer) { tx = w * (0.70 + Math.sin(t / 3700) * 0.12); ty = h * (0.45 + Math.cos(t / 4300) * 0.2); }
      x += (tx - x) * 0.12; y += (ty - y) * 0.12; place();
    };
    const move = (e: PointerEvent) => { if (e.pointerType === "touch") return; const b = el.getBoundingClientRect(); pointer = true; tx = e.clientX - b.left; ty = e.clientY - b.top; };
    const leave = () => { pointer = false; };
    const section = el.parentElement!;
    section.addEventListener("pointermove", move); section.addEventListener("pointerleave", leave);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(el);
    // wake-ups: a few agents at a time, placed in wall coordinates near the middle of the view
    const wake = still ? 0 : window.setInterval(() => {
      if (!visible || document.hidden) return;
      const w = el.clientWidth, h = el.clientHeight;
      const c = Math.floor((COLS * TILE - w) / 2 / TILE + Math.random() * (w / TILE));
      const r = Math.floor((ROWS * TILE - h) / 2 / TILE + Math.random() * (h / TILE));
      const d = document.createElement("i");
      d.className = "hh-wake";
      d.style.transform = `translate3d(${c * TILE + GAP / 2}px, ${r * TILE + GAP / 2}px, 0)`;
      d.addEventListener("animationend", () => d.remove());
      wl.appendChild(d);
    }, 450);
    if (still) { x = el.clientWidth * 0.72; y = el.clientHeight * 0.42; place(); } else raf = requestAnimationFrame(tick);
    return () => { alive = false; cancelAnimationFrame(raf); clearInterval(wake); io.disconnect(); section.removeEventListener("pointermove", move); section.removeEventListener("pointerleave", leave); };
  }, []);
  return (
    <div className="hh-wall" ref={host} aria-hidden="true">
      <div className={`hh-drift${ready ? " in" : ""}`}>
        <div className="hh-drift-y" ref={layer}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="home/wall-dim.webp" alt="" width={COLS * TILE} height={ROWS * TILE} decoding="async" fetchPriority="low" onLoad={() => setReady(true)} ref={(im) => { if (im?.complete && im.naturalWidth) setReady(true); }} />
        </div>
      </div>
      <div className="hh-torch" ref={torch} />
    </div>
  );
}

/** One large Trencher (pre-rendered at 840px in public/home/p). A new one arrives pixel by pixel. */
const portraitCache = new Map<number, Promise<HTMLImageElement>>();
function portrait(id: number) {
  let p = portraitCache.get(id);
  if (!p) { p = new Promise((ok, no) => { const im = new Image(); im.decoding = "async"; im.onload = () => ok(im); im.onerror = no; im.src = `home/p/${id}.webp`; }); portraitCache.set(id, p); }
  return p;
}
function Portrait({ id, next }: { id: number; next?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const shown = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const g = cv.getContext("2d"); if (!g) return;
    let raf = 0, alive = true;
    portrait(id).then((im) => {
      if (!alive) return;
      const S = cv.width, old = shown.current; shown.current = im;
      if (next) portrait(next).catch(() => {}); // warm the next one
      if (!old || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { g.drawImage(im, 0, 0, S, S); return; }
      const N = 28, cell = S / N, k = im.naturalWidth / S, order = Array.from({ length: N * N }, (_, i) => i).sort(() => Math.random() - 0.5);
      const t0 = performance.now(), D = 650; let done = 0;
      g.drawImage(old, 0, 0, S, S);
      const step = (now: number) => {
        if (!alive) return;
        const p = Math.min(1, (now - t0) / D), upto = Math.floor(order.length * p * p);
        for (; done < upto; done++) { const i = order[done], x = (i % N) * cell, y = Math.floor(i / N) * cell; g.drawImage(im, x * k, y * k, cell * k, cell * k, x, y, cell, cell); }
        if (p < 1) raf = requestAnimationFrame(step); else g.drawImage(im, 0, 0, S, S);
      };
      raf = requestAnimationFrame(step);
    }).catch(() => {});
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [id, next]);
  return <canvas ref={ref} width={840} height={840} className="hh-art" aria-hidden="true" />;
}

/** The verb, settling out of noise when it changes. */
function Verb({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(text); return; }
    let n = 0; const total = 9;
    const id = setInterval(() => {
      n++;
      const keep = Math.floor((n / total) * text.length);
      setShown(text.split("").map((ch, i) => (i < keep ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(""));
      if (n >= total) { clearInterval(id); setShown(text); }
    }, 38);
    return () => clearInterval(id);
  }, [text]);
  return <span className="hh-verb" aria-hidden="true">{shown}</span>;
}

export function HomeHero() {
  const [on, setOn] = useState(0);
  const [turn, setTurn] = useState(0); // restarts the progress bar
  const [paused, setPaused] = useState(false);
  const pick = useCallback((i: number) => { setOn(i); setTurn((n) => n + 1); }, []);
  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => pick((on + 1) % STEPS.length), CYCLE);
    return () => clearTimeout(t);
  }, [on, turn, paused, pick]);
  const s = STEPS[on];
  const ids = HEROES[s.key] ?? [1];
  const id = ids[turn % ids.length];
  const nx = STEPS[(on + 1) % STEPS.length], nids = HEROES[nx.key] ?? [1], nextId = nids[(turn + 1) % nids.length];

  return (
    <section id="path" className={`hh tone-${s.tone}`} aria-label="Trenchers" style={{ ["--cycle" as string]: `${CYCLE}ms` }}>
      <Wall />
      <div className="hh-shade" aria-hidden="true" />
      <div className="hh-in">
        <div className="hh-copy">
          <p className="hh-k mono"><span className="live-dot" />Trenchers Agentic Finance Ecosystem</p>
          <h1 className="hh-title">
            <span className="hh-l1">Protocols to</span>
            <span className="hh-l1 hh-l1b">Make Agents</span>
            <span className="hh-l2"><Verb text={verbOf(s.verb)} /><span className="hh-dot">.</span></span>
            <span className="sr-only">Protocols to make agents trade, think, talk, launch and borrow.</span>
          </h1>
          <p className="hh-what" aria-live="polite"><b>{nameOf(s)}.</b> {s.what}</p>
          <div className="hh-cta">
            <a href={ROUTES.mint} className="hh-mint mono" aria-label={`Mint a Trencher for ${LIST_PRICE_ETH} ETH`}>Mint</a>
            <a href={s.home} className="hh-go">{s.key === "borrow" && !CREDIT_LIVE ? "Preview" : "Open"} {nameOf(s).replace(/^The /, "the ")}</a>
            {s.key === "borrow" && !CREDIT_LIVE && <span className="hh-soon mono">Coming soon</span>}
          </div>
        </div>
        <figure className="hh-fig">
          <span className="hh-halo" aria-hidden="true" />
          <Portrait id={id} next={nextId} />
          <figcaption className="mono"><span>Trencher #{id}</span><span>{s.verb.toLowerCase()}</span></figcaption>
        </figure>
        <nav className={`hh-bar${paused ? " paused" : ""}`} aria-label="What you can make it do" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
          {STEPS.map((x, i) => (
            <button key={x.key} type="button" className={`hh-tab tone-${x.tone}${i === on ? " on" : ""}`} aria-pressed={i === on} onClick={() => pick(i)} onFocus={() => i !== on && pick(i)}>
              <span className="hh-prog" aria-hidden="true"><i key={i === on ? `${turn}-${paused}` : "off"} /></span>
              <span className="hh-tn mono">{x.n}</span>
              <b>{verbOf(x.verb)}</b>
              <span className="hh-tp">{nameOf(x)}{x.key === "borrow" && !CREDIT_LIVE && <em className="hh-soon-s mono"> · soon</em>}</span>
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}
