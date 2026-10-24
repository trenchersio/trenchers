"use client";
/**
 * trenchers.io/trenchies before the game opens: sign in with X, earn XP and climb the leaderboard.
 * Follow @trenchersio once, like and reply to its latest posts every day, and link a wallet for XP from using
 * Trenchers (Trencher NFTs, their trades, coins launched, inference bought). Everything is checked by the engine.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, getAddress } from "viem";
import { ENGINE_URL, EXPLORER, ROUTES, chain } from "@/lib/constants";
import { walletProvider } from "@/lib/chain";
import { useWallet } from "@/lib/wallet";
import { ConnectModal } from "@/components/ConnectModal";

type Rules = { follow: number; like: number; reply: number; posts: number; original: number; originalsPerDay: number; nft: number; trade: number; tradesPerDay: number; coin: number; inferencePerUsd: number };
type Post = { id: string; text: string; at: number; liked: boolean; replied: boolean };
type Me = { id: string; handle: string; name: string; avatar: string; xp: number; rank: number; players: number; followed: boolean; account: string; rules: Rules; posts: Post[]; log: { t: number; xp: number; why: string }[]; wallet: string | null; usage: { nfts: number[]; trades: number; coins: string[]; usd: number };
  originals: Original[]; admin: boolean; toReview: number };
type Original = { id: string; url: string; at: number; status: "pending" | "ok" | "no" };
type ReviewRow = Original & { user: string; handle: string; name: string; avatar: string; xp: number; by: string | null };
type Row = { rank: number; handle: string; name: string; avatar: string; xp: number };
const KEY = "trenchies:xp";
const DEF: Rules = { follow: 5, like: 1, reply: 1, posts: 3, original: 15, originalsPerDay: 1, nft: 50, trade: 1, tradesPerDay: 20, coin: 25, inferencePerUsd: 10 };
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

  const [wantLink, setWantLink] = useState(false);
  const linkWallet = async () => {
    if (!me || !session) return;
    if (!w.address) { setWantLink(true); w.openModal(); return; }
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
  // connected from the "Connect wallet" button: carry straight on to the signature
  useEffect(() => { if (wantLink && w.address && me && session) { setWantLink(false); w.closeModal(); void linkWallet(); } }, [wantLink, w.address, me, session]); // eslint-disable-line react-hooks/exhaustive-deps
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
        <h1>Earn Early XP and Win Prizes</h1>
        <p>Trenchies, our upcoming SocialFi meets Web3 Gaming protocol. Make trades, pick memecoin winners, and earn real-world and in-game prizes. Sign in with X, earn XP before the game opens, and climb the leaderboard for a share of the prize pool.</p>
        {!me && (
          <div className="tx-cta">
            <button type="button" className="tx-btn tx-btn-x" onClick={login} disabled={ready === false}><X s={16} />{ready === false ? "Sign-in opens soon" : "Sign in with X"}</button>
            {board && board.players > 0 && <span className="tx-count mono"><i />{n0(board.players)} signed up</span>}
          </div>
        )}
      </section>

      <PrizePool />

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
            <p className="tx-sub">Like and reply to <XLink h={me.account} />&apos;s latest posts: <b>+{rules.like} XP</b> for each like and <b>+{rules.reply} XP</b> for each reply. New posts, new XP.</p>
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

          <OriginalCard me={me} rules={rules} session={session!} onMe={apply} say={say} />

          {me.admin && <ReviewCard session={session!} count={me.toReview} say={say} onDone={() => { void loadMe(session!); loadBoard(); }} />}

          <div className="tx-card">
            <h2>One time</h2>
            <div className="tx-once">
              <div className={`tx-row${me.followed ? " done" : ""}`}>
                <span className="tx-ic"><X s={16} /></span><div><b>Follow <XLink h={me.account} /></b><small>+{rules.follow} XP</small></div>
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
            <li><b className="mono">+{rules.follow}</b><span>Follow <XLink h="trenchersio" /> (once)</span></li>
            <li><b className="mono">+{rules.like}</b><span>Like each of its latest posts, every day</span></li>
            <li><b className="mono">+{rules.reply}</b><span>Reply to each of its latest posts, every day</span></li>
            <li><b className="mono">+{rules.original}</b><span>Write your own post about Trenchies (one a day, checked by the team)</span></li>
            <li><b className="mono">+{rules.nft}</b><span>For every Trencher NFT you hold</span></li>
            <li><b className="mono">+{rules.trade}</b><span>For every trade your Trencher makes</span></li>
            <li><b className="mono">+{rules.coin}</b><span>For every coin you launch</span></li>
            <li><b className="mono">+{rules.inferencePerUsd}</b><span>For every $1 of inference you buy</span></li>
          </ul>
          <p className="tx-fine">The X tasks count as soon as you sign in with X. For NFTs, trades, coins and inference, link your wallet after signing in: one free signature, no transaction. Each NFT and coin counts once, for the first profile that links it.</p>
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
      <ConnectModal />
      {toast && <div className={`tx-toast${toast.good ? " good" : ""}`} role="status">{toast.text}</div>}
    </main>
  );
}

const POST_TEXT = "My Trencher is getting its own land in Trenchies, the game coming to @trenchersio. Earning XP before it opens:";
function OriginalCard({ me, rules, session, onMe, say }: { me: Me; rules: Rules; session: string; onMe: (m: Me) => void; say: (t: string, good?: boolean) => void }) {
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false);
  const today = Math.floor(Date.now() / 86_400_000), used = me.originals.filter((o) => o.status !== "no" && Math.floor(o.at / 86_400_000) === today).length >= rules.originalsPerDay;
  const send = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${ENGINE_URL}/xp/original`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ s: session, url: url.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (j.me) { onMe(j.me); setUrl(""); say("Sent in. The team checks it soon.", true); } else say(j.error ?? "Couldn't send that in.");
    } catch { say("Couldn't reach the server. Try again in a moment."); }
    setBusy(false);
  };
  const label = { pending: "waiting for review", ok: `+${rules.original} XP`, no: "not counted" } as const;
  return (
    <div className="tx-card">
      <h2>Your own post</h2>
      <p className="tx-sub">Write a post about Trenchies from your own account, then paste its link here. The team checks it by hand: <b>+{rules.original} XP</b> once it&apos;s approved, one post a day.</p>
      {used ? <p className="tx-sub">Today&apos;s post is in. Write another one tomorrow.</p> : (<>
        <a className="tx-btn" href={`https://x.com/intent/post?text=${encodeURIComponent(POST_TEXT)}&url=${encodeURIComponent("https://www.trenchers.io/trenchies")}`} target="_blank" rel="noreferrer"><X s={14} />Write a post</a>
        <form className="tx-orig" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={`https://x.com/${me.handle}/status/…`} inputMode="url" aria-label="Link to your post" />
          <button type="submit" className="tx-btn tx-btn-go" disabled={busy || !url.trim()}>{busy ? "Sending…" : "Send in"}</button>
        </form>
      </>)}
      {me.originals.length > 0 && <ol className="tx-origs">{me.originals.map((o) => <li key={o.id} className={o.status}><a href={o.url} target="_blank" rel="noreferrer" className="mono">x.com/…/{o.id.slice(-6)}</a><small className="mono">{ago(o.at)} ago</small><em className="mono">{label[o.status]}</em></li>)}</ol>}
    </div>
  );
}
/** For the team: posts waiting for a yes or no. */
function ReviewCard({ session, count, say, onDone }: { session: string; count: number; say: (t: string, good?: boolean) => void; onDone: () => void }) {
  const [d, setD] = useState<{ pending: ReviewRow[]; recent: ReviewRow[] } | null>(null), [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { fetch(`${ENGINE_URL}/xp/review?s=${encodeURIComponent(session)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (Array.isArray(j.pending)) setD(j); }).catch(() => {}); }, [session]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load, count]);
  const decide = async (r: ReviewRow, ok: boolean) => {
    setBusy(r.id);
    try { const res = await fetch(`${ENGINE_URL}/xp/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ s: session, user: r.user, id: r.id, ok }) }); const j = await res.json(); if (Array.isArray(j.pending)) { setD(j); onDone(); say(ok ? `Approved @${r.handle}'s post` : `Rejected @${r.handle}'s post`, ok); } else say(j.error ?? "Couldn't save that."); }
    catch { say("Couldn't reach the server."); }
    setBusy(null);
  };
  return (
    <div className="tx-card tx-review">
      <h2>Review posts <small className="mono">team only · {d ? d.pending.length : count} waiting</small></h2>
      {!d ? <p className="tx-sub">Loading…</p> : d.pending.length === 0 ? <p className="tx-sub">Nothing waiting.</p> : (
        <ol className="tx-revs">{d.pending.map((r) => (
          <li key={r.id}>
            <Avatar src={r.avatar} name={r.name} size={30} />
            <div className="tx-rev-t"><b>{r.name}</b><small className="mono">@{r.handle} · {n0(r.xp)} XP · {ago(r.at)} ago</small></div>
            <a className="tx-btn tx-btn-sm" href={r.url} target="_blank" rel="noreferrer"><X s={12} />Open</a>
            <button type="button" className="tx-btn tx-btn-sm tx-btn-go" disabled={busy === r.id} onClick={() => void decide(r, true)}>Approve</button>
            <button type="button" className="tx-btn tx-btn-sm" disabled={busy === r.id} onClick={() => void decide(r, false)}>Reject</button>
          </li>))}</ol>
      )}
      {d && d.recent.length > 0 && <details className="tx-fine"><summary>Recently decided ({d.recent.length})</summary><ol className="tx-origs">{d.recent.map((r) => <li key={r.id} className={r.status}><a href={r.url} target="_blank" rel="noreferrer" className="mono">@{r.handle}</a><small className="mono">{r.by ? `by @${r.by}` : ""}</small><em className="mono">{r.status === "ok" ? "approved" : "rejected"}</em></li>)}</ol></details>}
    </div>
  );
}

