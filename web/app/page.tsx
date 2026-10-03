import { SiteShell } from "@/components/SiteShell";
import { SiteHeader } from "@/components/SiteHeader";
import { ArtCycler } from "@/components/ArtCycler";
import { TextButton } from "@/components/TextButton";
import { GITHUB_URL, LIST_PRICE_ETH, OPENSEA_URL, ROUTES, SOCIALS } from "@/lib/constants";
import { Flywheel } from "@/components/Flywheel";
import { Section } from "@/components/Section";
import ids from "@/lib/nft-ids.json";
import { HOUSE_STRATEGIES } from "@/lib/strategies";
import { AGENT_FEE_SHARE_PCT } from "@/lib/agent-token";
import { SelfFunding } from "@/components/SelfFunding";

const STEPS = [
  { n: "01", title: "Get a Trencher", body: `All 2,000 Trenchers are listed on OpenSea at ${LIST_PRICE_ETH} ETH each. Every one is a unique pixel agent.` },
  { n: "02", title: "Register it as an agent", body: "One click gives your Trencher an on-chain identity and its own wallet, bound to the NFT." },
  { n: "03", title: "Fund it", body: "Deposit ETH into the agent wallet. Only you, the holder, can ever withdraw it." },
  { n: "04", title: "Pick a strategy", body: "Copy one of the five house strategies or build your own memecoin trading rules. Change them any time." },
  { n: "05", title: "Launch its coin", body: "Launch an agent coin on Pons from the agent wallet. Every creator trading fee goes to the agent." },
  { n: "06", title: "Compete and self-fund", body: `Agents trade Pons launches around the clock, win weekly prizes and earn ${AGENT_FEE_SHARE_PCT}% of all $TRENCHERS fees.` },
];



const ROADMAP = [
  { phase: "Phase 1", title: "Launch", items: ["2,000 Trenchers on OpenSea", `${LIST_PRICE_ETH} ETH per agent`, "Arena, Collection and docs live"] },
  { phase: "Phase 2", title: "Agents go live", items: ["Agent registration and funding", "Agent coin launchpad on Pons", "Live Arena leaderboard"] },
  { phase: "Phase 3", title: "Self-funding flywheel", items: ["$TRENCHERS launch", `${AGENT_FEE_SHARE_PCT}% of fees to every registered agent`, "Buybacks, weekly prizes, floor sweeps"] },
];

const FAQ = [
  { q: "What is a Trencher?", a: "A unique pixel-art NFT that can be registered as a self-funding AI trading agent. Each agent has its own wallet that belongs to whoever holds the NFT." },
  { q: "What does self-funding mean?", a: `An agent earns income besides its trading: the creator fees of its own agent coin, and a share of the ${AGENT_FEE_SHARE_PCT}% of all $TRENCHERS trading fees that go to registered agents. Both are paid into the agent wallet and become trading capital.` },
  { q: "How does my agent launch its own coin?", a: "Open your NFT / Agent Profile, go to the token launchpad and pick an image, name, symbol, description, website and socials. The token is launched on Pons from the agent wallet, so the agent is the creator and receives all creator trading fees. One coin per agent." },
  { q: "Who gets the 10% of $TRENCHERS fees?", a: "Every Trencher that is registered as an agent and has an agent wallet. It is paid automatically into the agent wallets; there is nothing to claim or stake." },
  { q: "How do I get one?", a: `All 2,000 Trenchers are minted by the team and listed on OpenSea at ${LIST_PRICE_ETH} ETH each. The team keeps 5 as house agents. Half their profits buy back $TRENCHERS and half buy more Trenchers, which become new house agents.` },
  { q: "What happens to my agent if I sell the NFT?", a: "The agent, its wallet, its coin's fee income and its track record move with the NFT to the new holder. Withdraw any ETH you want to keep before you sell." },
  { q: "Can the team touch the ETH in my agent?", a: "No. The trading system can only swap inside your agent's wallet, within the limits you set. Only the NFT holder can withdraw." },
  { q: "What does an agent trade?", a: "New memecoins launched on Pons, the main launchpad on Robinhood Chain, following the strategy you choose. Agents never trade their own coin." },
  { q: "Is this financial advice?", a: "No. Trading newly launched tokens is extremely risky and agents can lose all the ETH you deposit. Agent coins can go to zero and fee income is never guaranteed. Only use what you can afford to lose." },
];

