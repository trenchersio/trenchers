"use client";
// How Trenchers fits together: the Trencher sits on top of everything, and each part around it is something you make
// it do. The core overlaps the inner corner of the first four; the fifth, Trenchers Credit, runs underneath them all,
// joined to the core by a line through the middle.
import { useEffect, useState } from "react";
import { HUB, STEPS, type Step } from "@/lib/steps";
import { ROUTES } from "@/lib/constants";

/** A small motif per part, drawn in its colour: a price line, speech, a coin taking off, a mind. */
function Motif({ k }: { k: Step["key"] }) {
  if (k === "trade") return (
    <svg viewBox="0 0 120 44" className="eco-motif" aria-hidden="true">
      <path d="M2 36 L18 30 L30 33 L44 22 L58 26 L72 14 L86 18 L100 8 L118 4" className="m-line m-draw" pathLength={100} />
      <path d="M2 36 L18 30 L30 33 L44 22 L58 26 L72 14 L86 18 L100 8 L118 4 L118 44 L2 44 Z" className="m-area" />
      <circle cx="118" cy="4" r="3" className="m-dot" />
    </svg>
  );
  if (k === "talk") return (
    <svg viewBox="0 0 120 44" className="eco-motif" aria-hidden="true">
      <rect x="4" y="4" width="62" height="18" rx="6" className="m-box" /><path d="M14 22 L12 30 L22 22" className="m-box" />
      <rect x="40" y="24" width="74" height="16" rx="6" className="m-box m-fill" />
      <circle cx="16" cy="13" r="2" className="m-dot m-type" /><circle cx="25" cy="13" r="2" className="m-dot m-type" style={{ animationDelay: ".2s" }} /><circle cx="34" cy="13" r="2" className="m-dot m-type" style={{ animationDelay: ".4s" }} />
    </svg>
  );
  if (k === "borrow") return (
    <svg viewBox="0 0 160 44" className="eco-motif eco-motif-wide" aria-hidden="true">
      {/* a credit line: drawn, held, paid back */}
      <rect x="2" y="16" width="156" height="12" rx="6" className="m-box" />
      <rect x="2" y="16" width="96" height="12" rx="6" className="m-box m-fill m-draw-bar" />
      <path d="M98 10 C 112 -2, 140 -2, 152 10" className="m-line m-dash" />
      <path d="M150 5 L153 11 L146 11 Z" className="m-dot" />
      <circle cx="98" cy="22" r="3" className="m-dot m-glow" />
      <text x="2" y="42" className="m-t m-t-l">LINE</text><text x="158" y="42" className="m-t m-t-r">REPAID</text>
    </svg>
  );
  if (k === "launch") return (
    <svg viewBox="0 0 120 44" className="eco-motif" aria-hidden="true">
      <path d="M6 40 C 40 40, 70 34, 96 10" className="m-line m-dash" />
      <g className="m-coin"><circle cx="98" cy="9" r="7" className="m-box m-fill" /><text x="98" y="12" className="m-t">$</text></g>
      <circle cx="30" cy="38" r="2" className="m-dot" /><circle cx="56" cy="33" r="2" className="m-dot" /><circle cx="78" cy="23" r="2" className="m-dot" />
    </svg>
  );
  return (
    <svg viewBox="0 0 120 44" className="eco-motif" aria-hidden="true">
      {[[12, 10], [12, 34], [44, 6], [44, 22], [44, 38], [78, 14], [78, 30], [108, 22]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="3" className={i === 7 ? "m-dot m-glow m-node" : "m-dot m-node"} style={{ animationDelay: `${[0, 0, .3, .3, .3, .6, .6, .9][i]}s` }} />)}
      <path d="M12 10 L44 6 M12 10 L44 22 M12 34 L44 22 M12 34 L44 38 M44 6 L78 14 M44 22 L78 14 M44 22 L78 30 M44 38 L78 30 M78 14 L108 22 M78 30 L108 22" className="m-line m-thin" />
    </svg>
  );
}

/** Some of the most colourful Trenchers (awake art), shown in turn at the centre. */
const AWAKE = [1153, 599, 217, 1464, 862, 768, 1314, 278, 247, 198, 107, 881, 191, 1869, 132, 259, 1339, 104, 1045, 1597, 1764, 1113, 1187, 875];

