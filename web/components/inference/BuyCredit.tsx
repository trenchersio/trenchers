"use client";
// Buying inference credit from the page. Three ways in:
//
//   $TRENCHERS  one transfer to the desk. Credit lands on the wallet it came from, and the tokens are burned.
//   ETH         one call to the InferenceRouter: it buys $TRENCHERS through the Trenchers Pons adapter and hands it
//               to the desk in the same transaction, so paying in ETH is one step, not swap-then-send.
//   P2P         fill the cheapest $TRENCHERS asks on the P2P book with the desk as the recipient: buy from holders
//               at their price, straight into credit.
import { useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits, type Address } from "viem";
import { useWallet } from "@/lib/wallet";
import { usd, type Rate } from "@/lib/inference";
import { ERC20_MIN_ABI, OTC_ABI, ROUTER_ABI, ethFor, priceOf, type Order } from "@/lib/inference-contracts";
import { EXPLORER, TRENCHERS_PONS } from "@/lib/constants";

type Pay = "token" | "eth" | "p2p";
const SLIPPAGE_BPS = 50n;

/** Keep only digits and one dot, and no more decimals than the token has. */
const clean = (v: string, decimals = 18) => {
  const s = v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
  const [i, f] = s.split(".");
  return f === undefined ? i : `${i}.${f.slice(0, decimals)}`;
};
const fmt = (n: number, max = 2) => n.toLocaleString("en-US", { maximumFractionDigits: max });

/** The cheapest asks first, enough of them to cover `want` tokens. */
export function route(asks: Order[], want: bigint, me: string | null) {
  const usable = asks
    .filter((o) => o.side === "ask" && BigInt(o.tokenLeft) > 0n && (!o.taker || (me && o.taker.toLowerCase() === me.toLowerCase())) && (!o.expiresAt || Date.parse(o.expiresAt) > Date.now()))
    .sort((a, b) => priceOf(a) - priceOf(b));
  const legs: { order: Order; amount: bigint; eth: bigint }[] = [];
  let left = want;
  for (const o of usable) {
    if (left <= 0n) break;
    const take = BigInt(o.tokenLeft) < left ? BigInt(o.tokenLeft) : left;
    legs.push({ order: o, amount: take, eth: ethFor(o, take) });
    left -= take;
  }
  const filled = want - (left > 0n ? left : 0n);
  const eth = legs.reduce((a, l) => a + l.eth, 0n);
  return { legs, filled, eth, short: left > 0n };
}

