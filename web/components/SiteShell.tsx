"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Intro } from "./Intro";
import { ROUTES } from "@/lib/constants";
import { STEPS, type Where } from "@/lib/steps";

/** Shows the intro once per browser session, then the site. */
export function SiteShell({ children, section = "hub" }: { children: ReactNode; section?: Where }) {
  const [intro, setIntro] = useState<boolean | null>(null);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("trenchers-entered") === "1"; } catch {}
    setIntro(!seen);
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = intro ? "hidden" : "";
  }, [intro]);

  /** The intro is the map of Trenchers: the Trencher itself, or one of the four things it does of Trenchers: stay on this one, or go to the other. */
  function enter(to: Where) {
    try { sessionStorage.setItem("trenchers-entered", "1"); } catch {}
    if (to !== section) { window.location.href = to === "hub" ? ROUTES.home : STEPS.find((s) => s.key === to)!.home; return; }
    setIntro(false);
    window.scrollTo(0, 0);
  }

  return (
    <>
      {intro !== false && (intro === null ? <div className="intro" /> : <Intro onEnter={enter} />)}
      <div className={intro === false ? "site site-in" : "site"}>{children}</div>
    </>
  );
}
