"use client";
import { useState } from "react";
import { TRENCHERS_PONS, TRENCHERS_TOKEN, gmgnToken } from "@/lib/constants";

/** A quiet line with the $TRENCHERS contract address (tap to copy), its Pons page and chart. Hidden until the token is set. */
export function TokenLine() {
  const [copied, setCopied] = useState(false);
  if (!TRENCHERS_TOKEN) return null;
  const copy = async () => { try { await navigator.clipboard.writeText(TRENCHERS_TOKEN); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ } };
  return (
    <p className="token-line mono">
      <span>$TRENCHERS</span>
      <button type="button" onClick={copy} title="Copy contract address">CA {TRENCHERS_TOKEN.slice(0, 6)}…{TRENCHERS_TOKEN.slice(-4)} <i>{copied ? "copied" : "copy"}</i></button>
      <a href={TRENCHERS_PONS} target="_blank" rel="noreferrer">Pons ↗</a>
      <a href={gmgnToken(TRENCHERS_TOKEN)} target="_blank" rel="noreferrer">Chart ↗</a>
    </p>
  );
}