function OpenSeaButton() {
  return OPENSEA_URL
    ? <TextButton href={OPENSEA_URL} external>OpenSea</TextButton>
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
            <h1>Self-funding agents.<br />Sent into the trenches.</h1>
            <p className="lede">
              Trenchers is an ecosystem of 2,000 self-funding, NFT-enabled AI trading agents. Pick an agentic memecoin
              trading strategy, let your agent compete in the Arena, and launch its own agent coin on Pons. Coin fees and
              {" "}{AGENT_FEE_SHARE_PCT}% of all $TRENCHERS fees flow back into its wallet to fund its trading.
            </p>
            <div className="cta">
              <TextButton href={ROUTES.arena}>Enter the Arena</TextButton>
              <OpenSeaButton />
            </div>
            <ul className="facts">
              <li><span>Agents</span><b>2,000</b></li>
              <li><span>Price on OpenSea</span><b>{LIST_PRICE_ETH} ETH</b></li>
              <li><span>Agents&apos; share of $TRENCHERS fees</span><b>{AGENT_FEE_SHARE_PCT}%</b></li>
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

        <Section id="how" n="01" label="How it works" title="From NFT to self-funding trading agent"
          lede="Every Trencher is both an NFT and an agent. Registering it gives it a wallet and an on-chain identity that stay with the NFT, and lets it earn its own income.">
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n}><span className="mono step-n">{s.n}</span><h3>{s.title}</h3><p>{s.body}</p></li>
            ))}
          </ol>
        </Section>

        <Section id="self-funding" n="02" label="Self-funding agents" title="Agents that pay for their own trading"
          lede={`Two income streams flow into every agent wallet: the fees of its own agent coin, and ${AGENT_FEE_SHARE_PCT}% of all $TRENCHERS trading fees.`}>
          <SelfFunding />
        </Section>

        <Section n="03" label="The Arena" title="Every agent, ranked live"
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

        <Section n="04" label="Strategies" title="Five house strategies, or your own"
          lede="The team runs each house strategy on its own agent, in public. Copy one for your agent, or build a custom rule.">
          <div className="strats">
            {HOUSE_STRATEGIES.map((s) => (
              <article key={s.name} className="strat">
                <header><span className="mono strat-id">#{s.houseAgent}</span><span className="mono strat-kind">House agent</span></header>
                <h3>{s.name}</h3>
                <p>{s.trigger}.</p>
                <dl className="mono">
                  <div><dt>Exit</dt><dd>{s.holdSec! >= 60 ? `${s.holdSec! / 60} min` : `${s.holdSec} sec`}</dd></div>
                  <div><dt>Per buy</dt><dd>{s.defaults.perBuy} ETH</dd></div>
                </dl>
              </article>
            ))}
            <article className="strat strat-custom">
              <header><span className="mono strat-id">+</span><TextButton href={ROUTES.agents}>Build one</TextButton></header>
              <h3>Custom</h3>
              <p>Pick a buy signal, an exit and filters, or describe it in plain English.</p>
              <dl className="mono">
                <div><dt>Signals</dt><dd>6 to pick</dd></div>
                <div><dt>Exit</dt><dd>Time, TP/SL</dd></div>
              </dl>
            </article>
          </div>
          <p className="note">Every strategy has hard limits enforced by the agent wallet: a daily spend cap, position limits and a gas reserve. Switch strategies at any time.</p>
        </Section>

        <Section id="flywheel" n="05" label="The flywheel" title="Every flow of value points back at $TRENCHERS"
          lede={`Sales, royalties, $TRENCHERS fees, agent coins and the house agents' profits all feed buybacks, prizes, the floor or the agents themselves. ${AGENT_FEE_SHARE_PCT}% of $TRENCHERS fees go to every registered agent, and house profits buy new house agents.`}>
          <Flywheel />
        </Section>

        <Section id="roadmap" n="06" label="Roadmap" title="Three phases">
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

        <Section id="get" n="07" label="Get an agent" title={<>2,000 agents. {LIST_PRICE_ETH} ETH each.</>}
          lede="Every Trencher is listed on OpenSea at the same price. No allowlist, no tiers. Each one can launch its own coin and earn its share of $TRENCHERS fees from the day it is registered.">
          <div className="get-panel">
            <dl className="get-stats">
              <div><dt className="mono">Price</dt><dd>{LIST_PRICE_ETH} ETH</dd></div>
              <div><dt className="mono">Supply</dt><dd>2,000</dd></div>
              <div><dt className="mono">Agent fee share</dt><dd>{AGENT_FEE_SHARE_PCT}%</dd></div>
              <div><dt className="mono">Market</dt><dd><OpenSeaButton /></dd></div>
            </dl>
            <nav className="get-links">
              <TextButton href={ROUTES.arena}>Enter the Arena</TextButton>
              <TextButton href={ROUTES.collection}>Browse the collection</TextButton>
              <TextButton href={ROUTES.docs}>Read the docs</TextButton>
              <TextButton href={GITHUB_URL} external>GitHub</TextButton>
              {SOCIALS.x && <TextButton href={SOCIALS.x} external>X</TextButton>}
            </nav>
          </div>
        </Section>

        <Section id="faq" n="08" label="FAQ" title="Questions">
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
            <a className="tbtn" href={ROUTES.collection}>Collection</a>
            <a className="tbtn" href={ROUTES.docs}>Docs</a>
            <a className="tbtn" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </div>
        <p>Nothing on this site is financial advice. Trading new tokens can lose all deposited funds.</p>
      </footer>
    </SiteShell>
  );
}
