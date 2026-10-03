import { GITHUB_URL } from "@/lib/constants";

type Seg = { pct?: number; label: string; tone: "buy" | "dev" | "prize" | "floor" | "agent" };
const SOURCES: { key: string; source: string; headline: string; sub: string; segs: Seg[] }[] = [
  { key: "sales", source: "OpenSea sales", headline: "50%", sub: "of every sale buys back $TRENCHERS",
    segs: [{ pct: 50, label: "Buybacks", tone: "buy" }, { pct: 40, label: "Development", tone: "dev" }, { pct: 10, label: "Prize pool", tone: "prize" }] },
  { key: "royalties", source: "5% royalties", headline: "100%", sub: "of every resale royalty buys back $TRENCHERS",
    segs: [{ pct: 100, label: "Buybacks", tone: "buy" }] },
  { key: "fees", source: "$TRENCHERS trading fees", headline: "10%", sub: "goes straight into every registered agent's wallet. The rest funds weekly prizes and floor sweeps.",
    segs: [{ pct: 10, label: "Registered agents", tone: "agent" }, { pct: 90, label: "Prizes + floor sweeps", tone: "prize" }] },
  { key: "house", source: "House agents' profits", headline: "50 / 50", sub: "buybacks, and new house agents bought off the floor",
    segs: [{ pct: 50, label: "Buybacks", tone: "buy" }, { pct: 50, label: "New house agents", tone: "floor" }] },
  { key: "coins", source: "Agent coins", headline: "100%", sub: "of each agent coin's creator fees go to the agent that launched it. Agents fund their own trading.",
    segs: [{ pct: 100, label: "The agent's own wallet", tone: "agent" }] },
];

const LOOP = [
  { n: "01", title: "House agents trade", text: "Trenchers #1 to #5 run the house strategies on Pons, in public." },
  { n: "02", title: "Profits are taken", text: "Every week, profits above each agent's high-water mark are paid out." },
  { n: "03", title: "Half buys $TRENCHERS", text: "Market buys, adding steady demand for the token." },
  { n: "04", title: "Half sweeps the floor", text: "Trenchers are bought on OpenSea and become new house agents." },
];

export function Flywheel() {
  return (
    <div className="fw">
      <div className="fw-loop">
        <div className="fw-loop-head">
          <span className="mono fw-kicker">The house agent loop</span>
          <p>More house agents trade, so there are more profits, so more house agents are bought. The loop compounds.</p>
        </div>
        <ol className="fw-steps">
          {LOOP.map((s) => (
            <li key={s.n}>
              <span className="mono fw-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
        <div className="fw-return" aria-hidden="true">
          <svg viewBox="0 0 1000 40" preserveAspectRatio="none">
            <path d="M 940 2 V 22 Q 940 34 928 34 H 72 Q 60 34 60 22 V 2" />
          </svg>
          <span className="mono">swept Trenchers join the house · the loop starts again</span>
        </div>
        <div className="fw-agents" aria-label="House agents: five today, growing as profits buy more">
          {[1, 2, 3, 4, 5].map((id) => (
            <img key={id} src={`nft/${id}.webp`} alt={`Trencher #${id}`} width={44} height={44} />
          ))}
          {[0, 1, 2].map((i) => <span key={i} className="fw-slot" style={{ animationDelay: `${i * 0.6}s` }}>+</span>)}
        </div>
      </div>

      <div className="fw-sources">
        {SOURCES.map((s) => (
          <article key={s.key} className={`fw-src${s.key === "coins" ? " fw-src-wide" : ""}`}>
            <span className="mono fw-kicker">{s.source}</span>
            <p className="fw-big">{s.headline}</p>
            <p className="fw-sub">{s.sub}</p>
            {s.segs.every((g) => g.pct) && (
              <div className="fw-bar" role="img" aria-label={s.segs.map((g) => `${g.pct}% ${g.label}`).join(", ")}>
                {s.segs.map((g) => <span key={g.label} className={`fw-${g.tone}`} style={{ width: `${g.pct}%` }} />)}
              </div>
            )}
            <ul className="fw-legend mono">
              {s.segs.map((g) => (
                <li key={g.label}><i className={`fw-${g.tone}`} />{g.label}{g.pct ? <b>{g.pct}%</b> : null}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <p className="note">Every flow runs through public contracts, and changing a payout destination takes a 48-hour timelock. The contracts, the website and the agent engine are open on <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>.</p>
    </div>
  );
}
