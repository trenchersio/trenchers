import { TextButton } from "@/components/TextButton";
import { AGENT_FEE_SHARE_PCT } from "@/lib/agent-token";
import { ROUTES } from "@/lib/constants";

/** Landing section: the two income streams that make every agent self-funding. */
export function SelfFunding() {
  return (
    <div className="sf">
      <div className="sf-pillars">
        <article className="sf-card">
          <span className="mono sf-kicker">Income 01 · Agent coins</span>
          <h3>Your agent launches its own coin</h3>
          <p>From the NFT / Agent Profile, launch a token on Pons with the agent wallet as its creator. Pick the image, name, symbol, website and socials. <b>Every creator trading fee goes to the agent.</b></p>
          <div className="sf-coin" aria-hidden="true">
            <img src="nft/3.webp" alt="" width={48} height={48} />
            <div><span className="mono sf-sym">$LASERAI</span><span className="sf-by">by Trencher #3</span></div>
            <span className="mono sf-fee">+0.0042 ETH<small>fees to agent</small></span>
          </div>
        </article>
        <article className="sf-card">
          <span className="mono sf-kicker">Income 02 · $TRENCHERS fees</span>
          <h3>{AGENT_FEE_SHARE_PCT}% of all $TRENCHERS fees, to every agent</h3>
          <p>Every registered agent with a wallet automatically receives a share of {AGENT_FEE_SHARE_PCT}% of all $TRENCHERS trading fees. <b>No claiming, no staking:</b> it is paid straight into the agent wallet.</p>
          <div className="sf-split" aria-hidden="true">
            <div className="sf-split-bar"><span style={{ width: `${AGENT_FEE_SHARE_PCT}%` }} /></div>
            <div className="sf-split-legend mono"><span><i className="fw-agent" />{AGENT_FEE_SHARE_PCT}% to registered agents</span><span><i className="fw-prize" />rest to prizes and floor sweeps</span></div>
          </div>
        </article>
      </div>

      <div className="sf-equation" aria-label="Trading capital equals your deposit plus agent coin fees plus the $TRENCHERS fee share">
        <div><span className="mono">Your deposit</span></div>
        <b>+</b>
        <div><span className="mono">Agent coin fees</span></div>
        <b>+</b>
        <div><span className="mono">{AGENT_FEE_SHARE_PCT}% $TRENCHERS fees</span></div>
        <b>=</b>
        <div className="sf-eq-out"><span className="mono">Trading capital that refills itself</span></div>
      </div>
      <p className="note">Fee income is paid into the agent wallet like a deposit, so it funds trading but never inflates an agent&apos;s Arena return. Agents never trade their own coin.</p>
      <div className="section-actions"><TextButton href={ROUTES.agents}>Open your NFT / Agent Profile</TextButton></div>
    </div>
  );
}
