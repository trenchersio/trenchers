"use client";
// Trenchers Credit: lend ETH, back the lines, or stake $TRENCHERS and give an agent an ETH credit line. Reads the chain directly;
// before launch it shows the same page with sample figures, marked as a preview.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { useWallet, short } from "@/lib/wallet";
import { reader, reason } from "@/lib/chain";
import { ROUTES, TRENCHERS_TOKEN } from "@/lib/constants";
import {
  PREVIEW, PREVIEW_BACKER, creditAddrs, readOverview, readReport, readLoansOf, readPosition, readLender, readBacker, ownerOfAgent, lineFor, feeFor,
  backingSharesFor, sharesForFraction, lend, withdraw, openLine, addStake, closeLine, borrow, repay, harvest, sweepReserve,
  backLines, requestExit, cancelExit, exitBacking, ERC20_ABI, eth, tok, days,
  type CreditAddrs, type Overview, type Report, type LoanRow, type Position, type Lender, type Backer,
} from "@/lib/credit";

const toWei = (v: string) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? BigInt(Math.round(x * 1e9)) * 10n ** 9n : 0n; };
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
const when = (t: number) => new Date(t * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const until = (t: number, now: number) => { const s = t - now; if (s <= 0) return "now"; const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600); return d >= 1 ? `${d}d ${h}h` : h >= 1 ? `${h}h ${Math.floor((s % 3600) / 60)}m` : `${Math.max(1, Math.ceil(s / 60))}m`; };
const left = (t: number) => { const s = t - Date.now() / 1000; if (s <= 0) return "due"; const d = Math.floor(s / 86400); return d >= 1 ? `${d}d ${Math.floor((s % 86400) / 3600)}h left` : `${Math.max(1, Math.floor(s / 3600))}h left`; };

type Busy = { what: string; phase: string } | null;
const PHASE: Record<string, string> = { approve: "Approve $TRENCHERS in your wallet…", sign: "Confirm in your wallet…", chain: "Waiting for Robinhood Chain…" };

/* ----------------------------------------------------------------------------------------------- small pieces */

function Stat({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: string }) {
  return <div className={`cr-stat${tone ? ` t-${tone}` : ""}`}><span className="mono">{k}</span><b>{v}</b>{sub && <em className="mono">{sub}</em>}</div>;
}

function Score({ v, size = 168 }: { v: number; size?: number }) {
  const r = 70, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, v / 1000));
  const tier = v >= 700 ? "Strong" : v >= 400 ? "Trusted" : v >= 150 ? "Building" : v > 0 ? "New" : "No record";
  return (
    <div className="cr-score" style={{ width: size, height: size }}>
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle cx="80" cy="80" r={r} className="cr-score-bg" />
        <circle cx="80" cy="80" r={r} className="cr-score-fg" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 80 80)" />
      </svg>
      <span className="cr-score-in"><b>{v}</b><em className="mono">of 1000</em><i className="mono">{tier}</i></span>
    </div>
  );
}

function Notice({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return <p className={`cr-note${ok ? " ok" : ""}`}>{children}</p>;
}

/* ----------------------------------------------------------------------------------------------- the page */

export function Credit() {
  const w = useWallet();
  const me = (w.kind === "wallet" ? w.address : null) as Address | null;
  const [addrs, setAddrs] = useState<CreditAddrs | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const a = creditAddrs();
    setAddrs(a);
    if (!a) { setOv(PREVIEW); return; }
    readOverview(a).then((o) => { setOv(o); setFailed(false); }).catch(() => setFailed(true));
  }, [tick]);
  useEffect(() => { const t = setInterval(reload, 30_000); return () => clearInterval(t); }, [reload]);

  const live = !!addrs && !!ov && !ov.preview;
  const o = ov ?? PREVIEW;

  return (
    <main id="top" className="cr">
      {!addrs && (
        <div className="cr-preview mono" role="status">
          <i aria-hidden="true" />Launching soon. This is a preview of Trenchers Credit with sample figures; nothing here moves money yet.
        </div>
      )}
      {addrs && failed && <div className="cr-preview mono" role="status"><i aria-hidden="true" />Can&apos;t reach Robinhood Chain right now. Showing the last figures seen.</div>}

      <Hero o={o} />
      <How o={o} />

      <div className="cr-act">
        <Lend addrs={live ? addrs : null} me={me} o={o} onDone={reload} />
        <BackPanel addrs={live ? addrs : null} me={me} o={o} sample={!addrs} onDone={reload} />
        <BorrowPanel addrs={live ? addrs : null} me={me} o={o} onDone={reload} />
      </div>

      <RecordPanel addrs={live ? addrs : null} />
      <Loans o={o} addrs={live ? addrs : null} me={me} onDone={reload} />
      <Terms o={o} />
      <Risks />
    </main>
  );
}

/* ----------------------------------------------------------------------------------------------- hero */

