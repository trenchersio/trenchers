"use client";
import { useEffect, useRef, useState } from "react";

export type NavItem = { label: string; href: string; hint?: string; external?: boolean };

/** Compact header menu: a [Label ▾] button that opens a small panel of links. Hover or click. */
export function NavDropdown({ label, items, active = false }: { label: string; items: NavItem[]; active?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(0); // when hover opened the menu, so the click that follows doesn't close it
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("keydown", esc); };
  }, [open]);
  const enter = () => { if (timer.current) clearTimeout(timer.current); if (!open) hovered.current = Date.now(); setOpen(true); };
  const leave = () => { timer.current = setTimeout(() => setOpen(false), 160); };
  return (
    <div className="nd" ref={ref} onMouseEnter={enter} onMouseLeave={leave}>
      <button type="button" className={`tbtn nd-btn${open || active ? " tbtn-on" : ""}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => (Date.now() - hovered.current < 600 ? true : !o))}>
        {label}<span className="nd-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="nd-panel" role="menu">
          {items.map((it) => (
            <a key={it.label} role="menuitem" href={it.href} onClick={() => setOpen(false)} {...(it.external ? { target: "_blank", rel: "noreferrer" } : {})}>
              <span className="nd-label">{it.label}{it.external && <span className="nd-ext"> ↗</span>}</span>
              {it.hint && <span className="nd-hint">{it.hint}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
