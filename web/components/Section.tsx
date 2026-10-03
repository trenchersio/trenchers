import type { ReactNode } from "react";

/** Landing-page section: numbered label and title on the left, content on the right. */
export function Section({ id, n, label, title, lede, children }: {
  id?: string; n: string; label: string; title: ReactNode; lede?: ReactNode; children: ReactNode;
}) {
  return (
    <section id={id} className="section">
      <header className="section-head">
        <p className="eyebrow"><span className="section-n">{n}</span>{label}</p>
        <h2>{title}</h2>
        {lede && <p className="section-lede">{lede}</p>}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}
