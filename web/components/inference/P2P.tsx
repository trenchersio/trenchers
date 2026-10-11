"use client";
// Trenchers P2P: holders trade $TRENCHERS and agent coins with each other, at their own prices, escrowed on-chain.
// No curve, no slippage, no fee. An ask holds the tokens in the contract until it is filled or cancelled; a bid
// holds the ETH. A $TRENCHERS ask can be filled straight into inference credit, with the desk as the recipient.
import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther, parseUnits, type Address } from "viem";
import { useWallet, short } from "@/lib/wallet";
import { compact, type Rate } from "@/lib/inference";
import { ERC20_MIN_ABI, OTC_ABI, ethFor, priceOf, type Fill, type Order } from "@/lib/inference-contracts";
import { EXPLORER } from "@/lib/constants";
import { route } from "./BuyCredit";

type Tab = "buy" | "sell" | "make";
const whole = (u: string | bigint) => Number(BigInt(u) / 10n ** 12n) / 1e6;
const fmt = (n: number, max = 2) => n.toLocaleString("en-US", { maximumFractionDigits: max });
/** ETH per million tokens: $TRENCHERS-sized prices read better that way. */
const perM = (p: number) => fmt(p * 1e6, p * 1e6 < 1 ? 4 : 3);
const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
const left = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.round((Date.parse(iso) - Date.now()) / 1000);
  return s <= 0 ? "expired" : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`;
};
const clean = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

export function P2P({ rate, orders, fills, onChange }: { rate: Rate | null; orders: Order[] | null; fills: Fill[]; onChange: () => void }) {
  const w = useWallet();
  const trenchers = (rate?.deposit.token ?? "").toLowerCase();
  const otc = (rate?.otc ?? null) as Address | null;
  const desk = (rate?.deposit.address ?? null) as Address | null;

  // The markets on the book, $TRENCHERS first, then agent coins, then anything else.
  const markets = useMemo(() => {
    const m = new Map<string, { token: string; symbol: string; verified: boolean; agent: number | null; n: number }>();
    if (trenchers) m.set(trenchers, { token: trenchers, symbol: "TRENCHERS", verified: true, agent: null, n: 0 });
    for (const o of orders ?? []) {
      const k = o.token.toLowerCase();
      const e = m.get(k) ?? { token: k, symbol: o.symbol, verified: o.verified, agent: o.agent, n: 0 };
      e.n += 1; m.set(k, e);
    }
    return [...m.values()].sort((a, b) => (a.token === trenchers ? -1 : b.token === trenchers ? 1 : (b.verified ? 1 : 0) - (a.verified ? 1 : 0) || b.n - a.n));
  }, [orders, trenchers]);
  const [mkt, setMkt] = useState<string>("");
  useEffect(() => { if (!mkt && markets[0]) setMkt(markets[0].token); }, [markets, mkt]);
  const market = markets.find((m) => m.token === mkt) ?? markets[0];

  const live = (o: Order) => BigInt(o.tokenLeft) > 0n && (!o.expiresAt || Date.parse(o.expiresAt) > Date.now());
  const book = useMemo(() => (orders ?? []).filter((o) => market && o.token.toLowerCase() === market.token && live(o)), [orders, market]);
  const asks = useMemo(() => book.filter((o) => o.side === "ask").sort((a, b) => priceOf(b) - priceOf(a)), [book]);
  const bids = useMemo(() => book.filter((o) => o.side === "bid").sort((a, b) => priceOf(b) - priceOf(a)), [book]);
  const bestAsk = asks.length ? priceOf(asks[asks.length - 1]) : null;
  const bestBid = bids.length ? priceOf(bids[0]) : null;
  const spread = bestAsk && bestBid ? ((bestAsk - bestBid) / bestAsk) * 100 : null;
  const depthMax = Math.max(1, ...book.map((o) => whole(o.tokenLeft)));

  const [tab, setTab] = useState<Tab>("buy");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [side, setSide] = useState<"ask" | "bid">("ask");
  const [days, setDays] = useState(7);
  const [taker, setTaker] = useState("");
  const [toDesk, setToDesk] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | "sign" | "chain">(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { setAmount(""); setErr(null); setDone(null); setPicked(null); }, [mkt]);
  const isTrenchers = market?.token === trenchers;

  let want = 0n;
  try { want = amount ? parseUnits(amount, 18) : 0n; } catch { want = 0n; }
  const pickedOrder = picked !== null ? book.find((o) => o.id === picked) ?? null : null;

  const buyRoute = useMemo(() => {
    if (tab !== "buy" || want <= 0n) return null;
    if (pickedOrder && pickedOrder.side === "ask") {
      const take = BigInt(pickedOrder.tokenLeft) < want ? BigInt(pickedOrder.tokenLeft) : want;
      return { legs: [{ order: pickedOrder, amount: take, eth: ethFor(pickedOrder, take) }], filled: take, eth: ethFor(pickedOrder, take), short: take < want };
    }
    return route(asks, want, w.address);
  }, [tab, want, asks, pickedOrder, w.address]);
  const sellInto = tab === "sell" ? (pickedOrder?.side === "bid" ? pickedOrder : bids[0] ?? null) : null;
  const sellAmt = sellInto ? (BigInt(sellInto.tokenLeft) < want ? BigInt(sellInto.tokenLeft) : want) : 0n;
  const sellEth = sellInto && sellAmt > 0n ? (sellAmt * BigInt(sellInto.ethTotal)) / BigInt(sellInto.tokenTotal) : 0n;
  const makeEth = (() => { const p = Number(price), a = Number(amount); return p > 0 && a > 0 ? (a * p) / 1e6 : 0; })();

  async function act() {
    if (!w.address) { w.openModal(); return; }
    if (w.kind === "demo") { setErr("The demo wallet can look around but cannot trade. Connect a browser wallet."); return; }
    if (!otc || !market) return;
    setErr(null); setDone(null);
    const { sendCall, reason, reader } = await import("@/lib/chain");
    const from = w.address as Address;
    const token = market.token as Address;
    const approve = async (amt: bigint) => {
      const a = await reader().readContract({ address: token, abi: ERC20_MIN_ABI, functionName: "allowance", args: [from, otc] }).catch(() => 0n) as bigint;
      if (a < amt) await sendCall(from, { address: token, abi: ERC20_MIN_ABI, functionName: "approve", args: [otc, amt] }, setBusy);
    };
    try {
      let hash: string;
      if (tab === "buy" && buyRoute) {
        const to = (isTrenchers && toDesk && desk ? desk : from) as Address;
        hash = await sendCall(from, { address: otc, abi: OTC_ABI, functionName: "buy", args: [buyRoute.legs.map((l) => BigInt(l.order.id)), buyRoute.legs.map((l) => l.amount), to], value: buyRoute.eth }, setBusy);
      } else if (tab === "sell" && sellInto) {
        await approve(sellAmt);
        hash = await sendCall(from, { address: otc, abi: OTC_ABI, functionName: "sell", args: [BigInt(sellInto.id), sellAmt, sellEth] }, setBusy);
      } else {
        const tok = parseUnits(amount, 18);
        const eth = parseEther(makeEth.toFixed(18));
        const expiry = days ? Math.floor(Date.now() / 1000) + days * 86400 : 0;
        const t = (/^0x[0-9a-fA-F]{40}$/.test(taker.trim()) ? taker.trim() : "0x0000000000000000000000000000000000000000") as Address;
        if (side === "ask") {
          await approve(tok);
          hash = await sendCall(from, { address: otc, abi: OTC_ABI, functionName: "ask", args: [token, tok, eth, expiry, t] }, setBusy);
        } else {
          hash = await sendCall(from, { address: otc, abi: OTC_ABI, functionName: "bid", args: [token, tok, expiry, t], value: eth }, setBusy);
        }
      }
      setDone(hash); setAmount(""); onChange();
    } catch (e) { setErr(reason(e)); }
    finally { setBusy(null); }
  }

  const mine = (orders ?? []).filter((o) => w.address && o.maker.toLowerCase() === w.address.toLowerCase());
  const cancel = async (id: number) => {
    if (!otc || !w.address) return;
    const { sendCall, reason } = await import("@/lib/chain");
    try { await sendCall(w.address as Address, { address: otc, abi: OTC_ABI, functionName: "cancel", args: [BigInt(id)] }, setBusy); onChange(); }
    catch (e) { setErr(reason(e)); } finally { setBusy(null); }
  };

  const goLabel = busy === "sign" ? "Check your wallet…" : busy === "chain" ? "Confirming…" : !w.address ? "Connect wallet"
    : !otc ? "Opens when the contract is live"
    : tab === "buy" ? (!buyRoute ? "Enter an amount" : buyRoute.short ? "Not enough on the book" : `Buy for ${fmt(Number(formatEther(buyRoute.eth)), 6)} ETH`)
    : tab === "sell" ? (!sellInto ? "No bids to sell into" : sellAmt === 0n ? "Enter an amount" : `Sell for ${fmt(Number(formatEther(sellEth)), 6)} ETH`)
    : !makeEth ? "Enter amount and price" : side === "ask" ? "Approve and place ask" : `Place bid with ${fmt(makeEth, 6)} ETH`;
  const goOff = !!busy || (!!w.address && (!otc || (tab === "buy" ? !buyRoute || buyRoute.short : tab === "sell" ? !sellInto || sellAmt === 0n : !makeEth)));

  const row = (o: Order) => {
    const amt = whole(o.tokenLeft);
    const priv = !!o.taker;
    const forMe = priv && w.address && o.taker!.toLowerCase() === w.address.toLowerCase();
    return (
      <button type="button" key={o.id} className={`ibook-row ${o.side}${picked === o.id ? " on" : ""}${priv && !forMe ? " priv" : ""}`}
        onClick={() => { if (priv && !forMe) return; setPicked(o.id); setTab(o.side === "ask" ? "buy" : "sell"); setAmount(String(amt)); }}
        style={{ ["--d" as string]: `${Math.max(4, (amt / depthMax) * 100)}%` }} aria-label={`${o.side === "ask" ? "Ask" : "Bid"} ${fmt(amt, 0)} at ${perM(priceOf(o))} ETH per million`}>
        <span className="ibook-p mono">{perM(priceOf(o))}</span>
        <span className="mono">{compact(amt)}</span>
        <span className="mono">{fmt(whole(o.tokenLeft) * priceOf(o), 4)}</span>
        <span className="ibook-mk mono">{priv ? <><i className="ibook-lock" aria-hidden="true" />{forMe ? "for you" : "private"}</> : short(o.maker)}</span>
        <span className="mono ibook-exp">{left(o.expiresAt)}</span>
      </button>
    );
  };

  return (
    <div className="ip2p">
      <div className="ip2p-top">
        <div className="ip2p-mkts" role="tablist" aria-label="Market">
          {markets.map((m) => (
            <button key={m.token} type="button" role="tab" aria-selected={market?.token === m.token} className={market?.token === m.token ? "on" : ""} onClick={() => setMkt(m.token)}>
              <b>${m.symbol}</b>
              <span>{m.token === trenchers ? "the token" : m.agent ? `agent #${m.agent}` : "unverified"}</span>
              {m.verified ? <i className="ip2p-ok" title="Verified: $TRENCHERS or an agent coin">✓</i> : <i className="ip2p-warn" title="Not a Trenchers token: check the address">!</i>}
            </button>
          ))}
        </div>
        <dl className="ip2p-stats">
          <div><dt>Best ask</dt><dd className="mono down">{bestAsk ? perM(bestAsk) : "–"}</dd></div>
          <div><dt>Best bid</dt><dd className="mono up">{bestBid ? perM(bestBid) : "–"}</dd></div>
          <div><dt>Spread</dt><dd className="mono">{spread !== null ? `${fmt(spread, 2)}%` : "–"}</dd></div>
          <div><dt>Open orders</dt><dd className="mono">{book.length}</dd></div>
        </dl>
      </div>

      <div className="ip2p-grid">
        <div className="ibook">
          <div className="ipanel-head"><span className="ipanel-dot" /><span>Order book · ${market?.symbol ?? "…"}</span><span className="mono ibook-unit">price in ETH per 1M</span></div>
          <div className="ibook-cols mono"><span>Price</span><span>Amount</span><span>Total ETH</span><span>Maker</span><span>Expires</span></div>
          <div className="ibook-asks">{orders === null ? <div className="ibook-empty">Reading the book…</div> : asks.length ? asks.map(row) : <div className="ibook-empty">No asks yet. Be the first to list.</div>}</div>
          <div className="ibook-mid">
            <span className="mono">{bestAsk && bestBid ? perM((bestAsk + bestBid) / 2) : "–"}</span>
            <span>mid</span>
            {spread !== null && <span className="mono ibook-spread">spread {fmt(spread, 2)}%</span>}
          </div>
          <div className="ibook-bids">{orders === null ? null : bids.length ? bids.map(row) : <div className="ibook-empty">No bids yet.</div>}</div>
        </div>

        <aside className="itrade">
          <div className="ipanel-head"><span className="ipanel-dot" /><span>Trade ${market?.symbol ?? ""}</span><span className="mono itrade-fee">0% fee</span></div>
          <div className="ibuy-tabs" role="tablist">
            {([["buy", "Buy"], ["sell", "Sell"], ["make", "Place order"]] as [Tab, string][]).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setAmount(""); setErr(null); setDone(null); setPicked(null); }}>{l}</button>
            ))}
          </div>
          <div className="itrade-body">
            {tab === "make" && (
              <div className="itrade-side" role="group" aria-label="Order side">
                <button type="button" className={side === "ask" ? "on ask" : ""} onClick={() => setSide("ask")}>Sell (ask)</button>
                <button type="button" className={side === "bid" ? "on bid" : ""} onClick={() => setSide("bid")}>Buy (bid)</button>
              </div>
            )}
            <label className="ibuy-field">
              <span className="ibuy-label">Amount</span>
              <span className="ibuy-row"><input value={amount} onChange={(e) => { setAmount(clean(e.target.value)); if (tab !== "make") setPicked(null); }} placeholder="0" inputMode="decimal" /><span className="ibuy-unit">${market?.symbol}</span></span>
            </label>
            {tab === "make" && (
              <>
                <label className="ibuy-field">
                  <span className="ibuy-label">Price</span>
                  <span className="ibuy-row"><input value={price} onChange={(e) => setPrice(clean(e.target.value))} placeholder={bestAsk ? perM(side === "ask" ? bestAsk : bestBid ?? bestAsk) : "0"} inputMode="decimal" /><span className="ibuy-unit eth">ETH / 1M</span></span>
                </label>
                <div className="itrade-opts">
                  <label><span>Expires</span>
                    <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                      <option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={0}>Never</option>
                    </select>
                  </label>
                  <label><span>Only for (optional)</span><input value={taker} onChange={(e) => setTaker(e.target.value.trim())} placeholder="0x… private buyer" /></label>
                </div>
              </>
            )}

            <dl className="itrade-sum">
              {tab === "buy" && <>
                <div><dt>Fills</dt><dd className="mono">{buyRoute ? `${buyRoute.legs.length} order${buyRoute.legs.length === 1 ? "" : "s"}` : "–"}</dd></div>
                <div><dt>Average price</dt><dd className="mono">{buyRoute && buyRoute.filled > 0n ? `${perM(Number(buyRoute.eth) / Number(buyRoute.filled))} / 1M` : "–"}</dd></div>
                <div><dt>You pay</dt><dd className="mono">{buyRoute ? `${fmt(Number(formatEther(buyRoute.eth)), 6)} ETH` : "–"}</dd></div>
              </>}
              {tab === "sell" && <>
                <div><dt>Into bid</dt><dd className="mono">{sellInto ? `#${sellInto.id} at ${perM(priceOf(sellInto))}` : "–"}</dd></div>
                <div><dt>Fills</dt><dd className="mono">{sellAmt > 0n ? `${fmt(whole(sellAmt), 0)}` : "–"}</dd></div>
                <div><dt>You get</dt><dd className="mono">{sellAmt > 0n ? `${fmt(Number(formatEther(sellEth)), 6)} ETH` : "–"}</dd></div>
              </>}
              {tab === "make" && <>
                <div><dt>{side === "ask" ? "You receive" : "You escrow"}</dt><dd className="mono">{makeEth ? `${fmt(makeEth, 6)} ETH` : "–"}</dd></div>
                <div><dt>{side === "ask" ? "Escrowed" : "You receive"}</dt><dd className="mono">{Number(amount) > 0 ? `${fmt(Number(amount), 0)} $${market?.symbol}` : "–"}</dd></div>
                <div><dt>Visible to</dt><dd className="mono">{/^0x[0-9a-fA-F]{40}$/.test(taker) ? short(taker) : "everyone"}</dd></div>
              </>}
            </dl>

            {tab === "buy" && isTrenchers && (
              <label className="itrade-desk">
                <input type="checkbox" checked={toDesk} onChange={(e) => setToDesk(e.target.checked)} />
                <span><b>Turn it into inference credit</b>The tokens go straight to the desk and are burned; the credit lands on your account.</span>
              </label>
            )}

            <button type="button" className="ibtn ibtn-wide" onClick={act} disabled={goOff}>{goLabel}</button>
            {err && <p className="ibuy-err">{err}</p>}
            {done && <p className="ibuy-ok">Done. {EXPLORER && <a href={`${EXPLORER}/tx/${done}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</p>}
            {!market?.verified && <p className="ibuy-err">This token is not $TRENCHERS or an agent coin. Check its address before you trade it.</p>}
            <p className="inf-fine">Orders are escrowed by the P2P contract until filled, cancelled or expired. Cancel any time and the escrow comes straight back. Click a row in the book to fill that order.</p>
          </div>
        </aside>
      </div>

      <div className="ip2p-low">
        <div className="itape">
          <div className="ipanel-head"><span className="ipanel-dot" /><span>Recent fills</span></div>
          <ul>
            {fills.length === 0 ? <li className="ibook-empty">No fills yet.</li> : fills.slice(0, 10).map((f) => (
              <li key={f.id}>
                <span className={`mono ${f.side === "buy" ? "up" : "down"}`}>{f.side}</span>
                <span className="mono">{compact(whole(f.tokenAmount))} ${f.symbol}</span>
                <span className="mono">{fmt(Number(formatEther(BigInt(f.ethAmount))), 4)} ETH</span>
                <span>{f.toDesk ? <em className="itape-desk">→ credit, burned</em> : null}</span>
                <span className="mono itape-t">{ago(f.at)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="imine">
          <div className="ipanel-head"><span className="ipanel-dot" /><span>Your orders</span></div>
          {!w.address ? <p className="inf-muted imine-empty">Connect a wallet to see and cancel your orders.</p>
            : mine.length === 0 ? <p className="inf-muted imine-empty">No open orders. Place one from the trade panel.</p>
            : <ul>{mine.map((o) => (
              <li key={o.id}>
                <span className={`mono ${o.side === "ask" ? "down" : "up"}`}>{o.side}</span>
                <span className="mono">{compact(whole(o.tokenLeft))} ${o.symbol} @ {perM(priceOf(o))}</span>
                <button type="button" className="tbtn" onClick={() => cancel(o.id)} disabled={!!busy}>Cancel</button>
              </li>))}</ul>}
        </div>
      </div>
    </div>
  );
}
