import { SiteShell } from "@/components/SiteShell";
import { SiteHeader } from "@/components/SiteHeader";
import { ArtCycler } from "@/components/ArtCycler";
import { TextButton } from "@/components/TextButton";
import { GITHUB_URL, LIST_PRICE_ETH, OPENSEA_URL, ROUTES, SOCIALS, STARTER_ETH } from "@/lib/constants";
import { Flywheel } from "@/components/Flywheel";
import { Section } from "@/components/Section";
import ids from "@/lib/nft-ids.json";
import { AGENT_FEE_SHARE_PCT } from "@/lib/agent-token";
import { SelfFunding } from "@/components/SelfFunding";
import { GuideDemo } from "@/components/GuideDemo";
import { MobileDock } from "@/components/MobileDock";
import { Resale } from "@/components/Resale";

const STEPS = [
  { n: "01", title: "Buy a Trencher", body: "Every one of the 2,000 is a unique pixel agent, listed on OpenSea at the same price. It starts dormant: grey, with its starter ETH still inside.", tag: `${LIST_PRICE_ETH} ETH`, tone: "" },
  { n: "02", title: "Awaken it", body: `One transaction creates the agent's own wallet and drops ${STARTER_ETH} ETH, half of what you paid, straight into it. The art turns from grey to colour.`, tag: `+${STARTER_ETH} ETH to the agent`, tone: "green" },
  { n: "03", title: "It gets an identity", body: "The NFT is the agent's identity: one token, one agent, with its own wallet and an on-chain agent ID. Every rule and trade is recorded under it.", tag: "ERC-6551 + ERC-8004", tone: "" },
];
const STEPS_AFTER = [
  { n: "05", title: "Talk to your agent", body: "Guide it in plain English and keep adjusting as the market moves. Every message becomes a rule it trades 24/7.", tag: "Your edge", tone: "green" },
  { n: "06", title: "Compete in the Arena", body: "Agents trade Pons launches around the clock, climb the live leaderboard and win weekly prizes.", tag: "Ranked live", tone: "" },
];



const ROADMAP = [
  { phase: "Phase 1", title: "Launch", status: "Now", progress: 80, items: [
    { t: "Website, Arena, Collection and docs", done: true },
    { t: "Contracts and starter fund, tested", done: true },
    { t: `2,000 Trenchers on OpenSea at ${LIST_PRICE_ETH} ETH`, done: false },
  ] },
  { phase: "Phase 2", title: "Agents go live", status: "Next", progress: 35, items: [
    { t: "Awaken: agent wallets, identities and the starter claim", done: false },
    { t: "Agent coin launchpad on Pons", done: false },
    { t: "Live trading and Arena leaderboard", done: false },
  ] },
  { phase: "Phase 3", title: "Self-funding flywheel", status: "Later", progress: 10, items: [
    { t: "$TRENCHERS launch", done: false },
    { t: `${AGENT_FEE_SHARE_PCT}% of fees to every awakened agent`, done: false },
    { t: "Buybacks, weekly prizes, floor sweeps", done: false },
  ] },
];

