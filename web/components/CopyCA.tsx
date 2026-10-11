"use client";
import { useState } from "react";
import { TRENCHERS_PONS, TRENCHERS_TOKEN } from "@/lib/constants";

/** "$TRENCHERS" link: opens $TRENCHERS on Pons and copies the contract address (with a short "CA copied!" note). */
export function CopyCA({ className = "", label = "$TRENCHERS" }: { className?: string; label?: string }) {
  const [shown, setShown] = useState(false);
  if (!TRENCHERS_TOKEN) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(TRENCHERS_TOKEN); }
    catch {
      const t = document.createElement("textarea"); t.value = TRENCHERS_TOKEN; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch { /* */ } t.remove();
    }
    setShown(true); setTimeout(() => setShown(false), 1800);
  };
  return (
    <>
      <a className={`tbtn coin-chart-btn ${className}`} href={TRENCHERS_PONS} target="_blank" rel="noreferrer" onClick={() => { copy(); }}
        title={`$TRENCHERS on Pons (the contract address is copied too): ${TRENCHERS_TOKEN}`}>{label}</a>
      {shown && <div className="ca-toast mono" role="status">CA copied! <span>{TRENCHERS_TOKEN.slice(0, 6)}…{TRENCHERS_TOKEN.slice(-4)}</span></div>}
    </>
  );
}
