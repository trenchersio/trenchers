"use client";
// One coin: its price, its rules, a trade panel (ETH in, ETH out) and the creator's fee claim.
import { useEffect, useState } from "react";
import { formatEther, type Address } from "viem";
import { useWallet } from "@/lib/wallet";
import { EXPLORER, explorerAddress } from "@/lib/constants";
import { ERC20_ABI, PLATFORM_FEE_BPS, bps, moduleDef, quoteSymbol, type BuilderCoin } from "@/lib/v4builder";
import { ACTIONABLE } from "@/lib/v4builder-actions";
import { Avatar, Line, Marks, ago, num, q, shortAddr } from "./bits";

const SLIPS = [3, 5, 10];

function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className="vb-copy mono" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }).catch(() => {}); }}>{ok ? "copied" : "copy"}</button>;
}

export function CoinView({ coin, mock }: { coin: BuilderCoin; mock: boolean }) {
  const w = useWallet();
  const qs = quoteSymbol(coin.quote);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slip, setSlip] = useState(5);
  const [est, setEst] = useState<{ out: bigint; min: bigint } | null>(null);
  const [estErr, setEstErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; hash?: string } | null>(null);
  const [bal, setBal] = useState<{ eth: bigint; tok: bigint } | null>(null);
  const [claim, setClaim] = useState<bigint | null>(null);
  const [tick, setTick] = useState(0);
  const ref = { token: coin.token, hook: coin.hook, quote: coin.quote, ledger: coin.ledger, creatorBuyBps: coin.creatorBuyBps, creatorSellBps: coin.creatorSellBps };
  const isCreator = !!w.address && w.address.toLowerCase() === coin.creator.toLowerCase();

  useEffect(() => {
    if (mock || !w.address) { setBal(null); return; }
    let live = true;
    import("@/lib/chain").then(async ({ reader }) => {
      const pub = reader();
      const [eth, tok] = await Promise.all([pub.getBalance({ address: w.address as Address }), pub.readContract({ address: coin.token, abi: ERC20_ABI, functionName: "balanceOf", args: [w.address as Address] }) as Promise<bigint>]);
      if (live) setBal({ eth, tok });
    }).catch(() => {});
    return () => { live = false; };
  }, [w.address, coin.token, mock, tick]);

  useEffect(() => {
    if (mock) { setClaim(isCreator ? BigInt(coin.feesQuote) / 2n : null); return; }
    if (!isCreator) { setClaim(null); return; }
    import("@/lib/v4builder-actions").then(({ claimable }) => claimable(ref)).then(setClaim).catch(() => setClaim(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreator, coin.ledger, mock, tick]);

  // Estimate, a moment after typing stops.
  useEffect(() => {
    setEst(null); setEstErr(null);
    const n = Number(amount);
    if (!amount || !(n > 0)) return;
    const t = setTimeout(async () => {
      const { units, quoteTrade, reason } = await import("@/lib/v4builder-actions");
      try {
        const amt = units(amount);
        if (mock) {
          const p = BigInt(coin.priceQuote ?? "1");
          const fee = BigInt(PLATFORM_FEE_BPS + (side === "buy" ? coin.creatorBuyBps : coin.creatorSellBps));
          const out = side === "buy" ? (amt * 10n ** 18n / (qs === "ETH" ? p : p / 20_000_000n || 1n)) * (10_000n - fee) / 10_000n : (amt * (qs === "ETH" ? p : p / 20_000_000n) / 10n ** 18n) * (10_000n - fee) / 10_000n;
          setEst({ out, min: (out * BigInt(100 - slip)) / 100n });
          return;
        }
        const r = await quoteTrade(ref, side, amt, slip);
        setEst({ out: r.out, min: r.minOut });
      } catch (e) { setEstErr(reason(e)); }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, side, slip, coin.token, mock]);

  async function go() {
    if (!w.address) { w.openModal(); return; }
    if (w.kind === "demo") { setMsg({ ok: false, text: "The demo wallet can look around but can't trade. Connect a browser wallet." }); return; }
    setMsg(null);
    if (mock) { setBusy("chain"); await new Promise((r) => setTimeout(r, 900)); setBusy(null); setMsg({ ok: true, text: side === "buy" ? "Bought (sample data)." : "Sold (sample data)." }); setAmount(""); return; }
    const { trade, units, reason } = await import("@/lib/v4builder-actions");
    try {
      const hash = await trade(w.address as Address, ref, side, units(amount), slip, setBusy);
      setMsg({ ok: true, text: side === "buy" ? `Bought $${coin.symbol}.` : `Sold $${coin.symbol}.`, hash });
      setAmount(""); setTick((n) => n + 1);
    } catch (e) { setMsg({ ok: false, text: reason(e) }); } finally { setBusy(null); }
  }

  async function act(kind: "claim" | number) {
    if (!w.address) { w.openModal(); return; }
    if (w.kind === "demo") { setMsg({ ok: false, text: "Connect a browser wallet first." }); return; }
    setMsg(null);
    if (mock) { setBusy(`a${kind}`); await new Promise((r) => setTimeout(r, 800)); setBusy(null); setMsg({ ok: true, text: "Done (sample data)." }); return; }
    const a = await import("@/lib/v4builder-actions");
    try {
      setBusy(`a${kind}`);
      const hash = kind === "claim" ? await a.claimCreator(w.address as Address, ref, () => {}) : await a.moduleAction(w.address as Address, ref, kind, coin.modules[kind], () => {});
      setMsg({ ok: true, text: kind === "claim" ? "Fees claimed to your wallet." : "Done.", hash }); setTick((n) => n + 1);
    } catch (e) { setMsg({ ok: false, text: a.reason(e) }); } finally { setBusy(null); }
  }

  const first = coin.chart?.[0]?.p, last = coin.chart?.[coin.chart.length - 1]?.p;
  const chg = first && last ? ((last - first) / first) * 100 : null;
  const inSym = side === "buy" ? "ETH" : `$${coin.symbol}`;
  const outSym = side === "buy" ? `$${coin.symbol}` : "ETH";
  const have = bal ? (side === "buy" ? bal.eth : bal.tok) : null;
  const label = busy === "approve" ? "Approve in your wallet…" : busy === "sign" ? "Confirm in your wallet…" : busy === "chain" ? "Confirming…"
    : !w.address ? "Connect wallet" : !amount || !(Number(amount) > 0) ? "Enter an amount" : side === "buy" ? `Buy $${coin.symbol}` : `Sell $${coin.symbol}`;

  return (
    <div className="vb-cv">
      <a className="vb-back mono" href="?">← all coins</a>
      <header className="vb-cv-head">
        <Avatar image={coin.image} symbol={coin.symbol} size={64} />
        <div className="vb-cv-id">
          <h1>{coin.name} <span className="mono">${coin.symbol}</span></h1>
          <p className="mono">
            <i className={`vb-q vb-q-${qs === "ETH" ? "e" : "t"}`}>{qs === "ETH" ? "ETH pair" : "$TRENCHERS pair"}</i>
            <span>launched {ago(coin.launchedAt)}</span>
            <span>by <a href={explorerAddress(coin.creator)} target="_blank" rel="noreferrer">{shortAddr(coin.creator)}</a>{isCreator && " (you)"}</span>
            {coin.website && <a href={coin.website} target="_blank" rel="noreferrer nofollow">website ↗</a>}
          </p>
          {coin.description && <p className="vb-cv-desc">{coin.description}</p>}
        </div>
      </header>

      <ul className="vb-cv-stats mono">
        <li><span>price · {qs === "ETH" ? "eth" : "trenchers"}</span><b>{q(coin.priceQuote, 3)}</b></li>
        <li><span>value · {qs === "ETH" ? "eth" : "trenchers"}</span><b>{q(coin.marketCapQuote, 3)}</b></li>
        <li><span>volume</span><b>{q(coin.volumeQuote, 3)}</b></li>
        <li><span>trades</span><b>{coin.trades.toLocaleString()}</b></li>
        <li><span>change</span><b className={chg === null ? "" : chg >= 0 ? "up" : "down"}>{chg === null ? "–" : `${chg >= 0 ? "+" : ""}${chg.toFixed(1)}%`}</b></li>
      </ul>

      <div className="vb-cv-main">
        <section className="vb-chart">
          <Marks />
          <div className="vb-chart-head mono"><span>price in {qs === "ETH" ? "ETH" : "$TRENCHERS"}, from trades</span><span>{coin.chart?.length ?? 0} points</span></div>
          <Line points={coin.chart ?? []} w={800} h={300} axis className="vb-chart-line" />
        </section>

        <section className="vb-trade" aria-label="Trade">
          <div className="vb-trade-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={side === "buy"} className={side === "buy" ? "on" : ""} onClick={() => { setSide("buy"); setAmount(""); setMsg(null); }}>Buy</button>
            <button type="button" role="tab" aria-selected={side === "sell"} className={side === "sell" ? "on sell" : ""} onClick={() => { setSide("sell"); setAmount(""); setMsg(null); }}>Sell</button>
          </div>
          <label className="vb-f">
            <span>You pay {have !== null && <button type="button" className="vb-max mono" onClick={() => setAmount(formatEther(side === "buy" ? (have * 98n) / 100n : have))}>balance {num(Number(formatEther(have)))}</button>}</span>
            <span className="vb-pre vb-pre-r vb-big"><input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" /><i className="mono">{inSym}</i></span>
          </label>
          {side === "buy" && <div className="vb-chips">{["0.01", "0.05", "0.1", "0.5"].map((v) => <button key={v} type="button" className={amount === v ? "on" : ""} onClick={() => setAmount(v)}>{v} ETH</button>)}</div>}
          <div className="vb-est mono">
            <div><span>you get about</span><b>{est ? `${num(Number(formatEther(est.out)))} ${outSym}` : "–"}</b></div>
            <div><span>at least</span><b>{est ? `${num(Number(formatEther(est.min)))} ${outSym}` : "–"}</b></div>
            <div><span>fee</span><b>{bps((side === "buy" ? coin.creatorBuyBps : coin.creatorSellBps) + PLATFORM_FEE_BPS)}</b></div>
            <div className="vb-slip"><span>slippage</span><span>{SLIPS.map((s) => <button key={s} type="button" className={slip === s ? "on" : ""} onClick={() => setSlip(s)}>{s}%</button>)}</span></div>
          </div>
          {estErr && <p className="vb-err">{estErr}</p>}
          <button type="button" className={`vb-btn vb-btn-wide${side === "sell" ? " vb-btn-sell" : ""}`} disabled={!!busy || (!!w.address && (!amount || !(Number(amount) > 0)))} onClick={go}>{label}</button>
          {msg && <p className={msg.ok ? "vb-ok" : "vb-err"}>{msg.text}{msg.hash && EXPLORER && <> <a href={`${EXPLORER}/tx/${msg.hash}`} target="_blank" rel="noreferrer">View ↗</a></>}</p>}
          <p className="vb-fine">{qs === "ETH" ? "ETH is wrapped and swapped in one transaction." : "Routed ETH → $TRENCHERS → this coin in one transaction."} {side === "sell" && "The first sell asks for two approvals."}</p>
        </section>
      </div>

      <div className="vb-cv-low">
        <section className="vb-panel">
          <Marks />
          <h3><span className="vb-n mono">R</span>Rules and mechanics</h3>
          {coin.modules.length === 0 ? <p className="vb-empty">No modules. A plain Uniswap v4 coin with creator fees.</p> : (
            <ol className="vb-mlist">
              {coin.modules.map((k, i) => {
                const def = (k as string) === "unknown" ? null : moduleDef(k);
                const action = ACTIONABLE[k];
                return (
                  <li key={i}>
                    <span className="vb-cfg-i mono">M{i + 1}</span>
                    <div><b>{def?.name ?? "Custom module"}</b><span>{def?.blurb ?? "A module this site doesn't describe yet."}</span></div>
                    {action && <button type="button" className="vb-ghost" disabled={busy === `a${i}`} onClick={() => act(i)}>{busy === `a${i}` ? "…" : action}</button>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="vb-panel">
          <Marks />
          <h3><span className="vb-n mono">F</span>Fees</h3>
          <dl className="vb-spec mono">
            <div><dt>creator fee on buys</dt><dd>{bps(coin.creatorBuyBps)}</dd></div>
            <div><dt>creator fee on sells</dt><dd>{bps(coin.creatorSellBps)}</dd></div>
            <div><dt>trenchers buyback fee</dt><dd>{bps(PLATFORM_FEE_BPS)}</dd></div>
            <div><dt>creator fees collected</dt><dd>{q(coin.feesQuote)} {qs === "ETH" ? "WETH" : "TRENCHERS"}</dd></div>
          </dl>
          {isCreator && (
            <div className="vb-claim">
              <div><span className="mono">ready to claim</span><b className="mono">{claim === null ? "…" : `${q(claim)} ${qs === "ETH" ? "WETH" : "TRENCHERS"}`}</b></div>
              <button type="button" className="vb-btn" disabled={!claim || busy === "aclaim"} onClick={() => act("claim")}>{busy === "aclaim" ? "Claiming…" : "Claim fees"}</button>
            </div>
          )}
        </section>

        <section className="vb-panel">
          <Marks />
          <h3><span className="vb-n mono">C</span>Contracts</h3>
          <ul className="vb-addrs mono">
            {([["coin", coin.token], ["hook", coin.hook], ["fee ledger", coin.ledger]] as const).map(([l, a]) => (
              <li key={l}><span>{l}</span><a href={explorerAddress(a)} target="_blank" rel="noreferrer">{shortAddr(a)}</a><Copy text={a} /></li>
            ))}
            <li><span>pool id</span><code>{coin.poolId.slice(0, 10)}…</code><Copy text={coin.poolId} /></li>
          </ul>
          <p className="vb-fine">Liquidity is held by the dead address. The hook's rules are fixed at launch and can't be changed by anyone.</p>
        </section>
      </div>
    </div>
  );
}
