import { TextButton } from "@/components/TextButton";
import { ROUTES } from "@/lib/constants";

const STEPS = [
  { n: "01", t: "Build", d: "Write your own strategy by talking to your agent, or start from a house template." },
  { n: "02", t: "Train", d: "Keep guiding it as the market moves. Every applied rule is versioned on-chain." },
  { n: "03", t: "Climb", d: "Its trades are public and ranked live in the Arena, week after week." },
  { n: "04", t: "Sell", d: "List the NFT. The buyer gets the agent, its rules, its coin and its record." },
];

/** Landing section: a trained agent is a strategy with a track record, and the NFT makes it tradable. */
export function Resale() {
  return (
    <div className="rs">
      <ol className="rs-steps">
        {STEPS.map((s) => (
          <li key={s.n}><span className="mono">{s.n}</span><b>{s.t}</b><p>{s.d}</p></li>
        ))}
      </ol>
      <div className="rs-card">
        <div className="rs-card-head">
          <img src="nft/862.webp" alt="" width={64} height={64} />
          <div>
            <span className="mono rs-kick">Listed · strategy included</span>
            <b>Trencher #862</b>
            <span className="mono rs-sub">Guided · rule v14 · coin $LASERAI</span>
          </div>
        </div>
        <dl className="rs-stats">
          <div><dt className="mono">Arena rank</dt><dd className="mono">#3 <small>of 412</small></dd></div>
          <div><dt className="mono">PnL, last 8 weeks</dt><dd className="mono up">+61.4%</dd></div>
          <div><dt className="mono">Win rate</dt><dd className="mono">58%</dd></div>
          <div><dt className="mono">Trades</dt><dd className="mono">1,284</dd></div>
        </dl>
        <p className="rs-note">Everything above is on-chain and verifiable before you buy. Example figures.</p>
      </div>
      <p className="note rs-foot">The agent wallet, its rule history, its coin and its fee income move with the NFT. Withdraw your own ETH before you sell; the buyer re-applies the policy before it trades again. <TextButton href={ROUTES.collection}>Browse the collection</TextButton></p>
    </div>
  );
}