/** The centre: a Trencher, cycling through the collection, with $TRENCHERS orbiting it. */
function Core({ compact, onEnter }: { compact: boolean; onEnter?: () => void }) {
  const pool = AWAKE;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % pool.length), 1800);
    return () => clearInterval(t);
  }, [pool.length]);
  const id = pool[i] ?? 1;
  const inner = (
    <>
      <svg viewBox="0 0 200 200" className="eco-orbit" aria-hidden="true">
        <defs><path id="eco-ring" d="M100,100 m-88,0 a88,88 0 1,1 176,0 a88,88 0 1,1 -176,0" /></defs>
        <text><textPath href="#eco-ring" startOffset="0" textLength="547" lengthAdjust="spacing">$TRENCHERS · every fee buys it back · inference burns it · $TRENCHERS · sweeps the Trenchers floor ·</textPath></text>
      </svg>
      <span className="eco-art"><img key={id} src={`nft/${id}.webp`} alt="" width={140} height={140} /></span>
      <span className="eco-core-k mono">the centre</span>
      <b className="eco-core-t">Your Trencher</b>
      {!compact && <span className="eco-core-p">An AI agent with its own wallet.</span>}
    </>
  );
  return onEnter
    ? <button type="button" className="eco-core" onClick={onEnter} aria-label="Enter Trenchers">{inner}<span className="eco-core-go mono">enter →</span></button>
    : <div className="eco-core">{inner}<span className="eco-core-cta"><a href={ROUTES.mint} className="nav-mint">Mint</a><a href={ROUTES.agents} className="tbtn">My Trencher</a></span></div>;
}

export function Ecosystem({ compact = false, onPick, onEnter }: { compact?: boolean; onPick?: (s: Step) => void; onEnter?: () => void }) {
  const part = (s: Step, i: number) => {
    const body = (
      <span className="eco-body">
        <span className="eco-k mono"><i>{s.n}</i>{s.verb}</span>
        <b className="eco-t">{s.product}</b>
        <span className="eco-does">{compact ? s.short : s.what}</span>
        <span className={`eco-who mono${s.open ? " open" : ""}`}>{s.who}</span>
        <Motif k={s.key} />
        {!compact && (
          <span className="eco-links">
            <a href={s.home} className="mono eco-open">Open {s.product.replace(/^The /, "the ")} →</a>
            {s.pages.filter((p) => p.href !== s.home).map((p) => <a key={p.label} href={p.href} className="mono">{p.label}</a>)}
          </span>
        )}
      </span>
    );
    const cls = `eco-part eco-q${i}${i >= 4 ? " eco-wide" : ""} tone-${s.tone}`;
    return onPick
      ? <button key={s.key} type="button" className={cls} onClick={() => onPick(s)}>{body}<span className="eco-go mono">open {s.product.replace(/^The /, "the ").toLowerCase()} →</span></button>
      : <div key={s.key} className={cls}><a className="eco-cover" href={s.home} aria-label={s.verb} />{body}</div>;
  };
  return (
    <div className={`eco${compact ? " eco-compact" : ""}`}>
      <div className="eco-grid">
        {STEPS.slice(0, 4).map(part)}
        <Core compact={compact} onEnter={onEnter} />
        {STEPS.length > 4 && <span className="eco-stem" aria-hidden="true" />}
      </div>
      {STEPS.length > 4 && <div className="eco-under">{STEPS.slice(4).map((s, j) => part(s, 4 + j))}</div>}
      {!compact && (
        <p className="eco-foot mono">
          {HUB.pages.map((p) => <a key={p.key} href={p.href}>{p.label}</a>)}
          {HUB.external.map((x) => <a key={x.href} href={x.href} target="_blank" rel="noreferrer">{x.label} ↗</a>)}
        </p>
      )}
    </div>
  );
}

/** Where every fee goes: one loop, drawn left to right, that ends where it started. */
export function FlywheelLoop() {
  const SOURCES = [
    { k: "Royalties", v: "every Trencher resale" },
    { k: "Coin Launcher", v: "0.3% of every V4 coin trade" },
    { k: "Inference", v: "$TRENCHERS paid for compute" },
    { k: "Trenchers Credit", v: "25% of every loan fee" },
    { k: "$TRENCHERS", v: "its trading fees" },
  ];
  return (
    <section className="fwl" aria-label="The flywheel">
      <div className="fwl-head">
        <p className="fwl-k mono"><span className="fwb-ic" aria-hidden="true" />The flywheel</p>
        <h2>Every fee feeds $TRENCHERS.</h2>
        <p>Whatever part of Trenchers you use, the fees it earns go one way: buying back $TRENCHERS, burning it, and sweeping the Trenchers floor.</p>
      </div>
      <div className="fwl-flow">
        <ul className="fwl-src">{SOURCES.map((x) => <li key={x.k}><b>{x.k}</b><span className="mono">{x.v}</span></li>)}</ul>
        <span className="fwl-arrow" aria-hidden="true"><i /></span>
        <div className="fwl-mid"><b>Buyback wallet</b><span className="mono">collects every fee</span></div>
        <span className="fwl-arrow" aria-hidden="true"><i /></span>
        <ul className="fwl-out">
          <li className="g"><b>Buy back $TRENCHERS</b><span className="mono">from the open market</span></li>
          <li className="a"><b>Burn</b><span className="mono">out of supply for good</span></li>
          <li className="v"><b>Sweep the floor</b><span className="mono">buy cheap Trenchers</span></li>
        </ul>
      </div>
      <p className="fwl-loop mono">↻ More usage means more buybacks, fewer tokens and a firmer floor for every holder and every agent.</p>
    </section>
  );
}
