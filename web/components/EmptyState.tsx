import type { ReactNode } from "react";

export type EmptyAction = { label: string; href?: string; onClick?: () => void; primary?: boolean; external?: boolean };

/** The Trenchers mark, still: nine cells with the green eye in the middle. */
export function Mark({ tone = "green" }: { tone?: "green" | "amber" | "ice" | "violet" | "red" }) {
  return (
    <span className={`es-mark es-${tone}`} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => <i key={i} className={i === 4 ? "eye" : i % 2 === 0 ? "sq" : ""} />)}
    </span>
  );
}

/** A proper empty or "can't reach it" state: the mark, one clear title, one sentence and a next step. */
export function EmptyState({ title, text, actions = [], tone = "green", children }: { title: string; text?: ReactNode; actions?: EmptyAction[]; tone?: "green" | "amber" | "ice" | "violet" | "red"; children?: ReactNode }) {
  return (
    <div className="es" role="status">
      <Mark tone={tone} />
      <h2 className="es-title">{title}</h2>
      {text && <p className="es-text">{text}</p>}
      {children}
      {actions.length > 0 && (
        <div className="es-actions">
          {actions.map((a) => a.href
            ? <a key={a.label} href={a.href} className={a.primary ? "nav-mint" : "tbtn"} {...(a.external ? { target: "_blank", rel: "noreferrer" } : {})}>{a.label}{a.external ? " ↗" : ""}</a>
            : <button key={a.label} type="button" className={a.primary ? "nav-mint" : "tbtn"} onClick={a.onClick}>{a.label}</button>)}
        </div>
      )}
    </div>
  );
}
