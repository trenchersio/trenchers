"use client";
import { useEffect } from "react";

/** On small screens the section strip scrolls sideways: bring the current section into view. */
export function SecswScroll() {
  useEffect(() => {
    document.querySelectorAll<HTMLElement>(".secsw-path").forEach((p) => {
      const on = p.querySelector<HTMLElement>("a.on");
      if (on && p.scrollWidth > p.clientWidth) p.scrollLeft = Math.max(0, on.offsetLeft - p.clientWidth / 2 + on.offsetWidth / 2);
    });
  }, []);
  return null;
}
