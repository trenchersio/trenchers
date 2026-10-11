import { ROUTES } from "@/lib/constants";

/** The strip above every header: the two halves of Trenchers, one click apart. */
export function SectionSwitch({ on, wide = false }: { on: "agents" | "inference"; wide?: boolean }) {
  return (
    <div className={`secsw${wide ? " secsw-wide" : ""}`}>
      <nav className="secsw-in" aria-label="Trenchers sections">
        <a href={ROUTES.home} className={on === "agents" ? "on" : undefined} aria-current={on === "agents" ? "page" : undefined}>
          <span className="secsw-ic secsw-ic-a" aria-hidden="true" />AI Agents
        </a>
        <a href={ROUTES.inference} className={on === "inference" ? "on" : undefined} aria-current={on === "inference" ? "page" : undefined}>
          <span className="secsw-ic secsw-ic-i" aria-hidden="true" />Inference Markets{on !== "inference" && <b className="secsw-new">New</b>}
        </a>
        <span className="secsw-note">Robinhood Chain · paid in $TRENCHERS</span>
      </nav>
    </div>
  );
}
