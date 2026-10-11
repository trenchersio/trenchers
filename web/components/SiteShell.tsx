"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Intro } from "./Intro";
import { ROUTES } from "@/lib/constants";
import type { Section } from "./SectionSwitch";

/** Shows the intro once per browser session, then the site. */
export function SiteShell({ children, section = "agents" }: { children: ReactNode; section?: Section }) {
  const [intro, setIntro] = useState<boolean | null>(null);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("trenchers-entered") === "1"; } catch {}
    setIntro(!seen);
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = intro ? "hidden" : "";
  }, [intro]);

  /** The intro is a choice between the three parts of Trenchers: stay on this one, or go to the other. */
  function enter(to: Section) {
    try { sessionStorage.setItem("trenchers-entered", "1"); } catch {}
    if (to !== section) { window.location.href = to === "inference" ? ROUTES.inference : to === "builder" ? ROUTES.builder : ROUTES.home; return; }
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
