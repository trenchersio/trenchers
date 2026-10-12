"use client";
// Trenchers V4 Builder: launch a Uniswap v4 hook coin on Robinhood Chain with its own rules, fees and mechanics.
import { useEffect, useState, type ReactNode } from "react";
import { GITHUB_URL, ROUTES, SOCIALS } from "@/lib/constants";
import { MODULES, PLATFORM_FEE_BPS, type BuilderCoin, type ModuleDef } from "@/lib/v4builder";
import { TokenLine } from "@/components/TokenLine";
import { builderApi, useBuilder } from "./useBuilder";
import { Studio } from "./Studio";
import { Explore } from "./Explore";
import { CoinView } from "./CoinView";
import { Marks, q } from "./bits";

function Sec({ id, n, label, title, lede, children }: { id: string; n: string; label: string; title: ReactNode; lede?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="vb-sec">
      <header className="vb-sec-head">
        <p className="vb-eyebrow mono"><span>{n}</span>{label}</p>
        <h2>{title}</h2>
        {lede && <p className="vb-sec-lede">{lede}</p>}
      </header>
      {children}
    </section>
  );
}

/** One trade through a V4 Builder coin, stage by stage. A pulse walks down the stages on a loop, so the reader
 *  sees the order: rules first, then the pool, then the mechanics, then the fees. */
function Schematic() {
  const STAGES: { k: string; t: string; tone: string; body: React.ReactNode }[] = [
    { k: "in", t: "A buy comes in", tone: "fog", body: <span className="mono vb-pp-amt">0.50 ETH → $TIDE</span> },
    { k: "rules", t: "Before the swap: your rules", tone: "ice", body: <span className="vb-pp-chips">{["Buy window", "Cooldown", "Wallet cap"].map((x) => <i key={x}><b aria-hidden="true">✓</b>{x}</i>)}</span> },
    { k: "pool", t: "Uniswap v4 pool", tone: "fog", body: <span className="vb-pp-pool"><svg viewBox="0 0 120 28" aria-hidden="true"><path d="M2 24 L20 20 L34 22 L50 14 L66 16 L82 9 L98 11 L118 3" /></svg><em className="mono">liquidity locked forever</em></span> },
    { k: "mech", t: "After the swap: mechanics", tone: "violet", body: <span className="vb-pp-chips">{["Cashback", "King of the hill", "Buyback"].map((x) => <i key={x}>{x}</i>)}</span> },
    { k: "fees", t: "Fees split", tone: "green", body: (
      <span className="vb-pp-fees">
        <span className="vb-pp-bar" aria-hidden="true"><i className="c" /><i className="m" /><i className="t" /></span>
        <span className="mono vb-pp-legend"><span><i className="c" />you 3%</span><span><i className="m" />modules</span><span><i className="t" />0.3% $TRENCHERS buyback</span></span>
      </span>
    ) },
    { k: "out", t: "Coins out", tone: "fog", body: <span className="mono vb-pp-amt">1,240,000 $TIDE</span> },
  ];
  return (
    <figure className="vb-schem" aria-label="How a trade moves through a V4 Builder coin">
      <Marks />
      <figcaption className="mono"><span>fig. 01</span><span>one trade, end to end</span></figcaption>
      <ol className="vb-pp">
        {STAGES.map((x, i) => (
          <li key={x.k} className={`vb-pp-st t-${x.tone}`} style={{ ["--i" as string]: i }}>
            <span className="vb-pp-n mono">{String(i + 1).padStart(2, "0")}</span>
            <div className="vb-pp-b"><b>{x.t}</b>{x.body}</div>
          </li>
        ))}
      </ol>
    </figure>
  );
}

