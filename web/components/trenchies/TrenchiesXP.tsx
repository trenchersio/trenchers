"use client";
/**
 * trenchers.io/trenchies before the game opens: sign in with X, earn XP and climb the leaderboard.
 * Follow @trenchersio once, like and reply to its latest posts every day, and link a wallet for XP from using
 * Trenchers (Trencher NFTs, their trades, coins launched, inference bought). Everything is checked by the engine.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, getAddress } from "viem";
import { ENGINE_URL, ROUTES, chain } from "@/lib/constants";
import { walletProvider } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";

type Rules = { follow: number; like: number; reply: number; posts: number; nft: number; trade: number; tradesPerDay: number; coin: number; inferencePerUsd: number };
type Post = { id: string; text: string; at: number; liked: boolean; replied: boolean };
type Me = { id: string; handle: string; name: string; avatar: string; xp: number; rank: number; players: number; followed: boolean; account: string; rules: Rules; posts: Post[]; log: { t: number; xp: number; why: string }[]; wallet: string | null; usage: { nfts: number[]; trades: number; coins: string[]; usd: number } };
type Row = { rank: number; handle: string; name: string; avatar: string; xp: number };
const KEY = "trenchies:xp";
const DEF: Rules = { follow: 10, like: 1, reply: 1, posts: 3, nft: 50, trade: 1, tradesPerDay: 20, coin: 25, inferencePerUsd: 10 };
const linkText = (handle: string, wallet: string, time: string) => `Link this wallet to Trenchies XP\n\nX: @${handle}\nWallet: ${wallet}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;
const ago = (t: number) => { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`; };
const n0 = (v: number) => v.toLocaleString("en-US");

function Avatar({ src, name, size = 36 }: { src: string; name: string; size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img className="tx-av" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} /> : <span className="tx-av tx-av-l" style={{ width: size, height: size }}>{name.slice(0, 1).toUpperCase()}</span>;
}
const X = ({ s = 14 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.4 4.7H5.5z" /></svg>;

export function TrenchiesXP() {
  const [session, setSession] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState<boolean | null>(null);
  const [rules, setRules] = useState<Rules>(DEF);
  const [board, setBoard] = useState<{ players: number; top: Row[] } | null>(null);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; good?: boolean } | null>(null);
  const [pop, setPop] = useState<{ n: number; k: number } | null>(null);
  const w = useWallet();
  const say = (text: string, good = false) => { setToast({ text, good }); setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4200); };

  // sign-in comes back as #xp=<session>
  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    let s: string | null = h.get("xp");
    if (s) { try { localStorage.setItem(KEY, s); } catch { /* */ } history.replaceState(null, "", window.location.pathname + window.location.search); }
    else { try { s = localStorage.getItem(KEY); } catch { /* */ } }
    if (h.get("xp-error")) setTimeout(() => say(h.get("xp-error") === "cancelled" ? "Sign-in was cancelled." : "X sign-in didn't work. Try again."), 300);
    if (s && Number(s.split(".")[1]) > Date.now()) setSession(s);
    fetch(`${ENGINE_URL}/xp/status`, { cache: "no-store" }).then((r) => r.json()).then((j: { ready: boolean; rules: Rules }) => { setReady(j.ready); if (j.rules) setRules(j.rules); }).catch(() => setReady(false));
  }, []);
  const loadBoard = useCallback(() => { fetch(`${ENGINE_URL}/xp/board`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j && Array.isArray(j.top)) setBoard(j); }).catch(() => {}); }, []);
  useEffect(() => { loadBoard(); const t = setInterval(loadBoard, 60_000); return () => clearInterval(t); }, [loadBoard]);
  const apply = useCallback((next: Me) => setMe((prev) => { if (prev && next.xp > prev.xp) setPop({ n: next.xp - prev.xp, k: Date.now() }); return next; }), []);
  const loadMe = useCallback(async (s: string) => {
    const r = await fetch(`${ENGINE_URL}/xp/me?s=${encodeURIComponent(s)}`, { cache: "no-store" });
    if (r.status === 401) { try { localStorage.removeItem(KEY); } catch { /* */ } setSession(null); setMe(null); return; }
    const j = await r.json(); if (j.me) { apply(j.me); setRules(j.me.rules); }
  }, [apply]);
  useEffect(() => { if (session) void loadMe(session).catch(() => {}); }, [session, loadMe]);

  const check = useCallback(async (task: string, quiet = false) => {
    if (!session) return;
    setBusy(task);
    try {
      const r = await fetch(`${ENGINE_URL}/xp/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ s: session, task }) });
      const j = await r.json().catch(() => ({}));
      if (j.me) apply(j.me);
      if (j.ok) { setPending((p) => { const n = { ...p }; delete n[task]; return n; }); loadBoard(); }
      else if (!quiet) say(j.msg ?? j.error ?? "Couldn't check that right now.");
    } catch { if (!quiet) say("Couldn't reach the server. Try again in a moment."); }
    setBusy(null);
  }, [session, apply, loadBoard]);
  // come back from X: check whatever was just done
  useEffect(() => {
    const back = () => { if (document.visibilityState !== "visible") return; const now = Date.now(); for (const [task, at] of Object.entries(pending)) if (now - at > 5500 && now - at < 10 * 60_000) void check(task, true); };
    document.addEventListener("visibilitychange", back); window.addEventListener("focus", back);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [pending, check]);
  const open = (url: string, task: string) => {
    window.open(url, "_blank", "noopener"); setPending((p) => ({ ...p, [task]: Date.now() }));
    if (session) void fetch(`${ENGINE_URL}/xp/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ s: session, task }) }).catch(() => {});
  };

  const linkWallet = async () => {
    if (!me || !session) return;
    if (!w.address) { w.openModal(); return; }
    setBusy("wallet");
    try {
      const a = getAddress(w.address), time = new Date().toISOString(), p = await walletProvider();
      const signature = await createWalletClient({ chain, transport: custom(p) }).signMessage({ account: a, message: linkText(me.handle, a, time) });
      const r = await fetch(`${ENGINE_URL}/xp/wallet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ s: session, address: a, time, signature }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Couldn't link the wallet.");
      apply(j.me); loadBoard(); say("Wallet linked.", true);
    } catch (e) { const m = String((e as Error).message ?? e); say(/reject|denied/i.test(m) ? "Cancelled in your wallet." : m.split("\n")[0]); }
    setBusy(null);
  };
  const signOut = () => { try { localStorage.removeItem(KEY); } catch { /* */ } setSession(null); setMe(null); };
  const login = () => { window.location.href = `${ENGINE_URL}/xp/login?ret=${encodeURIComponent(`${window.location.origin}${window.location.pathname}`)}`; };

  const daily = me ? me.posts.reduce((a, p) => a + (p.liked ? rules.like : 0) + (p.replied ? rules.reply : 0), 0) : 0;
  const dailyMax = me ? me.posts.length * (rules.like + rules.reply) : 0;
  const meRow = useMemo(() => board?.top.find((r) => me && r.handle === me.handle), [board, me]);

  return (
    <main className="tx">
      <header className="tx-top">
        <a className="tx-back mono" href={ROUTES.home}>← trenchers.io</a>
        {me && <button type="button" className="tx-ghost mono" onClick={signOut}>Sign out</button>}
      </header>

      <section className="tx-hero">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="tx-logo" src="/trenchies/logo.webp" alt="Trenchies" width={420} height={140} />
        <h1>Earn XP before the game opens</h1>
        <p>Trenchies is the game coming to Trenchers: your Trencher becomes a little character with its own land to build. Sign in with X, collect XP now and climb the early leaderboard.</p>
        {!me && (
          <div className="tx-cta">
            <button type="button" className="tx-btn tx-btn-x" onClick={login} disabled={ready === false}><X s={16} />{ready === false ? "Sign-in opens soon" : "Sign in with X"}</button>
            {board && board.players > 0 && <span className="tx-count mono"><i />{n0(board.players)} signed up</span>}
          </div>
        )}
      </section>

      {me && (
        <section className="tx-me">
          <div className="tx-card tx-prof">
            <Avatar src={me.avatar} name={me.name} size={64} />
            <div className="tx-prof-t"><b>{me.name}</b><span className="mono">@{me.handle}</span></div>
            <div className="tx-xp">
              <span className="mono">YOUR XP</span><b className="mono">{n0(me.xp)}</b>
              {pop && <em key={pop.k} className="tx-pop mono">+{pop.n}</em>}
            </div>
            <div className="tx-rank"><span className="mono">RANK</span><b className="mono">#{me.rank}</b><small>of {n0(me.players)}</small></div>
          </div>

          <div className="tx-card">
            <h2>Every day</h2>
            <p className="tx-sub">Like and reply to @{me.account}&apos;s latest posts: <b>+{rules.like} XP</b> for each like and <b>+{rules.reply} XP</b> for each reply. New posts, new XP.</p>
            <div className="tx-prog"><i style={{ width: `${dailyMax ? (daily / dailyMax) * 100 : 0}%` }} /><span className="mono">{daily}/{dailyMax} XP from these posts</span></div>
            {me.posts.length === 0 ? <p className="tx-sub">No posts to do right now. Check back soon.</p> : (
              <ol className="tx-posts">
                {me.posts.map((p) => (
                  <li key={p.id}>
                    <a className="tx-post" href={`https://x.com/${me.account}/status/${p.id}`} target="_blank" rel="noreferrer"><X s={12} /><span>{p.text.length > 160 ? `${p.text.slice(0, 157)}…` : p.text}</span><small className="mono">{ago(p.at)}</small></a>
                    <div className="tx-acts">
                      <Task done={p.liked} label="Like" xp={rules.like} wait={!!pending[`like:${p.id}`]} busy={busy === `like:${p.id}`} go={() => open(`https://x.com/intent/like?tweet_id=${p.id}`, `like:${p.id}`)} check={() => void check(`like:${p.id}`)} />
                      <Task done={p.replied} label="Reply" xp={rules.reply} wait={!!pending[`reply:${p.id}`]} busy={busy === `reply:${p.id}`} go={() => open(`https://x.com/intent/tweet?in_reply_to=${p.id}`, `reply:${p.id}`)} check={() => void check(`reply:${p.id}`)} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="tx-card">
            <h2>One time</h2>
            <div className="tx-once">
              <div className={`tx-row${me.followed ? " done" : ""}`}>
                <span className="tx-ic"><X s={16} /></span><div><b>Follow @{me.account}</b><small>+{rules.follow} XP</small></div>
                <Task done={me.followed} label="Follow" xp={rules.follow} wait={!!pending.follow} busy={busy === "follow"} go={() => open(`https://x.com/intent/follow?screen_name=${me.account}`, "follow")} check={() => void check("follow")} />
              </div>
            </div>
          </div>

          <div className="tx-card">
            <h2>Use Trenchers</h2>
            <p className="tx-sub">Link your wallet once and XP keeps coming in as you use Trenchers.</p>
            <div className="tx-uses">
              <Use n={me.usage.nfts.length} xp={me.usage.nfts.length * rules.nft} title="Trencher NFTs" text={`+${rules.nft} XP each`} href={ROUTES.market} cta="Get one" />
              <Use n={me.usage.trades} xp={me.usage.trades * rules.trade} title="Trades by your Trencher" text={`+${rules.trade} XP each, up to ${rules.tradesPerDay} a day`} href={ROUTES.agents} cta="Set it up" />
              <Use n={me.usage.coins.length} xp={me.usage.coins.length * rules.coin} title="Coins launched" text={`+${rules.coin} XP each`} href={ROUTES.launcher} cta="Launch" />
              <Use n={me.usage.usd} xp={me.usage.usd * rules.inferencePerUsd} title="Inference bought" text={`+${rules.inferencePerUsd} XP per $1`} href={ROUTES.inference} cta="Buy" unit="$" />
            </div>
            {me.wallet ? <p className="tx-fine mono">Linked: {me.wallet.slice(0, 6)}…{me.wallet.slice(-4)} · updates every 10 minutes</p>
              : <button type="button" className="tx-btn tx-btn-go" onClick={linkWallet} disabled={busy === "wallet"}>{busy === "wallet" ? "Check your wallet…" : w.address ? "Link this wallet (free signature)" : "Connect wallet"}</button>}
          </div>

          {me.log.length > 0 && (
            <div className="tx-card">
              <h2>Recent XP</h2>
              <ol className="tx-log">{me.log.map((l, i) => <li key={i}><b className="mono">+{l.xp}</b><span>{l.why}</span><small className="mono">{ago(l.t)}</small></li>)}</ol>
            </div>
          )}
        </section>
      )}

      {!me && (
        <section className="tx-how">
          <h2>How to earn</h2>
          <ul>
            <li><b className="mono">+{rules.follow}</b><span>Follow @trenchersio (once)</span></li>
            <li><b className="mono">+{rules.like}</b><span>Like each of its latest posts, every day</span></li>
            <li><b className="mono">+{rules.reply}</b><span>Reply to each of its latest posts, every day</span></li>
            <li><b className="mono">+{rules.nft}</b><span>For every Trencher NFT you hold</span></li>
            <li><b className="mono">+{rules.trade}</b><span>For every trade your Trencher makes</span></li>
            <li><b className="mono">+{rules.coin}</b><span>For every coin you launch</span></li>
            <li><b className="mono">+{rules.inferencePerUsd}</b><span>For every $1 of inference you buy</span></li>
          </ul>
        </section>
      )}

      <section className="tx-board">
        <h2>Leaderboard <small className="mono">{board ? `${n0(board.players)} players` : ""}</small></h2>
        {!board ? <p className="tx-sub">Loading…</p> : board.top.length === 0 ? <p className="tx-sub">No one yet. Be the first.</p> : (
          <ol>
            {board.top.map((r) => (
              <li key={r.handle} className={`${r.rank <= 3 ? `top t${r.rank}` : ""}${me && r.handle === me.handle ? " me" : ""}`}>
                <span className="tx-rk mono">{r.rank}</span><Avatar src={r.avatar} name={r.name} size={30} />
                <a href={`https://x.com/${r.handle}`} target="_blank" rel="noreferrer" className="tx-bn"><b>{r.name}</b><small className="mono">@{r.handle}</small></a>
                <em className="mono">{n0(r.xp)} XP</em>
              </li>
            ))}
            {me && !meRow && <li className="me"><span className="tx-rk mono">{me.rank}</span><Avatar src={me.avatar} name={me.name} size={30} /><span className="tx-bn"><b>{me.name}</b><small className="mono">@{me.handle}</small></span><em className="mono">{n0(me.xp)} XP</em></li>}
          </ol>
        )}
      </section>
      {toast && <div className={`tx-toast${toast.good ? " good" : ""}`} role="status">{toast.text}</div>}
    </main>
  );
}

function Task({ done, label, xp, wait, busy, go, check }: { done: boolean; label: string; xp: number; wait: boolean; busy: boolean; go: () => void; check: () => void }) {
  if (done) return <span className="tx-done mono">✓ +{xp}</span>;
  if (wait) return <button type="button" className="tx-btn tx-btn-sm tx-btn-go" onClick={check} disabled={busy}>{busy ? "Checking…" : "Check"}</button>;
  return <button type="button" className="tx-btn tx-btn-sm" onClick={go}>{label} <span className="mono">+{xp}</span></button>;
}
function Use({ n, xp, title, text, href, cta, unit = "" }: { n: number; xp: number; title: string; text: string; href: string; cta: string; unit?: string }) {
  return (
    <div className="tx-use">
      <b className="mono">{unit}{n0(n)}</b><span>{title}</span><small>{text}</small>
      {xp > 0 ? <em className="mono">+{n0(xp)} XP</em> : <a className="mono" href={href}>{cta} →</a>}
    </div>
  );
}
