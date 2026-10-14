"use client";
// The homepage's first screen: the Trencher at the centre of a dial, with the five things you make it do around it.
// One part is lit at a time (it moves on by itself until you point at one), and the card under the dial says what it is.
// Below the fold, HomeIndex lists all five at once, one row each.
import { useEffect, useRef, useState } from "react";
import { STEPS, type Step } from "@/lib/steps";

/** Some of the most colourful Trenchers (awake art), shown in turn at the centre. */
const AWAKE = [1153, 599, 217, 1464, 862, 768, 1314, 278, 247, 198, 107, 881, 191, 1869, 132, 259, 1339, 104, 1045, 1597, 1764, 1113, 1187, 875];
const R = 41; // ring radius, in % of the dial
const at = (i: number, r: number) => { const a = (-90 + i * (360 / STEPS.length)) * (Math.PI / 180); return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]; };
const verbOf = (s: Step) => s.verb.replace(/^Make it /i, "");

export function HomeDial() {
  const [on, setOn] = useState(STEPS.length - 1); // open on the newest part
  const [art, setArt] = useState(0);
  const held = useRef(false);   // pointer or focus is on the dial
  const picked = useRef(false); // someone chose a part: stop moving on
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = setInterval(() => setArt((n) => (n + 1) % AWAKE.length), 1800);
    const b = setInterval(() => { if (!held.current && !picked.current) setOn((n) => (n + 1) % STEPS.length); }, 3600);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  const s = STEPS[on];
  const [ex, ey] = at(on, R - 7);
  return (
    <div className={`hd tone-${s.tone}`} onPointerEnter={() => { held.current = true; }} onPointerLeave={() => { held.current = false; }}
      onFocus={() => { held.current = true; }} onBlur={() => { held.current = false; }}>
      <div className="hd-dial">
        <svg viewBox="0 0 100 100" className="hd-lines" aria-hidden="true">
          <circle cx="50" cy="50" r={R} className="hd-ring" />
          {STEPS.map((x, i) => { const [a, b] = at(i, 21), [c, d] = at(i, R - 7); return <line key={x.key} x1={a} y1={b} x2={c} y2={d} className={`hd-spoke${i === on ? " on" : ""}`} />; })}
          <circle key={on} r="0.9" className="hd-pulse"><animateMotion dur="1.6s" repeatCount="indefinite" path={`M${at(on, 21).join(" ")} L${ex} ${ey}`} /></circle>
        </svg>
        <div className="hd-core">
          <svg viewBox="0 0 200 200" className="hd-orbit" aria-hidden="true">
            <defs><path id="hd-ring" d="M100,100 m-90,0 a90,90 0 1,1 180,0 a90,90 0 1,1 -180,0" /></defs>
            <text><textPath href="#hd-ring" textLength="560" lengthAdjust="spacing">$TRENCHERS · every fee buys it back · inference burns it · sweeps the Trenchers floor ·</textPath></text>
          </svg>
          <span className="hd-art"><img key={art} src={`nft/${AWAKE[art]}.webp`} alt="" width={180} height={180} /></span>
        </div>
        {STEPS.map((x, i) => {
          const [l, t] = at(i, R);
          return (
            <button key={x.key} type="button" className={`hd-node tone-${x.tone}${i === on ? " on" : ""}`} style={{ left: `${l}%`, top: `${t}%` }}
              aria-pressed={i === on} aria-controls="hd-card" onClick={() => { picked.current = true; setOn(i); }} onMouseEnter={() => setOn(i)} onFocus={() => setOn(i)}>
              <i aria-hidden="true" />
              <b>{verbOf(x)}</b>
              <span className="mono">{x.product}</span>
            </button>
          );
        })}
      </div>
      <div className="hd-card" id="hd-card" aria-live="polite">
        <p className="hd-k mono">{s.verb}</p>
        <h2>{s.product}</h2>
        <p className="hd-what">{s.what}</p>
        <p className="hd-act">
          <a href={s.home} className="hd-open">Open {s.product.replace(/^The /, "the ")}</a>
          <span className="mono">{s.who}</span>
        </p>
      </div>
    </div>
  );
}

/** All five at once, one row each: the part, what it is, who it's for. */
export function HomeIndex() {
  return (
    <section className="hx" aria-label="What you can make it do">
      <h2 className="hx-h">Five things to make it do.</h2>
      <ol className="hx-list">
        {STEPS.map((s) => (
          <li key={s.key} className={`hx-row tone-${s.tone}`}>
            <a href={s.home} className="hx-link">
              <span className="hx-n mono">{s.n}</span>
              <b className="hx-v">{verbOf(s)}</b>
              <span className="hx-p"><b>{s.product}</b><span>{s.short}</span></span>
              <span className={`hx-who mono${s.open ? " open" : ""}`}>{s.who}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
