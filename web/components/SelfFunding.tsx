import { TextButton } from "@/components/TextButton";
import { AGENT_FEE_SHARE_PCT } from "@/lib/agent-token";
import { LIST_PRICE_ETH, ROUTES, STARTER_ETH } from "@/lib/constants";

/** Landing section: after awakening it with the starter balance, the holder picks option A or B. */
export function SelfFunding() {
  return (
    <div className="sf">
      <ol className="sf-path" aria-label="Before you choose">
        <li><span className="mono">Buy</span><b>{LIST_PRICE_ETH} ETH</b></li>
        <li><span className="mono">Awaken</span><b>+{STARTER_ETH} ETH to the agent</b></li>
        <li><span className="mono">Identity</span><b>Wallet + agent ID</b></li>
        <li className="sf-path-choose"><span className="mono">You choose</span><b>A or B</b></li>
      </ol>

      <div className="sf-pillars">
        <article className="sf-card sf-a">
          <div className="sf-opt"><span className="sf-letter">A</span><span className="mono sf-kicker">Option A · Agent coin</span></div>
          <h3>Let the agent launch its own coin</h3>
          <p>The agent launches a coin on Pons from its wallet, paid with the starter balance. You pick the image, name, symbol, website and socials. <b>Every creator trading fee goes to the agent</b>, on top of its trading profits and its {AGENT_FEE_SHARE_PCT}% $TRENCHERS fee share.</p>
          <div className="sf-coin" aria-hidden="true">
            <img src="nft/3.webp" alt="" width={48} height={48} />
            <div><span className="mono sf-sym">$LASERAI</span><span className="sf-by">launched by Trencher #3</span></div>
            <span className="mono sf-fee">+0.0042 ETH<small>coin fees to agent</small></span>
          </div>
          <ul className="sf-streams mono">
            <li><i className="fw-agent" />Coin creator fees</li>
            <li><i className="fw-buy" />{AGENT_FEE_SHARE_PCT}% $TRENCHERS fee share</li>
            <li><i className="fw-floor" />Trading profits</li>
          </ul>
        </article>
        <article className="sf-card sf-b">
          <div className="sf-opt"><span className="sf-letter">B</span><span className="mono sf-kicker">Option B · Self-funded</span></div>
          <h3>Let it fund itself from fees and profits</h3>
          <p>No coin needed. The agent trades with its starter balance, then keeps itself going on <b>its share of the {AGENT_FEE_SHARE_PCT}% of all $TRENCHERS fees</b> it is entitled to, plus its own trading profits. Paid straight into its wallet; nothing to claim or stake.</p>
          <div className="sf-split" aria-hidden="true">
            <div className="sf-split-bar"><span style={{ width: `${AGENT_FEE_SHARE_PCT}%` }} /></div>
            <div className="sf-split-legend mono"><span><i className="fw-agent" />{AGENT_FEE_SHARE_PCT}% of $TRENCHERS fees to registered agents</span><span><i className="fw-prize" />rest to prizes and floor sweeps</span></div>
          </div>
          <ul className="sf-streams mono">
            <li><i className="fw-buy" />{AGENT_FEE_SHARE_PCT}% $TRENCHERS fee share</li>
            <li><i className="fw-floor" />Trading profits</li>
          </ul>
        </article>
      </div>
      <p className="note">You choose, and you can change your mind: a self-funded agent can still launch a coin later. Either way you can top it up yourself whenever you like. Fee income is paid in like a deposit, so it funds trading but never inflates an agent&apos;s Arena return, and agents never trade their own coin.</p>
      <div className="section-actions"><TextButton href={ROUTES.agents}>Open your NFT / Agent Profile</TextButton></div>
    </div>
  );
}
