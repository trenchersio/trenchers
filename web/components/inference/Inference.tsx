"use client";
// Trenchers Inference Markets: every frontier model through one key, paid in $TRENCHERS, every token spent burned.
import type { ReactNode } from "react";
import { compact, tokens, type Stats } from "@/lib/inference";
import { GITHUB_URL, ROUTES, SOCIALS, TRENCHERS_PONS } from "@/lib/constants";
import { TokenLine } from "@/components/TokenLine";
import { useDesk } from "./useDesk";
import { BuyCredit } from "./BuyCredit";
import { Endpoint } from "./Endpoint";
import { Catalogue } from "./Catalogue";
import { Account } from "./Account";
import { P2P } from "./P2P";

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
  { q: "What is Trenchers Inference Markets?", a: "An inference desk. One endpoint and one API key reach every frontier model family, and it is paid for in $TRENCHERS. Point any client at the endpoint, name the model you want, and the call is billed against the dollar credit on your account." },
  { q: "What happens to the $TRENCHERS I pay?", a: "It is burned. Every $TRENCHERS that buys credit is taken out of supply for good, whether you pay in $TRENCHERS, in ETH through the router, or from holders on the P2P market. Demand for models becomes demand for the token." },
  { q: "How is a call charged?", a: "When a call opens, an estimate is held from your balance. When it finishes, it is settled on the provider's own usage figure and the rest of the hold goes straight back. A call that never ran costs nothing, and a hold that is never resolved is swept back to you." },
  { q: "Do I need an account?", a: "Your wallet is the account. Pay from it and the credit lands on it. To make API keys, sign one message with the same wallet: a signature, not a transaction, so nothing moves and there is no gas." },
  { q: "Can I limit what a key spends?", a: "Yes. Every key can have its own spending ceiling and can be revoked on its own. Give a bot a key with a $5 ceiling and that is all it can ever spend, whatever the account holds." },
  { q: "What is the P2P market?", a: "Holders trade $TRENCHERS and agent coins with each other at their own prices, escrowed by a contract, with no fee. An ask holds the tokens until it is filled or cancelled; a bid holds the ETH. A $TRENCHERS ask can be filled straight into inference credit." },
  { q: "Can my Trencher pay for its own inference?", a: "That is where this is going. Agent wallets already earn $TRENCHERS from their share of fees; paying the desk from an agent wallet is on the roadmap, so an agent can fund the models it thinks with." },
  { q: "Is it safe?", a: "Credit is held by the desk, not by a contract, so only buy what you plan to use. The router and P2P contracts are small, open source and reviewed before launch. Nothing here is financial advice." },
];

/** Digits on their own tiles, like a departures board: a number you read, not a box with a number in it. */
function Flaps({ value }: { value: string }) {
  return <span className="iflap" aria-label={value}>{[...value].map((c, i) => <i key={i} className={/[0-9]/.test(c) ? "" : "sep"}>{c}</i>)}</span>;
}

