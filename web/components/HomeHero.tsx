"use client";
// The homepage's first screen. Behind everything: the whole collection, all 2,000 Trenchers, as one dark wall that
// drifts slowly; a torch follows the pointer and lights up the agents under it, and agents across the wall wake up
// for a moment in the colour of the part on show. In front: the line "Make it ___", one large Trencher that changes
// with every part (pixel by pixel), and a bar along the bottom with the five parts.
import { useCallback, useEffect, useRef, useState } from "react";
import { STEPS } from "@/lib/steps";
import { ROUTES, LIST_PRICE_ETH } from "@/lib/constants";
import { drawArt, loadArt } from "@/lib/art-vector";

const CYCLE = 5200; // ms each part stays on show
const TILE = 46, GAP = 6, COLS = 50, ROWS = 40; // the wall: 50 x 40 = 2,000
const HEROES: Record<string, number[]> = {
  trade: [1153, 862, 107], think: [599, 1314, 1869], talk: [217, 278, 1339], launch: [1464, 247, 1045], borrow: [768, 198, 1597],
};
const TONE: Record<string, string> = { green: "57,255,136", amber: "255,176,32", violet: "183,156,255", ice: "110,200,255", gold: "242,211,107" };
const verbOf = (v: string) => v.replace(/^Make it /i, "");
/** The name shown here; the credit layer is called Agentic Credit on this screen. */
const nameOf = (x: { key: string; product: string }) => (x.key === "borrow" ? "Agentic Credit" : x.product);
const GLYPHS = "▓▒░#$%&@*+=";

/** The wall of all 2,000, the torch and the wake-ups. */
function Wall({ tone }: { tone: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const toneRef = useRef(tone);
  toneRef.current = tone;
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const g = cv.getContext("2d"); if (!g) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, alive = true, visible = true, wall: HTMLCanvasElement | null = null;
    const torch = { x: -1, y: -1, tx: -1, ty: -1, on: false };
    const wakes: { i: number; born: number }[] = [];
    let lastWake = 0, w = 0, h = 0, dpr = 1;

    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth; h = cv.clientHeight; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    };
    const build = () => {
      const c = document.createElement("canvas"); c.width = COLS * TILE; c.height = ROWS * TILE;
      const x = c.getContext("2d")!; x.fillStyle = "#0B0D0C"; x.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < COLS * ROWS; i++) {
        const tx = (i % COLS) * TILE + GAP / 2, ty = Math.floor(i / COLS) * TILE + GAP / 2, s = TILE - GAP;
        x.save(); x.beginPath(); x.roundRect(tx, ty, s, s, 6); x.clip(); drawArt(x, i + 1, s, tx, ty); x.restore();
      }
      wall = c;
    };
    // where the wall sits: a slow drift, so the collection is always moving a little
    const offset = (t: number) => {
      const W = COLS * TILE, H = ROWS * TILE;
      const ox = -((W - w) / 2) + Math.sin(t / 26000) * Math.min(260, (W - w) / 2);
      const oy = -((H - h) / 2) + Math.cos(t / 31000) * Math.min(140, (H - h) / 2);
      return [ox, oy];
    };
    const frame = (t: number) => {
      if (!alive) return;
      if (wall && visible) {
        const [ox, oy] = offset(still ? 0 : t);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        // 1. the wall, dimmed
        g.globalAlpha = 1; g.drawImage(wall, ox, oy);
        g.fillStyle = "rgba(11,13,12,0.80)"; g.fillRect(0, 0, w, h);
        // 2. the torch: the wall at full brightness inside a soft circle
        if (torch.x < 0) { torch.x = w * 0.72; torch.y = h * 0.42; }
        if (!torch.on) { torch.tx = w * (0.70 + Math.sin(t / 3700) * 0.12); torch.ty = h * (0.45 + Math.cos(t / 4300) * 0.2); }
        torch.x += (torch.tx - torch.x) * 0.08; torch.y += (torch.ty - torch.y) * 0.08;
        const R = Math.max(170, Math.min(w, h) * 0.32);
        g.save(); g.beginPath(); g.arc(torch.x, torch.y, R, 0, Math.PI * 2); g.clip();
        const grd = g.createRadialGradient(torch.x, torch.y, 0, torch.x, torch.y, R);
        grd.addColorStop(0, "rgba(0,0,0,0)"); grd.addColorStop(0.55, "rgba(11,13,12,0.25)"); grd.addColorStop(1, "rgba(11,13,12,0.80)");
        g.drawImage(wall, ox, oy); g.fillStyle = grd; g.fillRect(torch.x - R, torch.y - R, R * 2, R * 2);
        g.restore();
        // 3. wake-ups: single agents light up for a moment, outlined in the colour on show
        const rgb = TONE[toneRef.current] ?? TONE.green;
        if (!still && t - lastWake > 140) {
          lastWake = t;
          const c = Math.floor((-ox + Math.random() * w) / TILE), r = Math.floor((-oy + Math.random() * h) / TILE);
          if (c >= 0 && c < COLS && r >= 0 && r < ROWS) wakes.push({ i: r * COLS + c, born: t });
        }
        for (let k = wakes.length - 1; k >= 0; k--) {
          const a = (t - wakes[k].born) / 1800; if (a >= 1) { wakes.splice(k, 1); continue; }
          const env = Math.sin(a * Math.PI);
          const i = wakes[k].i, sx = (i % COLS) * TILE + GAP / 2, sy = Math.floor(i / COLS) * TILE + GAP / 2, s = TILE - GAP;
          const x = ox + sx, y = oy + sy;
          g.save(); g.globalAlpha = env; g.drawImage(wall, sx, sy, s, s, x, y, s, s);
          g.strokeStyle = `rgba(${rgb},${0.9 * env})`; g.lineWidth = 1.5; g.shadowColor = `rgba(${rgb},1)`; g.shadowBlur = 14 * env;
          g.beginPath(); g.roundRect(x - 1, y - 1, s + 2, s + 2, 7); g.stroke(); g.restore();
        }
      }
      if (!still) raf = requestAnimationFrame(frame);
    };

    size();
    const ro = new ResizeObserver(() => { size(); if (still) frame(0); }); ro.observe(cv);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(cv);
    const host = cv.parentElement!;
    const move = (e: PointerEvent) => { if (e.pointerType === "touch") return; const b = cv.getBoundingClientRect(); torch.on = true; torch.tx = e.clientX - b.left; torch.ty = e.clientY - b.top; };
    const leave = () => { torch.on = false; };
    host.addEventListener("pointermove", move); host.addEventListener("pointerleave", leave);
    loadArt().then(() => { if (!alive) return; build(); if (still) frame(0); else raf = requestAnimationFrame(frame); });
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave); };
  }, []);
  return <canvas ref={ref} className="hh-wall" aria-hidden="true" />;
}

