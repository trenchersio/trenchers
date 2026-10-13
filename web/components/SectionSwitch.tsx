import { ROUTES } from "@/lib/constants";
import { SecswScroll } from "./SecswScroll";
import { STEPS, type Where } from "@/lib/steps";

export type Section = Where;

/** The strip above every header: the Trencher (home) first, then the four things you make it do, then Mint. */
export function SectionSwitch({ on, wide = false, mintOn = false }: { on: Where; wide?: boolean; mintOn?: boolean }) {
  return (
    <div className={`secsw${wide ? " secsw-wide" : ""}`}>
      <div className="secsw-in">
      <nav className="secsw-path" aria-label="The Trenchers path">
        <a href={ROUTES.home} className={`secsw-hub${on === "hub" ? " on" : ""}`} aria-current={on === "hub" ? "page" : undefined}>
          <span className="secsw-core" aria-hidden="true" />Trenchers
        </a>
        <span className="secsw-make" aria-hidden="true">make it</span>
        {STEPS.map((s) => (
          <a key={s.key} href={s.home} className={`secsw-step tone-${s.tone}${on === s.key ? " on" : ""}`} aria-current={on === s.key ? "page" : undefined}>
            <i className="secsw-n" aria-hidden="true">{s.n}</i>{s.name.toLowerCase()}
          </a>
        ))}
      </nav>
      {/* Mint lives here, in the same spot on every page */}
      <a href={ROUTES.mint} className={`secsw-mint mono${mintOn ? " on" : ""}`} aria-current={mintOn ? "page" : undefined}>Mint</a>
      <span className="secsw-note">Robinhood Chain · powered by $TRENCHERS</span>
      <SecswScroll />
      </div>
    </div>
  );
}
