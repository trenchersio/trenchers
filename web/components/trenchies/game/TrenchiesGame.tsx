"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createWalletClient, custom, getAddress, type Address } from "viem";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { artPalette, loadArt } from "@/lib/art-vector";
import { ownedTrenchers, walletProvider } from "@/lib/chain";
import { ENGINE_URL, EXPLORER, ROUTES, chain } from "@/lib/constants";
import { useWallet } from "@/lib/wallet";
import { ConnectModal } from "@/components/ConnectModal";
import { ACHIEVEMENTS, CHEER, DESK, FLOORS, HAT_TRICK_XP, HOUSE_ORDER, ITEMS, LEVEL_COINS, NET_EVERY, PAINTS, PAINT_COST, PICKS, PLAY_COINS, PLAY_XP, PRIZE_BPS, PRIZE_SPLIT, RANK_COINS, RANK_XP, REFERRAL, ROOM_SLOTS, X_XP, bug, item, levelOf, roomLayout, xpFor, type ChestTier, type Item, type ItemKind } from "@/lib/trenchies-catalog";
import { Terminal } from "./Terminal";
import { SKY_LABEL, type Sky } from "./weather";
import { Icon } from "./icons";
import { Land } from "./Land";
import { ChestModal, CollectionPanel, DailyModal, TodayPanel, Wardrobe, rewardText } from "./progress";
import type { Call, LandInfo, Me, Mini, Note, Pub, Result } from "./model";
import type { Look, Palette } from "./types";

