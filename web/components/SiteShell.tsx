"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Intro } from "./Intro";

/** Shows the intro once per browser session, then the site. */
export function SiteShell({ children }: { children: ReactNode }) {
  const [intro, setIntro] = useState<boolean | null>(null);

  useEffect(() => {
    let seen = false;
    try { seen = sessionStorage.getItem("trenchers-entered") === "1"; } catch {}
    setIntro(!seen);
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = intro ? "hidden" : "";
  }, [intro]);

  function enter() {
    try { sessionStorage.setItem("trenchers-entered", "1"); } catch {}
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
