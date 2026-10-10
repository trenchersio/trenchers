"use client";
import { useState } from "react";
import type React from "react";
import { pickOf } from "@/lib/token-picks";

/** A coin's logo (from its Pons launch, or ours for $TRENCHERS); a lettered disc when there isn't one. */
export function TokenLogo({ address, logo, symbol, size = 20, className = "", title }: { address: string; logo?: string | null; symbol?: string | null; size?: number; className?: string; title?: string }) {
  const src = pickOf(address)?.logo ?? logo ?? null;
  const [bad, setBad] = useState<string | null>(null);
  const hue = parseInt(address.slice(2, 8), 16) % 360;
  const letter = (symbol ?? pickOf(address)?.symbol ?? "?").replace(/^\$/, "").slice(0, 1).toUpperCase();
  const style = { width: size, height: size, ["--tk" as string]: `${size}px`, fontSize: Math.max(9, Math.round(size * 0.48)) } as React.CSSProperties;
  if (src && bad !== src)
    return <img src={src} alt="" width={size} height={size} className={`tk-logo${src.endsWith(".svg") ? " tk-svg" : ""} ${className}`} style={style} title={title} onError={() => setBad(src)} referrerPolicy="no-referrer" loading="lazy" />;
  return <span className={`tk-logo tk-mono ${className}`} style={{ ...style, background: `hsl(${hue} 45% 26%)`, color: `hsl(${hue} 80% 78%)` }} title={title} aria-hidden={title ? undefined : true}>{letter}</span>;
}
