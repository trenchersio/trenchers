"use client";
import { useEffect } from "react";

/**
 * A new page opens at its top, unless the link points at a section (#...).
 * Inside an embedded preview the page can be shown in a frame that keeps the previous page's scroll position,
 * so the frame is brought back to the top as well.
 */
export function StartAtTop() {
  useEffect(() => {
    if (location.hash) return;
    try { history.scrollRestoration = "manual"; } catch {}
    window.scrollTo(0, 0);
    if (window.self !== window.top) {
      try { document.documentElement.scrollIntoView({ block: "start" }); } catch {}
    }
  }, []);
  return null;
}
