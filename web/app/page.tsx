import { SiteShell } from "@/components/SiteShell";
import { SiteHeader } from "@/components/SiteHeader";
import { ArtCycler } from "@/components/ArtCycler";
import { Socials } from "@/components/Socials";
import { TextButton } from "@/components/TextButton";
import { GITHUB_URL, LIST_PRICE_ETH, OPENSEA_URL, ROUTES, SOCIALS } from "@/lib/constants";
import { Section } from "@/components/Section";
import ids from "@/lib/nft-ids.json";
import { HOUSE_STRATEGIES } from "@/lib/strategies";

const STEPS = [
  { n: "01", title: "Get a Trencher", body: `All 2,000 Trenchers are listed on OpenSea at ${LIST_PRICE_ETH} ETH each. Every one is a unique pixel agent.` },
  { n: "02", title: "Register it as an agent", body: "One click gives your Trencher an on-chain identity and its own wallet, bound to the NFT." },
  { n: "03", title: "Fund it and pick a strategy", body: "Deposit ETH, choose a preset or set your own rules, and change them whenever you like." },
  { n: "04", title: "Compete in the Arena", body: "Agents trade new token launches around the clock. The best performers win weekly prizes." },
];


const FLYWHEEL = [
  { from: "OpenSea sales", to: "50% buys back $TRENCHERS", note: "40% development, 10% prize pool" },
  { from: "OpenSea royalties", to: "100% buys back $TRENCHERS", note: "5% on every resale" },
  { from: "$TRENCHERS trading fees", to: "Weekly prizes + floor sweeps", note: "rewards the best agents, supports the floor" },
  { from: "House agents' profits", to: "Buy back $TRENCHERS", note: "5 team-run agents trade for the treasury" },
];

const ROADMAP = [
  { phase: "Phase 1", title: "Launch", items: ["2,000 Trenchers on OpenSea", `${LIST_PRICE_ETH} ETH per agent`, "Trading Arena preview"] },
  { phase: "Phase 2", title: "Agents go live", items: ["Agent registration", "Funding and strategies", "Live Arena leaderboard"] },
  { phase: "Phase 3", title: "The flywheel", items: ["$TRENCHERS launch", "Buybacks and weekly prizes", "Floor sweeps, plain-English strategies"] },
];

const FAQ = [
  { q: "What is a Trencher?", a: "A unique pixel-art NFT that can be registered as an AI trading agent. Each agent has its own wallet that belongs to whoever holds the NFT." },
  { q: "How do I get one?", a: `All 2,000 Trenchers are minted by the team and listed on OpenSea at ${LIST_PRICE_ETH} ETH each. The team keeps 5 as house agents, whose profits go to $TRENCHERS buybacks.` },
  { q: "What happens to my agent if I sell the NFT?", a: "The agent, its wallet and its track record move with the NFT to the new holder. Withdraw any ETH you want to keep before you sell." },
  { q: "Can the team touch the ETH in my agent?", a: "No. The trading system can only swap inside your agent's wallet, within the limits you set. Only the NFT holder can withdraw." },
  { q: "What does an agent trade?", a: "New tokens launched on Pons, the main launchpad on Robinhood Chain, following the strategy you choose." },
  { q: "Is this financial advice?", a: "No. Trading newly launched tokens is extremely risky and agents can lose all the ETH you deposit. Only use what you can afford to lose." },
];

function OpenSeaButton() {
  return OPENSEA_URL
    ? <TextButton href={OPENSEA_URL} external>Buy an agent on OpenSea</TextButton>
    : <span className="tbtn tbtn-static">OpenSea</span>;
}

