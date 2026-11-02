"use client";
import { ROUTES } from "@/lib/constants";
import { useTrenchiesLive } from "@/lib/trenchies-live";

/** A slim strip across the top of every page once Trenchies is open to everyone. Hidden until then. */
export function TrenchiesLiveBanner() {
  const live = useTrenchiesLive();
  if (!live) return null;
  return (
    <a className="tl-banner" href={ROUTES.trenchiesPlay}>
      <span className="tl-dot" aria-hidden="true" />
      <b>Trenchies is live.</b>
      <span className="tl-sub">Spawn your Trenchie, call Bitcoin, pick tomorrow&apos;s top coins.</span>
      <span className="tl-go">Play now →</span>
    </a>
  );
}
