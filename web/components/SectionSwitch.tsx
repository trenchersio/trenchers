import { ROUTES } from "@/lib/constants";

export type Section = "agents" | "inference" | "builder";

/** The strip above every header: the three parts of Trenchers, one click apart. */
export function SectionSwitch({ on, wide = false }: { on: Section; wide?: boolean }) {
  return (
    <div className={`secsw${wide ? " secsw-wide" : ""}`}>
      <nav className="secsw-in" aria-label="Trenchers sections">
        <a href={ROUTES.home} className={on === "agents" ? "on" : undefined} aria-current={on === "agents" ? "page" : undefined}>
          <span className="secsw-ic secsw-ic-a" aria-hidden="true" />AI Agents
        </a>
        <a href={ROUTES.inference} className={on === "inference" ? "on" : undefined} aria-current={on === "inference" ? "page" : undefined}>
          <span className="secsw-ic secsw-ic-i" aria-hidden="true" />Inference Markets
        </a>
        <a href={ROUTES.builder} className={on === "builder" ? "on" : undefined} aria-current={on === "builder" ? "page" : undefined}>
          <span className="secsw-ic secsw-ic-b" aria-hidden="true" />V4 Builder{on !== "builder" && <b className="secsw-new secsw-new-b">New</b>}
        </a>
        <span className="secsw-note">Robinhood Chain · powered by $TRENCHERS</span>
      </nav>
    </div>
  );
}
