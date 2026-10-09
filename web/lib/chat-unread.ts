"use client";
import { useEffect, useState } from "react";
import { CHAT_OPEN, ENGINE_URL } from "@/lib/constants";

const KEY = "trenchers:chat:seen";
export const markChatSeen = (id: number) => { try { if (id > Number(localStorage.getItem(KEY) || 0)) localStorage.setItem(KEY, String(id)); } catch { /* */ } };

/** True when the holders' chat has messages newer than the last one this browser saw (checked every minute). */
export function useChatUnread(enabled = true) {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (!enabled || !CHAT_OPEN) return;
    let alive = true;
    const go = () => fetch(`${ENGINE_URL}/chat?after=999999999`, { cache: "no-store" }).then((r) => r.json()).then((j: { latest?: number }) => {
      let seen = 0; try { seen = Number(localStorage.getItem(KEY) || 0); } catch { /* */ }
      if (alive && typeof j.latest === "number") setUnread(j.latest > seen);
    }).catch(() => {});
    go(); const iv = setInterval(go, 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, [enabled]);
  return unread;
}
