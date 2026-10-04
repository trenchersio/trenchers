"use client";
import { useEffect, useState } from "react";
import { Arena } from "./Arena";
import { LiveArena } from "./LiveArena";

/** The Arena page: the sample Arena (what launch looks like) or the live one (real agents, from the engine). */
export function ArenaSwitch() {
  const [mode, setMode] = useState<"sample" | "live">("sample");
  useEffect(() => { if (window.location.hash === "#live") setMode("live"); }, []);
  const pick = (m: "sample" | "live") => { setMode(m); history.replaceState(null, "", m === "live" ? "#live" : window.location.pathname); };
  return (
    <>
      <div className="arena-mode" role="tablist" aria-label="Arena view">
        <button type="button" role="tab" aria-selected={mode === "sample"} className={`tbtn${mode === "sample" ? " tbtn-on" : ""}`} onClick={() => pick("sample")}>Sample</button>
        <button type="button" role="tab" aria-selected={mode === "live"} className={`tbtn${mode === "live" ? " tbtn-on" : ""}`} onClick={() => pick("live")}><i className="live-dot" />Live</button>
      </div>
      {mode === "sample" ? <Arena /> : <LiveArena />}
    </>
  );
}