/** One large Trencher. A new one arrives pixel by pixel. */
function Portrait({ id }: { id: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const g = cv.getContext("2d"); if (!g) return;
    let raf = 0, alive = true;
    const run = async () => {
      await loadArt(); if (!alive) return;
      const S = cv.width;
      const next = document.createElement("canvas"); next.width = next.height = S; drawArt(next.getContext("2d")!, id, S);
      const from = prev.current; prev.current = id;
      if (from === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { g.drawImage(next, 0, 0); return; }
      const old = document.createElement("canvas"); old.width = old.height = S; drawArt(old.getContext("2d")!, from, S);
      const N = 28, cell = S / N, order = Array.from({ length: N * N }, (_, i) => i).sort(() => Math.random() - 0.5);
      const t0 = performance.now(), D = 650;
      const step = (now: number) => {
        if (!alive) return;
        const p = Math.min(1, (now - t0) / D), k = Math.floor(order.length * p * p);
        g.drawImage(old, 0, 0);
        for (let j = 0; j < k; j++) { const i = order[j], x = (i % N) * cell, y = Math.floor(i / N) * cell; g.drawImage(next, x, y, cell, cell, x, y, cell, cell); }
        if (p < 1) raf = requestAnimationFrame(step); else g.drawImage(next, 0, 0);
      };
      raf = requestAnimationFrame(step);
    };
    run();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [id]);
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

  return (
    <section id="path" className={`hh tone-${s.tone}`} aria-label="Trenchers" style={{ ["--cycle" as string]: `${CYCLE}ms` }}>
      <Wall tone={s.tone} />
      <div className="hh-shade" aria-hidden="true" />
      <div className="hh-in">
        <div className="hh-copy">
          <p className="hh-k mono"><span className="live-dot" />2,000 AI agents on Robinhood Chain</p>
          <h1 className="hh-title">
            <span className="hh-l1">One NFT Agent.</span>
            <span className="hh-l1 hh-l1b">Make it</span>
            <span className="hh-l2"><Verb text={verbOf(s.verb)} /><span className="hh-dot">.</span></span>
            <span className="sr-only">Make it trade, think, talk, launch and borrow.</span>
          </h1>
          <p className="hh-what" aria-live="polite"><b>{nameOf(s)}.</b> {s.what}</p>
          <div className="hh-cta">
            <a href={ROUTES.mint} className="hh-mint mono" aria-label={`Mint a Trencher for ${LIST_PRICE_ETH} ETH`}>Mint</a>
            <a href={s.home} className="hh-go">Open {nameOf(s).replace(/^The /, "the ")}</a>
          </div>
        </div>
        <figure className="hh-fig">
          <span className="hh-halo" aria-hidden="true" />
          <Portrait id={id} />
          <figcaption className="mono"><span>Trencher #{id}</span><span>{s.verb.toLowerCase()}</span></figcaption>
        </figure>
        <nav className={`hh-bar${paused ? " paused" : ""}`} aria-label="What you can make it do" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
          {STEPS.map((x, i) => (
            <button key={x.key} type="button" className={`hh-tab tone-${x.tone}${i === on ? " on" : ""}`} aria-pressed={i === on} onClick={() => pick(i)} onFocus={() => i !== on && pick(i)}>
              <span className="hh-prog" aria-hidden="true"><i key={i === on ? `${turn}-${paused}` : "off"} /></span>
              <span className="hh-tn mono">{x.n}</span>
              <b>{verbOf(x.verb)}</b>
              <span className="hh-tp">{nameOf(x)}</span>
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}
