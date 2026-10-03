import { ROUTES } from "@/lib/constants";

/** Phones only: a slim bar pinned to the bottom with the three things people come for. */
export function MobileDock() {
  return (
    <nav className="dock" aria-label="Quick links">
      <a href={ROUTES.arena}><span className="dock-ic" aria-hidden="true">▲</span>Arena</a>
      <a href={ROUTES.collection}><span className="dock-ic" aria-hidden="true">▦</span>Collection</a>
      <a href={ROUTES.agents} className="dock-main"><span className="dock-ic" aria-hidden="true">●</span>Your agent</a>
    </nav>
  );
}