const FAQ = [
  { q: "What is a hook coin?", a: "A coin whose Uniswap v4 pool runs its own small contract, the hook, on every trade. The hook is where the rules live: who can buy, when, how much, and what happens to the fees. Each coin launched here gets its own hook with the modules you picked, fixed at launch." },
  { q: "What does a launch cost?", a: "Only the network fee, plus whatever first buy you choose. There is no launch fee. After launch, every trade pays your creator fee (0 to 10%, buys and sells set separately) and a 0.3% Trenchers fee." },
  { q: "Where does the 0.3% go?", a: "To the Trenchers buyback wallet, the same one that buys and burns $TRENCHERS. Every coin launched here feeds $TRENCHERS on every trade, whichever pair it uses." },
  { q: "Can I pull the liquidity or change the rules later?", a: "No. The whole supply goes into the pool at launch and the position is owned by the dead address, so nobody can remove it. The hook's modules, settings and fees are set in its constructor and there is no owner or admin to change them." },
  { q: "Why pair with $TRENCHERS?", a: "Every buy of your coin is first a buy of $TRENCHERS, and every sell ends in a sale of it, so your coin's volume is $TRENCHERS volume too. Your fees are paid in $TRENCHERS. You still pay and receive ETH: the site routes through $TRENCHERS's own pool for you." },
  { q: "How do budget modules work?", a: "Fee engines and games run on a share of your creator fee that you choose at launch. That share is set aside for the module, separately from what you can claim, and the module spends it on its job: buying back and burning, adding liquidity, paying buyers. Anyone can trigger a fee engine when it is ready, from the coin's page." },
  { q: "Who wrote the contracts?", a: "The launch system is adapted from Programmable's open-source Foundation contracts (MIT licence), configured for Robinhood Chain and deployed by Trenchers. Our copy, its changes and its full test suite are in the Trenchers GitHub. The contracts were reviewed before launch; as with any new contracts, only put in what you are comfortable with." },
  { q: "Is this financial advice?", a: "No. Coins launched here are created by their launchers, not by Trenchers. Anyone can launch anything, so check what you buy." },
];

const GROUP_NOTE: Record<ModuleDef["group"], string> = {
  "Trading rules": "Checked before every swap. A trade that breaks a rule simply fails.",
  "Fee engines": "Run on a share of your creator fee. Anyone can trigger them when ready.",
  "Games and rewards": "Turn trading into a game: pots, crowns, cashback and contagion.",
  "Linked pools": "Tie your coin to another coin launched here with the same pair.",
};

