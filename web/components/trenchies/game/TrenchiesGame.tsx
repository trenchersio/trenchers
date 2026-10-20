"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, getAddress, type Address } from "viem";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { artPalette, loadArt } from "@/lib/art-vector";
import { ownedTrenchers, walletProvider } from "@/lib/chain";
import { ENGINE_URL, ROUTES, chain } from "@/lib/constants";
import { useWallet } from "@/lib/wallet";
import { GATHER, HAT_TRICK_XP, HOUSE_ORDER, ITEMS, PICKS, PLAY_XP, RANK_XP, X_XP, item, levelOf, xpFor, type Item, type ItemKind, type Resource } from "@/lib/trenchies-catalog";
import { Icon } from "./icons";
import { Land } from "./Land";
import type { Look, Palette } from "./types";

// ------------------------------------------------------------------ types + api
type Pick = { token: string; symbol: string; pct: number | null; rank: number | null };
type Result = { round: number; picks: Pick[]; xp: number; parts: { label: string; xp: number }[]; at: number };
type Pub = { name: string; nft: number; level: number; xp: number; streak: number; hits: number; wins: number; hatTricks: number; rounds: number; items: string[]; house: string; vehicle: string; x: string | null };
type Me = Pub & {
  bricks: number; held: boolean; wood: number; stone: number; next: { wood: number; stone: number }; xPending: { handle: string; code: string } | null;
  open: { round: number; label: string; lockAt: number; picks: { token: string; symbol: string }[] };
  live: { round: number; label: string; endsAt: number; dataAt: number; players: number; picks: { token: string; symbol: string; pct: number | null; place: number | null }[]; top: { token: string; symbol: string; pct: number | null; by: number }[] };
  last: { round: number; label: string; top: { token: string; symbol: string; pct: number | null }[]; players: number } | null;
  results: Result[]; unseen: Result | null;
};
type Coin = { token: string; symbol: string; price: number; changePct: number; volEth: number; trades: number };
type Panel = "picks" | "results" | "build" | "board" | "visit" | "rules" | "me";
const API = `${ENGINE_URL}/trenchies/`;
const loginText = (addr: string, time: string) => `Sign in to Trenchies\n\nWallet: ${addr}\nTime: ${time}\n\nThis only proves you hold this wallet. It costs nothing and sends no transaction.`;
const tokKey = (a: string) => `trenchies:token:${a.toLowerCase()}`;
const FALLBACK: Palette = { bg: "#141a17", main: "#39ff88", second: "#2b8a57", sig: "#ffd84d", eye: "#ffffff" };
const pct = (v: number | null, d = 1) => (v === null ? "–" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
const n0 = (v: number) => v.toLocaleString("en-US");
const PLACE = ["1st", "2nd", "3rd"];
function left(ts: number, now: number) { const s = Math.max(0, Math.floor(ts - now)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; }

function useNow() { const [n, setN] = useState(() => Date.now() / 1000); useEffect(() => { const t = setInterval(() => setN(Date.now() / 1000), 1000); return () => clearInterval(t); }, []); return n; }
function usePalette(nft: number | null) {
  const [p, setP] = useState<Palette>(FALLBACK);
  useEffect(() => { if (!nft) return; loadArt().then(() => { const x = artPalette(nft); if (x) setP(x); }).catch(() => {}); }, [nft]);
  return p;
}
const DOCK: [Panel, string, string][] = [["picks", "target", "Picks"], ["results", "chart", "Results"], ["build", "build", "Build"], ["board", "ranks", "Ranks"], ["visit", "users", "Visit"], ["rules", "info", "Rules"], ["me", "user", "Me"]];

// ------------------------------------------------------------------ the game
export function TrenchiesGame() {
  const w = useWallet();
  const addr = w.address as Address | null;
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [phase, setPhase] = useState<"boot" | "signin" | "invite" | "spawn" | "play">("boot");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [visiting, setVisiting] = useState<Pub | null>(null);
  const [party, setParty] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [levelUp, setLevelUp] = useState<number | null>(null);
  const [gathered, setGathered] = useState<{ res: Resource; got: number; n: number } | null>(null);
  const [gathering, setGathering] = useState<Resource | null>(null);
  const now = useNow();

  const call = useCallback(async (op: string, body?: Record<string, unknown>, get?: Record<string, string>) => {
    const q = new URLSearchParams({ ...(get ?? {}), token: token ?? "" });
    const r = await fetch(body ? API + op : `${API}${op}?${q}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, token }) } : undefined);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { try { if (addr) localStorage.removeItem(tokKey(addr)); } catch { /* */ } setToken(null); setPhase("signin"); }
    if (!r.ok) throw new Error(j.error ?? "Something went wrong. Try again.");
    return j;
  }, [token, addr]);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 3200); };
  const apply = (next: Me) => setMe((prev) => { if (prev && next.level > prev.level) setLevelUp(next.level); return next; });

  useEffect(() => {
    setMe(null); setToken(null); setVisiting(null);
    if (!addr) { setPhase("boot"); return; }
    let t: string | null = null; try { t = localStorage.getItem(tokKey(addr)); } catch { /* */ }
    if (!t || Number(t.split(".")[1]) < Date.now()) { setPhase("signin"); return; }
    setToken(t);
  }, [addr]);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = () => fetch(`${API}state?token=${encodeURIComponent(token)}`).then(async (r) => {
      if (!alive) return;
      if (r.status === 401) { setPhase("signin"); setToken(null); return; }
      const j = await r.json(); if (j.me) { apply(j.me); setPhase("play"); } else setPhase("spawn");
    }).catch(() => {});
    load(); const iv = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, [token]);

  const signIn = async () => {
    if (!addr) return; setBusy(true); setErr(null);
    try {
      const p = await walletProvider(), a = getAddress(addr), time = new Date().toISOString();
      const signature = await createWalletClient({ chain, transport: custom(p) }).signMessage({ account: a, message: loginText(a, time) });
      const r = await fetch(API + "login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: a, time, signature }) });
      const j = await r.json();
      if (r.status === 403) { setPhase("invite"); return; }
      if (!r.ok) throw new Error(j.error ?? "Sign-in failed.");
      try { localStorage.setItem(tokKey(addr), j.token); } catch { /* */ }
      setToken(j.token);
      if (j.me) { apply(j.me); setPhase("play"); } else setPhase("spawn");
    } catch (e) { const m = String((e as Error).message ?? e); setErr(/reject|denied/i.test(m) ? "Cancelled in your wallet." : m.split("\n")[0]); }
    finally { setBusy(false); }
  };
  const gather = async (res: Resource) => {
    setGathering(res);
    try { const j = await call("gather", { res }); apply(j.me); setGathered({ res, got: j.got, n: Date.now() }); say(`+${j.got} ${res} · +${j.xp} XP`); }
    catch (e) { say((e as Error).message); }
    setGathering(null);
  };

  const palette = usePalette(visiting?.nft ?? me?.nft ?? null);
  const subject = visiting ?? me;
  const look: Look | null = useMemo(() => subject ? { name: subject.name, house: subject.house, vehicle: subject.vehicle, items: subject.items, palette, trophies: subject.hits, level: subject.level, x: subject.x } : null, [subject, palette]);
  const grow = useMemo(() => (!visiting && me ? { wood: me.next.wood, stone: me.next.stone } : { wood: 0, stone: 0 }), [visiting, me]);

  if (phase === "boot" || !addr) return (
    <Splash>
      <p className="tg-lede">Spawn your Trenchie, pick tomorrow&apos;s top coins, and build out your own land.</p>
      <button type="button" className="tg-btn tg-btn-go" onClick={w.openModal}>Connect wallet</button>
      <HowShort />
    </Splash>
  );
  if (phase === "signin") return (
    <Splash>
      <p className="tg-lede">Sign in with your wallet. It&apos;s one free signature, no transaction.</p>
      <button type="button" className="tg-btn tg-btn-go" onClick={signIn} disabled={busy}>{busy ? "Check your wallet…" : "Sign in to play"}</button>
      {err && <p className="tg-err">{err}</p>}
    </Splash>
  );
  if (phase === "invite") return (
    <Splash>
      <p className="tg-lede">Trenchies is invite-only while we build it. Join the waitlist to be among the first in.</p>
      <a className="tg-btn tg-btn-go" href={ROUTES.trenchies}>Join the waitlist</a>
    </Splash>
  );
  if (phase === "spawn" || !me || !look) return <Spawn me={addr} existing={me} onDone={(m) => { apply(m); setPhase("play"); setParty((p) => p + 1); setPanel(null); }} call={call} />;

  const level = levelOf(me.xp), lo = xpFor(level), hi = xpFor(level + 1), prog = Math.max(0, Math.min(1, (me.xp - lo) / Math.max(1, hi - lo)));
  const needPicks = me.open.picks.length < PICKS;

  return (
    <div className="tg">
      <Land key={visiting ? `v-${visiting.name}` : "home"} look={look} nft={subject!.nft} celebrate={party} grow={grow} now={now} mine={!visiting} onGather={gather} gathered={visiting ? null : gathered} busy={gathering} />

      <header className="tg-hud">
        <div className="tg-hud-l">
          <a className="tg-card tg-home" href={ROUTES.home} title="Back to trenchers.io" aria-label="Back to trenchers.io"><Icon n="home" size={15} /></a>
          <button type="button" className="tg-card tg-who" onClick={() => setPanel("me")}>
            <ArtCanvas id={me.nft} size={34} />
            <span className="tg-who-t">
              <b>{me.name}</b>
              <span className="tg-lv"><span className="tg-lvb">Lv {level}</span><span className="tg-bar"><i style={{ width: `${prog * 100}%` }} /></span><small>{n0(me.xp - lo)} / {n0(hi - lo)}</small></span>
            </span>
          </button>
        </div>
        <div className="tg-stats">
          <span className="tg-card tg-stat" title="Bricks: every XP you earn adds one"><Icon n="brick" size={14} /><b>{n0(me.bricks)}</b></span>
          <span className="tg-card tg-stat" title="Wood: chop the tree on your land"><Icon n="wood" size={14} /><b>{n0(me.wood)}</b></span>
          <span className="tg-card tg-stat" title="Stone: mine the rock on your land"><Icon n="stone" size={14} /><b>{n0(me.stone)}</b></span>
          <span className={`tg-card tg-stat${me.streak > 1 ? " hot" : ""}`} title="Days in a row"><Icon n="flame" size={14} /><b>{me.streak}</b></span>
          <button type="button" className={`tg-card tg-stat tg-lock${needPicks ? " urgent" : ""}`} onClick={() => setPanel("picks")}><Icon n="clock" size={14} /><span>{needPicks ? "Pick before" : "Locked in"}</span><b className="mono">{left(me.open.lockAt, now)}</b></button>
        </div>
      </header>

      {visiting && <div className="tg-visit-bar"><span>Visiting <b>{visiting.name}</b> · Lv {visiting.level}{visiting.x ? ` · @${visiting.x}` : ""}</span><button type="button" className="tg-btn tg-btn-sm" onClick={() => setVisiting(null)}>Back home</button></div>}
      {!me.held && <div className="tg-warn">Trencher #{me.nft} isn&apos;t in this wallet any more. <button type="button" className="linkish" onClick={() => setPanel("me")}>Move your Trenchie</button></div>}

      <nav className="tg-dock" aria-label="Trenchies">
        {DOCK.map(([k, ic, l]) => (
          <button key={k} type="button" className={`tg-dk${panel === k ? " on" : ""}`} onClick={() => setPanel(panel === k ? null : k)}>
            <Icon n={ic} size={18} /><span>{l}</span>{k === "picks" && needPicks && <i className="tg-dot" />}
          </button>
        ))}
      </nav>

      {panel && (
        <aside className="tg-panel" role="dialog" aria-label={panel}>
          <button type="button" className="tg-x" aria-label="Close" onClick={() => setPanel(null)}><Icon n="close" size={14} /></button>
          {panel === "picks" && <PicksPanel me={me} now={now} call={call} onSaved={(m) => { apply(m); say(`Picks locked in for ${m.open.label}`); }} />}
          {panel === "results" && <ResultsPanel me={me} />}
          {panel === "build" && <ShopPanel me={me} call={call} onDone={(m, it) => { apply(m); setParty((p) => p + 1); say(`${it.name} added to your land`); }} />}
          {panel === "board" && <BoardPanel call={call} onVisit={(p) => { setVisiting(p); setPanel(null); }} />}
          {panel === "visit" && <VisitPanel call={call} onVisit={(p) => { setVisiting(p); setPanel(null); }} />}
          {panel === "rules" && <RulesPanel />}
          {panel === "me" && <ProfilePanel me={me} call={call} onMe={(m, bonus) => { apply(m); if (bonus) { setParty((p) => p + 1); say(`X linked: +${bonus} XP`); } }} onRespawn={() => setPhase("spawn")} />}
        </aside>
      )}

      {me.unseen && !visiting && <Reveal r={me.unseen} onCollect={async () => { const r = me.unseen!; await call("seen", { round: r.round }).catch(() => {}); setMe({ ...me, unseen: null }); if (r.xp > 10) setParty((p) => p + 1); }} />}
      {levelUp && <LevelUp level={levelUp} onClose={() => setLevelUp(null)} />}
      {toast && <div className="tg-toast" role="status">{toast}</div>}
    </div>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div className="tg-splash">
      <a className="tg-back" href={ROUTES.home}><Icon n="home" size={14} />trenchers.io</a>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/trenchies/logo.webp" alt="Trenchies" className="tg-logo" />
      {children}
    </div>
  );
}
function HowShort() {
  return (
    <ol className="tg-how-s">
      <li><Icon n="target" size={16} /><b>Pick 3 coins</b><span>before 00:00 UTC for the next day</span></li>
      <li><Icon n="chart" size={16} /><b>Earn XP</b><span>for every pick in the day&apos;s top 3</span></li>
      <li><Icon n="build" size={16} /><b>Build your land</b><span>rooms, rides, garden, pets</span></li>
    </ol>
  );
}

// ------------------------------------------------------------------ spawn
function Spawn({ me, existing, onDone, call }: { me: Address; existing: Me | null; onDone: (m: Me) => void; call: (op: string, b?: Record<string, unknown>) => Promise<{ me: Me }> }) {
  const [ids, setIds] = useState<number[] | null>(null);
  const [pick, setPick] = useState<number | null>(existing?.nft ?? null);
  const [name, setName] = useState(existing?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { ownedTrenchers(me).then((x) => { setIds(x); setPick((p) => p ?? x[0] ?? null); if (!name && x[0]) setName(`Trenchie${x[0]}`); }).catch(() => setIds([])); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);
  const go = async () => { if (!pick) return; setBusy(true); setErr(null); try { const j = await call("spawn", { nft: pick, name: name.trim() }); onDone(j.me); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  return (
    <div className="tg-splash tg-spawn">
      <a className="tg-back" href={ROUTES.home}><Icon n="home" size={14} />trenchers.io</a>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/trenchies/symbol.webp" alt="" className="tg-sym" />
      <h1>{existing ? "Move your Trenchie" : "Spawn your Trenchie"}</h1>
      <p className="tg-lede">{existing ? "Pick another Trencher you hold. Your XP, bricks and land come along." : "Pick the Trencher it's born from. Your Trenchie wears its colours."}</p>
      {ids === null ? <p className="tg-lede">Finding your Trenchers…</p> : ids.length === 0 ? <p className="tg-err">This wallet doesn&apos;t hold a Trencher. You need one to spawn a Trenchie.</p> : (
        <div className="tg-nfts">{ids.slice(0, 24).map((id) => <button key={id} type="button" className={`tg-nft${pick === id ? " on" : ""}`} onClick={() => setPick(id)}><ArtCanvas id={id} size={72} /><span>#{id}</span></button>)}</div>
      )}
      <label className="tg-name"><span>Name your Trenchie</span><input value={name} maxLength={16} onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))} placeholder="3 to 16 letters" /></label>
      <button type="button" className="tg-btn tg-btn-go" onClick={go} disabled={busy || !pick || name.length < 3}>{busy ? "Spawning…" : existing ? "Move in" : "Spawn"}</button>
      {err && <p className="tg-err">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ picks
function PicksPanel({ me, now, call, onSaved }: { me: Me; now: number; call: (op: string, b?: Record<string, unknown>, q?: Record<string, string>) => Promise<{ me: Me; coins?: Coin[]; popular?: { token: string; symbol: string; count: number }[]; dataAt?: number }>; onSaved: (m: Me) => void }) {
  const [sel, setSel] = useState(me.open.picks);
  const [coins, setCoins] = useState<Coin[] | null>(null);
  const [popular, setPopular] = useState<{ token: string; symbol: string; count: number }[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { call("coins", undefined, {}).then((j) => { setCoins(j.coins ?? []); setPopular(j.popular ?? []); }).catch((e) => setErr(e.message)); }, [call]);
  const list = (coins ?? []).filter((c) => !q || c.symbol.toLowerCase().includes(q.toLowerCase()) || c.token.includes(q.toLowerCase()));
  const toggle = (c: { token: string; symbol: string }) => setSel((s) => (s.some((x) => x.token === c.token) ? s.filter((x) => x.token !== c.token) : s.length >= PICKS ? s : [...s, c]));
  const changed = sel.map((x) => x.token).sort().join() !== me.open.picks.map((x) => x.token).sort().join();
  const save = async () => { setBusy(true); setErr(null); try { const j = await call("picks", { tokens: sel.map((x) => x.token) }); onSaved(j.me); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Daily picks</p><h2>Pick tomorrow&apos;s top 3</h2></header>
      <p className="tg-sub">For <b>{me.open.label}</b> (UTC), locks in <b className="mono">{left(me.open.lockAt, now)}</b>. Each of your picks that finishes in the day&apos;s top 3 earns <b>{RANK_XP.join(" / ")} XP</b>.</p>
      <div className="tg-slots">
        {Array.from({ length: PICKS }, (_, i) => sel[i]).map((c, i) => (
          <button key={i} type="button" className={`tg-slot${c ? " full" : ""}`} onClick={() => c && toggle(c)} title={c ? "Tap to remove" : "Pick a coin below"}>
            {c ? <><Avatar s={c.symbol} /><b>${c.symbol}</b><small>remove</small></> : <><span className="tg-slot-n">{i + 1}</span><small>empty</small></>}
          </button>
        ))}
      </div>
      <button type="button" className="tg-btn tg-btn-go tg-wide" onClick={save} disabled={busy || sel.length !== PICKS || !changed}>{busy ? "Saving…" : !changed && me.open.picks.length === PICKS ? <><Icon n="check" size={14} />Picks locked in</> : `Lock in ${PICKS} picks`}</button>
      {err && <p className="tg-err">{err}</p>}
      {popular.length > 0 && <div className="tg-popular"><span>Most picked</span>{popular.map((p) => <button key={p.token} type="button" className="tg-chip" onClick={() => toggle(p)}>${p.symbol} <small>×{p.count}</small></button>)}</div>}
      <input className="tg-search" placeholder="Search a ticker or paste an address" value={q} onChange={(e) => setQ(e.target.value)} />
      {coins === null ? <p className="tg-sub">Loading Pons coins…</p> : list.length === 0 ? <p className="tg-sub">No coins match. Coins that traded in the last 24 hours show up here.</p> : (
        <ol className="tg-coins">
          {list.map((c) => { const on = sel.some((x) => x.token === c.token); return (
            <li key={c.token}><button type="button" className={`tg-coin${on ? " on" : ""}`} onClick={() => toggle(c)} disabled={!on && sel.length >= PICKS}>
              <Avatar s={c.symbol} /><span className="tg-coin-n"><b>${c.symbol}</b><small className="mono">{c.trades} trades · {c.volEth.toFixed(2)} ETH</small></span>
              <em className={`mono ${c.changePct >= 0 ? "up" : "down"}`}>{pct(c.changePct)}</em><span className="tg-coin-add"><Icon n={on ? "check" : "plus"} size={13} /></span>
            </button></li>); })}
        </ol>
      )}
      <section className="tg-box">
        <h3>Today, live <small className="mono">{me.live.label}</small></h3>
        {me.live.picks.length ? (
          <ol className="tg-live-picks">{me.live.picks.map((p) => <li key={p.token} className={p.place && p.place <= 3 ? "top" : ""}><span className="tg-place">{p.place ? `#${p.place}` : "–"}</span><b>${p.symbol}</b><em className={`mono ${(p.pct ?? 0) >= 0 ? "up" : "down"}`}>{pct(p.pct)}</em></li>)}</ol>
        ) : <p className="tg-sub">You didn&apos;t pick for today. Tomorrow&apos;s picks are above.</p>}
        {me.live.top.length > 0 && <p className="tg-sub">Leading: {me.live.top.slice(0, 3).map((t, i) => <span key={t.token} className="tg-lead">{PLACE[i]} ${t.symbol} {pct(t.pct)}</span>)}</p>}
        <p className="tg-fine">Settles 00:00 UTC, in {left(me.live.endsAt, now)} · {me.live.players} player{me.live.players === 1 ? "" : "s"} · prices from Pons, hourly</p>
      </section>
    </div>
  );
}
function Avatar({ s }: { s: string }) { return <span className="tg-av" style={{ background: `hsl(${hue(s)} 55% 38%)` }}>{s.slice(0, 1)}</span>; }

// ------------------------------------------------------------------ results
function ResultsPanel({ me }: { me: Me }) {
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Results</p><h2>How your picks did</h2></header>
      {me.last && <div className="tg-podium">{me.last.top.slice(0, 3).map((t, i) => <div key={t.token} className={`tg-pod tg-pod-${i + 1}`}><span className="tg-pod-p">{PLACE[i]}</span><b>${t.symbol}</b><em className="mono up">{pct(t.pct)}</em></div>)}<p className="tg-fine">{me.last.label} · {me.last.players} player{me.last.players === 1 ? "" : "s"}</p></div>}
      {me.results.length === 0 ? <p className="tg-sub">No results yet. Make your picks; your first day settles at 00:00 UTC after it runs.</p> : (
        <ol className="tg-hist">{me.results.map((r) => (
          <li key={r.round}><div className="tg-hist-h"><b className="mono">{new Date(r.round * 86400000).toISOString().slice(0, 10)}</b><em className="tg-xp">+{r.xp} XP</em></div>
            <div className="tg-hist-p">{r.picks.map((p) => <span key={p.token} className={p.rank ? "hit" : ""}>{p.rank ? PLACE[p.rank - 1] : "·"} ${p.symbol} <small className="mono">{pct(p.pct)}</small></span>)}</div></li>))}</ol>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ build (shop)
const TABS: [ItemKind, string][] = [["house", "House"], ["room", "Rooms"], ["vehicle", "Rides"], ["indoor", "Indoor"], ["outdoor", "Garden"], ["pet", "Pets"]];
function ShopPanel({ me, call, onDone }: { me: Me; call: (op: string, b?: Record<string, unknown>) => Promise<{ me: Me }>; onDone: (m: Me, it: Item) => void }) {
  const [tab, setTab] = useState<ItemKind>("room");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (it: Item, op: "buy" | "equip") => { setBusy(it.id); setErr(null); try { const j = await call(op, { id: it.id }); onDone(j.me, it); } catch (e) { setErr((e as Error).message); } setBusy(null); };
  const houseIx = HOUSE_ORDER.indexOf(me.house);
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Build</p><h2>Add to your land</h2></header>
      <div className="tg-wallet">
        <span><Icon n="brick" size={13} /><b>{n0(me.bricks)}</b> bricks</span><span><Icon n="wood" size={13} /><b>{n0(me.wood)}</b> wood</span><span><Icon n="stone" size={13} /><b>{n0(me.stone)}</b> stone</span>
      </div>
      <div className="tg-tabs" role="tablist">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {err && <p className="tg-err">{err}</p>}
      <div className="tg-items">
        {ITEMS.filter((i) => i.kind === tab).sort((a, b) => a.level - b.level).map((it) => {
          const own = me.items.includes(it.id), eq = me.house === it.id || me.vehicle === it.id, lock = me.level < it.level;
          const needH = it.needsHouse !== undefined && houseIx < it.needsHouse;
          const short = me.bricks < it.cost || (it.wood ?? 0) > me.wood || (it.stone ?? 0) > me.stone;
          const swap = it.kind === "house" || it.kind === "vehicle";
          return (
            <div key={it.id} className={`tg-item${own ? " own" : ""}${lock ? " lock" : ""}`}>
              <span className="tg-item-i"><Icon n={lock ? "lock" : it.glyph} size={18} /></span>
              <div className="tg-item-t"><b>{it.name}</b><small>{it.blurb}</small>
                {!own && <span className="tg-cost">
                  <span className={me.bricks < it.cost ? "short" : ""}><Icon n="brick" size={11} />{n0(it.cost)}</span>
                  {it.wood ? <span className={it.wood > me.wood ? "short" : ""}><Icon n="wood" size={11} />{it.wood}</span> : null}
                  {it.stone ? <span className={it.stone > me.stone ? "short" : ""}><Icon n="stone" size={11} />{it.stone}</span> : null}
                </span>}
              </div>
              <div className="tg-item-a">
                {own ? (!swap ? <span className="tg-tag on"><Icon n="check" size={11} />Built</span> : eq ? <span className="tg-tag on">In use</span> : <button type="button" className="tg-btn tg-btn-sm" disabled={!!busy} onClick={() => act(it, "equip")}>Use</button>)
                  : lock ? <span className="tg-tag">Lv {it.level}</span>
                  : needH ? <span className="tg-tag">Needs {item(HOUSE_ORDER[it.needsHouse!])?.name}</span>
                  : <button type="button" className="tg-btn tg-btn-sm tg-btn-go" disabled={!!busy || short} onClick={() => act(it, "buy")}>{busy === it.id ? "…" : "Build"}</button>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="tg-fine">Bricks come from XP. Wood and stone come from the tree and the rock on your land.</p>
    </div>
  );
}

// ------------------------------------------------------------------ leaderboard + visit + rules
function BoardPanel({ call, onVisit }: { call: (op: string, b?: undefined, q?: Record<string, string>) => Promise<{ players: (Pub & { rank: number })[]; me: number }>; onVisit: (p: Pub) => void }) {
  const [d, setD] = useState<{ players: (Pub & { rank: number })[]; me: number } | null>(null);
  useEffect(() => { call("leaderboard", undefined, {}).then(setD).catch(() => setD({ players: [], me: 0 })); }, [call]);
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Leaderboard</p><h2>Top Trenchies</h2></header>
      {d && d.me > 0 && <p className="tg-sub">You&apos;re <b>#{d.me}</b> of {d.players.length}. Tap anyone to visit their land.</p>}
      {!d ? <p className="tg-sub">Loading…</p> : (
        <ol className="tg-board">{d.players.map((p) => (
          <li key={p.name}><button type="button" onClick={() => onVisit(p)}>
            <span className={`tg-rk${p.rank <= 3 ? " top" : ""}`}>{p.rank}</span>
            <ArtCanvas id={p.nft} size={28} /><span className="tg-bn"><b>{p.name}</b><small>{p.x ? `@${p.x}` : `${p.hits} top-3 picks`}</small></span>
            <span className="tg-lvb">Lv {p.level}</span><em className="mono">{n0(p.xp)} XP</em>
          </button></li>))}</ol>
      )}
    </div>
  );
}
function VisitPanel({ call, onVisit }: { call: (op: string, b?: undefined, q?: Record<string, string>) => Promise<{ player: Pub }>; onVisit: (p: Pub) => void }) {
  const [name, setName] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setErr(null); try { const j = await call("visit", undefined, { name: name.trim() }); onVisit(j.player); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Visit</p><h2>See someone&apos;s land</h2></header>
      <p className="tg-sub">Type a Trenchie&apos;s name to look around their land, their buildings and what they ride.</p>
      <form className="tg-row" onSubmit={(e) => { e.preventDefault(); void go(); }}><input className="tg-search" value={name} onChange={(e) => setName(e.target.value)} placeholder="Trenchie name" /><button type="submit" className="tg-btn tg-btn-go" disabled={busy || name.trim().length < 3}>Visit</button></form>
      {err && <p className="tg-err">{err}</p>}
    </div>
  );
}
function RulesPanel() {
  const h = (s: number) => `${s / 3600} hours`;
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">How it works</p><h2>Rules</h2></header>
      <ol className="tg-rules">
        <li><span>1</span><div><b>Pick 3 coins a day</b><p>Choose 3 Pons coins before 00:00 UTC. They count for the next UTC day, 00:00 to 24:00. You can change them until the lock.</p></div></li>
        <li><span>2</span><div><b>Every pick is ranked</b><p>All coins picked by anyone that day are ranked by how much their price climbs. If one of yours lands in the top 3 you earn XP: <b>{RANK_XP[0]}</b> for 1st, <b>{RANK_XP[1]}</b> for 2nd, <b>{RANK_XP[2]}</b> for 3rd.</p></div></li>
        <li><span>3</span><div><b>Bonus XP</b><p>+{PLAY_XP} for playing a day, +5 per day in a row (up to +50), +{HAT_TRICK_XP} when all 3 picks make the top 3, and +{X_XP} once for linking your X.</p></div></li>
        <li><span>4</span><div><b>XP builds your land</b><p>Every XP you earn adds a brick. Spend bricks to upgrade the house, add rooms, buy rides, furniture, garden pieces and pets. Higher levels unlock more.</p></div></li>
        <li><span>5</span><div><b>Wood and stone</b><p>Chop the tree on your land every {h(GATHER.wood.every)} for {GATHER.wood.min}–{GATHER.wood.max} wood, and mine the rock every {h(GATHER.stone.every)} for {GATHER.stone.min}–{GATHER.stone.max} stone. Each gives +5 XP. Bigger builds need them.</p></div></li>
        <li><span>6</span><div><b>Your Trenchie lives there</b><p>It works at the desk by day, sleeps at night, uses what you build and rides around the block. Tap it to say hi. Visit other players from the leaderboard.</p></div></li>
      </ol>
      <p className="tg-fine">Prices come from Pons and update hourly. Results settle after 00:00 UTC.</p>
    </div>
  );
}

// ------------------------------------------------------------------ profile + X
function ProfilePanel({ me, call, onMe, onRespawn }: { me: Me; call: (op: string, b?: Record<string, unknown>) => Promise<{ me: Me; bonus?: number }>; onMe: (m: Me, bonus?: number) => void; onRespawn: () => void }) {
  const [handle, setHandle] = useState(me.xPending?.handle ?? ""); const [url, setUrl] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const run = async (op: string, b: Record<string, unknown>) => { setBusy(true); setErr(null); try { const j = await call(op, b); onMe(j.me, j.bonus); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  const post = me.xPending ? `My Trenchie ${me.name} just moved into the trench. ${me.xPending.code}\n\ntrenchers.io/trenchies` : "";
  return (
    <div className="tg-pp">
      <div className="tg-prof"><ArtCanvas id={me.nft} size={56} /><div><h2>{me.name}</h2><p className="tg-sub">Trencher #{me.nft} · Level {me.level} · {n0(me.xp)} XP</p></div></div>
      <dl className="tg-kpis">
        <div><dt>Days played</dt><dd>{me.rounds}</dd></div><div><dt>Top-3 picks</dt><dd>{me.hits}</dd></div>
        <div><dt>1st places</dt><dd>{me.wins}</dd></div><div><dt>Hat tricks</dt><dd>{me.hatTricks}</dd></div>
      </dl>
      <section className="tg-box">
        <h3><Icon n="x" size={12} /> X account</h3>
        {me.x ? <p className="tg-sub">Linked to <a href={`https://x.com/${me.x}`} target="_blank" rel="noreferrer"><b>@{me.x}</b></a>. It shows above your Trenchie and on the leaderboard.</p>
          : !me.xPending ? (<>
            <p className="tg-sub">Link your X to show it above your Trenchie and on the leaderboard. <b>+{X_XP} XP</b> the first time.</p>
            <form className="tg-row" onSubmit={(e) => { e.preventDefault(); void run("x/start", { handle }); }}><input className="tg-search" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@yourhandle" /><button type="submit" className="tg-btn tg-btn-go" disabled={busy || !handle.trim()}>Next</button></form>
          </>) : (<>
            <p className="tg-sub">Post this from <b>@{me.xPending.handle}</b> (it has your code <b className="mono">{me.xPending.code}</b>), then paste the link to the post.</p>
            <a className="tg-btn tg-btn-x" href={`https://x.com/intent/post?text=${encodeURIComponent(post)}`} target="_blank" rel="noreferrer"><Icon n="x" size={13} />Post on X</a>
            <form className="tg-row" onSubmit={(e) => { e.preventDefault(); void run("x/verify", { url }); }}><input className="tg-search" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://x.com/…/status/…" /><button type="submit" className="tg-btn tg-btn-go" disabled={busy || !url.trim()}>Verify</button></form>
            <button type="button" className="linkish" onClick={() => void run("x/start", { handle: "" }).catch(() => {})}>Use a different handle</button>
          </>)}
      </section>
      <div className="tg-row"><button type="button" className="tg-btn" onClick={onRespawn}>Move to another Trencher</button><a className="tg-btn" href={ROUTES.home}>Back to trenchers.io</a></div>
      {err && <p className="tg-err">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ moments
function Reveal({ r, onCollect }: { r: Result; onCollect: () => void }) {
  const [shown, setShown] = useState(0);
  useEffect(() => { let n = 0; const t = setInterval(() => { n = Math.min(r.xp, n + Math.max(1, Math.ceil(r.xp / 40))); setShown(n); if (n >= r.xp) clearInterval(t); }, 30); return () => clearInterval(t); }, [r.xp]);
  return (
    <div className="tg-modal"><div className="tg-mbox tg-reveal">
      <p className="tg-k">Day settled · {new Date(r.round * 86400000).toISOString().slice(0, 10)}</p>
      <div className="tg-rv-picks">{r.picks.map((p, i) => <div key={p.token} className={`tg-rv${p.rank ? " hit" : ""}`} style={{ animationDelay: `${0.2 + i * 0.35}s` }}><span>{p.rank ? PLACE[p.rank - 1] : "–"}</span><b>${p.symbol}</b><em className="mono">{pct(p.pct)}</em></div>)}</div>
      <ul className="tg-parts">{r.parts.map((x, i) => <li key={i}><span>{x.label}</span><b>+{x.xp}</b></li>)}</ul>
      <p className="tg-bigxp mono">+{shown} XP</p>
      <button type="button" className="tg-btn tg-btn-go tg-wide" onClick={onCollect}>Collect</button>
    </div></div>
  );
}
function LevelUp({ level, onClose }: { level: number; onClose: () => void }) {
  const unlocked = ITEMS.filter((i) => i.level === level);
  return (
    <div className="tg-modal" onClick={onClose}><div className="tg-mbox tg-lvup">
      <p className="tg-k">Level up</p><p className="tg-biglv">{level}</p>
      {unlocked.length ? <><p className="tg-sub">New to build:</p><div className="tg-unl">{unlocked.map((i) => <span key={i.id}><Icon n={i.glyph} size={12} />{i.name}</span>)}</div></> : <p className="tg-sub">Keep picking: more unlocks at level {ITEMS.find((i) => i.level > level)?.level ?? level + 1}.</p>}
      <button type="button" className="tg-btn tg-btn-go tg-wide" onClick={onClose}>Nice</button>
    </div></div>
  );
}

export { levelOf };
