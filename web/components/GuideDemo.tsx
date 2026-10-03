import { HOUSE_STRATEGIES } from "@/lib/strategies";
import { TextButton } from "@/components/TextButton";
import { ROUTES } from "@/lib/constants";

const CONVO: { you?: string; agent?: string; rule?: string; tag?: string }[] = [
  { you: "Only new launches with more than 3 ETH liquidity. Take profit at 40%, stop loss 20%." },
  { agent: "Got it. Here's the rule I'd trade:", rule: "Buy every new Pons launch (liquidity above 3 ETH), take profit at +40%, stop loss at -20%.", tag: "Applied · v1" },
  { you: "Too many duds this morning. Only tokens launched in the last 10 minutes." },
  { agent: "Added a filter:", rule: "…(launched in the last 10 min, liquidity above 3 ETH), take profit at +40%, stop loss at -20%.", tag: "Applied · v2" },
  { you: "Market's fast today, just hold for 2 minutes instead." },
  { agent: "Switched the exit to a timer. 14 trades since v2, +6.2%.", rule: "…sell after 2 min.", tag: "Applied · v3" },
];

/** Landing section: guiding your own agent is the core; house strategies are only templates. */
export function GuideDemo() {
  return (
    <div className="gd">
      <div className="gd-chat" aria-label="Example conversation with an agent">
        <div className="gd-head">
          <img src="nft/669.webp" alt="" width={32} height={32} />
          <div><b>Trencher #669</b><span className="mono"><i className="live-dot" /> Trading · rule v3</span></div>
        </div>
        <div className="gd-log">
          {CONVO.map((m, i) => m.you ? (
            <p key={i} className="gd-you">{m.you}</p>
          ) : (
            <div key={i} className="gd-agent">
              <p>{m.agent}</p>
              <div className="gd-rule"><span className="mono">{m.tag}</span>{m.rule}</div>
            </div>
          ))}
        </div>
        <div className="gd-input mono">Tell your agent how to trade…<span>[Send]</span></div>
      </div>

      <div className="gd-side">
        <ol className="gd-points">
          <li><span className="mono">01</span><div><b>You talk, it listens</b><p>Plain English, any time. React to the market, tighten or loosen, switch signals.</p></div></li>
          <li><span className="mono">02</span><div><b>Every message becomes a rule</b><p>The agent shows the exact rule it will trade. Nothing changes until you apply it, and every version is kept.</p></div></li>
          <li><span className="mono">03</span><div><b>It executes without emotion</b><p>24/7, within hard limits the agent wallet enforces. No fear, no greed, no revenge trades.</p></div></li>
        </ol>
        <div className="gd-templates">
          <span className="mono gd-tk">House templates · a baseline to beat</span>
          <p>Five fixed strategies the team runs in public. Fine as a starting point, but they never adapt, so they can&apos;t keep up with a guided agent.</p>
          <ul>
            {HOUSE_STRATEGIES.map((s) => (
              <li key={s.name} className="mono"><span>#{s.houseAgent} {s.name}</span><em>{s.holdSec! >= 60 ? `${s.holdSec! / 60} min` : `${s.holdSec} sec`}</em></li>
            ))}
          </ul>
        </div>
        <TextButton href={ROUTES.agents}>Talk to your agent</TextButton>
      </div>
    </div>
  );
}