export function BuyCredit({ rate, orders, mock, onSent }: { rate: Rate | null; orders: Order[] | null; mock: boolean; onSent?: () => void }) {
  const w = useWallet();
  const [pay, setPay] = useState<Pay>("token");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [bal, setBal] = useState<{ token: bigint | null; eth: bigint | null }>({ token: null, eth: null });
  const [busy, setBusy] = useState<null | "sign" | "chain">(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const dep = rate?.deposit;
  const desk = (dep?.address ?? null) as Address | null;
  const token = (dep?.token ?? null) as Address | null;
  const decimals = dep?.decimals ?? 18;
  const perUsd = Number(dep?.tokensPerUsd ?? rate?.rate?.tokensPerUsd ?? 0);
  const router = (rate?.router ?? null) as Address | null;
  const otc = (rate?.otc ?? null) as Address | null;
  const real = w.kind === "wallet" && !!w.address;

  // Balances, read from the chain when a real wallet is connected.
  useEffect(() => {
    let alive = true;
    if (!real || !w.address || !token) { setBal({ token: null, eth: null }); return; }
    (async () => {
      const { reader } = await import("@/lib/chain");
      const c = reader();
      const [t, e] = await Promise.all([
        c.readContract({ address: token, abi: ERC20_MIN_ABI, functionName: "balanceOf", args: [w.address as Address] }).catch(() => null),
        c.getBalance({ address: w.address as Address }).catch(() => null),
      ]);
      if (alive) setBal({ token: t as bigint | null, eth: e });
    })();
    return () => { alive = false; };
  }, [real, w.address, token, sent]);

  // ETH: quote the router by simulating the buy (the curve answers exactly what it would give).
  useEffect(() => {
    setQuote(null);
    if (pay !== "eth") return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    let alive = true;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        if (mock || !router) {
          // Local preview only: a fixed sample price so the panel can be seen working without a chain.
          if (mock) { const q = parseEther(clean(amount)) * 10_000_000n; if (alive) setQuote(q); }
          return;
        }
        const { reader } = await import("@/lib/chain");
        const { result } = await reader().simulateContract({ address: router, abi: ROUTER_ABI, functionName: "buyCredit", args: [0n, "0x0000000000000000000000000000000000000000"], value: parseEther(clean(amount)), account: (w.address ?? "0x000000000000000000000000000000000000dEaD") as Address });
        if (alive) setQuote(result as bigint);
      } catch { if (alive) setQuote(null); }
      finally { if (alive) setQuoting(false); }
    }, 350);
    return () => { alive = false; clearTimeout(t); setQuoting(false); };
  }, [amount, pay, router, mock, w.address]);

  const asks = useMemo(() => (orders ?? []).filter((o) => o.side === "ask" && token && o.token.toLowerCase() === token.toLowerCase()), [orders, token]);
  const p2p = useMemo(() => {
    if (pay !== "p2p") return null;
    let want = 0n;
    try { want = parseUnits(clean(amount, decimals) || "0", decimals); } catch { want = 0n; }
    return want > 0n ? route(asks, want, w.address) : null;
  }, [pay, amount, asks, decimals, w.address]);

  /** Tokens that reach the desk for what is typed, or null while unknown. */
  const tokensIn: bigint | null = useMemo(() => {
    try {
      if (pay === "token") return amount ? parseUnits(clean(amount, decimals) || "0", decimals) : null;
      if (pay === "eth") return quote;
      return p2p ? p2p.filled : null;
    } catch { return null; }
  }, [pay, amount, quote, p2p, decimals]);
  const credit = tokensIn !== null && perUsd > 0 ? (tokensIn * 1_000_000n) / (parseUnits(String(perUsd), decimals)) : null;

  const have = pay === "eth" ? bal.eth : pay === "token" ? bal.token : bal.eth;
  const spend: bigint | null = (() => {
    try {
      if (pay === "token") return amount ? parseUnits(clean(amount, decimals) || "0", decimals) : null;
      if (pay === "eth") return amount ? parseEther(clean(amount) || "0") : null;
      return p2p ? p2p.eth : null;
    } catch { return null; }
  })();
  const enough = have === null || spend === null || spend <= have;
  const minTokens = dep?.minimumTokens ? parseUnits(dep.minimumTokens, decimals) : 0n;
  const belowMin = tokensIn !== null && tokensIn > 0n && tokensIn < minTokens;

  const unavailable =
    !desk ? "The desk has no deposit address yet, so credit cannot be bought."
    : pay === "eth" && !router ? "eth"
    : pay === "p2p" && !otc ? "p2p"
    : null;

  async function go() {
    if (!w.address) { w.openModal(); return; }
    if (w.kind === "demo") { setErr("The demo wallet can look around but cannot pay. Connect a browser wallet to buy credit."); return; }
    setErr(null); setSent(null);
    const { sendCall, reason } = await import("@/lib/chain");
    const from = w.address as Address;
    try {
      let hash: string;
      if (pay === "token") {
        hash = await sendCall(from, { address: token!, abi: ERC20_MIN_ABI, functionName: "transfer", args: [desk!, spend!] }, setBusy);
      } else if (pay === "eth") {
        const min = (quote! * (10_000n - SLIPPAGE_BPS)) / 10_000n;
        hash = await sendCall(from, { address: router!, abi: ROUTER_ABI, functionName: "buyCredit", args: [min, "0x0000000000000000000000000000000000000000"], value: spend! }, setBusy);
      } else {
        const legs = p2p!.legs;
        hash = await sendCall(from, { address: otc!, abi: OTC_ABI, functionName: "buy", args: [legs.map((l) => BigInt(l.order.id)), legs.map((l) => l.amount), desk!], value: p2p!.eth }, setBusy);
      }
      setSent(hash); setAmount(""); onSent?.();
    } catch (e) {
      setErr(reason(e));
    } finally { setBusy(null); }
  }

  const label =
    busy === "sign" ? "Check your wallet…"
    : busy === "chain" ? "Confirming…"
    : !w.address ? "Connect wallet"
    : !amount || Number(amount) <= 0 ? "Enter an amount"
    : !enough ? `Not enough ${pay === "token" ? "$TRENCHERS" : "ETH"}`
    : belowMin ? `Minimum ${fmt(Number(dep?.minimumTokens ?? 0), 0)} $TRENCHERS`
    : pay === "p2p" && p2p?.short ? "Not enough on the book"
    : pay === "p2p" ? `Buy from ${p2p?.legs.length ?? 0} holder${p2p?.legs.length === 1 ? "" : "s"}`
    : "Buy credit";
  const disabled = !!busy || (!!w.address && (!amount || Number(amount) <= 0 || !enough || belowMin || (pay === "eth" && quote === null) || (pay === "p2p" && (!p2p || p2p.short))));

  const best = asks.length ? Math.min(...asks.map(priceOf)) : null;

  return (
    <div className="ibuy" id="buy">
      <div className="ipanel-head">
        <span className="ipanel-dot" /><span>Buy inference credit</span>
        {dep?.burns && <span className="ibuy-burn mono">burns $TRENCHERS</span>}
      </div>

      <div className="ibuy-tabs" role="tablist" aria-label="Pay with">
        {([["token", "$TRENCHERS"], ["eth", "ETH"], ["p2p", "From holders"]] as [Pay, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={pay === k} className={pay === k ? "on" : ""}
            onClick={() => { setPay(k); setAmount(""); setErr(null); setSent(null); }}>{l}</button>
        ))}
      </div>

      <div className="ibuy-body">
        <label className="ibuy-field">
          <span className="ibuy-label">{pay === "p2p" ? "You get" : "You pay"}</span>
          <span className="ibuy-row">
            <input value={amount} onChange={(e) => setAmount(clean(e.target.value, pay === "eth" ? 18 : decimals))} placeholder="0" inputMode="decimal"
              aria-label={pay === "eth" ? "Amount of ETH" : "Amount of $TRENCHERS"} />
            <span className={`ibuy-unit${pay === "eth" ? " eth" : ""}`}>{pay === "eth" ? "ETH" : "$TRENCHERS"}</span>
          </span>
          <span className="ibuy-under">
            <span>Balance {have === null ? "–" : fmt(Number(formatUnits(have, pay === "token" ? decimals : 18)), 4)} {pay === "token" ? "" : "ETH"}</span>
            {pay !== "p2p" && have !== null && have > 0n && (
              <button type="button" className="ibuy-max" onClick={() => setAmount(formatUnits(pay === "eth" ? (have > parseEther("0.0005") ? have - parseEther("0.0005") : 0n) : have, pay === "eth" ? 18 : decimals))}>Max</button>
            )}
            {pay === "p2p" && best !== null && <span>best ask {fmt(best * 1e6, 4)} ETH / 1M</span>}
          </span>
        </label>

        <div className="ibuy-arrow" aria-hidden="true"><span>↓</span></div>

        <div className="ibuy-field ibuy-get">
          <span className="ibuy-label">Credit on your account</span>
          <span className="ibuy-row">
            <b>{quoting ? "…" : credit !== null ? usd(credit) : "$0.00"}</b>
            <span className="ibuy-unit cr">credit</span>
          </span>
          <span className="ibuy-under">
            {pay === "token" && <span>{perUsd ? `${fmt(perUsd, 0)} $TRENCHERS = $1.00 of credit` : "Rate not published yet"}</span>}
            {pay === "eth" && <span>{quote !== null ? `buys ${fmt(Number(formatUnits(quote, decimals)), 0)} $TRENCHERS, ${Number(SLIPPAGE_BPS) / 100}% slippage` : "Quoted live from the pool"}</span>}
            {pay === "p2p" && <span>{p2p ? `pay ${fmt(Number(formatEther(p2p.eth)), 6)} ETH across ${p2p.legs.length} order${p2p.legs.length === 1 ? "" : "s"}` : `${asks.length} open asks on the book`}</span>}
          </span>
        </div>

        <div className="ibuy-burnline">
          <span className="ibuy-flame" aria-hidden="true" />
          <span>{tokensIn !== null && tokensIn > 0n ? <><b>{fmt(Number(formatUnits(tokensIn, decimals)), 0)} $TRENCHERS</b> burned</> : <>Every $TRENCHERS paid in is <b>burned</b></>}</span>
        </div>

        {unavailable === "eth" ? (
          <div className="ibuy-note">
            <p>Paying in ETH in one step opens when its router contract is live. Until then, buy $TRENCHERS on Pons and pay with the $TRENCHERS tab.</p>
            {TRENCHERS_PONS && <a className="tbtn" href={TRENCHERS_PONS} target="_blank" rel="noreferrer">Buy $TRENCHERS on Pons ↗</a>}
          </div>
        ) : unavailable === "p2p" ? (
          <div className="ibuy-note"><p>The P2P market opens when its contract is live. Orders will show here and fill straight into credit.</p></div>
        ) : unavailable ? (
          <div className="ibuy-note"><p>{unavailable}</p></div>
        ) : (
          <button type="button" className="ibuy-go" onClick={go} disabled={disabled}>{label}</button>
        )}

        {err && <p className="ibuy-err">{err}</p>}
        {sent && (
          <p className="ibuy-ok">Sent. Credit appears on your account once it confirms.{" "}
            {EXPLORER && <a href={`${EXPLORER}/tx/${sent}`} target="_blank" rel="noreferrer">View transaction ↗</a>}</p>
        )}

        <span className="ibuy-soon" tabIndex={0} aria-describedby="ibuy-soon-tip">
          <button type="button" className="ibuy-trencher" disabled aria-disabled="true">
            <img src="brand/mark.svg" alt="" width={14} height={14} />Send inference to a Trencher
          </button>
          <span className="ibuy-tip mono" id="ibuy-soon-tip" role="tooltip">Coming Soon</span>
        </span>

        <p className="ibuy-foot">
          {pay === "token" && "Sent straight to the desk. The credit lands on the wallet it came from."}
          {pay === "eth" && "One transaction: ETH buys $TRENCHERS through the pool and it goes straight to the desk. The credit lands on the wallet that signed."}
          {pay === "p2p" && "Fills the cheapest $TRENCHERS asks on the P2P book at the holders' own prices, with the desk as the recipient."}
          {" "}Credit is in dollars and never expires.
        </p>
      </div>
    </div>
  );
}
