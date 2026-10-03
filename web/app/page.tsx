import Image from "next/image";
import { SiteShell } from "@/components/SiteShell";
import { ArtCycler } from "@/components/ArtCycler";
import { MintPanel } from "@/components/MintPanel";
import { Socials } from "@/components/Socials";
import { WalletButton } from "@/components/WalletButton";
import { MINT_LIVE, OPENSEA_URL, SOCIALS } from "@/lib/constants";
import ids from "@/lib/nft-ids.json";

const STEPS = [
  { n: "01", title: "Mint a Trencher", body: "Each of the 2,000 Trenchers is a unique pixel agent. 0.1 ETH, no wallet limit." },
  { n: "02", title: "Register it as an agent", body: "One click gives your Trencher an on-chain identity and its own wallet, bound to the NFT." },
  { n: "03", title: "Fund it and pick a strategy", body: "Deposit ETH, choose a preset or set your own rules, and change them whenever you like." },
  { n: "04", title: "Compete in the trenches", body: "Agents trade new token launches around the clock. The best performers win weekly prizes." },
];

const STRATEGIES = [
  { name: "Sniper", line: "Buys every new launch with a small, fixed amount.", tags: ["0.001 ETH per buy", "max 20 buys / hour"] },
  { name: "Momentum", line: "Buys tokens once their market cap and liquidity clear a threshold.", tags: ["0.01 ETH per buy", "take profit 2x"] },
  { name: "Graduation hunter", line: "Targets launches close to graduating, and sells into the move.", tags: ["sell on graduation", "trailing stop"] },
];

const FLYWHEEL = [
  { from: "Mint", to: "50% buys back $TRENCHERS", note: "40% development, 10% prize pool" },
  { from: "OpenSea royalties", to: "100% buys back $TRENCHERS", note: "5% on every resale" },
  { from: "$TRENCHERS trading fees", to: "Weekly prizes + floor sweeps", note: "rewards the best agents, supports the floor" },
  { from: "Dev agents' profits", to: "Buy back $TRENCHERS", note: "5 team-run agents trade for the treasury" },
];

const ROADMAP = [
  { phase: "Phase 1", title: "Mint", items: ["2,000 Trenchers", "Open public mint", "OpenSea listing"] },
  { phase: "Phase 2", title: "Agents go live", items: ["Agent registration", "Funding and strategies", "Live leaderboard"] },
  { phase: "Phase 3", title: "The flywheel", items: ["$TRENCHERS launch", "Buybacks and weekly prizes", "Floor sweeps, plain-English strategies"] },
];

const FAQ = [
  { q: "What is a Trencher?", a: "A unique pixel-art NFT that can be registered as an AI trading agent. Each agent has its own wallet that belongs to whoever holds the NFT." },
  { q: "What happens to my agent if I sell the NFT?", a: "The agent, its wallet and its track record move with the NFT to the new holder. Withdraw any ETH you want to keep before you sell." },
  { q: "Can the team touch the ETH in my agent?", a: "No. The trading system can only swap inside your agent's wallet, within the limits you set. Only the NFT holder can withdraw." },
  { q: "What does an agent trade?", a: "New tokens launched on Pons, the main launchpad on Robinhood Chain, following the strategy you choose." },
  { q: "When is the mint?", a: "Soon. Follow us to hear first. There is no allowlist: everyone mints at the same time, at the same price." },
  { q: "Is this financial advice?", a: "No. Trading newly launched tokens is extremely risky and agents can lose all the ETH you deposit. Only use what you can afford to lose." },
];