// ------------------------------------------------------------------ types + api
type Coin = { token: string; symbol: string; price: number; changePct: number; volEth: number; trades: number };
type Prizes = {
  pot: { wallet: string | null; bps: number; potEth: string; feesEth: string; end: number; updatedAt: number; error: string | null } | null; split: number[];
  week: { label: string; end: number }; standings: (Mini & { rank: number; xp: number; hits: number })[]; me: { rank: number | null; xp: number; players: number } | null; admin: boolean;
  past: { week: number; label: string; potWei: string; winners: { name: string; addr: string; nft: number; xp: number; share: number; wei: string }[]; paid: string | null }[];
};
type Panel = "picks" | "desk" | "today" | "build" | "me" | "collection" | "board" | "prizes" | "lands" | "more";
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
const DOCK: [Panel, string, string][] = [["picks", "target", "Picks"], ["desk", "chart", "Trade"], ["today", "gift", "Today"], ["build", "build", "Build"], ["me", "shirt", "Trenchie"], ["collection", "medal", "Collect"], ["board", "ranks", "Ranks"], ["lands", "users", "Lands"], ["more", "more", "More"]];
const NO_GROW = { wood: 0, stone: 0, fish: 0 };
const SKY_ICON: Record<Sky, string> = { sun: "sun", clouds: "fan", rain: "drop", snow: "sparkle" };
const SITE = "https://www.trenchers.io";
const inviteUrl = (name: string) => `${SITE}/trenchies/u/${encodeURIComponent(name)}`;
const eth = (v: string | number, d = 4) => { const n = Number(v); return n === 0 ? "0" : n < 10 ** -d ? `<${(10 ** -d).toFixed(d)}` : n.toFixed(d); };
const weiEth = (w: string) => Number(BigInt(w)) / 1e18;
function until(ts: number, now: number) { const s = Math.max(0, Math.floor(ts - now)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : `${h}h ${m}m`; }
function usePrizes(token: string | null) {
  const [p, setP] = useState<Prizes | null>(null);
  const load = useCallback(() => { fetch(`${API}prizes${token ? `?token=${encodeURIComponent(token)}` : ""}`).then((r) => r.json()).then(setP).catch(() => {}); }, [token]);
  useEffect(() => { load(); const t = setInterval(load, 300_000); return () => clearInterval(t); }, [load]);
  return [p, load] as const;
}

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
  const [netted, setNetted] = useState<{ got: string[]; n: number } | null>(null);
  const [netting, setNetting] = useState<"net" | null>(null);
  const [ticker, setTicker] = useState<[number, number][] | undefined>(undefined);
  const [placing, setPlacing] = useState<string | null>(null);
  const [sky, setSky] = useState<Sky | null>(null);
  const [deskMax, setDeskMax] = useState(false);
  useEffect(() => { if (panel === "picks") setDeskMax(false); }, [panel]);
  const [landInfo, setLandInfo] = useState<LandInfo | null>(null);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [chest, setChest] = useState<ChestTier | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [cheered, setCheered] = useState<string[]>([]);
  const shownDaily = useRef(false), shownNotes = useRef(new Set<number>());
  const [prizes, reloadPrizes] = usePrizes(token);
  const now = useNow();

  const call: Call = useCallback(async (op, body, get) => {
    const q = new URLSearchParams({ ...(get ?? {}), token: token ?? "" });
    const r = await fetch(body ? API + op : `${API}${op}?${q}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, token }) } : undefined);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { try { if (addr) localStorage.removeItem(tokKey(addr)); } catch { /* */ } setToken(null); setPhase("signin"); }
    if (!r.ok) throw new Error(j.error ?? "Something went wrong. Try again.");
    return j;
  }, [token, addr]);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast((t) => (t === m ? null : t)), 3200); };
  const apply = useCallback((next: Me) => setMe((prev) => { if (prev && next.level > prev.level) setLevelUp(next.level); return next; }), []);

  // an invite link (?ref=name) is remembered until you spawn
  useEffect(() => { try { const r = new URLSearchParams(window.location.search).get("ref"); if (r) localStorage.setItem("trenchies:ref", r); } catch { /* */ } }, []);
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
  }, [token, apply]);
  // the daily reward pops up once per visit until it's claimed
  useEffect(() => { if (phase === "play" && me && !me.daily?.claimed && !shownDaily.current && !me.unseen) { shownDaily.current = true; const t = setTimeout(() => setDailyOpen(true), 1600); return () => clearTimeout(t); } }, [phase, me]);
  // news from the engine (quests done, chests, cheers, achievements) as cards, then marked read
  useEffect(() => {
    if (!me?.inbox?.length) return;
    const fresh = me.inbox.filter((n) => !shownNotes.current.has(n.id)); if (!fresh.length) return;
    fresh.forEach((n) => shownNotes.current.add(n.id));
    setNotes((x) => [...x, ...fresh].slice(-4));
    fresh.forEach((n) => setTimeout(() => setNotes((x) => x.filter((y) => y.id !== n.id)), 5200));
    void call("inbox/seen", { id: Math.max(...fresh.map((n) => n.id)) }).catch(() => {});
  }, [me?.inbox, call]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const refresh = useCallback(() => { void call("state").then((j) => { if (j.me) apply(j.me); }).catch(() => {}); }, [call, apply]);
  const place = async (x: number | null, y?: number) => {
    const id = placing; if (!id) return;
    try { const j = await call("place", x === null ? { id, x: null } : { id, x, y }); apply(j.me); say(x === null ? `${item(id)?.name} is back in its usual spot` : `${item(id)?.name} moved`); setPlacing(null); }
    catch (e) { say((e as Error).message); }
  };
  const net = async () => {
    if (visiting) setVisiting(null);
    setNetting("net");
    try { const j = await call("net", {}); apply(j.me); setNetted({ got: j.got, n: Date.now() }); say(`Caught ${(j.got as string[]).map((id) => bug(id)?.name ?? id).join(" and ")} · +${j.xp} XP`); }
    catch (e) { say((e as Error).message); }
    setNetting(null);
  };
  const claimDaily = async () => {
    setClaiming(true);
    try { const j = await call("daily", {}); apply(j.me); setParty((p) => p + 1); say(`Daily reward: ${rewardText(j.reward)}`); setDailyOpen(false); }
    catch (e) { say((e as Error).message); setDailyOpen(false); }
    setClaiming(false);
  };
  const shareLand = () => {
    if (!me) return;
    const text = `My Trenchie ${me.name} is level ${me.level} with a land worth ${me.landValue.toLocaleString("en-US")} coins. Come build next to me in Trenchies by @trenchersio`;
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(inviteUrl(me.name))}`, "_blank", "noopener");
    void call("shared", {}).then((j) => apply(j.me)).catch(() => {});
  };
  const cheer = async (name: string) => {
    try { const j = await call("cheer", { name }); apply(j.me); setCheered((c) => [...c, name]); setParty((p) => p + 1); say(`You cheered ${name}'s land · +${CHEER.xp} XP`); }
    catch (e) { const m = (e as Error).message; if (/already/i.test(m)) setCheered((c) => [...c, name]); say(m); }
  };
  const goQuest = (id: string) => {
    if (!me) return;
    if (id === "pick") setPanel("picks");
    else if (id === "desk" || id === "deskwin" || id === "crowd") setPanel("desk");
    else if (id === "net") { if (!me.netAt || me.netAt <= Date.now()) { setPanel(null); void net(); } else say(`The net is ready in ${until(me.netAt / 1000, now)}`); }
    else if (id === "visit" || id === "cheer") setPanel("board");
    else if (id === "chat") { setPanel(null); say("Say something in your land chat"); }
    else if (id === "build") setPanel("build");
    else if (id === "wear") setPanel("me");
    else if (id === "chest") { const t = (["epic", "rare", "common"] as ChestTier[]).find((x) => me.chests[x] > 0); if (t) setChest(t); else say("No chests yet: finish all 3 quests for one"); }
    else if (id === "share") shareLand();
  };

  // the land you're on: its members, who's here, its chat (checked every few seconds; members checking in are "here")
  const landName = visiting?.name ?? me?.name ?? null;
  const loadLand = useCallback(async () => {
    if (!token || !landName) return;
    try { const j = await call("land", undefined, { name: landName }) as LandInfo; setLandInfo(j); if (visiting && j.land.name === visiting.name) setVisiting((v) => (v && JSON.stringify(v) !== JSON.stringify(j.land) ? j.land : v)); } catch { /* keep the last view */ }
  }, [token, landName, call, visiting]);
  useEffect(() => {
    setLandInfo(null); if (phase !== "play") return;
    void loadLand(); const t = setInterval(() => { if (!document.hidden) void loadLand(); }, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landName, phase, token]);
  const landAct = async (op: string, body: Record<string, unknown>, ok?: string) => { try { const j = await call(op, { name: landName, ...body }) as LandInfo; setLandInfo(j); if (ok) say(ok); return true; } catch (e) { say((e as Error).message); return false; } };

  const myPalette = usePalette(me?.nft ?? null);
  const palette = usePalette(visiting?.nft ?? me?.nft ?? null);
  const subject = visiting ?? me;
  const look: Look | null = useMemo(() => subject ? { name: subject.name, house: subject.house, vehicle: subject.vehicle, items: subject.items, palette, trophies: subject.hits, level: subject.level, x: subject.x, wear: subject.wear, layout: subject.layout, paint: subject.paint, place: subject.place } : null, [subject, palette]);
  const guests = useMemo(() => (landInfo && landInfo.land.name === landName ? landInfo.present : []), [landInfo, landName]);
  const onChestDone = useCallback((m: Me) => apply(m), [apply]);

  if (phase === "boot" || !addr) return (
    <Splash>
      <p className="tg-lede">Spawn your Trenchie, pick tomorrow&apos;s top coins, trade Bitcoin at your desk, and build a land like nobody else&apos;s.</p>
      {prizes?.pot && <PotBadge prizes={prizes} now={now} />}
      <button type="button" className="tg-btn tg-btn-go" onClick={w.openModal}>Connect wallet</button>
      <ConnectModal />
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
  const chests = (me.chests?.common ?? 0) + (me.chests?.rare ?? 0) + (me.chests?.epic ?? 0);
  const todo = (me.daily && !me.daily.claimed ? 1 : 0) + (me.quests?.list.filter((q) => !q.done).length ?? 0) + chests;
  const netReady = !me.netAt || me.netAt <= now * 1000;

  return (
    <div className="tg">
      <Land key={visiting ? `v-${visiting.name}` : "home"} look={look} nft={subject!.nft} celebrate={party} grow={NO_GROW} now={now} mine={!visiting} busy={netting}
        netAt={visiting ? 0 : me.netAt} onNet={net} netted={visiting ? null : netted}
        onDesk={() => setPanel("desk")} atDesk={!visiting && (panel === "picks" || panel === "desk")} ticker={ticker} onSky={setSky}
        onPick={placing && !visiting ? (x, y) => void place(x, y) : null}
        guests={guests} follow={visiting && landInfo?.role === "member" ? me.name : null} chat={landInfo && landInfo.land.name === landName ? landInfo.chat : undefined} />

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
          <button type="button" className="tg-card tg-stat tg-coinchip" title="Coins: won with picks and trades, spent on your land" onClick={() => setPanel("build")}><Icon n="coin" size={14} /><b>{n0(me.bricks)}</b></button>
          {me.desk?.streak > 1 && <button type="button" className="tg-card tg-stat hot" title="Trading desk: calls right in a row" onClick={() => setPanel("desk")}><Icon n="chart" size={14} /><b>{me.desk.streak}</b></button>}
          {sky && <span className={`tg-card tg-stat tg-sky tg-hide-s ${sky}`} title={`Weather on this land: ${SKY_LABEL[sky]}`}><Icon n={SKY_ICON[sky]} size={14} /><span>{SKY_LABEL[sky]}</span></span>}
          {chests > 0 && <button type="button" className="tg-card tg-stat tg-chestchip" onClick={() => setPanel("today")} title="Chests to open"><Icon n="chest" size={14} /><b>{chests}</b></button>}
          {prizes?.pot && <button type="button" className="tg-card tg-stat tg-potchip" onClick={() => setPanel("prizes")} title="This week's prize pot"><Icon n="trophy" size={14} /><b>{eth(prizes.pot.potEth)} ETH</b></button>}
          <span className={`tg-card tg-stat${me.streak > 1 ? " hot" : ""}`} title="Days in a row"><Icon n="flame" size={14} /><b>{me.streak}</b></span>
          <button type="button" className={`tg-card tg-stat tg-lock${needPicks ? " urgent" : ""}`} onClick={() => setPanel("picks")}><Icon n="clock" size={14} /><span>{needPicks ? "Pick before" : "Locked in"}</span><b className="mono">{left(me.open.lockAt, now)}</b></button>
        </div>
      </header>

      {visiting && (
        <div className="tg-visit-bar">
          <span>{landInfo?.role === "member" ? "You're on" : "Visiting"} <b>{visiting.name}</b>&apos;s land · Lv {visiting.level}</span>
          <button type="button" className="tg-btn tg-btn-sm tg-btn-cheer" disabled={cheered.includes(visiting.name)} onClick={() => void cheer(visiting.name)}><Icon n="heart" size={13} />{cheered.includes(visiting.name) ? "Cheered" : "Cheer"}</button>
          {landInfo?.role === "visitor" && <button type="button" className="tg-btn tg-btn-sm tg-btn-go" onClick={() => void landAct("land/request", {}, `Asked ${visiting.name} to let you join`)}>Ask to join</button>}
          {landInfo?.role === "pending" && <span className="tg-tag">Request sent</span>}
          {landInfo?.role === "member" && <button type="button" className="tg-btn tg-btn-sm" onClick={() => void landAct("land/leave", {}, `You left ${visiting.name}'s land`)}>Leave</button>}
          <button type="button" className="tg-btn tg-btn-sm" onClick={() => setVisiting(null)}>Back home</button>
        </div>
      )}
      {placing && !visiting && (
        <div className="tg-placebar" role="status"><Icon n="move" size={15} /><span>Tap your garden where the <b>{item(placing)?.name}</b> should go</span>
          <button type="button" className="tg-btn tg-btn-sm" onClick={() => void place(null)}>Usual spot</button>
          <button type="button" className="tg-btn tg-btn-sm" onClick={() => setPlacing(null)}>Done</button></div>
      )}
      {!visiting && !placing && netReady && <button type="button" className="tg-card tg-netfab" onClick={() => void net()} disabled={netting === "net"}><Icon n="bug" size={15} /><span>Catch butterflies</span></button>}
      {landInfo && landInfo.land.name === landName && <LandChat info={landInfo} me={me.name} onSay={(text) => landAct("land/say", { text })} onJoin={() => void landAct("land/request", {}, "Request sent")} />}
      {!me.held && <div className="tg-warn">Trencher #{me.nft} isn&apos;t in this wallet any more. <button type="button" className="linkish" onClick={() => setPanel("me")}>Move your Trenchie</button></div>}

      <nav className="tg-dock" aria-label="Trenchies">
        {DOCK.map(([k, ic, l]) => (
          <button key={k} type="button" className={`tg-dk${panel === k ? " on" : ""}`} onClick={() => setPanel(panel === k ? null : k)}>
            <Icon n={ic} size={18} /><span>{l}</span>
            {k === "picks" && needPicks && <i className="tg-dot" />}
            {k === "today" && todo > 0 && <i className="tg-dot tg-dot-n">{todo}</i>}
            {k === "lands" && me.requests > 0 && <i className="tg-dot tg-dot-n">{me.requests}</i>}
          </button>
        ))}
      </nav>

      {(panel === "picks" || panel === "desk") && (
        <div className={`tg-trade${deskMax ? " max" : ""} show-${panel}`}>
          <div className="tg-trade-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={panel === "desk"} className={panel === "desk" ? "on" : ""} onClick={() => setPanel("desk")}><Icon n="chart" size={14} />Trading desk</button>
            <button type="button" role="tab" aria-selected={panel === "picks"} className={panel === "picks" ? "on" : ""} onClick={() => setPanel("picks")}><Icon n="target" size={14} />Daily picks{needPicks && <i className="tg-dot" />}</button>
            <button type="button" className="tg-x" aria-label="Close" onClick={() => setPanel(null)}><Icon n="close" size={14} /></button>
          </div>
          <Terminal call={call} onTicker={setTicker} onSettled={refresh} say={say} max={deskMax} onMax={() => setDeskMax((m) => !m)} onClose={() => setPanel(null)} />
          {!deskMax && <div className="tg-trade-picks"><button type="button" className="tg-x" aria-label="Close" onClick={() => setPanel(null)}><Icon n="close" size={14} /></button>
            <PicksPanel me={me} now={now} call={call} onSaved={(m) => { apply(m); say(`Picks locked in for ${m.open.label}`); }} /></div>}
        </div>
      )}
      {panel && panel !== "picks" && panel !== "desk" && (
        <aside key={panel} className="tg-panel" role="dialog" aria-label={panel}>
          <button type="button" className="tg-x" aria-label="Close" onClick={() => setPanel(null)}><Icon n="close" size={14} /></button>
          {panel === "today" && <TodayPanel me={me} onClaim={claimDaily} claiming={claiming} onGo={goQuest} onChest={setChest} onShare={shareLand} invite={inviteUrl(me.name)} />}
          {panel === "build" && <ShopPanel me={me} call={call} onMe={apply} say={say} onDone={(m, it) => { apply(m); setParty((p) => p + 1); say(`${it.name} added to your land`); }} onPlace={(id) => { setVisiting(null); setPlacing(id); setPanel(null); }} />}
          {panel === "me" && <ProfilePanel me={me} palette={myPalette} call={call} onMe={(m, bonus) => { apply(m); if (bonus) { setParty((p) => p + 1); say(`X linked: +${bonus} XP`); } }} onRespawn={() => setPhase("spawn")} onShare={shareLand} />}
          {panel === "collection" && <CollectionPanel me={me} now={now} onNet={() => { setPanel(null); void net(); }} />}
          {panel === "board" && <BoardPanel call={call} onVisit={(p) => { setVisiting(p); setPanel(null); }} />}
          {panel === "lands" && <LandsPanel me={me} call={call} info={!visiting ? landInfo : null} onOpen={async (open) => { const ok = await landAct("land/open", { name: me.name, open }, open ? "Your land is public: anyone can walk in" : "Your land is private: members only"); if (ok) setMe((m) => (m ? { ...m, isOpen: open } : m)); }} onVisit={(p) => { setVisiting(p); setPanel(null); }} onAnswer={async (who, accept) => { const ok = await landAct("land/answer", { name: me.name, who, accept }, accept ? `${who} can now join your land` : undefined); if (ok) setMe((m) => (m ? { ...m, requests: Math.max(0, m.requests - 1) } : m)); }} onKick={(who) => void landAct("land/leave", { name: me.name, who }, `${who} was removed`)} />}
          {panel === "prizes" && <PrizesPanel prizes={prizes} now={now} call={call} reload={reloadPrizes} />}
          {panel === "more" && <MorePanel me={me} onPrizes={() => setPanel("prizes")} />}
        </aside>
      )}

      {notes.length > 0 && <div className="tg-notes" role="status">{notes.map((n) => <div key={n.id} className={`tg-note ${n.kind}`}><Icon n={n.kind === "chest" || n.kind === "level" ? "chest" : n.kind === "ach" ? "medal" : n.kind === "cheer" ? "heart" : n.kind === "bug" ? "bug" : n.kind === "quest" ? "quest" : n.kind === "ref" ? "users" : "sparkle"} size={14} /><span>{n.text}</span></div>)}</div>}
      {me.unseen && !visiting && <Reveal r={me.unseen} onCollect={async () => { const r = me.unseen!; await call("seen", { round: r.round }).catch(() => {}); setMe({ ...me, unseen: null }); if (r.xp > 10) setParty((p) => p + 1); }} />}
      {dailyOpen && !me.unseen && me.daily && !me.daily.claimed && <DailyModal me={me} busy={claiming} onClaim={claimDaily} onClose={() => setDailyOpen(false)} />}
      {chest && <ChestModal tier={chest} call={call} onDone={onChestDone} onClose={(tryOn) => { setChest(null); if (tryOn) setPanel("me"); }} />}
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
      <li><Icon n="chart" size={16} /><b>Trade Bitcoin</b><span>call it up or down, 5 minutes at a time</span></li>
      <li><Icon n="build" size={16} /><b>Build your land</b><span>rooms, rides, garden, pets</span></li>
    </ol>
  );
}

function PotBadge({ prizes, now }: { prizes: Prizes; now: number }) {
  return <div className="tg-potbadge"><Icon n="trophy" size={15} /><span>This week&apos;s prize pot</span><b className="mono">{eth(prizes.pot!.potEth)} ETH</b><small>ends in {until(prizes.week.end, now)}</small></div>;
}

// ------------------------------------------------------------------ land chat
function LandChat({ info, me, onSay, onJoin }: { info: LandInfo; me: string; onSay: (t: string) => Promise<boolean>; onJoin: () => void }) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.innerWidth > 720);
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false);
  const [read, setRead] = useState(0);
  const last = info.chat.length ? info.chat[info.chat.length - 1].id : 0;
  useEffect(() => { if (open) setRead(last); }, [open, last]);
  const unread = info.chat.filter((m) => m.id > read && m.by && m.by !== me).length;
  const listRef = useCallback((el: HTMLOListElement | null) => { if (el) el.scrollTop = el.scrollHeight; }, [last, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const can = info.role === "owner" || info.role === "member";
  const here = info.present.length + (info.ownerHere || info.role === "owner" ? 1 : 0);
  const send = async () => { const t = text.trim(); if (!t) return; setBusy(true); if (await onSay(t)) setText(""); setBusy(false); };
  if (!open) return <button type="button" className="tg-chatfab tg-card" onClick={() => setOpen(true)}><Icon n="chat" size={15} /><span>Land chat</span>{unread > 0 && <i>{unread}</i>}</button>;
  return (
    <section className="tg-chat" aria-label="Land chat">
      <header><b>{info.land.name}&apos;s land</b><small>{here} here · {info.members.length + 1} member{info.members.length ? "s" : ""}</small><button type="button" className="tg-x" aria-label="Close chat" onClick={() => setOpen(false)}><Icon n="close" size={12} /></button></header>
      <ol ref={listRef}>
        {info.chat.length === 0 && <li className="sys">No messages yet. Say gm.</li>}
        {info.chat.slice(-40).map((m) => m.by ? (
          <li key={m.id} className={m.by === me ? "me" : ""}><b>{m.by}</b><span>{m.text}</span><time className="mono">{new Date(m.at).toTimeString().slice(0, 5)}</time></li>
        ) : <li key={m.id} className="sys">{m.text}</li>)}
      </ol>
      {can ? (
        <form onSubmit={(e) => { e.preventDefault(); void send(); }}><input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Message the land" /><button type="submit" className="tg-btn tg-btn-sm tg-btn-go" disabled={busy || !text.trim()}>Send</button></form>
      ) : <p className="tg-chat-lock">{info.role === "pending" ? "Your request is waiting for the owner." : <>Only members can chat here. <button type="button" className="linkish" onClick={onJoin}>Ask to join</button></>}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ lands: visit, join, members
function LandsPanel({ me, call, info, onVisit, onAnswer, onKick, onOpen }: { me: Me; call: (op: string, b?: undefined, q?: Record<string, string>) => Promise<{ player: Pub }>; info: LandInfo | null; onVisit: (p: Pub) => void; onAnswer: (who: string, accept: boolean) => void; onKick: (who: string) => void; onOpen: (open: boolean) => void }) {
  const [name, setName] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async (n = name) => { setBusy(true); setErr(null); try { const j = await call("visit", undefined, { name: n.trim() }); onVisit(j.player); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Lands</p><h2>Visit and join lands</h2></header>
      <p className="tg-sub">Visit anyone&apos;s land. On a public land your Trenchie walks right in; on a private one, ask to join and the owner says yes or no.</p>
      <section className="tg-box">
        <h3><Icon n={info?.open ?? me.isOpen ? "globe" : "lock"} size={13} /> Your land is {(info?.open ?? me.isOpen) ? "public" : "private"}</h3>
        <div className="tg-seg" role="radiogroup" aria-label="Who can come in">
          <button type="button" role="radio" aria-checked={!(info?.open ?? me.isOpen)} className={!(info?.open ?? me.isOpen) ? "on" : ""} onClick={() => (info?.open ?? me.isOpen) && onOpen(false)}><Icon n="lock" size={14} /><b>Private</b><small>Members you approve</small></button>
          <button type="button" role="radio" aria-checked={!!(info?.open ?? me.isOpen)} className={(info?.open ?? me.isOpen) ? "on" : ""} onClick={() => !(info?.open ?? me.isOpen) && onOpen(true)}><Icon n="globe" size={14} /><b>Public</b><small>Anyone can spawn in</small></button>
        </div>
      </section>
      <form className="tg-row" onSubmit={(e) => { e.preventDefault(); void go(); }}><input className="tg-search" value={name} onChange={(e) => setName(e.target.value)} placeholder="Trenchie name" /><button type="submit" className="tg-btn tg-btn-go" disabled={busy || name.trim().length < 3}>Visit</button></form>
      {err && <p className="tg-err">{err}</p>}
      {info?.requests && info.requests.length > 0 && (
        <section className="tg-box"><h3>Asking to join your land <span className="tg-tag on">{info.requests.length}</span></h3>
          <ul className="tg-people">{info.requests.map((r) => <li key={r.name}><ArtCanvas id={r.nft} size={26} /><span className="tg-bn"><b>{r.name}</b><small>Lv {r.level}{r.x ? ` · @${r.x}` : ""}</small></span><button type="button" className="tg-btn tg-btn-sm tg-btn-go" onClick={() => onAnswer(r.name, true)}>Accept</button><button type="button" className="tg-btn tg-btn-sm" onClick={() => onAnswer(r.name, false)}>Decline</button></li>)}</ul>
        </section>
      )}
      <section className="tg-box"><h3>Lands you&apos;ve joined</h3>
        {me.lands.length === 0 ? <p className="tg-sub">None yet. Find someone on the leaderboard and ask to join.</p> : (
          <ul className="tg-people">{me.lands.map((l) => <li key={l.name}><ArtCanvas id={l.nft} size={26} /><span className="tg-bn"><b>{l.name}</b><small>Lv {l.level}</small></span><button type="button" className="tg-btn tg-btn-sm tg-btn-go" onClick={() => void go(l.name)}>Go</button></li>)}</ul>
        )}
      </section>
      <section className="tg-box"><h3>Members of your land</h3>
        {!info || info.members.length === 0 ? <p className="tg-sub">Nobody yet. Share your Trenchie name ({me.name}) so friends can ask to join.</p> : (
          <ul className="tg-people">{info.members.map((m) => <li key={m.name}><ArtCanvas id={m.nft} size={26} /><span className="tg-bn"><b>{m.name}</b><small>{info.present.some((x) => x.name === m.name) ? "here now" : `Lv ${m.level}`}</small></span><button type="button" className="tg-btn tg-btn-sm" onClick={() => onKick(m.name)}>Remove</button></li>)}</ul>
        )}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ weekly prizes
function PrizesPanel({ prizes, now, call, reload }: { prizes: Prizes | null; now: number; call: (op: string, b?: Record<string, unknown>) => Promise<unknown>; reload: () => void }) {
  const [tx, setTx] = useState<Record<number, string>>({}); const [err, setErr] = useState<string | null>(null);
  if (!prizes) return <div className="tg-pp"><header className="tg-ph"><p className="tg-k">Weekly prizes</p><h2>Prize pot</h2></header><p className="tg-sub">Loading…</p></div>;
  const pot = prizes.pot, potEth = Number(pot?.potEth ?? 0);
  const ex = (kind: "address" | "tx", v: string) => (EXPLORER ? `${EXPLORER.replace(/\/$/, "")}/${kind}/${v}` : "#");
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Weekly prizes</p><h2>This week&apos;s prize pot</h2></header>
      <div className="tg-pot">
        <small>Prize pot · {prizes.week.label}</small>
        <b className="mono">{eth(pot?.potEth ?? 0)} <span>ETH</span></b>
        <p>{(pot?.bps ?? PRIZE_BPS) / 100}% of the $TRENCHERS creator fees that come in this week. Ends in <b className="mono">{until(prizes.week.end, now)}</b>.</p>
        <div className="tg-split">{prizes.split.map((x, i) => <span key={i}><em>{["1st", "2nd", "3rd"][i]}</em><b className="mono">{eth(potEth * x / 100)} ETH</b><small>{x}%</small></span>)}</div>
      </div>
      {prizes.me && <p className="tg-sub">You: {prizes.me.rank ? <>rank <b>#{prizes.me.rank}</b> of {prizes.me.players} with <b>{prizes.me.xp} XP</b> from picks this week.</> : <>no settled picks this week yet. Pick today to get on the board.</>}</p>}
      <section className="tg-box"><h3>This week&apos;s top pickers</h3>
        {prizes.standings.length === 0 ? <p className="tg-sub">No days settled yet this week.</p> : (
          <ol className="tg-board">{prizes.standings.map((p) => <li key={p.name}><div className="tg-board-row"><span className={`tg-rk${p.rank <= 3 ? " top" : ""}`}>{p.rank}</span><ArtCanvas id={p.nft} size={24} /><span className="tg-bn"><b>{p.name}</b><small>{p.hits} top-3 picks</small></span><em className="mono">{p.xp} XP</em></div></li>)}</ol>
        )}
      </section>
      <section className="tg-box"><h3>Past weeks</h3>
        {prizes.past.length === 0 ? <p className="tg-sub">The first week pays out after Monday 00:00 UTC.</p> : prizes.past.map((z) => (
          <div key={z.week} className="tg-past">
            <div className="tg-past-h"><b>{z.label}</b><span className="mono">{eth(weiEth(z.potWei))} ETH</span>{z.paid ? <a className="tg-tag on" href={ex("tx", z.paid)} target="_blank" rel="noreferrer"><Icon n="check" size={11} />Paid</a> : <span className="tg-tag">Payout pending</span>}</div>
            {z.winners.length === 0 ? <p className="tg-fine">No winners that week.</p> : <ol className="tg-past-w">{z.winners.map((x, i) => <li key={x.name}><span>{["1st", "2nd", "3rd"][i]}</span><b>{x.name}</b><small className="mono">{x.xp} XP</small><em className="mono">{eth(weiEth(x.wei))} ETH</em>{prizes.admin && !z.paid && <code>{x.addr}</code>}</li>)}</ol>}
            {prizes.admin && !z.paid && z.winners.length > 0 && <form className="tg-row" onSubmit={async (e) => { e.preventDefault(); setErr(null); try { await call("prizes/paid", { week: z.week, tx: tx[z.week] }); reload(); } catch (er) { setErr((er as Error).message); } }}><input className="tg-search" placeholder="Payout transaction 0x…" value={tx[z.week] ?? ""} onChange={(e) => setTx({ ...tx, [z.week]: e.target.value })} /><button type="submit" className="tg-btn tg-btn-sm tg-btn-go">Mark paid</button></form>}
          </div>
        ))}
      </section>
      {err && <p className="tg-err">{err}</p>}
      {pot?.wallet && <p className="tg-fine">Tracking the $TRENCHERS creator wallet <a href={ex("address", pot.wallet)} target="_blank" rel="noreferrer" className="mono">{pot.wallet.slice(0, 6)}…{pot.wallet.slice(-4)}</a>{pot.updatedAt ? `, last checked ${new Date(pot.updatedAt * 1000).toISOString().slice(11, 16)} UTC` : ""}. Winners are the 3 players whose picks earned the most XP Monday to Sunday (UTC), paid {prizes.split.join(" / ")}%.</p>}
    </div>
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
  const [ref] = useState(() => { try { const q = new URLSearchParams(window.location.search).get("ref"); if (q) localStorage.setItem("trenchies:ref", q); return q ?? localStorage.getItem("trenchies:ref") ?? ""; } catch { return ""; } });
  const go = async () => { if (!pick) return; setBusy(true); setErr(null); try { const j = await call("spawn", { nft: pick, name: name.trim(), ...(ref && !existing ? { ref } : {}) }); onDone(j.me); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  return (
    <div className="tg-splash tg-spawn">
      <a className="tg-back" href={ROUTES.home}><Icon n="home" size={14} />trenchers.io</a>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/trenchies/symbol.webp" alt="" className="tg-sym" />
      <h1>{existing ? "Move your Trenchie" : "Spawn your Trenchie"}</h1>
      <p className="tg-lede">{existing ? "Pick another Trencher you hold. Your XP, coins and land come along." : "Pick the Trencher it's born from. Your Trenchie wears its colours."}</p>
      {ref && !existing && <p className="tg-invited"><Icon n="gift" size={14} />Invited by <b>{ref}</b>: you start with +{REFERRAL.newBricks} coins and a chest.</p>}
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
const TABS: [ItemKind, string][] = [["house", "House"], ["room", "Rooms"], ["vehicle", "Rides"], ["indoor", "Indoor"], ["outdoor", "Garden"], ["statue", "Statues"], ["pet", "Pets"]];
const RARE_C: Record<string, string> = { common: "#a9b3ad", rare: "#6ee7ff", epic: "#b388ff", legendary: "#ffcf3a" };
const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
/** The house from above: the core in the middle, rooms on both sides, a second row in front. */
const PLAN_ROWS: string[][] = [["L4", "L3", "L2", "L1", "core", "R1", "R2", "R3", "R4"], ["L4f", "L3f", "L2f", "L1f", "", "R1f", "R2f", "R3f", ""]];
function ShopPanel({ me, call, onDone, onMe, onPlace, say }: { me: Me; call: (op: string, b?: Record<string, unknown>) => Promise<{ me: Me }>; onDone: (m: Me, it: Item) => void; onMe: (m: Me) => void; onPlace: (id: string) => void; say: (m: string) => void }) {
  const [tab, setTab] = useState<ItemKind>("room");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const act = async (it: Item, op: "buy" | "equip") => {
    setBusy(it.id); setErr(null);
    try {
      const j = await call(op, { id: it.id }); onDone(j.me, it);
      // just built: pick where it goes straight away
      if (op === "buy" && it.kind === "room" && it.site === "house") setEdit(it.id);
      else if (op === "buy" && (it.kind === "outdoor" || it.kind === "statue")) onPlace(it.id);
    } catch (e) { setErr((e as Error).message); }
    setBusy(null);
  };
  const houseIx = HOUSE_ORDER.indexOf(me.house);
  if (edit) return <RoomEdit me={me} room={edit} call={call} onMe={onMe} say={say} onBack={() => setEdit(null)} />;
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Build</p><h2>Make your land your own</h2></header>
      <div className="tg-wallet"><span><Icon n="coin" size={13} /><b>{n0(me.bricks)}</b> coins</span><small>Win coins with your daily picks and on the trading desk.</small></div>
      <div className="tg-tabs tg-tabs-scroll" role="tablist">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "room" && <p className="tg-fine">Built rooms can be moved to another spot and painted: tap Edit.</p>}
      {(tab === "outdoor" || tab === "statue") && <p className="tg-fine">Garden pieces and statues you own can be moved anywhere in the garden.</p>}
      {err && <p className="tg-err">{err}</p>}
      <div className="tg-items">
        {tab === "house" && (
          <div className="tg-item own"><span className="tg-item-i"><Icon n="paint" size={18} /></span>
            <div className="tg-item-t"><b>Paint the main house</b><small>New walls or a new floor, {PAINT_COST} coins a coat.</small></div>
            <div className="tg-item-a"><button type="button" className="tg-btn tg-btn-sm" onClick={() => setEdit("core")}>Paint</button></div></div>
        )}
        {ITEMS.filter((i) => i.kind === tab).sort((a, b) => a.level - b.level || a.cost - b.cost).map((it) => {
          const own = me.items.includes(it.id), eq = me.house === it.id || me.vehicle === it.id, lock = me.level < it.level;
          const needH = it.needsHouse !== undefined && houseIx < it.needsHouse;
          const needA = it.needsAch && !me.achievements.includes(it.needsAch) ? ACHIEVEMENTS.find((a) => a.id === it.needsAch) : null;
          const short = me.bricks < it.cost;
          const swap = it.kind === "house" || it.kind === "vehicle", movable = it.kind === "outdoor" || it.kind === "statue";
          return (
            <div key={it.id} className={`tg-item${own ? " own" : ""}${lock || needA ? " lock" : ""}${it.rarity ? ` r-${it.rarity}` : ""}`} style={it.rarity ? { ["--r" as string]: RARE_C[it.rarity] } : undefined}>
              <span className="tg-item-i"><Icon n={lock ? "lock" : it.kind === "statue" ? "statue" : it.glyph} size={18} /></span>
              <div className="tg-item-t"><b>{it.name}{it.rarity && it.rarity !== "common" && <em className="tg-rar">{it.rarity}</em>}</b><small>{it.blurb}</small>
                {!own && <span className="tg-cost">{it.cost ? <span className={short ? "short" : ""}><Icon n="coin" size={11} />{n0(it.cost)}</span> : <span>free</span>}{needA && <span className="tg-need"><Icon n="medal" size={11} />{needA.name}</span>}</span>}
              </div>
              <div className="tg-item-a">
                {own ? (swap ? (eq ? <span className="tg-tag on">In use</span> : <button type="button" className="tg-btn tg-btn-sm" disabled={!!busy} onClick={() => act(it, "equip")}>Use</button>)
                    : it.kind === "room" && it.site === "house" ? <button type="button" className="tg-btn tg-btn-sm" onClick={() => setEdit(it.id)}><Icon n="paint" size={12} />Edit</button>
                    : movable ? <button type="button" className="tg-btn tg-btn-sm" onClick={() => onPlace(it.id)}><Icon n="move" size={12} />Move</button>
                    : <span className="tg-tag on"><Icon n="check" size={11} />Built</span>)
                  : lock ? <span className="tg-tag">Lv {it.level}</span>
                  : needH ? <span className="tg-tag">Needs {item(HOUSE_ORDER[it.needsHouse!])?.name}</span>
                  : needA ? <span className="tg-tag" title={needA.text}>Locked</span>
                  : it.needs && !me.items.includes(it.needs) ? <span className="tg-tag">Needs {item(it.needs)?.name}</span>
                  : <button type="button" className="tg-btn tg-btn-sm tg-btn-go" disabled={!!busy || short} onClick={() => act(it, "buy")}>{busy === it.id ? "…" : it.cost ? "Build" : "Claim"}</button>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="tg-fine">XP raises your level and unlocks more to build. Coins pay for it: every pick in the day&apos;s top 3 ({RANK_COINS.join(" / ")}), every right call on the trading desk (+{DESK.win.coins} and up), each level ({LEVEL_COINS} × the level), quests and chests. The rarest statues are only for achievements that take weeks.</p>
    </div>
  );
}
/** Move a room to another spot in the house, and paint its walls and floor. */
function RoomEdit({ me, room, call, onMe, onBack, say }: { me: Me; room: string; call: (op: string, b?: Record<string, unknown>) => Promise<{ me: Me }>; onMe: (m: Me) => void; onBack: () => void; say: (m: string) => void }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const lay = roomLayout(me.items, me.layout ?? {}), at = lay[room], bySlot = Object.fromEntries(Object.entries(lay).map(([r, s]) => [s, r]));
  const paint = me.paint?.[room] ?? {}, name = room === "core" ? "Main house" : item(room)?.name ?? room;
  const run = async (op: string, b: Record<string, unknown>, ok: string) => { setBusy(true); setErr(null); try { const j = await call(op, b); onMe(j.me); say(ok); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  return (
    <div className="tg-pp">
      <button type="button" className="linkish tg-backlink" onClick={onBack}><Icon n="arrow" size={12} />Back to Build</button>
      <header className="tg-ph"><p className="tg-k">Edit</p><h2>{name}</h2></header>
      {room !== "core" && (
        <section className="tg-box">
          <h3><Icon n="move" size={13} /> Where it goes</h3>
          <p className="tg-sub">Tap a spot. If another room is there, the two swap. A spot in the front row needs a room behind it.</p>
          <div className="tg-plan" role="grid" aria-label="House plan">
            {PLAN_ROWS.map((row, ri) => <div key={ri} className="tg-plan-row">{row.map((sl, i) => {
              if (!sl) return <span key={i} className="tg-plan-c empty" />;
              if (sl === "core") return <span key={i} className="tg-plan-c core" title="Main house"><Icon n="house" size={14} /></span>;
              const S = ROOM_SLOTS[sl], who = bySlot[sl], mine = sl === at, blocked = !!S.behind && !bySlot[S.behind] && !(at === S.behind);
              return <button key={i} type="button" className={`tg-plan-c${mine ? " on" : ""}${who && !mine ? " used" : ""}`} disabled={busy || mine || blocked} title={who ? item(who)?.name : "free"} onClick={() => void run("layout", { room, slot: sl }, who ? `${name} swapped with the ${item(who)?.name}` : `${name} moved`)}>
                {who ? <Icon n={item(who)?.glyph ?? "house"} size={14} /> : <Icon n="plus" size={10} />}</button>;
            })}</div>)}
            <p className="tg-plan-k"><span>by the house</span><span>front row</span></p>
          </div>
          <ul className="tg-plan-legend">{Object.keys(lay).map((r) => <li key={r} className={r === room ? "on" : ""}><Icon n={item(r)?.glyph ?? "house"} size={12} />{item(r)?.name ?? r}</li>)}</ul>
        </section>
      )}
      <section className="tg-box">
        <h3><Icon n="paint" size={13} /> Walls <small>{PAINT_COST} coins a coat</small></h3>
        <div className="tg-swatches">{PAINTS.map((c, i) => <button key={i} type="button" aria-label={i ? `Paint ${hex(c)}` : "As built"} className={`tg-sw${(paint.wall ?? 0) === i ? " on" : ""}${i ? "" : " none"}`} style={i ? { background: hex(c) } : undefined} disabled={busy || (paint.wall ?? 0) === i || me.bricks < PAINT_COST} onClick={() => void run("paint", { room, wall: i }, "Fresh paint")} />)}</div>
        <h3><Icon n="paint" size={13} /> Floor</h3>
        <div className="tg-swatches">{FLOORS.map((c, i) => <button key={i} type="button" aria-label={i ? `Floor ${hex(c)}` : "As built"} className={`tg-sw${(paint.floor ?? 0) === i ? " on" : ""}${i ? "" : " none"}`} style={i ? { background: hex(c) } : undefined} disabled={busy || (paint.floor ?? 0) === i || me.bricks < PAINT_COST} onClick={() => void run("paint", { room, floor: i }, "New floor down")} />)}</div>
        {me.bricks < PAINT_COST && <p className="tg-fine">You need {PAINT_COST} coins for a coat.</p>}
      </section>
      {err && <p className="tg-err">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ leaderboard + visit + rules
function BoardPanel({ call, onVisit }: { call: Call; onVisit: (p: Pub) => void }) {
  const [kind, setKind] = useState<"xp" | "desk" | "value" | "cheers" | "bugs">("xp");
  const [d, setD] = useState<{ players: (Pub & { rank: number; score: number })[]; me: number } | null>(null);
  useEffect(() => { setD(null); call("leaderboard", undefined, { kind }).then(setD).catch(() => setD({ players: [], me: 0 })); }, [call, kind]);
  const unit = (p: Pub & { score: number }) => kind === "xp" ? `${n0(p.xp)} XP` : kind === "desk" ? `${n0(p.score ?? 0)} won` : kind === "value" ? `${n0(p.score ?? 0)} coins` : kind === "cheers" ? `${n0(p.score ?? 0)} cheers` : `${n0(p.score ?? 0)} caught`;
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Leaderboard</p><h2>Top Trenchies</h2></header>
      <div className="tg-tabs" role="tablist">{([["xp", "XP"], ["desk", "Traders"], ["value", "Land value"], ["cheers", "Cheers"], ["bugs", "Butterflies"]] as const).map(([k, l]) => <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l}</button>)}</div>
      {d && d.me > 0 && <p className="tg-sub">You&apos;re <b>#{d.me}</b>. Tap anyone to visit their land and cheer it (+{CHEER.xp} XP for you, +{CHEER.ownerBricks} coins for them).</p>}
      {!d ? <p className="tg-sub">Loading…</p> : (
        <ol className="tg-board">{d.players.map((p) => (
          <li key={p.name}><button type="button" onClick={() => onVisit(p)}>
            <span className={`tg-rk${p.rank <= 3 ? " top" : ""}`}>{p.rank}</span>
            <ArtCanvas id={p.nft} size={28} /><span className="tg-bn"><b>{p.name}</b><small>{p.x ? `@${p.x}` : `${p.hits} top-3 picks`}</small></span>
            <span className="tg-lvb">Lv {p.level}</span><em className="mono">{unit(p)}</em>
          </button></li>))}</ol>
      )}
    </div>
  );
}
function RulesPanel() {
  return (
    <ol className="tg-rules">
      <li><span>1</span><div><b>Pick 3 coins a day</b><p>Choose 3 Pons coins before 00:00 UTC. They count for the next UTC day, 00:00 to 24:00. You can change them until the lock.</p></div></li>
      <li><span>2</span><div><b>Every pick is ranked</b><p>All coins picked by anyone that day are ranked by how much their price climbs. A pick in the top 3 earns <b>{RANK_XP.join(" / ")} XP</b> and <b>{RANK_COINS.join(" / ")} coins</b> for 1st, 2nd and 3rd. Playing a day adds +{PLAY_XP} XP and +{PLAY_COINS} coins, +5 XP per day in a row (up to +50), and +{HAT_TRICK_XP} XP when all 3 make the top 3.</p></div></li>
      <li><span>3</span><div><b>The trading desk</b><p>Every land has one. Bitcoin&apos;s live price, rounds of 5 minutes: call the next round Up or Down before it starts. Right calls pay +{DESK.win.xp} XP and +{DESK.win.coins} coins, more for every win in a row (up to {DESK.streak.max}) and more again when you beat the crowd. The first {DESK.paidPerDay} calls a day pay coins.</p></div></li>
      <li><span>4</span><div><b>XP for levels, coins for things</b><p>XP raises your level (up to 40) and unlocks more to build. Coins pay for it: a bigger house, rooms, rides, furniture, garden pieces, statues, pets and paint. Each level pays {LEVEL_COINS} coins times the level, with a chest every 5 levels.</p></div></li>
      <li><span>5</span><div><b>A land like nobody else&apos;s</b><p>Move rooms to other spots in the house, paint walls and floors, and place garden pieces and statues where you want them. The rarest statues are only for achievements that take weeks of trading.</p></div></li>
      <li><span>6</span><div><b>Daily reward and quests</b><p>Claim a reward every day: it builds to a rare chest on day 7, and missing a day starts it again. Three quests a day pay XP and coins; finish all three for a chest.</p></div></li>
      <li><span>7</span><div><b>Butterflies</b><p>Swing the net every {NET_EVERY / 60} minutes. 11 kinds, from common to a legendary Golden Birdwing. Collect them all for Butterfly Wings.</p></div></li>
      <li><span>8</span><div><b>Chests, achievements, wardrobe</b><p>Chests hold coins or things to wear. Achievements pay XP, chests, rare outfits and statues. Dress your Trenchie under Trenchie.</p></div></li>
      <li><span>9</span><div><b>Cheers and invites</b><p>Cheer other lands: +{CHEER.xp} XP for you (up to {CHEER.perDay} a day), +{CHEER.ownerBricks} coins for them. Invite friends with your link: they start with +{REFERRAL.newBricks} coins, you get +{REFERRAL.refBricks} and a {REFERRAL.refChest} chest when they play their first day.</p></div></li>
      <li><span>10</span><div><b>Weekly prizes</b><p>Every week (Monday to Sunday, UTC) the 3 players whose picks earned the most XP split the prize pot: {PRIZE_SPLIT.join(" / ")}%. The pot is {PRIZE_BPS / 100}% of the $TRENCHERS creator fees that came in that week, paid out in ETH.</p></div></li>
      <li><span>11</span><div><b>Lands and chat</b><p>Make your land public (anyone can walk in) or private (you approve who joins). Members spawn there whenever they visit and can use the land&apos;s chat.</p></div></li>
      <li><span>12</span><div><b>Your Trenchie, your way</b><p>Walk it with WASD or the arrow keys (or the joystick on a phone), tap the ground to walk there, or tap something to use it. Leave it alone for 30 seconds and it goes back to its own life. It sleeps at night, sits at its desk while you trade, and the weather changes through the day.</p></div></li>
    </ol>
  );
}
function MorePanel({ me, onPrizes }: { me: Me; onPrizes: () => void }) {
  const [tab, setTab] = useState<"results" | "rules">("results");
  return (
    <div className="tg-pp">
      <div className="tg-tabs" role="tablist"><button type="button" className={tab === "results" ? "on" : ""} onClick={() => setTab("results")}>Results</button><button type="button" onClick={onPrizes}>Weekly prizes</button><button type="button" className={tab === "rules" ? "on" : ""} onClick={() => setTab("rules")}>How it works</button></div>
      {tab === "results" ? <ResultsPanel me={me} /> : <><header className="tg-ph"><p className="tg-k">How it works</p><h2>Rules</h2></header><RulesPanel /><p className="tg-fine">Coin prices come from Pons and update hourly; daily results settle after 00:00 UTC. Bitcoin comes from Coinbase, second by second.</p></>}
    </div>
  );
}
// ------------------------------------------------------------------ profile + X
function ProfilePanel({ me, palette, call, onMe, onRespawn, onShare }: { me: Me; palette: Palette; call: Call; onMe: (m: Me, bonus?: number) => void; onRespawn: () => void; onShare: () => void }) {
  const [handle, setHandle] = useState(me.xPending?.handle ?? ""); const [url, setUrl] = useState(""); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const run = async (op: string, b: Record<string, unknown>) => { setBusy(true); setErr(null); try { const j = await call(op, b); onMe(j.me, j.bonus); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  const post = me.xPending ? `My Trenchie ${me.name} just moved into the trench. ${me.xPending.code}\n\ntrenchers.io/trenchies` : "";
  return (
    <div className="tg-pp">
      <div className="tg-prof"><ArtCanvas id={me.nft} size={44} /><div><h2>{me.name}</h2><p className="tg-sub">Trencher #{me.nft} · Level {me.level} · {n0(me.xp)} XP</p></div></div>
      <Wardrobe me={me} palette={palette} call={call} onMe={(m) => onMe(m)} />
      <dl className="tg-kpis">
        <div><dt>Land value</dt><dd>{n0(me.landValue ?? 0)}</dd></div><div><dt>Cheers</dt><dd>{me.cheers ?? 0}</dd></div>
        <div><dt>Top-3 picks</dt><dd>{me.hits}</dd></div><div><dt>Achievements</dt><dd>{me.achievements?.length ?? 0}</dd></div>
      </dl>
      <div className="tg-row"><button type="button" className="tg-btn tg-btn-x" onClick={onShare}><Icon n="x" size={13} />Share your land</button><a className="tg-btn" href={inviteUrl(me.name)} target="_blank" rel="noreferrer"><Icon n="eye" size={13} />Public page</a></div>
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
      {level % 5 === 0 && <p className="tg-sub"><Icon n="chest" size={13} /> You got a {level % 10 === 0 ? "epic" : "rare"} chest. Open it under Today.</p>}
      {unlocked.length ? <><p className="tg-sub">New to build:</p><div className="tg-unl">{unlocked.map((i) => <span key={i.id}><Icon n={i.glyph} size={12} />{i.name}</span>)}</div></> : <p className="tg-sub">Keep picking: more unlocks at level {ITEMS.find((i) => i.level > level)?.level ?? level + 1}.</p>}
      <button type="button" className="tg-btn tg-btn-go tg-wide" onClick={onClose}>Nice</button>
    </div></div>
  );
}

export { levelOf };