function Hero({ o }: { o: Overview }) {
  const s = o.stats, p = o.params;
  const util = s.totalAssets > 0n ? Number((s.lent * 10_000n) / s.totalAssets) / 100 : 0;
  const lendersBps = 10_000 - p.backerFeeBps - p.reserveFeeBps;
  return (
    <section className="cr-hero" aria-label="Trenchers Credit">
      <div className="cr-hero-l">
        <p className="cr-k mono"><i>05</i>Make it borrow</p>
        <h1>Credit for AI agents.<br /><span>Backed in full.</span></h1>
        <p className="cr-lede">
          Three open roles. Lend ETH and earn from every loan. Back the lines and share the fees and the defaults. Or
          stake $TRENCHERS and open an ETH credit line for any ERC-8004 agent: it borrows, repays, and builds a public
          credit score. Every line has backers&apos; ETH behind it one for one, so a default is never the lenders&apos; problem.
        </p>
        <div className="cr-hero-cta">
          <a href="#lend" className="nav-mint cr-btn">Lend ETH</a>
          <a href="#back" className="tbtn">Back the lines</a>
          <a href="#borrow" className="tbtn">Open a credit line</a>
          <a href="#record" className="tbtn">Check an agent</a>
        </div>
        <ul className="cr-who mono" aria-label="Who can use it"><li><i className="h" />Humans</li><li><i className="a" />AI agents and bots</li><li><i className="t" />Trenchers</li></ul>
      </div>
      <div className="cr-pool" aria-label="The pool right now">
        <div className="cr-pool-h"><span className="mono">The pool{o.preview ? " · sample" : " · live"}</span><b>{eth(s.totalAssets, 3)} ETH</b></div>
        <div className="cr-meter" aria-label={`${util}% lent out`}><i style={{ width: `${Math.min(100, util)}%` }} /></div>
        <p className="cr-meter-l mono"><span><i className="d" />Lent out {eth(s.lent, 3)} ETH</span><span><i className="f" />Free {eth(s.liquidity, 3)} ETH</span></p>
        <div className="cr-stats">
          <Stat k="Lenders earned" v={`${eth(s.lendersEarned)} ETH`} tone="green" />
          <Stat k="To the buyback" v={`${eth(s.toBuyback)} ETH`} tone="gold" />
          <Stat k="Loans so far" v={s.loans.toLocaleString("en-US")} sub={`${o.lines.linesOpened.toLocaleString("en-US")} lines opened`} />
          <Stat k="Backing" v={`${eth(o.lines.backingValue, 3)} ETH`} tone="violet" />
        </div>
        <div className="cr-split" aria-label="Where every loan fee goes">
          <span className="mono cr-split-k">Every loan fee</span>
          <div className="cr-split-bar">
            <i className="l" style={{ flex: lendersBps }}>{pct(lendersBps)} lenders</i>
            <i className="b" style={{ flex: p.backerFeeBps }}>{pct(p.backerFeeBps)} backers</i>
            <i className="r" style={{ flex: p.reserveFeeBps }}>{pct(p.reserveFeeBps)} buyback</i>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------- how it works */

function How({ o }: { o: Overview }) {
  const p = o.params;
  return (
    <section className="cr-how" id="how" aria-label="How it works">
      <div className="cr-sec-h">
        <p className="cr-k mono"><i>?</i>How it works</p>
        <h2>Three public roles, one pool, no loan losses for lenders.</h2>
      </div>
      <div className="cr-roles">
        <article className="cr-role tone-green">
          <span className="cr-role-n mono">01 · Lenders</span>
          <b>Put ETH in, earn from every loan</b>
          <p>Your ETH buys pool shares. {pct(10_000 - p.backerFeeBps - p.reserveFeeBps)} of every loan fee raises what each share is worth. A default is paid by the backing behind that line, never by you, so the share price can only go up.</p>
          <em className="mono">Take it out any time it isn&apos;t lent out. Within 7 days of lending, 0.5% stays with the pool.</em>
        </article>
        <article className="cr-role tone-violet">
          <span className="cr-role-n mono">02 · Backers</span>
          <b>Back the lines, share fees and defaults</b>
          <p>Anyone can put ETH behind the stake lines and get backing shares. The backing stands behind every open line, one for one, and backers share {pct(p.backerFeeBps)} of every loan fee by size. It belongs to the backers: nobody else can move it.</p>
          <em className="mono">A default is paid from the backing, shared by size, and the borrower&apos;s whole stake is burnt. Leaving takes 7 days&apos; notice.</em>
        </article>
        <article className="cr-role tone-ice">
          <span className="cr-role-n mono">03 · Borrowers</span>
          <b>Stake $TRENCHERS, get an ETH line</b>
          <p>The agent&apos;s owner stakes $TRENCHERS, signs once, and gets an ETH credit line. Borrow for up to {days(o.lines.maxTerm)}, repay with the fee, and the agent&apos;s credit score grows. Close the line and the whole stake comes back.</p>
          <em className="mono">Late by more than {days(p.grace)} after the due date: anyone can mark the default, and the stake is burnt.</em>
        </article>
      </div>
      <div className="cr-flow" aria-label="Where the ETH goes">
        <div className="cr-ins">
          <div className="cr-node g"><b>Lenders</b><span className="mono">ETH to lend</span></div>
          <div className="cr-node v"><b>Backers</b><span className="mono">ETH behind lines</span></div>
        </div>
        <span className="cr-arr" aria-hidden="true" />
        <div className="cr-node core"><b>Credit pool</b><span className="mono">shares · lines · loans</span></div>
        <span className="cr-arr" aria-hidden="true" />
        <div className="cr-node i"><b>Agent</b><span className="mono">borrows ETH</span></div>
        <span className="cr-arr" aria-hidden="true" />
        <div className="cr-node"><b>Repays</b><span className="mono">principal + fee</span></div>
        <span className="cr-arr" aria-hidden="true" />
        <ul className="cr-out">
          <li className="g"><b>{pct(10_000 - p.backerFeeBps - p.reserveFeeBps)}</b><span className="mono">to lenders</span></li>
          <li className="v"><b>{pct(p.backerFeeBps)}</b><span className="mono">to backers</span></li>
          <li className="r"><b>{pct(p.reserveFeeBps)}</b><span className="mono">buys back $TRENCHERS</span></li>
        </ul>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------- lend */

function Lend({ addrs, me, o, onDone }: { addrs: CreditAddrs | null; me: Address | null; o: Overview; onDone: () => void }) {
  const w = useWallet();
  const [amt, setAmt] = useState("0.1");
  const [pos, setPos] = useState<Lender | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const wei = toWei(amt);

  useEffect(() => {
    if (!addrs || !me) { setPos(null); return; }
    readLender(addrs, me).then(setPos).catch(() => setPos(null));
    reader().getBalance({ address: me }).then(setBal).catch(() => setBal(null));
  }, [addrs, me, busy]);

  const sharesFor = o.stats.sharePrice > 0n ? (wei * 10n ** 18n) / o.stats.sharePrice : 0n;
  const run = async (what: string, f: () => Promise<unknown>, done: string) => {
    setMsg(null); setBusy({ what, phase: "sign" });
    try { await f(); setMsg({ ok: true, t: done }); onDone(); } catch (e) { setMsg({ ok: false, t: reason(e) }); }
    setBusy(null);
  };

  return (
    <section className="cr-panel tone-green" id="lend" aria-label="Lend ETH">
      <div className="cr-panel-h"><span className="cr-k mono"><i>A</i>Lend</span><h2>Lend ETH</h2><p>Earn {pct(10_000 - o.params.backerFeeBps - o.params.reserveFeeBps)} of every loan fee. Lenders never pay for a default.</p></div>
      <label className="cr-field">
        <span className="mono">Amount{bal !== null ? <em>Wallet: {eth(bal)} ETH</em> : null}</span>
        <span className="cr-in"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="ETH to lend" /><b className="mono">ETH</b></span>
      </label>
      <div className="cr-quick">{["0.05", "0.1", "0.5", "1"].map((v) => <button key={v} type="button" className={`tbtn${amt === v ? " on" : ""}`} onClick={() => setAmt(v)}>{v}</button>)}</div>
      <dl className="cr-dl">
        <div><dt>You get</dt><dd className="mono">{tok(sharesFor)} shares</dd></div>
        <div><dt>One share is worth</dt><dd className="mono">{eth(o.stats.sharePrice, 6)} ETH</dd></div>
        <div><dt>Leave early</dt><dd className="mono">0.5% within 7 days, then free</dd></div>
      </dl>
      {!addrs ? <button type="button" className="nav-mint cr-go" disabled>Opens at launch</button>
        : !me ? <button type="button" className="nav-mint cr-go" onClick={w.openModal}>Connect a wallet to lend</button>
        : <button type="button" className="nav-mint cr-go" disabled={!!busy || wei === 0n} onClick={() => run("lend", () => lend(addrs, me, wei, (p) => setBusy({ what: "lend", phase: p })), `Lent ${amt} ETH. Your shares are in.`)}>{busy?.what === "lend" ? PHASE[busy.phase] : `Lend ${amt || 0} ETH`}</button>}
      {pos && pos.shares > 0n && (
        <div className="cr-mine">
          <span className="mono cr-mine-k">Your lending</span>
          <div className="cr-mine-row"><b>{eth(pos.value, 5)} ETH</b><span className="mono">{tok(pos.shares)} shares</span></div>
          <p className="mono" suppressHydrationWarning>{pos.unlocksAt * 1000 > Date.now() ? `Free to take out from ${when(pos.unlocksAt)} (0.5% stays before that)` : "Free to take out, no fee"}</p>
          <button type="button" className="tbtn" disabled={!!busy} onClick={() => addrs && me && run("withdraw", () => withdraw(addrs, me, pos.shares, (p) => setBusy({ what: "withdraw", phase: p })), "Withdrawn to your wallet.")}>{busy?.what === "withdraw" ? PHASE[busy.phase] : "Take it all out"}</button>
        </div>
      )}
      {msg && <Notice ok={msg.ok}>{msg.t}</Notice>}
      <ul className="cr-why">
        <li><b>Defaults don&apos;t reach you.</b><span>Every line has its own ETH backing behind it; a default burns that backing, so a share never loses value.</span></li>
        <li><b>Fees go up, never down.</b><span>Each repaid loan adds the lenders&apos; part of the fee to the pool: the share price only rises.</span></li>
        <li><b>Backing on hand.</b><span className="mono">{eth(o.lines.backing, 3)} ETH from backers behind {eth(o.lines.backingUsed, 3)} ETH of open lines</span></li>
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------- back the lines */

function BackPanel({ addrs, me, o, sample, onDone }: { addrs: CreditAddrs | null; me: Address | null; o: Overview; sample: boolean; onDone: () => void }) {
  const w = useWallet();
  const L = o.lines, P = o.params;
  const [amt, setAmt] = useState("0.1");
  const [live, setLive] = useState<Backer | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);
  const [out, setOut] = useState("");
  const [outPct, setOutPct] = useState<number | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 30_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (!addrs || !me) { setLive(null); return; }
    readBacker(addrs, me).then(setLive).catch(() => setLive(null));
    reader().getBalance({ address: me }).then(setBal).catch(() => setBal(null));
  }, [addrs, me, busy, o]);

  const pos = sample ? PREVIEW_BACKER : live;
  const wei = toWei(amt);
  const first = L.totalShares === 0n;
  const tooSmall = first && wei < 10n ** 16n;
  const shareWorth = L.totalShares > 0n ? (L.backingValue * 10n ** 18n) / L.totalShares : 0n;
  const free = pos ? pos.shares - pos.exitShares : 0n;
  const freeValue = pos && pos.shares > 0n ? (pos.value * free) / pos.shares : 0n;
  const outWei = toWei(out);
  const outShares = !pos || freeValue === 0n ? 0n : outPct !== null ? sharesForFraction(pos, outPct * 100) : outWei >= freeValue ? free : (free * outWei) / freeValue;
  const outValue = free > 0n ? (freeValue * outShares) / free : 0n;
  const ready = !!pos && pos.exitShares > 0n && pos.exitReadyAt <= now;
  const nowValue = pos && pos.exitShares > 0n ? (pos.exitValue * pos.exitNow) / pos.exitShares : 0n;
  const fullStr = (x: bigint) => (Number(x) / 1e18).toFixed(6).replace(/\.?0+$/, "");

  const run = async (what: string, f: () => Promise<unknown>, done: string) => {
    setMsg(null); setBusy({ what, phase: "sign" });
    try { await f(); setMsg({ ok: true, t: done }); onDone(); } catch (e) { setMsg({ ok: false, t: reason(e) }); }
    setBusy(null);
  };
  const ph = (what: string) => (p: string) => setBusy({ what, phase: p });
  const btn = (what: string, label: string) => (busy?.what === what ? PHASE[busy.phase] : label);
  const can = !!addrs && !!me && !sample;

  return (
    <section className="cr-panel tone-violet" id="back" aria-label="Back the lines">
      <div className="cr-panel-h"><span className="cr-k mono"><i>C</i>Back</span><h2>Back the lines</h2><p>Put ETH behind every stake line. It belongs to the backers, and nobody else can move it.</p></div>

      <div className="cr-back-cols">
      <div className="cr-back-l">
      <div className="cr-er">
        <div className="cr-er-up"><span className="mono">You earn</span><p>{pct(P.backerFeeBps)} of every loan fee, shared by all backers by size. It is added to the backing, so each share is worth more.</p></div>
        <div className="cr-er-dn"><span className="mono">You carry</span><p>Defaults, shared by size. But the borrower&apos;s whole $TRENCHERS stake is burnt, and stakes are sized at about twice the line.</p></div>
      </div>

      <div className="cr-vault" aria-label="The backing right now">
        <Stat k="Total backing" v={`${eth(L.backingValue, 3)} ETH`} tone="violet" />
        <Stat k="Behind open lines" v={`${eth(L.backingUsed, 3)} ETH`} />
        <Stat k="Free" v={`${eth(L.backingFree, 3)} ETH`} />
        <Stat k="Fees waiting" v={`${eth(L.feesWaiting, 5)} ETH`} />
      </div>
      <p className="cr-small mono">Leaving takes {days(L.exitDelay)}&apos; notice, so nobody can slip out ahead of a loan going bad.</p>
      {pos && pos.shares > 0n && (
        <div className="cr-mine">
          <span className="mono cr-mine-k">Your backing{sample ? " · sample" : ""}</span>
          <div className="cr-mine-row"><b>{eth(pos.value, 5)} ETH</b><span className="mono">{tok(pos.shares)} shares</span></div>
          {pos.exitShares > 0n && (
            <div className="cr-exit">
              <p className="mono"><span>Asked to leave</span><b>{eth(pos.exitValue, 5)} ETH</b></p>
              {ready ? (
                <p className="mono up">{pos.exitNow >= pos.exitShares ? "Ready to take out" : `${eth(nowValue, 5)} ETH can leave now; the rest is behind open lines and can leave as loans are repaid`}</p>
              ) : (
                <p className="mono" suppressHydrationWarning><span>Ready in</span><b className="cr-count" suppressHydrationWarning>{until(pos.exitReadyAt, now)}</b><em suppressHydrationWarning>{when(pos.exitReadyAt)}</em></p>
              )}
              <span className="cr-have-act">
                <button type="button" className="tbtn on" disabled={!can || !!busy || !ready || pos.exitNow === 0n} onClick={() => addrs && me && run("exit", () => exitBacking(addrs, me, pos.exitNow, me, ph("exit")), "Taken out. The ETH is in your wallet.")}>{btn("exit", "Take it out")}</button>
                <button type="button" className="tbtn" disabled={!can || !!busy} onClick={() => addrs && me && run("cancel", () => cancelExit(addrs, me, ph("cancel")), "Cancelled. Your shares stay in.")}>{btn("cancel", "Cancel")}</button>
              </span>
            </div>
          )}
          {free > 0n && (
            <div className="cr-ask">
              <span className="mono cr-ask-k">Ask to leave</span>
              <div className="cr-ask-row">
                <span className="cr-in cr-in-s"><input inputMode="decimal" placeholder="0" value={out} onChange={(e) => { setOut(e.target.value); setOutPct(null); }} aria-label="ETH to ask to take out" /><b className="mono">ETH</b></span>
                {[25, 50, 100].map((p) => <button key={p} type="button" className={`tbtn${outPct === p ? " on" : ""}`} onClick={() => { setOut(fullStr((freeValue * BigInt(p)) / 100n)); setOutPct(p); }}>{p}%</button>)}
              </div>
              <button type="button" className="tbtn" disabled={!can || !!busy || outShares === 0n} onClick={() => addrs && me && run("ask", () => requestExit(addrs, me, outShares, ph("ask")), `Asked to leave. You can take it out in ${days(L.exitDelay)}.`)}>{btn("ask", outShares === 0n ? "Ask to leave" : `Ask to leave with ${eth(outValue, 5)} ETH`)}</button>
              {pos.exitShares > 0n && <p className="cr-small mono">Asking again adds to your request and starts the {days(L.exitDelay)} again.</p>}
            </div>
          )}
        </div>
      )}
      </div>
      <div className="cr-back-r">

      <label className="cr-field">
        <span className="mono">Amount{bal !== null ? <em>Wallet: {eth(bal)} ETH</em> : null}</span>
        <span className="cr-in"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="ETH to back the lines with" /><b className="mono">ETH</b></span>
      </label>
      <div className="cr-quick">{["0.05", "0.1", "0.5", "1"].map((v) => <button key={v} type="button" className={`tbtn${amt === v ? " on" : ""}`} onClick={() => setAmt(v)}>{v}</button>)}</div>
      <dl className="cr-dl">
        <div><dt>You get</dt><dd className="mono">{tok(backingSharesFor(wei, L))} backing shares</dd></div>
        <div><dt>1,000 shares are worth</dt><dd className="mono">{first ? "–" : `${eth(shareWorth * 1000n, 6)} ETH`}</dd></div>
        <div><dt>Leaving</dt><dd className="mono">Ask, then wait {days(L.exitDelay)}</dd></div>
      </dl>
      {!addrs ? <button type="button" className="nav-mint cr-go cr-go-violet" disabled>Opens at launch</button>
        : !me ? <button type="button" className="nav-mint cr-go cr-go-violet" onClick={w.openModal}>Connect a wallet to back the lines</button>
        : <button type="button" className="nav-mint cr-go cr-go-violet" disabled={!!busy || wei === 0n || tooSmall} onClick={() => run("back", () => backLines(addrs, me, wei, ph("back")), `Backed the lines with ${amt} ETH. Your shares are in.`)}>{btn("back", tooSmall ? "The first backing must be at least 0.01 ETH" : `Back the lines with ${amt || 0} ETH`)}</button>}

      {msg && <Notice ok={msg.ok}>{msg.t}</Notice>}
      </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------- borrow */

function BorrowPanel({ addrs, me, o, onDone }: { addrs: CreditAddrs | null; me: Address | null; o: Overview; onDone: () => void }) {
  const w = useWallet();
  const [idTxt, setIdTxt] = useState("");
  const agentId = /^\d+$/.test(idTxt.trim()) ? BigInt(idTxt.trim()) : null;
  const [owner, setOwner] = useState<Address | null | undefined>(undefined);
  const [pos, setPos] = useState<Position | null>(null);
  const [rep, setRep] = useState<Report | null>(null);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [tBal, setTBal] = useState<bigint | null>(null);
  const [stake, setStake] = useState("100000");
  const [amt, setAmt] = useState("0.01");
  const [term, setTerm] = useState(7);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const L = o.lines, P = o.params;

  useEffect(() => {
    setOwner(undefined); setPos(null); setRep(null); setLoans([]);
    if (!addrs || agentId === null) return;
    let alive = true;
    ownerOfAgent(agentId).then((x) => alive && setOwner(x));
    readPosition(addrs, agentId).then((x) => alive && setPos(x)).catch(() => {});
    readReport(addrs, agentId).then((x) => alive && setRep(x)).catch(() => {});
    readLoansOf(addrs, agentId).then((x) => alive && setLoans(x)).catch(() => {});
    return () => { alive = false; };
  }, [addrs, idTxt, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!me || !TRENCHERS_TOKEN) return;
    reader().readContract({ address: TRENCHERS_TOKEN as Address, abi: ERC20_ABI, functionName: "balanceOf", args: [me] }).then((b) => setTBal(b as bigint)).catch(() => setTBal(null));
  }, [me, busy]);

  const stakeWei = toWei(stake);
  const lineNew = lineFor(stakeWei, L);
  const wei = toWei(amt);
  const fee = feeFor(wei, term * 86400, P);
  const mine = !!me && !!owner && owner.toLowerCase() === me.toLowerCase();
  const hasStake = !!pos && pos.tokens > 0n;
  const avail = rep ? rep.available : 0n;
  const active = loans.filter((l) => l.status === "active");

  const run = async (what: string, f: () => Promise<unknown>, done: string) => {
    setMsg(null); setBusy({ what, phase: "sign" });
    try { await f(); setMsg({ ok: true, t: done }); onDone(); } catch (e) { setMsg({ ok: false, t: reason(e) }); }
    setBusy(null);
  };
  const ph = (what: string) => (p: string) => setBusy({ what, phase: p });
  const btn = (what: string, label: string) => (busy?.what === what ? PHASE[busy.phase] : label);

  return (
    <section className="cr-panel tone-gold" id="borrow" aria-label="Open a credit line">
      <div className="cr-panel-h"><span className="cr-k mono"><i>B</i>Borrow</span><h2>Give an agent a credit line</h2><p>Stake $TRENCHERS behind any ERC-8004 agent you own, then borrow ETH against it.</p></div>

      <ol className="cr-steps">
        <li className={agentId !== null ? "done" : ""}><span className="mono">1</span>Your agent</li>
        <li className={hasStake ? "done" : ""}><span className="mono">2</span>Stake and open</li>
        <li className={active.length ? "done" : ""}><span className="mono">3</span>Borrow</li>
        <li><span className="mono">4</span>Repay</li>
      </ol>

      <label className="cr-field">
        <span className="mono">ERC-8004 agent id</span>
        <span className="cr-in"><input inputMode="numeric" placeholder="e.g. 8812" value={idTxt} onChange={(e) => setIdTxt(e.target.value.replace(/[^\d]/g, ""))} aria-label="Agent id" /><b className="mono">#</b></span>
      </label>
      {agentId !== null && addrs && (
        owner === undefined ? <p className="cr-hint mono">Reading agent #{idTxt}…</p>
          : owner === null ? <Notice>No ERC-8004 agent #{idTxt} on Robinhood Chain.</Notice>
          : mine ? <p className="cr-hint mono ok">✓ You own agent #{idTxt}</p>
          : <Notice>Agent #{idTxt} is owned by {short(owner)}. Connect that wallet to open or use its line; anyone can repay its loans below.</Notice>
      )}

      {/* 2 · stake and open */}
      <div className={`cr-block${hasStake ? " dim" : ""}`}>
        <span className="cr-block-k mono">Stake $TRENCHERS</span>
        {hasStake && pos ? (
          <div className="cr-have">
            <div><span className="mono">Staked</span><b>{tok(pos.tokens)} $TRENCHERS</b></div>
            <div><span className="mono">Line</span><b>{eth(pos.lineInPool || pos.line)} ETH</b></div>
            <div><span className="mono">Drawn</span><b>{eth(pos.drawn)} ETH</b></div>
            {mine && <span className="cr-have-act">
              <button type="button" className="tbtn" disabled={!!busy || stakeWei === 0n} onClick={() => addrs && me && agentId !== null && run("add", () => addStake(addrs, me, agentId, stakeWei, ph("add")), "Staked more, line raised.")}>{btn("add", `Stake ${tok(stakeWei)} more`)}</button>
              <button type="button" className="tbtn" disabled={!!busy || pos.activeLoans > 0} title={pos.activeLoans > 0 ? "Repay the open loans first" : undefined} onClick={() => addrs && me && agentId !== null && run("close", () => closeLine(addrs, me, agentId, ph("close")), "Line closed. Your whole stake is back.")}>{btn("close", "Close line, take stake back")}</button>
            </span>}
          </div>
        ) : (
          <>
            <span className="cr-in"><input inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} aria-label="$TRENCHERS to stake" /><b className="mono">$TRENCHERS</b></span>
            <dl className="cr-dl">
              <div><dt>Opens a line of</dt><dd className="mono gold">{eth(lineNew)} ETH</dd></div>
              <div><dt>Rate</dt><dd className="mono">{tok(L.tokensPerEth)} $TRENCHERS per ETH · max {eth(L.maxLine)} ETH</dd></div>
              <div><dt>Wallet</dt><dd className="mono">{tBal === null ? "–" : `${tok(tBal)} $TRENCHERS`}</dd></div>
              <div><dt>New lines left this week</dt><dd className="mono">{eth(L.weeklyRoom, 3)} ETH</dd></div>
            </dl>
          </>
        )}
      </div>
      {!hasStake && (!addrs ? <button type="button" className="nav-mint cr-go cr-go-gold" disabled>Opens at launch</button>
        : !me ? <button type="button" className="nav-mint cr-go cr-go-gold" onClick={w.openModal}>Connect a wallet</button>
        : <button type="button" className="nav-mint cr-go cr-go-gold" disabled={!!busy || !mine || lineNew < P.minLoan} onClick={() => agentId !== null && run("open", () => openLine(addrs, me, agentId, stakeWei, L.backerId, ph("open")), `Line of ${eth(lineNew)} ETH open for agent #${idTxt}.`)}>{btn("open", lineNew < P.minLoan ? `Stake more: the smallest line is ${eth(P.minLoan)} ETH` : `Stake and open a ${eth(lineNew)} ETH line`)}</button>)}
      {!hasStake && <p className="cr-small mono">Three steps in your wallet: approve $TRENCHERS, sign your consent (free, no gas), open the line.</p>}

      {/* 3 · borrow */}
      <div className="cr-block">
        <span className="cr-block-k mono">Borrow ETH{rep ? <em>Available: {eth(avail)} ETH</em> : null}</span>
        <div className="cr-two">
          <span className="cr-in"><input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="ETH to borrow" /><b className="mono">ETH</b></span>
          <label className="cr-term"><span className="mono">For {term} day{term === 1 ? "" : "s"}</span><input type="range" min={1} max={Math.max(1, Math.round(Math.min(L.maxTerm, P.maxTerm) / 86400))} value={term} onChange={(e) => setTerm(Number(e.target.value))} aria-label="Term in days" /></label>
        </div>
        <dl className="cr-dl">
          <div><dt>Fee</dt><dd className="mono">{eth(fee, 6)} ETH ({pct(P.feeBps)} per 30 days)</dd></div>
          <div><dt>You repay</dt><dd className="mono" suppressHydrationWarning>{eth(wei + fee, 6)} ETH by {when(Date.now() / 1000 + term * 86400)}</dd></div>
          <div><dt>Counts toward the score</dt><dd className="mono">{term * 86400 >= P.minScoreTerm ? "Yes, held 7 days or more" : "Repays fine, but only loans held 7+ days build the score"}</dd></div>
        </dl>
        <label className="cr-field cr-to"><span className="mono">Send the ETH to</span><input className="mono" placeholder={me ? `${short(me)} (you)` : "0x…"} value={to} onChange={(e) => setTo(e.target.value.trim())} aria-label="Recipient" /></label>
        {addrs && me && mine && hasStake && (
          <button type="button" className="nav-mint cr-go cr-go-gold" disabled={!!busy || wei === 0n || wei > avail} onClick={() => agentId !== null && run("borrow", () => borrow(addrs, me, agentId, wei, term * 86400, (/^0x[0-9a-fA-F]{40}$/.test(to) ? to : me) as Address, fee + fee / 50n + 1n, ph("borrow")), `Borrowed ${amt} ETH.`)}>{btn("borrow", wei > avail ? "More than the line has free" : `Borrow ${amt} ETH`)}</button>
        )}
      </div>

      {/* 4 · repay */}
      {active.length > 0 && (
        <div className="cr-block">
          <span className="cr-block-k mono">Open loans of agent #{idTxt}</span>
          <ul className="cr-open">
            {active.map((l) => (
              <li key={l.id}>
                <span><b>{eth(l.principal + l.fee, 6)} ETH</b><em className="mono" suppressHydrationWarning>loan #{l.id} · {left(l.dueAt)}</em></span>
                {addrs && me ? <button type="button" className="tbtn" disabled={!!busy} onClick={() => run(`repay${l.id}`, () => repay(addrs, me, l, ph(`repay${l.id}`)), `Loan #${l.id} repaid.`)}>{btn(`repay${l.id}`, "Repay")}</button> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {msg && <Notice ok={msg.ok}>{msg.t}</Notice>}
      <p className="cr-small mono">No agent id yet? Any wallet can register one on the ERC-8004 identity registry; a Trencher can use its own.</p>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------- check an agent */

const SAMPLE_REPORT: Report = { enrolled: true, isBacker: false, defaulted: false, frozen: false, backer: 9001n, line: 5n * 10n ** 16n, available: 0n, principalOut: 5n * 10n ** 16n, activeLoans: 1, loansRepaid: 9, volumeRepaid: 31n * 10n ** 16n, feesPaid: 26n * 10n ** 14n, seasonedRepaid: 7, ethSecondsRepaid: 31n * 10n ** 16n * 9n * 86400n, enrolledAt: Date.now() / 1000 - 41 * 86400, score: 747 };

function RecordPanel({ addrs }: { addrs: CreditAddrs | null }) {
  const [idTxt, setIdTxt] = useState("");
  const [rep, setRep] = useState<Report | null>(null);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const shown = addrs ? rep : SAMPLE_REPORT;
  const sampleLoans = useMemo(() => PREVIEW.recent.filter((l) => l.agentId === 8812n), []);

  const look = () => {
    if (!addrs) return;
    if (!/^\d+$/.test(idTxt)) { setErr("Enter an agent id (a number)."); return; }
    setErr(null); setRep(null); setLoans([]);
    const id = BigInt(idTxt);
    readReport(addrs, id).then(setRep).catch(() => setErr("Couldn't read that agent right now."));
    readLoansOf(addrs, id).then(setLoans).catch(() => {});
  };
  const ethDays = shown ? Number(shown.ethSecondsRepaid / 86400n) / 1e18 : 0;

  return (
    <section className="cr-record" id="record" aria-label="Check an agent">
      <div className="cr-sec-h">
        <p className="cr-k mono"><i>D</i>Check an agent</p>
        <h2>Before you trust, pay or lend to an agent, read its record.</h2>
        <p>Every repayment and every default is on-chain, and the score is worked out from them alone: ETH held for real time and paid back. Anyone can recompute it.</p>
      </div>
      <div className="cr-rec">
        <div className="cr-rec-q">
          <span className="cr-in"><input inputMode="numeric" placeholder={addrs ? "Agent id" : "8812 (sample)"} value={idTxt} onChange={(e) => setIdTxt(e.target.value.replace(/[^\d]/g, ""))} onKeyDown={(e) => e.key === "Enter" && look()} aria-label="Agent id to check" /><b className="mono">#</b></span>
          <button type="button" className="tbtn" onClick={look} disabled={!addrs}>Check</button>
          {err && <Notice>{err}</Notice>}
          {!addrs && <p className="cr-small mono">Preview: a sample agent&apos;s record.</p>}
        </div>
        {shown && (
          <div className="cr-rec-card">
            <Score v={shown.defaulted ? 0 : shown.score} />
            <div className="cr-rec-facts">
              <p className="cr-rec-title"><b>Agent #{addrs ? idTxt : "8812"}</b>{shown.defaulted ? <span className="cr-tag red mono">Defaulted</span> : shown.activeLoans ? <span className="cr-tag mono">Loan open</span> : shown.enrolled ? <span className="cr-tag ok mono">Clean record</span> : <span className="cr-tag mono">No record yet</span>}</p>
              <dl className="cr-grid">
                <div><dt>Loans repaid</dt><dd>{shown.loansRepaid}</dd></div>
                <div><dt>Held 7+ days</dt><dd>{shown.seasonedRepaid}</dd></div>
                <div><dt>ETH repaid</dt><dd>{eth(shown.volumeRepaid)}</dd></div>
                <div><dt>ETH-days</dt><dd>{ethDays.toLocaleString("en-US", { maximumFractionDigits: 2 })}</dd></div>
                <div><dt>Fees paid</dt><dd>{eth(shown.feesPaid, 5)}</dd></div>
                <div><dt>Line</dt><dd>{eth(shown.line)} ETH</dd></div>
                <div><dt>Drawn now</dt><dd>{eth(shown.principalOut)} ETH</dd></div>
                <div><dt>On record since</dt><dd suppressHydrationWarning>{shown.enrolledAt ? new Date(shown.enrolledAt * 1000).toLocaleDateString() : "–"}</dd></div>
              </dl>
            </div>
          </div>
        )}
        {(addrs ? loans : sampleLoans).length > 0 && (
          <ul className="cr-rec-loans">
            {(addrs ? loans : sampleLoans).map((l) => (
              <li key={l.id} className={l.status}><span className="mono">#{l.id}</span><b>{eth(l.principal)} ETH</b><em className="mono" suppressHydrationWarning>{l.status === "active" ? left(l.dueAt) : l.status}</em></li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------- recent loans */

function Loans({ o, addrs, me, onDone }: { o: Overview; addrs: CreditAddrs | null; me: Address | null; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const keep = async (what: string, f: () => Promise<unknown>) => { setBusy(what); try { await f(); onDone(); } catch { /* shown by the wallet */ } setBusy(null); };
  return (
    <section className="cr-loans" id="loans" aria-label="Recent loans">
      <div className="cr-sec-h cr-sec-row">
        <div><p className="cr-k mono"><i>E</i>Loans</p><h2>Recent loans</h2></div>
        {addrs && me && (
          <div className="cr-upkeep">
            <button type="button" className="tbtn" disabled={!!busy || o.lines.feesWaiting === 0n} onClick={() => keep("h", () => harvest(addrs, me))} title="Turns the backers' share of fees into more backing">{busy === "h" ? "…" : `Add ${eth(o.lines.feesWaiting, 5)} ETH of fees to the backing`}</button>
            <button type="button" className="tbtn" disabled={!!busy || o.stats.reserve <= 5n * 10n ** 15n} onClick={() => keep("r", () => sweepReserve(addrs, me))} title="Sends the reserve above 0.005 ETH to the buyback wallet">{busy === "r" ? "…" : "Send the reserve to the buyback"}</button>
          </div>
        )}
      </div>
      {o.recent.length === 0 ? <p className="cr-empty mono">No loans yet. The first one shows up here.</p> : (
        <div className="cr-table" role="table">
          <div className="cr-tr cr-th mono" role="row"><span>Loan</span><span>Agent</span><span>Amount</span><span>Fee</span><span>Taken</span><span>Status</span></div>
          {o.recent.map((l) => (
            <div key={l.id} className={`cr-tr ${l.status}`} role="row">
              <span className="mono">#{l.id}</span>
              <span className="mono">#{l.agentId.toString()}</span>
              <span><b>{eth(l.principal)}</b> ETH</span>
              <span className="mono">{eth(l.fee, 6)}</span>
              <span className="mono" suppressHydrationWarning>{new Date(l.issuedAt * 1000).toLocaleDateString()}</span>
              <span className={`cr-st mono ${l.status}`} suppressHydrationWarning>{l.status === "active" ? left(l.dueAt) : l.status}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------------------------------------- terms, risks */

function Terms({ o }: { o: Overview }) {
  const p = o.params, l = o.lines;
  const rows: [string, string][] = [
    ["Loan size", `${eth(p.minLoan)} to ${eth(p.maxLoan)} ETH`],
    ["Term", `${days(p.minTerm)} to ${days(Math.min(p.maxTerm, l.maxTerm))} on stake lines`],
    ["Fee", `${pct(p.feeBps)} per 30 days, pro rata, fixed when you borrow`],
    ["Where the fee goes", `${pct(10_000 - p.backerFeeBps - p.reserveFeeBps)} lenders · ${pct(p.backerFeeBps)} backers · ${pct(p.reserveFeeBps)} $TRENCHERS buyback`],
    ["Line per stake", `${tok(l.tokensPerEth)} $TRENCHERS per 1 ETH of line, up to ${eth(l.maxLine)} ETH per agent`],
    ["New lines per week", `${eth(l.weeklyRoom + 0n, 3)} ETH left this week`],
    ["Late", `After the due date plus ${days(p.grace)}, anyone can mark the default`],
    ["A default", "The backing pays the pool in full (shared by backers by size), the whole stake is burnt, and the agent and its owner's address can't borrow again"],
    ["Counts toward the score", `Repaid loans held ${days(p.minScoreTerm)} or more`],
    ["Lenders", "Take ETH out any time it isn't lent; 0.5% stays with the pool within 7 days of lending"],
    ["Backers", `Anyone can back the lines for shares. Leaving takes ${days(l.exitDelay)}' notice, and only backing not behind open lines can go; 0.5% stays with the pool within 7 days of the latest new backing`],
    ["Who owns the backing", "The backers who put it in. Only they can take it out; the owner, the timelock and the Safe can't move it"],
    ["Who can change the terms", "A 48-hour timelock run by the Trenchers Safe sets rates, sizes and caps; every change is public before it applies. It can't move lenders' ETH or the backing"],
    ["Emergency stop", "The Safe can stop new loans, new lines and new backing (the pool for up to 14 days); repaying, withdrawing and leaving never stop"],
  ];
  return (
    <section className="cr-terms" id="terms" aria-label="Terms">
      <div className="cr-sec-h"><p className="cr-k mono"><i>F</i>Terms</p><h2>The terms, as the contracts set them</h2></div>
      <dl className="cr-terms-t">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    </section>
  );
}

function Risks() {
  return (
    <section className="cr-risks" aria-label="What can go wrong">
      <h3>What can go wrong</h3>
      <ul>
        <li><b>New contracts.</b> They pass 185 tests, including fuzz and invariant tests, and have had internal reviews. They have not had an external audit. Start small.</li>
        <li><b>For lenders:</b> a default is paid from the backing, not from you, but a bug in the contracts could still put deposits at risk. ETH that is lent out can&apos;t be withdrawn until it is repaid.</li>
        <li><b>For backers:</b> a default is paid from the backing, shared by all backers by size, so your backing can be worth less than you put in. The borrower&apos;s whole stake is burnt and stakes are sized at about twice the line, which makes a default costly, but the burnt $TRENCHERS doesn&apos;t come to you. Leaving takes 7 days, and backing behind open lines can only leave as loans are repaid.</li>
        <li><b>For agents:</b> miss the due date by more than the grace period and the whole stake is burnt for good, the agent can never borrow again, and neither can the owner&apos;s address.</li>
        <li><b>$TRENCHERS moves.</b> The stake-per-ETH rate is set by the timelock and changes with the price; a line already open keeps its size.</li>
      </ul>
      <p className="mono">Read the contracts and tests in the <a href={`${ROUTES.docs}#trenchers-credit`}>docs</a>. Not financial advice.</p>
    </section>
  );
}
