"use client";
import { useEffect } from "react";

/**
 * Keeps every top bar on one clean line. When the links no longer fit next to the logo (a narrow window, a long
 * wallet label), the bar folds into the [Menu] button instead of letting anything overlap. The check runs
 * synchronously before paint, so there is no flicker.
 */
export function HeaderFit() {
  useEffect(() => {
    const fit = () => {
      document.querySelectorAll<HTMLElement>("header.bar").forEach((bar) => {
        bar.classList.remove("bar-fold");
        const nav = bar.querySelector<HTMLElement>(":scope > nav");
        if (!nav || getComputedStyle(nav).display === "none") return;
        const brand = bar.firstElementChild as HTMLElement | null;
        const gap = parseFloat(getComputedStyle(bar).columnGap) || 16;
        const room = bar.clientWidth - parseFloat(getComputedStyle(bar).paddingLeft) - parseFloat(getComputedStyle(bar).paddingRight);
        const need = (brand && brand !== nav ? brand.offsetWidth + gap : 0) + nav.scrollWidth;
        bar.classList.toggle("bar-fold", need > room - 8);
      });
    };
    let raf = 0;
    const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    fit();
    const ro = new ResizeObserver(soon);
    document.querySelectorAll("header.bar").forEach((b) => ro.observe(b));
    const mo = new MutationObserver(soon);
    document.querySelectorAll("header.bar > nav").forEach((n) => mo.observe(n, { childList: true, subtree: true, characterData: true }));
    window.addEventListener("resize", soon);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener("resize", soon); cancelAnimationFrame(raf); };
  }, []);
  return null;
}
