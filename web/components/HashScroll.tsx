"use client";
import { useEffect } from "react";

/**
 * Section links (#launch, #modules, …) land exactly on their section, even on pages whose content keeps loading
 * after the jump (coin lists, models, the order book). The browser's own jump happens once, before that content
 * arrives, and then ends up in the wrong place; this re-aims at the section until the page has settled, and stops
 * the moment the visitor scrolls by hand.
 */
function settle(id: string, smooth: boolean) {
  const el = document.getElementById(decodeURIComponent(id));
  if (!el) return;
  const go = (how: ScrollBehavior) => el.scrollIntoView({ behavior: how, block: "start" });
  go(smooth ? "smooth" : ("instant" as ScrollBehavior));
  let stop = false, lastY = -1, ticks = 0;
  const cancel = () => { stop = true; };
  const opts = { passive: true, once: true } as const;
  window.addEventListener("wheel", cancel, opts);
  window.addEventListener("touchstart", cancel, opts);
  window.addEventListener("keydown", cancel, opts);
  const iv = window.setInterval(() => {
    ticks++;
    if (stop || ticks > 16) {
      window.clearInterval(iv);
      window.removeEventListener("wheel", cancel); window.removeEventListener("touchstart", cancel); window.removeEventListener("keydown", cancel);
      return;
    }
    const y = window.scrollY;
    const still = Math.abs(y - lastY) < 1; // wait for a smooth scroll to finish before correcting
    lastY = y;
    if (!still) return;
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (Math.abs(el.getBoundingClientRect().top - margin) > 6) go("instant" as ScrollBehavior);
  }, 200);
}

export function HashScroll() {
  useEffect(() => {
    if (location.hash.length > 1) {
      const id = location.hash.slice(1);
      requestAnimationFrame(() => settle(id, false));
    }
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href*='#']") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank") return;
      const url = new URL(a.href, location.href);
      // Only links into this same page (same path and same ?query) are handled here; others load normally.
      if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || url.hash.length < 2) return;
      const id = url.hash.slice(1);
      if (!document.getElementById(decodeURIComponent(id))) return;
      e.preventDefault();
      history.pushState(null, "", url.hash);
      settle(id, true);
    };
    document.addEventListener("click", click);
    return () => document.removeEventListener("click", click);
  }, []);
  return null;
}
