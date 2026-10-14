"use client";
import { useEffect, useState } from "react";
import { PixelMosaic } from "./PixelMosaic";
import { Ecosystem } from "./Ecosystem";
import type { Step, Where } from "@/lib/steps";

/** Black intro screen: Trenchers assemble across the screen while the agents "boot", then the map of what a
 *  Trencher does: the Trencher at the centre, and the five parts around it. */
export function Intro({ onEnter }: { onEnter: (to: Where) => void }) {
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
  function enter(to: Where) {
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
        <div className={`intro-doors intro-eco${ready ? " show" : ""}`} aria-hidden={!ready}>
          <Ecosystem compact onPick={(st: Step) => ready && enter(st.key)} onEnter={() => ready && enter("hub")} />
          <p className="intro-open intro-fw"><span className="fwb-ic" aria-hidden="true" />Every fee feeds the flywheel: $TRENCHERS buybacks, burns and Trencher floor sweeps.</p>
          <p className="intro-open">No Trencher? <button type="button" className="intro-link ia" onClick={() => ready && enter("think")}>Inference Markets</button> and the <button type="button" className="intro-link ib" onClick={() => ready && enter("launch")}>Coin Launcher</button> are open to everyone.</p>
        </div>
      </div>
    </div>
  );
}
