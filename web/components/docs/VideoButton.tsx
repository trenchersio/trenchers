"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** "Watch the video" button: plays the What is Trenchers? film in a popup on the page. */
export function VideoButton({ className = "" }: { className?: string }) {
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
        <span><b>Watch: What is Trenchers?</b><small className="mono">Video · 53 s</small></span>
      </button>
      {open && createPortal(
        <div className="modal-backdrop video-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="video-modal" role="dialog" aria-modal="true" aria-label="What is Trenchers? video">
            <div className="video-head">
              <span className="mono">What is Trenchers?</span>
              <button type="button" className="tbtn" onClick={() => setOpen(false)}>Close</button>
            </div>
            <video poster="video/what-is-trenchers.jpg" controls autoPlay playsInline preload="metadata">
              <source src="video/what-is-trenchers.mp4" type="video/mp4" />
              <source src="video/what-is-trenchers.webm" type="video/webm" />
            </video>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