/** An @handle that opens the X profile. */
function XLink({ h }: { h: string }) { return <a className="tx-xlink" href={`https://x.com/${h}`} target="_blank" rel="noreferrer">@{h}</a>; }

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

/** The giveaway prize pool: the $TRENCHERS in the $TRENCHERS deployer wallet, in USD (live Pons price), plus Trencher NFTs. */
const MILESTONES = [1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const usdK = (v: number) => (v >= 1_000_000 ? `$${+(v / 1_000_000).toFixed(2)}M` : v >= 1_000 ? `$${+(v / 1_000).toFixed(1)}k` : `$${Math.round(v)}`);
function PrizePool() {
  const [g, setG] = useState<{ wallet: string | null; nfts: number; updatedAt: number; trenchers?: number | null; usd?: number | null } | null>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const load = () => fetch(`${ENGINE_URL}/giveaway`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (j && "eth" in j) setG(j); }).catch(() => {});
    load(); const t = setInterval(load, 30_000); return () => clearInterval(t);
  }, []);
  // The meter tracks only the $TRENCHERS held, in USD.
  const usd = g?.usd ?? null, tok = g?.trenchers ?? null;
  const compact = (v: number) => v.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
  // count up to the value once it arrives
  useEffect(() => {
    if (usd === null) return;
    let raf = 0; const from = shown, t0 = performance.now();
    const step = (t: number) => { const k = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - k, 3); setShown(from + (usd - from) * e); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [usd]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = usd === null ? MILESTONES[0] : MILESTONES.find((m) => m > usd) ?? Math.ceil(usd / 1_000_000) * 1_000_000 + 1_000_000;
  const prev = usd === null ? 0 : [0, ...MILESTONES].filter((m) => m <= usd).pop() ?? 0;
  const fill = usd === null ? 0 : Math.max(0.03, Math.min(1, (usd - prev) / (next - prev)));
  const nfts = g?.nfts ?? 10;
  const ago = g?.updatedAt ? Math.max(0, Math.round((Date.now() / 1000 - g.updatedAt) / 60)) : null;
  return (
    <section className="tx-pool" aria-label="Giveaway prize pool">
      <div className="tx-pool-h"><span className="tx-pool-chip mono"><i />Giveaway prize pool</span>{ago !== null && <small className="mono">live · updated {ago < 1 ? "just now" : `${ago} min ago`}</small>}</div>
      <div className="tx-pool-big">
        <b className="mono">{usd === null ? "…" : `$${Math.round(shown).toLocaleString("en-US")}`}<span> USD</span></b>
        <em>+ {nfts} Trencher NFTs</em>
      </div>
      {tok !== null && <div className="tx-pool-split mono"><span><i className="tr" />{compact(tok)} $TRENCHERS</span></div>}
      <div className="tx-meter" role="meter" aria-valuemin={prev} aria-valuemax={next} aria-valuenow={usd ?? 0} aria-label="Prize pool in USD">
        <i style={{ width: `${fill * 100}%` }} />
        {Array.from({ length: 9 }, (_, k) => <s key={k} style={{ left: `${(k + 1) * 10}%` }} />)}
      </div>
      <div className="tx-meter-k mono"><span>{usdK(prev)}</span><span>next: {usdK(next)}</span></div>
      <p className="tx-fine">$TRENCHERS held in the $TRENCHERS deployer wallet, valued in USD at the live Pons price{g?.wallet && <> <a className="mono" href={`${EXPLORER}/address/${g.wallet}`} target="_blank" rel="noreferrer">{g.wallet.slice(0, 6)}…{g.wallet.slice(-4)} ↗</a></>}. Earn XP to be in the running.</p>
    </section>
  );
}
