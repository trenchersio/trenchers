"use client";
/**
 * The reasons to come back: the daily reward calendar, the day's three quests, chests, the wardrobe on a 3D
 * turntable, achievements and the butterfly collection, and invites.
 */
import { useEffect, useRef, useState } from "react";
import { ACHIEVEMENTS, BUTTERFLIES, CHEER, COSMETICS, FISHES, FISH_EVERY, NET_EVERY, QUEST_ALL, REFERRAL, cosmetic, levelOf, type ChestTier, type Reward, type Slot, type Stat } from "@/lib/trenchies-catalog";
import { Icon } from "./icons";
import type { Call, Me, Wear } from "./model";
import type { Palette } from "./types";

const n0 = (v: number) => v.toLocaleString("en-US");
export const RARITY: Record<string, string> = { common: "#a9b3ad", uncommon: "#39ff88", rare: "#6ee7ff", epic: "#b388ff", legendary: "#ffcf3a" };
export const rewardText = (r: Reward) => [r.bricks && `${r.bricks} coins`, r.xp && `${r.xp} XP`, r.chest && `a ${r.chest} chest`].filter(Boolean).join(" + ");
function Chips({ r }: { r: Reward }) {
  return <span className="tg-chips">{r.bricks ? <span className="coin"><Icon n="coin" size={11} />{r.bricks}</span> : null}{r.xp ? <span className="xp">+{r.xp} XP</span> : null}{r.chest ? <span className={`ch ${r.chest}`}><Icon n="chest" size={11} />{r.chest}</span> : null}</span>;
}
export function statOf(me: Me, s: Stat) {
  switch (s) { case "picks": return me.rounds; case "hits": return me.hits; case "wins": return me.wins; case "hatTricks": return me.hatTricks; case "owned": return me.items.length; case "level": return levelOf(me.xp); case "species": return Object.keys(me.bugs ?? {}).length; case "fishSpecies": return Object.keys(me.fish ?? {}).length; default: return me.stats?.[s] ?? 0; }
}
const left = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`; };

// ------------------------------------------------------------------ the daily calendar
export function Calendar({ me, onClaim, busy }: { me: Me; onClaim?: () => void; busy?: boolean }) {
  const d = me.daily;
  return (
    <div className="tg-cal">
      {d.rewards.map((r, i) => {
        const upto = d.claimed && d.day === 0 ? 7 : d.day, done = i < upto, today = !d.claimed && i === d.day;
        return (
          <div key={i} className={`tg-cal-d${done ? " done" : ""}${today ? " today" : ""}${i === 6 ? " big" : ""}`}>
            <small>Day {i + 1}</small>
            <span className="tg-cal-ic"><Icon n={r.chest ? "chest" : "disc"} size={i === 6 ? 22 : 18} /></span>
            <b>{r.chest ? `${r.chest} chest` : `${r.bricks ?? 0}`}</b>
            {r.chest && r.bricks ? <em>+{r.bricks}</em> : !r.chest && r.xp ? <em>+{r.xp} XP</em> : null}
            {done && <i className="tg-cal-ok"><Icon n="check" size={11} /></i>}
          </div>
        );
      })}
      {onClaim && <button type="button" className="tg-btn tg-btn-go tg-wide tg-cal-btn" disabled={d.claimed || busy} onClick={onClaim}>{d.claimed ? <><Icon n="check" size={14} />Claimed today. Back tomorrow for day {(d.day % 7) + 1}</> : busy ? "…" : `Claim day ${d.day + 1}`}</button>}
    </div>
  );
}
export function DailyModal({ me, onClaim, onClose, busy }: { me: Me; onClaim: () => void; onClose: () => void; busy: boolean }) {
  return (
    <div className="tg-modal" onClick={onClose}><div className="tg-mbox tg-dailybox" onClick={(e) => e.stopPropagation()}>
      <p className="tg-k">Daily reward</p>
      <h2 className="tg-mh">{me.daily.run > 0 ? `${me.daily.run} day${me.daily.run === 1 ? "" : "s"} in a row` : "Welcome back"}</h2>
      <p className="tg-sub">Come back every day: the rewards grow to a rare chest on day 7. Miss a day and it starts again.</p>
      <Calendar me={me} />
      <button type="button" className="tg-btn tg-btn-go tg-wide" disabled={busy} onClick={onClaim}>{busy ? "…" : `Claim day ${me.daily.day + 1}`}</button>
    </div></div>
  );
}

// ------------------------------------------------------------------ today: daily, quests, chests, invites
const QUEST_GO: Record<string, string> = { pick: "Pick", desk: "Trade", deskwin: "Trade", crowd: "Trade", net: "Catch", visit: "Lands", cheer: "Ranks", chat: "Chat", build: "Build", wear: "Dress", chest: "Open", share: "Share" };
export function TodayPanel({ me, onClaim, claiming, onGo, onChest, onShare, invite }: { me: Me; onClaim: () => void; claiming: boolean; onGo: (id: string) => void; onChest: (t: ChestTier) => void; onShare: () => void; invite: string }) {
  const q = me.quests, done = q.list.filter((x) => x.done).length;
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* select instead */ } };
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Today</p><h2>Daily reward, quests and chests</h2></header>
      <section className="tg-box"><h3><Icon n="calendar" size={13} /> Daily reward {me.daily.run > 1 && <span className="tg-tag on">{me.daily.run} days in a row</span>}</h3><Calendar me={me} onClaim={onClaim} busy={claiming} /></section>
      <section className="tg-box">
        <h3><Icon n="quest" size={13} /> Quests <span className="tg-tag">{done}/3</span></h3>
        <ol className="tg-quests">
          {q.list.map((x) => (
            <li key={x.id} className={x.done ? "done" : ""}>
              <span className="tg-q-ic">{x.done ? <Icon n="check" size={13} /> : <Icon n="target" size={13} />}</span>
              <div className="tg-q-t"><b>{x.text}</b><span className="tg-q-bar"><i style={{ width: `${(x.n / x.goal) * 100}%` }} /></span><small className="mono">{x.n}/{x.goal} · +{x.xp} XP · +{x.bricks} coins</small></div>
              {!x.done && QUEST_GO[x.id] && <button type="button" className="tg-btn tg-btn-sm" onClick={() => onGo(x.id)}>{QUEST_GO[x.id]}</button>}
            </li>
          ))}
        </ol>
        <p className={`tg-q-all${q.bonus ? " done" : ""}`}><Icon n={q.bonus ? "check" : "chest"} size={13} />All 3 done: <Chips r={QUEST_ALL} />{q.bonus && <em>collected</em>}</p>
        <p className="tg-fine">New quests every day at 00:00 UTC.</p>
      </section>
      <section className="tg-box">
        <h3><Icon n="chest" size={13} /> Chests</h3>
        <div className="tg-chests">
          {(["common", "rare", "epic"] as ChestTier[]).map((t) => (
            <button key={t} type="button" className={`tg-chest ${t}`} disabled={!me.chests[t]} onClick={() => onChest(t)}>
              <span className="tg-chest-ic"><Icon n="chest" size={26} /></span><b>{t}</b><small>{me.chests[t] ? `${me.chests[t]} to open` : "none yet"}</small>
            </button>
          ))}
        </div>
        <p className="tg-fine">Chests come from quests, levels (every 5), achievements and invites. Inside: coins, or something new to wear.</p>
      </section>
      <section className="tg-box">
        <h3><Icon n="users" size={13} /> Invite friends</h3>
        <p className="tg-sub">Friends who join from your link get <b>+{REFERRAL.newBricks} coins</b> and a chest. When they play their first day you get <b>+{REFERRAL.refBricks} coins</b> and a <b>{REFERRAL.refChest} chest</b>.</p>
        <div className="tg-row"><input className="tg-search mono" readOnly value={invite} onFocus={(e) => e.currentTarget.select()} /><button type="button" className="tg-btn" onClick={copy}><Icon n={copied ? "check" : "link"} size={13} />{copied ? "Copied" : "Copy"}</button></div>
        <button type="button" className="tg-btn tg-btn-x" onClick={onShare}><Icon n="x" size={13} />Share your land on X</button>
      </section>
      <p className="tg-fine">Cheer other lands from the leaderboard: +{CHEER.xp} XP each (up to {CHEER.perDay} a day) and their owner gets +{CHEER.ownerBricks} coins. You cheered {me.cheeredToday} today.</p>
    </div>
  );
}

// ------------------------------------------------------------------ opening a chest
type Got = { tier: ChestTier; bricks?: number; cosmetic?: string };
export function ChestModal({ tier, call, onDone, onClose }: { tier: ChestTier; call: Call; onDone: (me: Me) => void; onClose: (tryOn: boolean) => void }) {
  const [got, setGot] = useState<Got | null>(null), [err, setErr] = useState<string | null>(null), [open, setOpen] = useState(false);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; ran.current = true;
    call("chest", { tier }).then((j: { me: Me; got: Got }) => { setGot(j.got); setTimeout(() => { setOpen(true); onDone(j.me); }, 1100); }).catch((e: Error) => setErr(e.message));
  }, [call, tier, onDone]);
  const c = got?.cosmetic ? cosmetic(got.cosmetic) : null;
  return (
    <div className="tg-modal" onClick={open || err ? () => onClose(false) : undefined}><div className={`tg-mbox tg-chestbox ${tier}`} onClick={(e) => e.stopPropagation()}>
      <p className="tg-k">{tier} chest</p>
      <div className={`tg-chest-big${open ? " open" : ""}`}><Icon n="chest" size={84} /></div>
      {err ? <p className="tg-err">{err}</p> : !open ? <p className="tg-sub">Opening…</p> : c ? (
        <><p className="tg-sub">Something new to wear</p><p className="tg-got" style={{ color: RARITY[c.rarity] }}>{c.name}</p><span className="tg-tag" style={{ color: RARITY[c.rarity] }}>{c.rarity} · {c.slot}</span></>
      ) : (
        <><p className="tg-got">{`+${n0(got?.bricks ?? 0)} coins`}</p></>
      )}
      {(open || err) && <button type="button" className="tg-btn tg-btn-go tg-wide" onClick={() => onClose(!!c)}>{c ? "Try it on" : "Nice"}</button>}
    </div></div>
  );
}

// ------------------------------------------------------------------ your Trenchie on a turntable, and the wardrobe
export function Turntable({ nft, palette, wear, className = "" }: { nft: number; palette: Palette; wear: Wear; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pv = useRef<import("./preview3d").Preview3D | null>(null);
  const wearKey = JSON.stringify(wear);
  const latest = useRef(wear); latest.current = wear;
  useEffect(() => {
    let alive = true, ro: ResizeObserver | null = null;
    import("./preview3d").then(({ Preview3D }) => {
      if (!alive || !ref.current) return;
      const p = (pv.current = new Preview3D(ref.current)); p.setWear(latest.current); p.setTrenchie(nft, palette);
      const size = () => { const r = ref.current!.getBoundingClientRect(); p.resize(Math.max(1, r.width), Math.max(1, r.height)); };
      size(); ro = new ResizeObserver(size); ro.observe(ref.current); p.start();
    });
    return () => { alive = false; ro?.disconnect(); pv.current?.dispose(); pv.current = null; };
  }, [nft, palette]);
  useEffect(() => { pv.current?.setWear(latest.current); }, [wearKey]);
  return <canvas ref={ref} className={`tg-turn ${className}`} aria-label="Your Trenchie, drag to turn" />;
}
const SLOTS: [Slot, string][] = [["hat", "Hats"], ["eyes", "Eyes"], ["neck", "Neck"], ["back", "Back"], ["aura", "Aura"], ["outline", "Outline"], ["trail", "Trail"]];
export function Wardrobe({ me, palette, call, onMe }: { me: Me; palette: Palette; call: Call; onMe: (m: Me) => void }) {
  const [slot, setSlot] = useState<Slot>("hat");
  const [trying, setTrying] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const level = levelOf(me.xp), have = new Set(me.wardrobe);
  const preview: Wear = { ...me.wear }; if (trying !== undefined) { if (trying) preview[slot] = trying; else delete preview[slot]; }
  const sel = trying !== undefined ? trying : me.wear[slot] ?? null, c = sel ? cosmetic(sel) : null;
  const run = async (op: string, body: Record<string, unknown>) => { setBusy(true); setErr(null); try { const j = await call(op, body); onMe(j.me); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); } };
  const wear = async (id: string | null) => { if (await run("wear", { slot, id })) setTrying(undefined); };
  const how = (id: string) => { const x = cosmetic(id)!; if (x.cost) return `${n0(x.cost)} coins${(x.level ?? 1) > level ? ` · Lv ${x.level}` : ""}`; if (x.chest) return "From chests"; if (x.ach) return `Achievement: ${ACHIEVEMENTS.find((a) => a.id === x.ach)?.name ?? x.ach}`; return `Lv ${x.level}`; };
  return (
    <div className="tg-ward">
      <div className="tg-turnwrap"><Turntable nft={me.nft} palette={palette} wear={preview} /><span className="tg-turn-hint">Drag to turn</span></div>
      <div className="tg-tabs" role="tablist">{SLOTS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={slot === k} className={slot === k ? "on" : ""} onClick={() => { setSlot(k); setTrying(undefined); }}>{l}</button>)}</div>
      <div className="tg-cos-grid">
        <button type="button" className={`tg-cos${!sel ? " on" : ""}`} onClick={() => setTrying(null)}><span className="tg-cos-sw none" /><b>None</b><small>&nbsp;</small></button>
        {COSMETICS.filter((x) => x.slot === slot).map((x) => {
          const own = have.has(x.id), on = me.wear[slot] === x.id;
          return (
            <button key={x.id} type="button" className={`tg-cos${sel === x.id ? " on" : ""}${own ? "" : " lock"}`} onClick={() => setTrying(x.id)} style={{ ["--r" as string]: RARITY[x.rarity] }}>
              <span className="tg-cos-sw" style={{ background: x.color ?? RARITY[x.rarity] }}>{!own && <Icon n="lock" size={11} />}</span>
              <b>{x.name}</b><small>{on ? "wearing" : own ? x.rarity : how(x.id)}</small>
            </button>
          );
        })}
      </div>
      {trying !== undefined && (
        <div className="tg-cos-act">
          {!trying ? <button type="button" className="tg-btn tg-btn-go tg-wide" disabled={busy || !me.wear[slot]} onClick={() => wear(null)}>Take it off</button>
            : have.has(trying) ? <button type="button" className="tg-btn tg-btn-go tg-wide" disabled={busy || me.wear[slot] === trying} onClick={() => wear(trying)}>{me.wear[slot] === trying ? "Wearing it" : `Wear ${c?.name}`}</button>
            : c?.cost && (c.level ?? 1) <= level ? <button type="button" className="tg-btn tg-btn-go tg-wide" disabled={busy || me.bricks < c.cost} onClick={async () => { if (await run("cosmetic/buy", { id: trying })) await wear(trying); }}><Icon n="coin" size={13} />Buy for {n0(c.cost)} coins</button>
            : <p className="tg-sub">Trying it on. {how(trying)} unlocks it.</p>}
        </div>
      )}
      {err && <p className="tg-err">{err}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ collection: achievements and butterflies
export function CollectionPanel({ me, now, onNet, onFish }: { me: Me; now: number; onNet: () => void; onFish?: () => void }) {
  const [tab, setTab] = useState<"ach" | "bugs" | "fish">("ach");
  const fish = me.fish ?? {}, fishKinds = Object.keys(fish).length, fishN = Object.values(fish).reduce((a, b) => a + b, 0), bite = !me.fishAt || me.fishAt <= now * 1000;
  const species = Object.keys(me.bugs ?? {}).length, caught = Object.values(me.bugs ?? {}).reduce((a, b) => a + b, 0), ready = !me.netAt || me.netAt <= now * 1000;
  return (
    <div className="tg-pp">
      <header className="tg-ph"><p className="tg-k">Collection</p><h2>{tab === "ach" ? `${me.achievements.length} of ${ACHIEVEMENTS.length} achievements` : tab === "fish" ? `${fishKinds} of ${FISHES.length} fish` : `${species} of ${BUTTERFLIES.length} butterflies`}</h2></header>
      <div className="tg-tabs" role="tablist"><button type="button" className={tab === "ach" ? "on" : ""} onClick={() => setTab("ach")}>Achievements</button><button type="button" className={tab === "bugs" ? "on" : ""} onClick={() => setTab("bugs")}>Butterflies</button><button type="button" className={tab === "fish" ? "on" : ""} onClick={() => setTab("fish")}>Fish</button></div>
      {tab === "ach" ? (
        <ol className="tg-achs">
          {[...ACHIEVEMENTS].sort((a, b) => Number(me.achievements.includes(b.id)) - Number(me.achievements.includes(a.id))).map((a) => {
            const got = me.achievements.includes(a.id), v = Math.min(a.goal, statOf(me, a.stat));
            return (
              <li key={a.id} className={got ? "got" : ""}>
                <span className="tg-ach-ic"><Icon n={got ? "medal" : "lock"} size={16} /></span>
                <div><b>{a.name}</b><small>{a.text}</small>{!got && <span className="tg-q-bar"><i style={{ width: `${(v / a.goal) * 100}%` }} /></span>}</div>
                <span className="tg-ach-r">{a.xp ? <em>+{a.xp} XP</em> : null}{a.chest && <em className={`ch ${a.chest}`}>{a.chest} chest</em>}{a.cosmetic && <em className="cos">{cosmetic(a.cosmetic)?.name}</em>}{!got && <small className="mono">{n0(v)}/{n0(a.goal)}</small>}</span>
              </li>
            );
          })}
        </ol>
      ) : tab === "fish" ? (<>
        <div className="tg-netbar"><span><Icon n="fish" size={14} />{n0(fishN)} caught</span>{bite ? <button type="button" className="tg-btn tg-btn-sm tg-btn-go" onClick={onFish}>Go fishing</button> : <span className="tg-tag">next cast in {left((me.fishAt ?? 0) - now * 1000)}</span>}</div>
        <ol className="tg-bugs">
          {FISHES.map((f) => { const n = fish[f.id] ?? 0, c = f.rarity === "mythic" ? "#ff5cf0" : RARITY[f.rarity]; return (
            <li key={f.id} className={n ? "got" : ""} style={{ ["--c" as string]: f.color, ["--r" as string]: c }}>
              <span className="tg-bug-ic"><Icon n="fish" size={22} /></span>
              <b>{n ? f.name : "???"}</b><small style={{ color: c }}>{f.rarity}{f.night ? " · night" : ""}</small><em className="mono">{n ? `×${n}` : `+${f.xp} XP`}</em>
            </li>); })}
        </ol>
        <p className="tg-fine">Cast a line from the dock every {FISH_EVERY / 60} minutes. Most bites are common. The Neon Koi turns up about once in 600 casts, and the Moon Whale only bites at night (UTC), about once in 4,000.</p>
      </>) : (<>
        <div className="tg-netbar"><span><Icon n="bug" size={14} />{n0(caught)} caught</span>{ready ? <button type="button" className="tg-btn tg-btn-sm tg-btn-go" onClick={onNet}>Catch butterflies</button> : <span className="tg-tag">net ready in {left(me.netAt - now * 1000)}</span>}</div>
        <ol className="tg-bugs">
          {BUTTERFLIES.map((b) => { const n = me.bugs?.[b.id] ?? 0; return (
            <li key={b.id} className={n ? "got" : ""} style={{ ["--c" as string]: b.color, ["--r" as string]: RARITY[b.rarity] }}>
              <span className="tg-bug-ic"><Icon n="bug" size={22} /></span>
              <b>{n ? b.name : "???"}</b><small style={{ color: RARITY[b.rarity] }}>{b.rarity}{b.night ? " · night" : ""}</small><em className="mono">{n ? `×${n}` : `+${b.xp} XP`}</em>
            </li>); })}
        </ol>
        <p className="tg-fine">Swing the net every {NET_EVERY / 60} minutes. The Butterfly Garden brings rarer ones; the Neon Moth only comes out at night (UTC). Catch all {BUTTERFLIES.length} for the Butterfly Wings.</p>
      </>)}
    </div>
  );
}
