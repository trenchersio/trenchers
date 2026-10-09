"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** "Watch the video" button: plays the What is Trenchers? film in a popup on the page. */
export function VideoButton({ className = "", src = "what-is-trenchers", title = "What is Trenchers?", length = "53 s", label, webm = src === "what-is-trenchers" }: { className?: string; src?: string; title?: string; length?: string; label?: string; webm?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <>
      <button type="button" className={`video-btn ${className}`} onClick={() => setOpen(true)}>
        <span className="video-play" aria-hidden="true" />
        <span><b>{label ?? `Watch: ${title}`}</b><small className="mono">Video · {length}</small></span>
      </button>
      {open && createPortal(
        <div className="modal-backdrop video-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="video-modal" role="dialog" aria-modal="true" aria-label={`${title} video`}>
            <div className="video-head">
              <span className="mono">{title}</span>
              <button type="button" className="tbtn" onClick={() => setOpen(false)}>Close</button>
            </div>
            <video poster={`/video/${src}.jpg`} controls autoPlay playsInline preload="metadata">
              <source src={`/video/${src}.mp4`} type="video/mp4" />
              {webm && <source src={`/video/${src}.webm`} type="video/webm" />}
            </video>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
