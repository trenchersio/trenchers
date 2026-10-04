"use client";
import { useEffect, useState } from "react";

/** Quick jumps to the sections of a long page: a sticky bar that marks where you are. */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(`sec-${i.id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) setActive(seen.target.id.replace(/^sec-/, ""));
    }, { rootMargin: "-90px 0px -60% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);
  const go = (id: string) => {
    window.dispatchEvent(new CustomEvent("fold-open", { detail: id }));
    setActive(id);
    requestAnimationFrame(() => {
      const el = document.getElementById(`sec-${id}`);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 76, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  };
  return (
    <nav className="secnav" aria-label="Sections">
      {items.map((i) => (
        <button key={i.id} type="button" className={i.id === active ? "on" : undefined} aria-current={i.id === active ? "true" : undefined} onClick={() => go(i.id)}>{i.label}</button>
      ))}
    </nav>
  );
}