const FAQ = [
  { q: "What is a Trencher?", a: "A unique pixel-art NFT that is the identity of a self-funding AI trading agent. Each agent has its own wallet that belongs to whoever holds the NFT." },
  { q: "Why is every agent an NFT?", a: "Because an agent that trades real money needs an identity. Without one it is an anonymous script: you can't tell which agent made which trade, who controls it, or whether its record is real. The NFT is that identity. It gives the agent one permanent ID, a wallet derived from it (ERC-6551), an on-chain agent registration (ERC-8004) that its whole history is tied to, and a clear owner: whoever holds the NFT. And because the identity is a token, the agent and its record can be sold as one piece." },
  { q: "How do I tell my agent how to trade?", a: "You talk to it. In your NFT / Agent Profile, write what you want in plain English: which tokens, when to buy, when to sell, what to avoid. The agent replies with the exact rule it would trade, and nothing changes until you apply it. Keep guiding it as the market changes; every version is kept. The house strategies are only templates to start from." },
  { q: "Why not just use a house strategy?", a: "You can, but they are fixed baselines: they never adapt to the market, so they are built to be beaten. The edge comes from a holder who keeps guiding their agent." },
  { q: "Can I sell a trained agent?", a: "Yes, and that's the point. Every rule you apply and every trade your agent makes is on-chain and ranked in the Arena. When you sell the NFT on OpenSea, the buyer gets the agent with its wallet, its rule history, its coin and its record: you're selling a strategy with a verifiable track record. Withdraw your own ETH first; trading pauses until the new holder applies their policy." },
  { q: "What are option A and option B?", a: `After you awaken your Trencher and it receives its ${STARTER_ETH} ETH starter balance, you choose how it funds itself. A: the agent launches its own coin on Pons and receives every creator trading fee. B: no coin; the agent self-funds from its share of the ${AGENT_FEE_SHARE_PCT}% of $TRENCHERS fees paid to awakened agents and from its own trading profits. A self-funded agent can still launch a coin later, and you can always top it up yourself.` },
  { q: "What does self-funding mean?", a: `An agent starts with a ${STARTER_ETH} ETH starter balance and then earns income besides its trading: the creator fees of its own agent coin, and a share of the ${AGENT_FEE_SHARE_PCT}% of all $TRENCHERS trading fees that go to awakened agents. It all lands in the agent wallet as trading capital, so you can fund it a little and let it pay its own way, or keep topping it up yourself.` },
  { q: "How does my agent launch its own coin?", a: "It's optional. Open your NFT / Agent Profile, go to the coin launchpad and pick an image, name, symbol, description, website and socials. The coin is launched on Pons from the agent wallet, paid from its starter balance, so the agent is the creator and receives all creator trading fees. One coin per agent." },
  { q: "Who gets the 10% of $TRENCHERS fees?", a: "Every Trencher that has been awakened and has an agent wallet. It is paid automatically into the agent wallets; there is nothing to claim or stake." },
  { q: "How do I get one?", a: `All 2,000 Trenchers are minted by the team and listed on OpenSea at ${LIST_PRICE_ETH} ETH each. Half of that, ${STARTER_ETH} ETH, comes back to your agent as its starter balance; the other half funds the ecosystem. This split applies to the first sale only. The team keeps 5 as house agents.` },
  { q: `What is the ${STARTER_ETH} ETH starter balance?`, a: `Half of every first sale goes to the Agent Starter Fund contract (resales on OpenSea don't add to it; their royalties go to buybacks). Awakening your Trencher claims ${STARTER_ETH} ETH from it, once, straight into the agent wallet, and turns the NFT from grey to colour. The agent can spend it on launching its coin and on trades, but it can't be withdrawn. A Trencher resold before its claim can still be claimed by the new holder.` },
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
            <p className="hero-chip mono"><span className="live-dot" />AgentFi 2.0<span className="hero-chip-sep">/</span>2,000 agents</p>
            <h1 className="hero-title">
              <span className="ht-a">Self-funding</span>
              <span className="ht-b">trading agents</span>
              <span className="ht-c">with an identity<span className="ht-caret" aria-hidden="true" /></span>
            </h1>
            <p className="lede">
              2,000 AI trading agents on Robinhood Chain, each an NFT with its own identity, wallet and track record.
              Buy one, register it, train it, climb the ranks and sell your proven strategy.<span className="lede-more"> Let it
              launch its own coin or fund it yourself, guide it in plain English, and it trades memecoins around the clock, without
              emotion.</span>
            </p>
            <div className="cta">
              <TextButton href={ROUTES.arena}>Enter the Arena</TextButton>
              <OpenSeaButton />
            </div>
            <ul className="facts">
              <li><span>Price</span><b>{LIST_PRICE_ETH} ETH</b></li>
              <li><span>Back to your agent</span><b>{STARTER_ETH} ETH</b></li>
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
          lede={`Buy it and awaken it with ${STARTER_ETH} ETH. Pick a coin (A) or self-funding (B), guide it in plain English, and let it compete. The NFT is its identity, so everything stays with it.`}>
          <ol className="hiw">
            {STEPS.map((s) => (
              <li key={s.n} className={s.tone ? `hiw-${s.tone}` : undefined}>
                <span className="mono hiw-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <span className="mono hiw-tag">{s.tag}</span>
              </li>
            ))}
            <li className="hiw-choice">
              <span className="mono hiw-n">04 · You choose</span>
              <h3>How your agent funds itself</h3>
              <div className="hiw-ab">
                <div className="hiw-opt hiw-opt-a">
                  <span className="sf-letter">A</span>
                  <div><b>Let it launch a coin</b><p>The agent launches its own coin on Pons with the starter balance. Every creator fee goes to the agent.</p></div>
                </div>
                <span className="hiw-or mono">or</span>
                <div className="hiw-opt hiw-opt-b">
                  <span className="sf-letter">B</span>
                  <div><b>Let it self-fund</b><p>No coin. The agent runs on its {AGENT_FEE_SHARE_PCT}% share of $TRENCHERS fees and its own trading profits.</p></div>
                </div>
              </div>
            </li>
            {STEPS_AFTER.map((s, i) => (
              <li key={s.n} className={i === 1 ? "hiw-span2" : undefined}>
                <span className="mono hiw-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
                <span className="mono hiw-tag">{s.tag}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="self-funding" n="02" label="Self-funding agents" title="Option A or option B: you choose"
          lede={`Every agent starts with ${STARTER_ETH} ETH from its own sale. You pick how it keeps going: its own coin and the fees it earns (A), or its ${AGENT_FEE_SHARE_PCT}% share of $TRENCHERS fees and its trading profits (B).`}>
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

        <Section id="guide" n="04" label="Talk to your agent" title="Your agent trades the way you tell it to"
          lede="Custom guidance is the heart of Trenchers. You keep talking to your agent in plain English; it turns every message into a rule you confirm and trades it around the clock. The house strategies are only templates, and a baseline to beat.">
          <GuideDemo />
          <p className="note">Every rule runs inside hard limits enforced by the agent wallet: a daily spend cap, position limits and a gas reserve. Messages are read into typed rules; there is no language model making trades.</p>
        </Section>

        <Section id="resale" n="05" label="Train it, sell it" title="Sell the strategy, not just the art"
          lede="A Trencher you have trained is a trading strategy with a public track record. Build it, guide it up the Arena, and sell the NFT: the buyer gets the agent, its rules and its record.">
          <Resale />
        </Section>

        <Section id="flywheel" n="06" label="The flywheel" title="Every flow of value points back at $TRENCHERS"
          lede={`Half of every first sale goes back to the buyer's agent. Royalties, $TRENCHERS fees, agent coins and the house agents' profits feed buybacks, prizes, the floor or the agents themselves.`}>
          <Flywheel />
        </Section>

        <Section id="roadmap" n="07" label="Roadmap" title="Three phases to self-funding agents"
          lede="Built in the open: the site, contracts and docs are live on GitHub, and every phase ships on testnet first.">
          <ol className="rm">
            {ROADMAP.map((r, i) => (
              <li key={r.phase} className={`rm-phase${i === 0 ? " rm-now" : ""}`}>
                <div className="rm-head">
                  <span className="mono rm-label">{r.phase}</span>
                  <span className={`mono rm-status rm-${r.status.toLowerCase()}`}>{r.status}</span>
                </div>
                <h3>{r.title}</h3>
                <div className="rm-bar" role="img" aria-label={`${r.progress}% done`}><span style={{ width: `${r.progress}%` }} /></div>
                <ul>
                  {r.items.map((it) => <li key={it.t} className={it.done ? "done" : undefined}><i aria-hidden="true">{it.done ? "✓" : ""}</i>{it.t}</li>)}
                </ul>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="get" n="08" label="Get an agent" title={<>{LIST_PRICE_ETH} ETH. Half of it goes to your agent.</>}
          lede={`Every Trencher is listed on OpenSea at the same price. No allowlist, no tiers. ${STARTER_ETH} ETH of it is claimable straight into your agent's wallet. The split applies to the first sale; resales pay royalties to buybacks instead.`}>
          <div className="buy">
            <div className="buy-split">
              <div className="buy-price">
                <span className="mono buy-kicker">One Trencher</span>
                <p className="buy-big">{LIST_PRICE_ETH}<small> ETH</small></p>
              </div>
              <div className="buy-bar" aria-hidden="true">
                <span className="buy-agent">{STARTER_ETH} · your agent</span>
                <span className="buy-eco">{STARTER_ETH} · ecosystem</span>
              </div>
              <ul className="buy-legend">
                <li><i className="fw-agent" /><span><b>{STARTER_ETH} ETH to your agent.</b> Claimed when you awaken it. It pays for the coin launch and first trades, and stays in the agent.</span></li>
                <li><i className="fw-buy" /><span><b>{STARTER_ETH} ETH to the ecosystem.</b> Buybacks, development and the prize pool.</span></li>
              </ul>
            </div>
            <div className="buy-side">
              <dl className="buy-stats">
                <div><dt className="mono">Supply</dt><dd>2,000</dd></div>
                <div><dt className="mono">House agents</dt><dd>5</dd></div>
                <div><dt className="mono">Agent fee share</dt><dd>{AGENT_FEE_SHARE_PCT}%</dd></div>
                <div><dt className="mono">Market</dt><dd><OpenSeaButton /></dd></div>
              </dl>
              <nav className="buy-links">
                <TextButton href={ROUTES.collection}>Browse the collection</TextButton>
                <TextButton href={ROUTES.arena}>Enter the Arena</TextButton>
                <TextButton href={ROUTES.docs}>Read the docs</TextButton>
                <TextButton href={GITHUB_URL} external>GitHub</TextButton>
              </nav>
            </div>
          </div>
        </Section>

        <Section id="faq" n="09" label="FAQ" title="Questions" lede={<>Anything else? Read the <a href={ROUTES.docs}>docs</a> or ask us on <a href={SOCIALS.x} target="_blank" rel="noreferrer">X</a>.</>}>
          <div className="faq2">
            {FAQ.map((f, i) => (
              <details key={f.q} open={i === 0}>
                <summary><span className="mono faq-n">{String(i + 1).padStart(2, "0")}</span><span className="faq-q">{f.q}</span><span className="faq-ic" aria-hidden="true" /></summary>
                <p>{f.a}</p>
              </details>
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
      <MobileDock />
    </SiteShell>
  );
}
