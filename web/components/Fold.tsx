"use client";
import { useEffect, useState, type ReactNode } from "react";

/** A section that opens and closes; each one remembers its state in this browser. */
export function Fold({ id, title, sub, children, defaultOpen = true }: { id: string; title: string; sub?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { try { const v = localStorage.getItem(`trenchers:fold:${id}`); if (v) setOpen(v === "1"); } catch { /* */ } }, [id]);
  // The section menu opens a closed section before scrolling to it.
  useEffect(() => {
    const f = (e: Event) => { if ((e as CustomEvent<string>).detail === id) setOpen(true); };
    window.addEventListener("fold-open", f);
    return () => window.removeEventListener("fold-open", f);
  }, [id]);
  const toggle = () => setOpen((o) => { try { localStorage.setItem(`trenchers:fold:${id}`, o ? "0" : "1"); } catch { /* */ } return !o; });
  return (
    <section className={`fold${open ? " open" : ""}`} id={`sec-${id}`} aria-labelledby={`fold-${id}`}>
      <button type="button" className="fold-head" id={`fold-${id}`} aria-expanded={open} aria-controls={`fold-body-${id}`} onClick={toggle}>
        <span className="fold-titles"><span className="fold-title">{title}</span>{sub && <span className="fold-sub">{sub}</span>}</span>
        <span className="fold-chev" aria-hidden="true" />
      </button>
      <div className="fold-body" id={`fold-body-${id}`} hidden={!open}>{children}</div>
    </section>
  );
}
