"use client";
import { useEffect, useState } from "react";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { activityText, useActivity, type ActivityItem } from "@/lib/activity";
import { EXPLORER, ROUTES } from "@/lib/constants";

const ago = (s: number) => (s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`);
const href = (a: ActivityItem) => (a.kind === "win" || a.kind === "awaken" ? `${ROUTES.collection}#${a.id}` : a.tx ? `${EXPLORER}/tx/${a.tx}` : ROUTES.arena);

/** A slim live strip: recent mints, awakenings, agent coins and big wins, from the trading engine. */
export function ActivityTicker({ className = "" }: { className?: string }) {
  const data = useActivity();
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 15_000); return () => clearInterval(t); }, []);
  const items = (data?.items ?? []).slice(0, 16);
  if (!items.length) return null;
  const loop = items.length > 3 ? [...items, ...items] : items;
  return (
    <section className={`act ${className}`} aria-label="Live activity">
      <span className="act-live mono"><i className="live-dot" />Live</span>
      <div className="act-view">
        <ol className={`act-track${items.length > 3 ? " moving" : ""}`} style={{ animationDuration: `${Math.max(30, items.length * 6)}s` }}>
          {loop.map((a, k) => (
            <li key={`${a.kind}-${a.id}-${a.tx}-${k}`} aria-hidden={k >= items.length || undefined}>
              <a href={href(a)} target={href(a).startsWith("http") ? "_blank" : undefined} rel="noreferrer" tabIndex={k >= items.length ? -1 : undefined}>
                <ArtCanvas id={a.id} size={24} />
                <span className={`act-kind act-${a.kind}`} />
                <span className="act-txt">{activityText(a)}</span>
                <span className="act-ago mono">{ago(Math.max(0, now - a.time))}</span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
