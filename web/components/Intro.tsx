"use client";
import { useEffect, useState } from "react";
import { PixelMosaic } from "./PixelMosaic";

/** Black intro screen: Trenchers assemble across the screen while the agents "boot". */
export function Intro({ onEnter }: { onEnter: (to: "agents" | "inference") => void }) {
  const [count, setCount] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setCount(2000); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 3000);
      setCount(Math.round(2000 * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const ready = count >= 2000;
  function enter(to: "agents" | "inference") {
    if (exiting) return;
    setExiting(true);
    setTimeout(() => onEnter(to), 750);
  }

  return (
    <div className={`intro${exiting ? " intro-exit" : ""}`} role="dialog" aria-label="Trenchers intro">
      <PixelMosaic exiting={exiting} />
      <div className="intro-center">
        <img src="brand/lockup.svg" alt="Trenchers" width={520} height={57} className="intro-logo" />
        <p className="intro-boot mono" aria-live="polite">
          {ready ? "2,000 agents online" : `booting agents ${count.toLocaleString()} / 2,000`}
          <span className="caret" />
        </p>
        <div className={`intro-doors${ready ? " show" : ""}`} role="group" aria-label="Choose where to go">
          <button type="button" className="door door-a" onClick={() => enter("agents")} disabled={!ready} tabIndex={ready ? 0 : -1}>
            <span className="door-k mono"><i className="door-dot" />01 · Trenchers</span>
            <b>AI Agents</b>
            <span className="door-p">2,000 NFT trading agents. Mint one, train it in plain English and climb the Arena.</span>
            <span className="door-go mono">Enter the agents <span aria-hidden="true">→</span></span>
          </button>
          <button type="button" className="door door-i" onClick={() => enter("inference")} disabled={!ready} tabIndex={ready ? 0 : -1}>
            <span className="door-k mono"><i className="door-dot" />02 · Trenchers<em>New</em></span>
            <b>Inference Markets</b>
            <span className="door-p">Every frontier model through one key, paid in $TRENCHERS. Every token spent is burned.</span>
            <span className="door-go mono">Enter the markets <span aria-hidden="true">→</span></span>
          </button>
        </div>
      </div>
    </div>
  );
}
