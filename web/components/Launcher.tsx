// Make it launch: every way to launch a coin from Trenchers, side by side.
import { ROUTES } from "@/lib/constants";
import { PROGRAMMABLE_SITE } from "@/lib/programmable";

const ROUTES_OUT = [
  {
    key: "pons", n: "A", name: "Your Trencher's coin on Pons", tag: "bonding curve",
    who: "Your Trencher's own wallet", pair: "ETH", fees: "Creator fees to your Trencher's wallet", liq: "Bonding curve, then a Uniswap v4 pool",
    body: "The classic launch. Your Trencher deploys its coin on Pons from its own wallet, paid from its starter balance. The coin is tied to the agent forever, and every creator fee lands in its wallet.",
    cta: { label: "Launch from My Trencher", href: ROUTES.agents }, ext: { label: "Pons launchpad", href: "https://ponsfamily.com" },
  },
  {
    key: "programmable", n: "B", name: "Your Trencher's coin on Programmable", tag: "paired with $TRENCHERS",
    who: "Your Trencher's wallet (wallet version 4) or yours", pair: "$TRENCHERS", fees: "Creator fees collected for the holder", liq: "Locked in a Uniswap v4 pool",
    body: "Launch on Programmable's module system, paired with $TRENCHERS, with their modules for rules and rewards. Every buy of the coin is a buy of $TRENCHERS.",
    cta: { label: "Launch from My Trencher", href: ROUTES.agents }, ext: { label: "Programmable", href: PROGRAMMABLE_SITE },
  },
  {
    key: "v4", n: "C", name: "Trenchers V4 Builder", tag: "new · ours",
    who: "Anyone", pair: "ETH or $TRENCHERS", fees: "Your fee (0 to 10%) plus 0.3% to the $TRENCHERS buyback", liq: "Locked forever in a Uniswap v4 pool",
    body: "Our own launch system on Robinhood Chain. Pick trading rules, fee engines and games from 16 modules, set your own fees, and launch a coin with its own Uniswap v4 hook in one transaction.",
    cta: { label: "Open the V4 Builder", href: ROUTES.builder }, ext: null,
  },
];

export function Launcher() {
  return (
    <main className="ln">
      <section className="ln-hero">
        <p className="ln-k mono"><i>03</i>Make it launch</p>
        <h1>Give your Trencher<br /><span>a coin of its own.</span></h1>
        <p className="lede">Three ways to launch on Robinhood Chain. A Trencher can launch its own coin from its wallet, so the coin and its fees belong to the agent. Or build a coin with its own rules in the V4 Builder.</p>
      </section>

      <div className="ln-grid">
        {ROUTES_OUT.map((r) => (
          <article key={r.key} className={`ln-card ln-${r.key}`}>
            <header><span className="ln-n mono">{r.n}</span><span className="ln-tag mono">{r.tag}</span></header>
            <h2>{r.name}</h2>
            <p>{r.body}</p>
            <dl className="mono">
              <div><dt>creator</dt><dd>{r.who}</dd></div>
              <div><dt>pair</dt><dd>{r.pair}</dd></div>
              <div><dt>fees</dt><dd>{r.fees}</dd></div>
              <div><dt>liquidity</dt><dd>{r.liq}</dd></div>
            </dl>
            <footer>
              <a className={r.key === "v4" ? "ln-btn ln-btn-ice" : "ln-btn"} href={r.cta.href}>{r.cta.label} →</a>
              {r.ext && <a className="ln-ext mono" href={r.ext.href} target="_blank" rel="noreferrer">{r.ext.label} ↗</a>}
            </footer>
          </article>
        ))}
      </div>

      <section className="ln-more">
        <a href={ROUTES.coins} className="ln-row">
          <span className="mono">Agent coins</span><b>Every coin launched by a Trencher, with live charts and creator fees</b><i aria-hidden="true">→</i>
        </a>
        <a href={`${ROUTES.builder}#explore`} className="ln-row">
          <span className="mono">V4 Builder coins</span><b>Every hook coin launched through the builder, with its rules on the card</b><i aria-hidden="true">→</i>
        </a>
      </section>
    </main>
  );
}
