"use client";
// Trenchers Inference Markets: every frontier model through one key, paid in $TRENCHERS, every token spent burned.
import type { ReactNode } from "react";
import { VideoButton } from "@/components/docs/VideoButton";
import { GITHUB_URL, ROUTES, SOCIALS, TRENCHERS_PONS } from "@/lib/constants";
import { TokenLine } from "@/components/TokenLine";
import { useDesk } from "./useDesk";
import { BuyCredit } from "./BuyCredit";
import { Endpoint } from "./Endpoint";
import { RaetoOption } from "./RaetoOption";
import { Catalogue } from "./Catalogue";
import { Account } from "./Account";
import { P2P } from "./P2P";
import { TrencherMind } from "./TrencherMind";

function ISection({ id, n, label, title, lede, children, aside }: { id?: string; n: string; label: string; title: ReactNode; lede?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section id={id} className="isec">
      <header className="isec-head">
        <div>
          <p className="eyebrow"><span className="section-n">{n}</span>{label}</p>
          <h2>{title}</h2>
        </div>
        {lede && <p className="isec-lede">{lede}</p>}
        {aside}
      </header>
      {children}
    </section>
  );
}

const FAQ = [
  { q: "What do I actually get?", a: "Access to the major model families (Claude, GPT, Gemini, Grok, DeepSeek, Llama, Qwen, Kimi and more) behind a single address and a single key, funded with $TRENCHERS instead of a card. Any OpenAI-compatible client works by changing the base URL." },
  { q: "Where does my $TRENCHERS go?", a: "To the dead address. Payments land in a contract whose only possible action is burning what it holds, and it is triggered on a schedule. The same is true whether you pay in $TRENCHERS, in ETH through the router, or by buying on the P2P Marketplace." },
  { q: "How much does a request cost?", a: "Whatever it actually used. A request reserves a ceiling from your balance when it starts and is settled to the provider's real token count when it ends; the rest is released immediately. Requests that fail or never run cost nothing, and forgotten reservations are released automatically after 15 minutes." },
  { q: "Do I have to sign up?", a: "No. Whichever wallet paid holds the credit. To create keys, sign one message with that wallet. It is a signature, not a transaction: no gas and nothing moves." },
  { q: "Can I give a bot its own key?", a: "Yes, and you should. Each key can carry its own spending cap and be revoked without affecting the others. A key capped at $5 can never spend more than $5, however much the account holds." },
  { q: "What is the P2P Marketplace?", a: "An order book where people trade $TRENCHERS directly with each other at prices they set, with the escrow held by a contract and no fee. Any ask can be filled straight into inference credit." },
  { q: "What does sending inference to a Trencher do?", a: "It gives the Trencher a balance of its own on the desk, held by its agent wallet. Its holder can then make keys for it and call it as its own model, trencher-<number>: it knows its identity, its wallet and the rule it was trained with, and answers as itself, paid from its own balance. The balance stays with the Trencher when it is sold; the old holder's keys stop working." },
  { q: "What are the risks?", a: "Credit lives on the desk's ledger, not in a contract, so only top up what you intend to use. The router and P2P contracts are small, open source and reviewed before launch. Nothing here is financial advice." },
];

