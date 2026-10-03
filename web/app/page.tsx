import Image from "next/image";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { MintPanel } from "@/components/MintPanel";
import { OPENSEA_URL } from "@/lib/constants";

const SAMPLES = [418, 77, 1203, 9, 640, 1555, 333, 1789, 25, 1402, 980, 61];

export default function Home() {
  return (
    <main>
      <header className="bar">
        <Image src="/brand/lockup.svg" alt="Trenchers" width={220} height={25} priority className="lockup" />
        <nav>
          <a href={OPENSEA_URL} target="_blank" rel="noreferrer">OpenSea</a>
          <ConnectButton chainStatus="icon" showBalance={false} />
        </nav>
      </header>

      <section className="hero">
        <div className="pitch">
          <p className="eyebrow">Robinhood Chain · 2,000 agents</p>
          <h1>Mint an agent.<br />Send it into the trenches.</h1>
          <p className="lede">
            Every Trencher can be registered as an on-chain trading agent with its own wallet.
            Fund it, give it a strategy for new Pons launches, and climb the weekly leaderboard.
            Sell the NFT and the agent, its wallet and its record go with it.
          </p>
          <ul className="facts">
            <li><span>Price</span><b>0.1 ETH</b></li>
            <li><span>Supply</span><b>2,000</b></li>
            <li><span>Royalty</span><b>5% to buybacks</b></li>
          </ul>
        </div>
        <MintPanel />
      </section>

      <section className="grid" aria-label="Sample Trenchers">
        {SAMPLES.map((id) => (
          <figure key={id}>
            <Image src={`/samples/${id}.png`} alt={`Trenchers #${id}`} width={360} height={360} />
            <figcaption>#{id}</figcaption>
          </figure>
        ))}
      </section>

      <section className="how">
        <h2>Where the mint goes</h2>
        <div className="split">
          <div style={{ flexBasis: "50%" }} className="seg seg-buy"><b>50%</b><span>$TRENCHERS buybacks</span></div>
          <div style={{ flexBasis: "40%" }} className="seg seg-dev"><b>40%</b><span>development, half vested 6 months</span></div>
          <div style={{ flexBasis: "10%" }} className="seg seg-prize"><b>10%</b><span>prizes</span></div>
        </div>
        <p className="note">
          Proceeds can only be sent to the revenue splitter contract, and every split is visible on-chain.
          Agent registration opens after the mint. Nothing here is financial advice; trading memecoins can lose all deposited ETH.
        </p>
      </section>
    </main>
  );
}
