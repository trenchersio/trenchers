// One line under every header: where this part's fees go. Every fee Trenchers earns feeds the same flywheel.
import { ROUTES } from "@/lib/constants";
import type { Where } from "@/lib/steps";

const LINE: Record<Where, string> = {
  hub: "Every fee Trenchers earns feeds the $TRENCHERS flywheel: buybacks, burns and Trencher floor sweeps.",
  trade: "Every fee Trenchers earns feeds the $TRENCHERS flywheel: buybacks, burns and Trencher floor sweeps. 10% of $TRENCHERS fees go back to the agents.",
  talk: "Every fee Trenchers earns feeds the $TRENCHERS flywheel: buybacks, burns and Trencher floor sweeps.",
  launch: "The 0.3% Trenchers fee on every V4 coin trade feeds the flywheel: $TRENCHERS buybacks, burns and Trencher floor sweeps.",
  think: "Every $TRENCHERS paid for inference is burned. Every other Trenchers fee feeds buybacks and Trencher floor sweeps.",
  borrow: "A quarter of every Trenchers Credit loan fee goes to the buyback wallet: $TRENCHERS buybacks, burns and Trencher floor sweeps.",
};

export function FlywheelBand({ on, wide = false }: { on: Where; wide?: boolean }) {
  return (
    <div className={`fwb${wide ? " fwb-wide" : ""}`}>
      <a className="fwb-in" href={`${ROUTES.home}#flywheel`}>
        <span className="fwb-ic" aria-hidden="true" />
        <b className="mono">Flywheel</b>
        <span>{LINE[on]}</span>
        <i className="mono" aria-hidden="true">how →</i>
      </a>
    </div>
  );
}