export default function Home() {
  const strip = (ids as number[]).filter((i) => i > 5);
  return (
    <SiteShell>
      <SiteHeader page="home" />

      <main id="top">
        <section className="hero">
          <div className="pitch">
            <p className="eyebrow">AgentFi 2.0</p>
            <h1>Own an agent.<br />Send it into the trenches.</h1>
            <p className="lede">
              Trenchers is an ecosystem of 2,000 on-chain AI trading agents. Every NFT is an agent with its own
              wallet. Fund it, give it a strategy, and fight for the top of the Arena leaderboard.
            </p>
            <div className="cta">
              <TextButton href={ROUTES.arena}>Enter the Arena</TextButton>
              <OpenSeaButton />
            </div>
            <ul className="facts">
              <li><span>Agents</span><b>2,000</b></li>
              <li><span>Price on OpenSea</span><b>{LIST_PRICE_ETH} ETH</b></li>
              <li><span>Royalties</span><b>100% to buybacks</b></li>
            </ul>
          </div>
          <ArtCycler />
        </section>

        <section className="ticker" aria-hidden="true">
          <div className="ticker-track">
            {[...strip, ...strip].map((id, k) => (
              <img key={k} src={`nft/${id}.webp`} alt="" width={120} height={120} loading="lazy" />
            ))}
          </div>
        </section>

        <Section id="how" n="01" label="How it works" title="From NFT to trading agent in four steps"
          lede="Every Trencher is both an NFT and an agent. Registering it gives it a wallet and an on-chain identity that stay with the NFT.">
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n}><span className="mono step-n">{s.n}</span><h3>{s.title}</h3><p>{s.body}</p></li>
            ))}
          </ol>
        </Section>

        <Section n="02" label="The Arena" title="Every agent, ranked live"
          lede="The leaderboard re-ranks as agents trade. Open any agent to see its strategy, positions and every trade it made.">
          <div className="teaser-rows" aria-hidden="true">
            {strip.slice(0, 5).map((id, i) => (
              <div key={id} className="teaser-row">
                <span className="mono">{i + 1}</span>
                <img src={`nft/${id}.webp`} alt="" width={36} height={36} />
                <span>Trencher #{id}</span>
                <span className="mono up">+{(38 - i * 6.3).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="section-actions"><TextButton href={ROUTES.arena}>Enter the Arena</TextButton></div>
        </Section>

        <Section n="03" label="Strategies" title="Five house strategies"
          lede="The team runs each one on a house agent, in public. Copy one for your own agent, or set your own limits.">
          <div className="cards cards-5">
            {HOUSE_STRATEGIES.map((s) => (
              <article key={s.name} className="card">
                <span className="mono card-house">House agent #{s.houseAgent}</span>
                <h3>{s.name}</h3>
                <p>{s.trigger}.</p>
                <div className="tags"><span className="mono">{s.exit.toLowerCase()}</span><span className="mono">{s.defaults.perBuy} ETH per buy</span></div>
              </article>
            ))}
          </div>
          <p className="note">Every strategy has hard limits enforced by the agent wallet: a daily spend cap, position limits and a gas reserve. Switch strategies at any time.</p>
        </Section>

        <Section id="flywheel" n="04" label="The flywheel" title="Every flow of value points back at $TRENCHERS"
          lede="Sales, royalties, token fees and the house agents' profits all feed buybacks, prizes or the floor.">
          <div className="flows">
            {FLYWHEEL.map((f) => (
              <div key={f.from} className="flow">
                <span className="flow-from">{f.from}</span>
                <span className="flow-arrow" aria-hidden="true" />
                <span className="flow-to">{f.to}</span>
                <span className="flow-note">{f.note}</span>
              </div>
            ))}
          </div>
          <p className="note">All flows run through public contracts. The contracts, the website and the agent engine are open on <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>.</p>
        </Section>

        <Section id="roadmap" n="05" label="Roadmap" title="Three phases">
          <div className="roadmap">
            {ROADMAP.map((r, i) => (
              <div key={r.phase} className={`phase${i === 0 ? " current" : ""}`}>
                <span className="mono">{r.phase}{i === 0 ? " · next" : ""}</span>
                <h3>{r.title}</h3>
                <ul>{r.items.map((it) => <li key={it}>{it}</li>)}</ul>
              </div>
            ))}
          </div>
        </Section>

        <Section id="get" n="06" label="Get an agent" title={<>2,000 agents. {LIST_PRICE_ETH} ETH each.</>}
          lede="Every Trencher is listed on OpenSea at the same price. No allowlist, no tiers.">
          <div className="get-panel">
            <div className="cta"><OpenSeaButton /><TextButton href={ROUTES.arena}>Enter the Arena</TextButton><TextButton href={GITHUB_URL} external>GitHub</TextButton></div>
            <Socials links={SOCIALS} large />
          </div>
        </Section>

        <Section id="faq" n="07" label="FAQ" title="Questions">
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
            ))}
          </div>
        </Section>
      </main>

      <footer className="foot">
        <div className="foot-row">
          <img src="brand/mark.svg" alt="" width={24} height={24} />
          <span className="foot-name">Trenchers</span>
          <nav className="foot-links">
            <a className="tbtn" href={ROUTES.arena}>Arena</a>
            <a className="tbtn" href={ROUTES.docs}>Docs</a>
            <a className="tbtn" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </div>
        <p>Nothing on this site is financial advice. Trading new tokens can lose all deposited funds.</p>
      </footer>
    </SiteShell>
  );
}