export function Inference() {
  const d = useDesk();
  const endpoint = d.rate?.endpoint ?? "https://inference.trenchers.io/v1";
  const prefix = d.rate?.keyPrefix ?? "trench";
  const perUsd = Number(d.rate?.rate?.tokensPerUsd ?? 0);
  const n = d.models?.length ?? 0;

  return (
    <main id="top" className="inf">
      {d.mock && <div className="inf-mockflag mono">Local preview · sample data</div>}

      <section className="ihero">
        <div className="ihero-grid" aria-hidden="true" />
        <div className="ihero-pitch">
          <p className="hero-chip mono"><span className="live-dot" />02 · Make it think<span className="hero-chip-sep">/</span>{n ? `${n} models` : "Inference Markets"}</p>
          <h1 className="ihero-title">
            Every model.<br />One <mark>$TRENCHERS</mark> balance.
          </h1>
          <p className="lede ihero-lede">
            Top up once and call Claude, GPT, Gemini, Grok, DeepSeek, Llama, Qwen, Kimi and the rest from the same endpoint.
            Whatever you pay in leaves the supply for good. Open to anyone with a wallet: hand your bots and agents a key each, or give your Trencher a mind of its own.
          </p>
          <VideoButton className="video-btn-sm howto-btn" src="how-to-inference" title="How to use Inference Markets" label="How it works" length="1 min" />

        </div>
        <div className="ihero-more">
          <div className="irate" aria-label="The rate">
            <span className="irate-chip"><b className="mono">{perUsd ? perUsd.toLocaleString("en-US") : "–"}</b> $TRENCHERS</span>
            <span className="irate-op mono">=</span>
            <span className="irate-chip cr"><b className="mono">$1.00</b> of credit</span>
            <span className="irate-op mono">→</span>
            <span className="irate-chip hot"><span className="ibuy-flame" aria-hidden="true" /><b className="mono">100%</b> burned</span>
            <span className="irate-note">No expiry date, no monthly plan. Top up when you run low.</span>
          </div>
          <Endpoint endpoint={endpoint} prefix={prefix} />
        </div>
        <div className="ihero-aside">
          <BuyCredit rate={d.rate} orders={d.orders} mock={d.mock} onSent={d.reloadOrders} />
          <RaetoOption endpoint={endpoint} prefix={prefix} />
          {d.rate?.deposit?.address && (
            <details className="imanual">
              <summary>Or send it yourself</summary>
              <code>{d.rate.deposit.address}</code>
              <ul>
                <li>Robinhood Chain, chain {d.rate.deposit.chainId ?? 4663}</li>
                <li>$TRENCHERS only. Anything else sent here is lost.</li>
                {d.rate.deposit.burns && <li className="warn">What you send is burned. Credit is bought by taking $TRENCHERS out of supply.</li>}
              </ul>
            </details>
          )}
          {d.rate && !d.rate.enabled && <p className="inf-warn">Routing is not switched on yet. You can buy credit and make keys now; calls start working with nothing further from you.</p>}
          {d.rateFailed && <p className="inf-warn">The desk could not be reached just now. Try again in a moment.</p>}
        </div>
      </section>

      <section className="iflow" aria-label="How it works">
        {[
          ["01", "Top up", "Pay in $TRENCHERS, in ETH through the router, or on the P2P Marketplace.", ""],
          ["02", "Gone for good", "The desk contract has exactly one move: send what it holds to the dead address.", "burn"],
          ["03", "A dollar balance", "Credited to the wallet that paid (or to a Trencher), normally within a minute.", ""],
          ["04", "Call any model", "Name the model in each request. Only what the call really used is billed.", "go"],
        ].map(([k, t, p, c]) => (
          <div key={k} className={`iflow-step${c ? ` ${c}` : ""}`}>
            <span className="mono iflow-n">{k}</span>
            <b>{t}</b>
            <p>{p}</p>
          </div>
        ))}
      </section>

      <section className="ifacts">
        <div className="ifact"><span className="mono">No silent swaps</span><p>The model you name is the model that runs, unless you choose <code>raeto/auto</code> to have one picked for you. Each response carries the provider&apos;s own model id, so you can check.</p></div>
        <div className="ifact"><span className="mono">Billed on real usage</span><p>A call sets aside a ceiling, then settles on the provider&apos;s token count. The rest comes straight back, and failed calls are free.</p></div>
        <div className="ifact hot"><span className="mono">Usage shrinks supply</span><p>None of the $TRENCHERS paid in is kept. The more the desk is used, the fewer tokens exist.</p></div>
        <div className="ifact"><span className="mono">A key per job</span><p>Give every bot, agent or Trencher its own key and spending cap. Revoke one and the rest keep running.</p></div>
      </section>

      <ISection id="trencher" n="01" label="Make your Trencher think" title={<>Give your Trencher <mark>a mind</mark></>}
        lede="Send inference to any awake Trencher. It keeps its own balance, and its holder can call it as its own AI model, identified by its NFT and speaking as itself.">
        <TrencherMind rate={d.rate} mock={d.mock} />
      </ISection>

      <ISection id="models" n="02" label="Models" title="What's on tap"
        lede={<>Every model the desk routes to right now. Switch by changing one string in the request; the key and the balance stay the same. {n ? <b className="mono">{n} live now.</b> : null}</>}>
        <Catalogue models={d.models} failed={d.modelsFailed} />
      </ISection>

      <ISection id="p2p" n="03" label="P2P" title="P2P Marketplace"
        lede={<>Buy and sell $TRENCHERS directly with other people, at your own price. The contract keeps the escrow until someone fills it. No curve, no slippage and no fee, and any ask can be filled straight into inference credit.<VideoButton className="video-btn-sm howto-btn" src="how-to-p2p" title="How to use the P2P Marketplace" label="How it works" length="1 min" /></>}>
        <P2P rate={d.rate} orders={d.orders} fills={d.fills} onChange={d.reloadOrders} />
      </ISection>

      <ISection id="account" n="04" label="Your account" title="Balance and keys"
        lede="There is nothing to sign up for: your wallet is the account. Sign one message to see the balance, make keys and read the log of every call. Until then this shows a demo account.">
        <Account prefix={prefix} />
      </ISection>

      <ISection id="start" n="05" label="Get $TRENCHERS" title="Getting onto Robinhood Chain"
        lede="ETH on another network is a couple of minutes away from Robinhood Chain. From there, one transaction turns it into credit.">
        <div className="istart">
          <div className="iroutes">
            <a className="iroute" href={TRENCHERS_PONS || undefined} target="_blank" rel="noreferrer">
              <span className="mono iroute-k">A · Pons</span><b>Buy $TRENCHERS on Pons</b><p>The launchpad pool. Then pay with the $TRENCHERS tab.</p><span className="mono iroute-go">Open Pons ↗</span>
            </a>
            <a className="iroute" href="#buy">
              <span className="mono iroute-k">B · ETH</span><b>Pay in ETH, one step</b><p>The router buys $TRENCHERS and delivers it to the desk in the same transaction.</p><span className="mono iroute-go">Buy with ETH →</span>
            </a>
            <a className="iroute" href="#p2p">
              <span className="mono iroute-k">C · P2P</span><b>P2P Marketplace</b><p>Fill $TRENCHERS asks at the sellers&apos; own prices, straight into credit.</p><span className="mono iroute-go">Open the marketplace →</span>
            </a>
          </div>
          <div className="ibridge">
            <div className="ipanel-head"><span className="ipanel-dot" /><span>Bringing funds in</span></div>
            <ol>
              <li><b>Start with ETH</b><span>From an exchange withdrawal, a card purchase or a wallet you already use, on any network.</span></li>
              <li><b>Move it to Robinhood Chain</b><span><a href="https://relay.link/bridge/robinhood" target="_blank" rel="noreferrer">Relay</a> and <a href="https://across.to/?to=robinhood" target="_blank" rel="noreferrer">Across</a> are the fast lanes from most networks. <a href="https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum" target="_blank" rel="noreferrer">The canonical bridge</a> is slower but goes straight through Ethereum.</span></li>
              <li><b>Fuel the desk</b><span>Use the panel at the top: pay in ETH, in $TRENCHERS, or on the P2P Marketplace.</span></li>
            </ol>
            <p className="inf-fine">Bridges are run by third parties. Nothing here is financial advice.</p>
          </div>
          <dl className="iterms">
            <div><dt>Settlement</dt><dd>Reserved up front, trued up to the real token count after.</dd></div>
            <div><dt>Minimum</dt><dd className="mono">{d.rate?.deposit?.minimumTokens ? `${Number(d.rate.deposit.minimumTokens).toLocaleString("en-US")} $TRENCHERS` : "–"}</dd></div>
            <div><dt>Credit</dt><dd>In dollars, on the wallet that paid. It never expires.</dd></div>
            <div><dt>Supply</dt><dd className="iterms-burn">Every $TRENCHERS spent here is <b>burned</b>.</dd></div>
          </dl>
        </div>
      </ISection>

      <ISection id="faq" n="06" label="FAQ" title="Questions" lede={<>Anything else? Read the <a href={`${ROUTES.docs}#trenchers-inference-markets`}>docs</a> or ask us on <a href={SOCIALS.x} target="_blank" rel="noreferrer">X</a>.</>}>
        <div className="faq2">
          {FAQ.map((f, i) => (
            <details key={f.q} open={i === 0}>
              <summary><span className="mono faq-n">{String(i + 1).padStart(2, "0")}</span><span className="faq-q">{f.q}</span><span className="faq-ic" aria-hidden="true" /></summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </ISection>

      <footer className="foot inf-foot">
        <div className="foot-row">
          <img src="brand/mark.svg" alt="" width={24} height={24} />
          <span className="foot-name">Trenchers Inference Markets</span>
          <nav className="foot-links">
            <a className="tbtn" href={ROUTES.home}>AI Agents</a>
            <a className="tbtn" href={ROUTES.arena}>Arena</a>
            <a className="tbtn" href={ROUTES.docs}>Docs</a>
            <a className="tbtn" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </div>
        <TokenLine />
        <p>Nothing on this site is financial advice. $TRENCHERS paid for inference is burned and cannot be refunded as tokens.</p>
      </footer>
    </main>
  );
}
