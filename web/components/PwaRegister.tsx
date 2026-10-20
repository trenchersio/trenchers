"use client";
import { useEffect } from "react";

/** Registers the service worker that shows Trenchers notifications (and makes the site installable). */
export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NEXT_PUBLIC_PREVIEW === "1") return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* not supported here */ });
  }, []);
  return null;
}