export function Builder() {
  const d = useBuilder();
  const [coinAddr, setCoinAddr] = useState<string | null>(null);
  useEffect(() => {
    const read = () => { const c = new URLSearchParams(window.location.search).get("coin"); setCoinAddr(c && /^0x[0-9a-fA-F]{40}$/.test(c) ? c.toLowerCase() : null); };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  // The list carries a short price line per coin; the coin page loads the coin's full history (and coins past the list).
  const [full, setFull] = useState<BuilderCoin | null>(null);
  useEffect(() => {
    if (!coinAddr) { setFull(null); return; }
    let live = true;
    builderApi(`coin?token=${coinAddr}`).then((x) => { const c = x as BuilderCoin | null; if (live && c?.token) setFull(c); }).catch(() => {});
    return () => { live = false; };
  }, [coinAddr, d.coins]);
  const coin = coinAddr ? full ?? d.coins?.find((c) => c.token.toLowerCase() === coinAddr) ?? null : null;

  const total = (d.coins ?? []).length;
  const volEth = (d.coins ?? []).filter((c) => c.quote.toLowerCase() === "0x0bd7d308f8e1639fab988df18a8011f41eacad73").reduce((s, c) => s + BigInt(c.volumeQuote), 0n);
  const trades = (d.coins ?? []).reduce((s, c) => s + c.trades, 0);

  return (
    <main className="vb" id="top">
      {d.mock && <div className="vb-mockflag mono">Local preview · sample data</div>}

      {coinAddr ? (
        coin ? <CoinView coin={coin} mock={d.mock} config={d.config} /> : (
          <div className="vb-cv"><a className="vb-back mono" href="?">← all coins</a>
            <div className="vb-none"><b>{d.coins === null ? "Loading the coin…" : "This coin isn't in the builder's list yet."}</b><span>{d.coins === null ? "" : "New launches appear within a minute. Check the address, or go back to all coins."}</span></div>
          </div>
        )
      ) : (<>
        <section className="vb-hero">
          <div className="vb-hero-grid" aria-hidden="true" />
          <div className="vb-hero-pitch">
            <p className="vb-eyebrow mono"><span>v4</span>Hook coins on Robinhood Chain</p>
            <h1 className="vb-title">Write the <em>rules</em>.<br />Launch the coin.</h1>
            <p className="vb-lede">Pick trading rules, fee engines and games, set your own fees, and launch a Uniswap v4 coin with its own hook in one transaction. Liquidity is locked forever. Every trade also feeds the $TRENCHERS buyback. Open to everyone: no Trencher needed.</p>
            <div className="vb-hero-cta">
              <a href="#launch" className="vb-btn">Start building</a>
              <a href="#explore" className="vb-ghost">Explore coins</a>
            </div>
            <dl className="vb-meter mono">
              <div><dt>coins launched</dt><dd>{d.coins ? total.toLocaleString() : "–"}</dd></div>
              <div><dt>trades</dt><dd>{d.coins ? trades.toLocaleString() : "–"}</dd></div>
              <div><dt>eth volume</dt><dd>{d.coins ? q(volEth, 3) : "–"}</dd></div>
              <div><dt>modules</dt><dd>{MODULES.length}</dd></div>
            </dl>
          </div>
          <div className="vb-hero-art"><Schematic /></div>
        </section>

        <Sec id="launch" n="01" label="Launch studio" title={<>Design it. <em>Then launch it.</em></>} lede={<>Five steps, one transaction. The blueprint shows exactly what goes on-chain.</>}>
          <Studio config={d.config} coins={d.coins} />
        </Sec>

        <Sec id="explore" n="02" label="Explore" title="Coins built here" lede="Every coin launched through the builder, with its rules on the card. Click one to trade it.">
          <Explore coins={d.coins} failed={d.failed} />
        </Sec>

        <Sec id="modules" n="03" label="Modules" title={<>{MODULES.length} building blocks</>} lede="Up to eight per coin. Each one is a small contract the hook calls on every trade.">
          <div className="vb-cat">
            {(["Trading rules", "Fee engines", "Games and rewards", "Linked pools"] as const).map((g) => (
              <div key={g} className="vb-cat-col">
                <div className="vb-cat-head"><b>{g}</b><span>{GROUP_NOTE[g]}</span></div>
                <ul>{MODULES.filter((m) => m.group === g).map((m) => <li key={m.key}><b>{m.name}</b><span>{m.blurb}</span></li>)}</ul>
              </div>
            ))}
          </div>
        </Sec>

        <Sec id="how" n="04" label="How it works" title="What happens when you press launch">
          <ol className="vb-how">
            <li><span className="mono">01</span><b>Your coin is created</b><p>A standard token with a fixed supply of 1,000,000,000. No mint function, no owner.</p></li>
            <li><span className="mono">02</span><b>Its hook is deployed</b><p>A contract made just for this coin, with your modules and fees built in. Its address is mined in your browser so Uniswap v4 knows which parts of a trade it handles.</p></li>
            <li><span className="mono">03</span><b>The pool opens, liquidity locked</b><p>All the supply goes into a v4 pool at your starting value. The position belongs to the dead address, so it can never be pulled.</p></li>
            <li><span className="mono">04</span><b>You buy first, if you want</b><p>Your first buy happens inside the same transaction, before anyone else can trade. From then on every trade pays your fee and {PLATFORM_FEE_BPS / 100}% to the $TRENCHERS buyback.</p></li>
          </ol>
          <div className="faq2 vb-faq">
            {FAQ.map((f, i) => (
              <details key={f.q} open={i === 0}>
                <summary><span className="mono faq-n">{String(i + 1).padStart(2, "0")}</span><span className="faq-q">{f.q}</span><span className="faq-ic" aria-hidden="true" /></summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
          <p className="vb-fine vb-more">More in the <a href={`${ROUTES.docs}#trenchers-v4-builder`}>docs</a>, or ask us on <a href={SOCIALS.x} target="_blank" rel="noreferrer">X</a>.</p>
        </Sec>
      </>)}

      <footer className="foot vb-foot">
        <div className="foot-row">
          <img src="brand/mark.svg" alt="" width={24} height={24} />
          <span className="foot-name">Trenchers V4 Builder</span>
          <nav className="foot-links">
            <a className="tbtn" href={ROUTES.home}>AI Agents</a>
            <a className="tbtn" href={ROUTES.inference}>Inference</a>
            <a className="tbtn" href={ROUTES.docs}>Docs</a>
            <a className="tbtn" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
        </div>
        <TokenLine />
        <p>Coins launched here are created by their launchers, not by Trenchers. Nothing on this site is financial advice. Launch contracts adapted from Programmable&apos;s open-source Foundation system (MIT).</p>
      </footer>
    </main>
  );
}
