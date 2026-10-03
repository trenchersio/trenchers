"use client";
import { useEffect, useState } from "react";
import { PixelMosaic } from "./PixelMosaic";

/** Black intro screen: Trenchers assemble across the screen while the agents "boot". */
export function Intro({ onEnter }: { onEnter: () => void }) {
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
  function enter() {
    if (exiting) return;
    setExiting(true);
    setTimeout(onEnter, 750);
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
        <button type="button" className={`tbtn tbtn-lg intro-enter${ready ? " show" : ""}`} onClick={enter} disabled={!ready} tabIndex={ready ? 0 : -1}>
          Enter the Future of AgentFi
        </button>
      </div>
    </div>
  );
}