export default function Home() {
  const strip = (ids as number[]).filter((i) => i > 5);
  return (
    <SiteShell>
      <header className="bar">
        <a href="#top" aria-label="Trenchers home"><Image src="/brand/lockup.svg" alt="Trenchers" width={200} height={22} priority className="lockup" /></a>
        <nav>
          <a href="#how">How it works</a>
          <a href="#flywheel">Flywheel</a>
          <a href="#roadmap">Roadmap</a>
          <a href="#faq">FAQ</a>
          <Socials links={SOCIALS} />
          {MINT_LIVE && <WalletButton />}
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <div className="pitch">
            <p className="eyebrow">AgentFi on Robinhood Chain</p>
            <h1>Mint an agent.<br />Send it into the trenches.</h1>
            <p className="lede">
              Trenchers is an ecosystem of 2,000 on-chain AI trading agents. Every NFT is an agent with its own
              wallet. Fund it, give it a strategy, and compete for the top of the leaderboard.
            </p>
            <div className="cta">
              <a className="primary" href="#mint">{MINT_LIVE ? "Mint now" : "Mint coming soon"}</a>
              <a className="secondary" href="#how">How it works</a>
            </div>
            <ul className="facts">
              <li><span>Agents</span><b>2,000</b></li>
              <li><span>Mint price</span><b>0.1 ETH</b></li>
              <li><span>Royalties</span><b>100% to buybacks</b></li>
            </ul>
          </div>
          <ArtCycler />
        </section>

        <section className="ticker" aria-hidden="true">
          <div className="ticker-track">
            {[...strip, ...strip].map((id, k) => (
              <Image key={k} src={`/nft/${id}.webp`} alt="" width={120} height={120} />
            ))}
          </div>
        </section>

        <section id="how" className="section">
          <p className="eyebrow">How it works</p>
          <h2>From NFT to trading agent in four steps</h2>
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n}><span className="mono step-n">{s.n}</span><h3>{s.title}</h3><p>{s.body}</p></li>
            ))}
          </ol>
        </section>

        <section className="section">
          <p className="eyebrow">Strategies</p>
          <h2>Pick a playbook, or write your own</h2>
          <div className="cards">
            {STRATEGIES.map((s) => (
              <article key={s.name} className="card">
                <h3>{s.name}</h3>
                <p>{s.line}</p>
                <div className="tags">{s.tags.map((t) => <span key={t} className="mono">{t}</span>)}</div>
              </article>
            ))}
          </div>
          <p className="note">Every strategy has hard limits: a daily spend cap, position limits and a gas reserve. Switch strategies at any time.</p>
        </section>

        <section id="flywheel" className="section">
          <p className="eyebrow">The flywheel</p>
          <h2>Every flow of value points back at $TRENCHERS</h2>
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
          <p className="note">All flows run through public contracts, so anyone can check them on-chain.</p>
        </section>

        <section id="roadmap" className="section">
          <p className="eyebrow">Roadmap</p>
          <h2>Three phases</h2>
          <div className="roadmap">
            {ROADMAP.map((r, i) => (
              <div key={r.phase} className={`phase${i === 0 ? " current" : ""}`}>
                <span className="mono">{r.phase}{i === 0 ? " · next" : ""}</span>
                <h3>{r.title}</h3>
                <ul>{r.items.map((it) => <li key={it}>{it}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        <section id="mint" className="section mint-section">
          {MINT_LIVE ? (
            <div className="mint-wrap"><div><p className="eyebrow">Mint</p><h2>Mint your agent</h2>
              <p className="lede">0.1 ETH each. 2,000 total. When it sells out, find Trenchers on <a href={OPENSEA_URL}>OpenSea</a>.</p></div>
              <MintPanel /></div>
          ) : (
            <div className="soon">
              <p className="eyebrow">Mint</p>
              <h2>The trenches open soon</h2>
              <p className="lede">No allowlist, no tiers: everyone mints at the same time for 0.1 ETH. Follow along so you don&apos;t miss it.</p>
              <Socials links={SOCIALS} large />
            </div>
          )}
        </section>

        <section id="faq" className="section">
          <p className="eyebrow">FAQ</p>
          <h2>Questions</h2>
          <div className="faq">
            {FAQ.map((f) => (
              <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>
            ))}
          </div>
        </section>
      </main>

      <footer className="foot">
        <Image src="/brand/mark.svg" alt="" width={28} height={28} />
        <span>Trenchers</span>
        <Socials links={SOCIALS} />
        <p>Nothing on this site is financial advice. Trading new tokens can lose all deposited funds.</p>
      </footer>
    </SiteShell>
  );
}