/** The furnace: every day's burn as a column of pixels, the total underneath, and three counters beside it. */
function Live({ stats }: { stats: Stats | null }) {
  const days = (stats?.burnedByDay ?? Array(14).fill("0")).map((d) => Number(BigInt(d) / 10n ** 18n));
  const peak = Math.max(1, ...days);
  const ROWS = 9;
  return (
    <section className="ifurnace" aria-label="The desk, live">
      <div className="ifurn-main">
        <div className="ifurn-read">
          <span className="ifurn-k mono"><span className="ibuy-flame" aria-hidden="true" />burned by inference</span>
          <b className="mono">{stats ? tokens(stats.burnedTokens) : "–"}</b>
          <span className="ifurn-u mono">$TRENCHERS gone for good · last 14 days above</span>
        </div>
        <div className="ifurn-grid" aria-hidden="true">
          {days.map((d, i) => {
            const lit = Math.max(d > 0 ? 1 : 0, Math.round((d / peak) * ROWS));
            return (
              <span key={i} className="ifurn-col" style={{ ["--i" as string]: i }}>
                {Array.from({ length: ROWS }, (_, r) => {
                  const on = ROWS - r <= lit;
                  const top = on && ROWS - r === lit;
                  return <i key={r} className={top ? "top" : on ? "on" : ""} />;
                })}
              </span>
            );
          })}
        </div>
      </div>
      <ul className="ifurn-side">
        <li><span>calls served</span><Flaps value={stats ? compact(stats.calls) : "--"} /></li>
        <li><span>wallets with credit</span><Flaps value={stats ? compact(stats.accounts) : "--"} /></li>
        <li><span>models live</span><Flaps value={stats ? String(stats.models) : "--"} /></li>
      </ul>
    </section>
  );
}

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
          <p className="hero-chip mono"><span className="live-dot" />Trenchers Inference Markets<span className="hero-chip-sep">/</span>{n ? `${n} models` : "one key"}</p>
          <h1 className="ihero-title">
            Every frontier model.<br />One key. Paid in <mark>$TRENCHERS</mark>.
          </h1>
          <p className="lede ihero-lede">
            Claude, GPT, Gemini, Grok, DeepSeek, Llama, Qwen, Kimi and more through one endpoint. No card, no subscription,
            no provider account. Pay in $TRENCHERS, in ETH, or straight from other holders, and every token spent is burned.
          </p>

        </div>
        <div className="ihero-more">
          <div className="irate" aria-label="The rate">
            <span className="irate-chip"><b className="mono">{perUsd ? perUsd.toLocaleString("en-US") : "–"}</b> $TRENCHERS</span>
            <span className="irate-op mono">=</span>
            <span className="irate-chip cr"><b className="mono">$1.00</b> of credit</span>
            <span className="irate-op mono">→</span>
            <span className="irate-chip hot"><span className="ibuy-flame" aria-hidden="true" /><b className="mono">100%</b> burned</span>
            <span className="irate-note">No setup, no subscription, no monthly minimum.</span>
          </div>
          <Endpoint endpoint={endpoint} prefix={prefix} />
        </div>
        <div className="ihero-aside">
          <BuyCredit rate={d.rate} orders={d.orders} mock={d.mock} onSent={d.reloadOrders} />
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

      <Live stats={d.stats} />

      <section className="iflow" aria-label="How it works">
        {[
          ["01", "Pay", "$TRENCHERS, ETH, or fill a holder's ask on the P2P market.", ""],
          ["02", "Burn", "Every $TRENCHERS that reaches the desk leaves supply for good.", "burn"],
          ["03", "Credit", "Dollars of credit land on the wallet that paid, within a minute.", ""],
          ["04", "Call", "One key, any model. Settled on what the call actually used.", "go"],
        ].map(([k, t, p, c]) => (
          <div key={k} className={`iflow-step${c ? ` ${c}` : ""}`}>
            <span className="mono iflow-n">{k}</span>
            <b>{t}</b>
            <p>{p}</p>
          </div>
        ))}
      </section>

      <section className="ifacts">
        <div className="ifact"><span className="mono">Straight relay</span><p>Your request goes to the model you named. Nothing is swapped for something cheaper, and the answer carries the provider&apos;s own model id so you can check.</p></div>
        <div className="ifact"><span className="mono">Charged on usage</span><p>A call holds an estimate when it opens and settles on the provider&apos;s own usage figure. A call that never ran is never charged, and an interrupted one gives the hold back.</p></div>
        <div className="ifact hot"><span className="mono">Burned on the way in</span><p>Every $TRENCHERS that buys credit is destroyed. Buying inference takes supply off the market for good, so demand for models is demand for the token.</p></div>
        <div className="ifact"><span className="mono">Keys with ceilings</span><p>Make as many keys as you like, each with its own spending ceiling, and revoke any of them on its own. Built for bots and agents as much as people.</p></div>
      </section>

      <ISection id="models" n="01" label="Models" title="Every model, one key"
        lede={<>The live catalogue. One key reaches all of them: name the model in the request and the desk routes it. {n ? <b className="mono">{n} live now.</b> : null}</>}>
        <Catalogue models={d.models} failed={d.modelsFailed} />
      </ISection>

      <ISection id="p2p" n="02" label="P2P market" title={<>Trade $TRENCHERS with holders, at your price</>}
        lede="An on-chain order book for $TRENCHERS and agent coins. No curve, no slippage, no fee: list an ask or a bid, the contract holds the escrow, anyone fills it. Buy from holders straight into inference credit.">
        <P2P rate={d.rate} orders={d.orders} fills={d.fills} onChange={d.reloadOrders} />
      </ISection>

      <ISection id="account" n="03" label="Your account" title="Balance, keys and every call"
        lede="Your wallet is the account. One signature opens it: no password, no email, nothing to store. Signed out, this is a sample of what you get.">
        <Account prefix={prefix} />
      </ISection>

      <ISection id="start" n="04" label="Get $TRENCHERS" title="Three ways to pay, from anywhere"
        lede="Robinhood Chain is new, so no card processor sells onto it directly. What does exist is a short hop from any chain an exchange already withdraws to.">
        <div className="istart">
          <div className="iroutes">
            <a className="iroute" href={TRENCHERS_PONS || undefined} target="_blank" rel="noreferrer">
              <span className="mono iroute-k">A · Pons</span><b>Buy $TRENCHERS on Pons</b><p>The launchpad pool. Then pay with the $TRENCHERS tab.</p><span className="mono iroute-go">Open Pons ↗</span>
            </a>
            <a className="iroute" href="#buy">
              <span className="mono iroute-k">B · ETH</span><b>Pay in ETH, one step</b><p>The router buys $TRENCHERS and delivers it to the desk in the same transaction.</p><span className="mono iroute-go">Buy with ETH →</span>
            </a>
            <a className="iroute" href="#p2p">
              <span className="mono iroute-k">C · P2P</span><b>Buy from holders</b><p>Fill asks on the P2P book at the holders&apos; own prices, straight into credit.</p><span className="mono iroute-go">Open the book →</span>
            </a>
          </div>
          <div className="ibridge">
            <div className="ipanel-head"><span className="ipanel-dot" /><span>Arriving from another chain, or from cash</span></div>
            <ol>
              <li><b>Get ETH anywhere you already can</b><span>An exchange, a card on-ramp, or a wallet you already hold it in. Any chain those send to.</span></li>
              <li><b>Bridge it to Robinhood Chain</b><span><a href="https://relay.link/bridge/robinhood" target="_blank" rel="noreferrer">Relay</a> and <a href="https://across.to/?to=robinhood" target="_blank" rel="noreferrer">Across</a> take seconds from most chains. <a href="https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum" target="_blank" rel="noreferrer">The canonical bridge</a> is the slower, trust-minimised route from Ethereum.</span></li>
              <li><b>Come back and pay</b><span>In ETH, in $TRENCHERS, or from a holder on the P2P book. One transaction either way.</span></li>
            </ol>
            <p className="inf-fine">Those are third-party services. Nothing here is financial advice.</p>
          </div>
          <dl className="iterms">
            <div><dt>Settlement</dt><dd>Held when a call opens, settled on the provider&apos;s own usage figure.</dd></div>
            <div><dt>Minimum</dt><dd className="mono">{d.rate?.deposit?.minimumTokens ? `${Number(d.rate.deposit.minimumTokens).toLocaleString("en-US")} $TRENCHERS` : "–"}</dd></div>
            <div><dt>Credit</dt><dd>In dollars, on the wallet that paid. It never expires.</dd></div>
            <div><dt>Supply</dt><dd className="iterms-burn">Every $TRENCHERS spent here is <b>burned</b>.</dd></div>
          </dl>
        </div>
      </ISection>

      <ISection id="faq" n="05" label="FAQ" title="Questions" lede={<>Anything else? Read the <a href={`${ROUTES.docs}#trenchers-inference-markets`}>docs</a> or ask us on <a href={SOCIALS.x} target="_blank" rel="noreferrer">X</a>.</>}>
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
