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
  { q: "What do I actually get?", a: "Access to the major model families (Claude, GPT, Gemini, Grok, DeepSeek, Llama, Qwen, Kimi and more) behind a single address and a single key, funded with $TRENCHERS instead of a card. Any OpenAI-compatible client works by changing the base URL." },
  { q: "Where does my $TRENCHERS go?", a: "To the dead address. Payments land in a contract whose only possible action is burning what it holds, and it is triggered on a schedule. The same is true whether you pay in $TRENCHERS, in ETH through the router, or by buying from holders on the P2P book." },
  { q: "How much does a request cost?", a: "Whatever it actually used. A request reserves a ceiling from your balance when it starts and is settled to the provider's real token count when it ends; the rest is released immediately. Requests that fail or never run cost nothing, and forgotten reservations are released automatically after 15 minutes." },
  { q: "Do I have to sign up?", a: "No. Whichever wallet paid holds the credit. To create keys, sign one message with that wallet. It is a signature, not a transaction: no gas and nothing moves." },
  { q: "Can I give a bot its own key?", a: "Yes, and you should. Each key can carry its own spending cap and be revoked without affecting the others. A key capped at $5 can never spend more than $5, however much the account holds." },
  { q: "What is the P2P book?", a: "An order book where holders trade $TRENCHERS and agent coins directly at prices they set, with the escrow held by a contract and no fee. A $TRENCHERS ask can be filled straight into inference credit." },
  { q: "Will Trenchers agents be able to use this?", a: "That is the plan. Agent wallets already collect $TRENCHERS from the fee share; letting an agent pay for its own model calls is next on the roadmap." },
  { q: "What are the risks?", a: "Credit lives on the desk's ledger, not in a contract, so only top up what you intend to use. The router and P2P contracts are small, open source and reviewed before launch. Nothing here is financial advice." },
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
            Burn <mark>$TRENCHERS</mark>.<br />Run any model.
          </h1>
          <p className="lede ihero-lede">
            Turn $TRENCHERS into compute. Claude, GPT, Gemini, Grok, DeepSeek, Llama, Qwen, Kimi and dozens more answer at a
            single address. The tokens you bring are destroyed on arrival; what you get back is dollar credit your bots, agents and
            apps can spend on whichever model fits the job.
          </p>

        </div>
        <div className="ihero-more">
          <div className="irate" aria-label="The rate">
            <span className="irate-chip"><b className="mono">{perUsd ? perUsd.toLocaleString("en-US") : "–"}</b> $TRENCHERS</span>
            <span className="irate-op mono">=</span>
            <span className="irate-chip cr"><b className="mono">$1.00</b> of credit</span>
            <span className="irate-op mono">→</span>
            <span className="irate-chip hot"><span className="ibuy-flame" aria-hidden="true" /><b className="mono">100%</b> burned</span>
            <span className="irate-note">Credit never expires. Nothing to subscribe to, nothing to cancel.</span>
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
          ["01", "Bring fuel", "$TRENCHERS from your wallet, ETH through the router, or tokens bought from a holder.", ""],
          ["02", "It burns", "The desk contract can only send what it receives to the dead address. Nobody keeps it.", "burn"],
          ["03", "You hold credit", "A dollar balance appears on the wallet that paid, usually inside a minute.", ""],
          ["04", "Your code asks", "Pick a model per request. Each call draws down only what it actually used.", "go"],
        ].map(([k, t, p, c]) => (
          <div key={k} className={`iflow-step${c ? ` ${c}` : ""}`}>
            <span className="mono iflow-n">{k}</span>
            <b>{t}</b>
            <p>{p}</p>
          </div>
        ))}
      </section>

      <section className="ifacts">
        <div className="ifact"><span className="mono">Exactly the model you named</span><p>Ask for Claude and Claude answers. Every response names the provider&apos;s own model id, so nothing cheaper can be slipped in behind your back.</p></div>
        <div className="ifact"><span className="mono">Pay for tokens, not guesses</span><p>Each call reserves a ceiling, then settles to the provider&apos;s real token count. The unused reserve returns at once, and a call that fails costs nothing.</p></div>
        <div className="ifact hot"><span className="mono">Supply only goes one way</span><p>The desk keeps none of the $TRENCHERS it takes in. Every purchase of compute is a permanent burn, so more usage means fewer tokens.</p></div>
        <div className="ifact"><span className="mono">Keys you can fence in</span><p>One key per bot or agent, each with its own spend cap. Shut one down without touching the others.</p></div>
      </section>

      <ISection id="models" n="01" label="Models" title="The model shelf"
        lede={<>Everything the desk can route to right now. Swap models by changing one string in your request; your key and balance stay the same. {n ? <b className="mono">{n} live now.</b> : null}</>}>
        <Catalogue models={d.models} failed={d.modelsFailed} />
      </ISection>

      <ISection id="p2p" n="02" label="P2P market" title={<>Trade $TRENCHERS with holders, at your price</>}
        lede="An on-chain order book for $TRENCHERS and agent coins. No curve, no slippage, no fee: list an ask or a bid, the contract holds the escrow, anyone fills it. Buy from holders straight into inference credit.">
        <P2P rate={d.rate} orders={d.orders} fills={d.fills} onChange={d.reloadOrders} />
      </ISection>

      <ISection id="account" n="03" label="Your account" title="Your desk, your keys"
        lede="No sign-up form: the wallet that paid is the account. A single signature unlocks the balance, the keys and a log of every request. Until then you are looking at a demo account.">
        <Account prefix={prefix} />
      </ISection>

      <ISection id="start" n="04" label="Get $TRENCHERS" title="Fuel up from anywhere"
        lede="Holding ETH on another network? It is a couple of minutes from Robinhood Chain, and from there one transaction turns it into credit.">
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
            <div className="ipanel-head"><span className="ipanel-dot" /><span>Bringing funds in</span></div>
            <ol>
              <li><b>Start with ETH</b><span>From an exchange withdrawal, a card purchase or a wallet you already use, on any network.</span></li>
              <li><b>Move it to Robinhood Chain</b><span><a href="https://relay.link/bridge/robinhood" target="_blank" rel="noreferrer">Relay</a> and <a href="https://across.to/?to=robinhood" target="_blank" rel="noreferrer">Across</a> are the fast lanes from most networks. <a href="https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain&sourceChain=ethereum" target="_blank" rel="noreferrer">The canonical bridge</a> is slower but goes straight through Ethereum.</span></li>
              <li><b>Fuel the desk</b><span>Use the panel at the top: pay in ETH, in $TRENCHERS, or from a holder on the P2P book.</span></li>
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

      <ISection id="faq" n="05" label="FAQ" title="Good to know" lede={<>Anything else? Read the <a href={`${ROUTES.docs}#trenchers-inference-markets`}>docs</a> or ask us on <a href={SOCIALS.x} target="_blank" rel="noreferrer">X</a>.</>}>
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
