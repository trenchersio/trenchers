"use client";
import { useState } from "react";
import { TRENCHERS_TOKEN } from "@/lib/constants";

/** "$TRENCHERS" button: copies the contract address and shows a short "CA copied!" note. */
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
      <button type="button" className={`tbtn coin-chart-btn ${className}`} onClick={copy} title={`Copy the $TRENCHERS contract address: ${TRENCHERS_TOKEN}`}>{label}</button>
      {shown && <div className="ca-toast mono" role="status">CA copied! <span>{TRENCHERS_TOKEN.slice(0, 6)}…{TRENCHERS_TOKEN.slice(-4)}</span></div>}
    </>
  );
}
