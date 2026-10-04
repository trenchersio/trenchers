"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { TextButton } from "@/components/TextButton";
import { useWallet, short } from "@/lib/wallet";
import { ownedIds, loadAgent } from "@/lib/agents-store";
import { createSim, pct, type Sim } from "@/lib/arena-sim";
import { PALETTES, STATUS_LABEL, SUPPLY, paletteOf, sample, traits, type Sample, type Status } from "@/lib/collection";
import { loadArt } from "@/lib/art-vector";
import { ArtCanvas } from "./ArtCanvas";
import { LIST_PRICE_ETH, OPENSEA_URL, ROUTES, gmgnToken } from "@/lib/constants";
import { AgentLinks } from "@/components/AgentLinks";

const ALL = Array.from({ length: SUPPLY }, (_, i) => i + 1);
type Filter = "all" | Status | "mine";
type Size = "s" | "m" | "l";

/** Sample data for every token, with the connected holder's own Trenchers taken from this browser. */
function useBook(address: string | null) {
  const [ver, setVer] = useState(0);
  useEffect(() => {
    const f = () => setVer((v) => v + 1);
    window.addEventListener("trenchers-agents-changed", f);
    return () => window.removeEventListener("trenchers-agents-changed", f);
  }, []);
  return useMemo(() => {
    const book = new Map<number, Sample & { mine: boolean }>();
    for (const id of ALL) book.set(id, { ...sample(id), mine: false });
    if (address) {
      for (const id of ownedIds(address)) {
        const a = loadAgent(address, id);
        book.set(id, {
          status: a.live ? "live" : a.registered ? "registered" : "idle", owner: address, listed: false,
          wallet: a.agentWallet, identity: a.identityId, strategy: a.strategy?.preset ?? null, balance: a.registered ? a.balance : null, mine: true,
          coin: a.token?.symbol ?? null, coinAddress: a.token?.address ?? null,
        });
      }
    }
    return book;
  }, [address, ver]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function Collection() {
  const { address } = useWallet();
  const book = useBook(address);
  const [filter, setFilter] = useState<Filter>("all");
  const [palette, setPalette] = useState("");
  const [q, setQ] = useState("");
  const [size, setSize] = useState<Size>("m");
  const [sel, setSel] = useState<number | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);
  useEffect(() => { const t = setTimeout(() => setSim(createSim()), 50); return () => clearTimeout(t); }, []);
  useEffect(() => { loadArt().catch(() => {}); }, []);

  const counts = useMemo(() => {
    const c = { live: 0, registered: 0, idle: 0, mine: 0 };
    book.forEach((b) => { c[b.status]++; if (b.mine) c.mine++; });
    return c;
  }, [book]);

  const ids = useMemo(() => {
    const n = Number(q.replace(/[^\d]/g, ""));
    return ALL.filter((id) => {
      const b = book.get(id)!;
      if (filter === "mine" ? !b.mine : filter !== "all" && b.status !== filter) return false;
      if (palette && paletteOf(id) !== palette) return false;
      if (q.trim() && n && !String(id).startsWith(String(n))) return false;
      return true;
    });
  }, [book, filter, palette, q]);

  const FILTERS: [Filter, string, number][] = [
    ["all", "All", SUPPLY], ["live", "In the Arena", counts.live], ["registered", "Awake", counts.registered], ["idle", "Dormant · 0.01 claimable", counts.idle],
  ];
  if (address) FILTERS.push(["mine", "Yours", counts.mine]);

  const pos = sel === null ? -1 : ids.indexOf(sel);
  const go = (d: number) => { if (pos < 0 || !ids.length) return; setSel(ids[(pos + d + ids.length) % ids.length]); };

  return (
    <div className="coll">
      <header className="coll-head">
        <div>
          <p className="eyebrow">Collection</p>
          <h1>2,000 agents</h1>
          <p className="coll-lede">Every Trencher, in colour once its agent is awake. Grey ones are dormant: their 0.01 ETH starter balance is still waiting to be claimed. The NFT's own metadata follows the same state on OpenSea. Select any of them for its owner, funding, strategy and traits.</p>
        </div>
        <dl className="coll-stats">
          <div><dt className="mono">In the Arena</dt><dd><i className="lg-live" />{counts.live}</dd></div>
          <div><dt className="mono">Awake</dt><dd><i className="lg-reg" />{counts.registered}</dd></div>
          <div><dt className="mono">Dormant</dt><dd><i className="lg-idle" />{counts.idle}</dd></div>
          <div><dt className="mono">Price</dt><dd>{LIST_PRICE_ETH} <small>ETH</small></dd></div>
        </dl>
      </header>

      <div className="coll-bar">
        <div className="coll-filters" role="tablist" aria-label="Filter by status">
          {FILTERS.map(([k, label, n]) => (
            <button key={k} type="button" role="tab" aria-selected={filter === k} className={`tbtn${filter === k ? " tbtn-on" : ""}`} onClick={() => setFilter(k)}>
              {label} <span className="coll-n">{n}</span>
            </button>
          ))}
        </div>
        <div className="coll-tools">
          <label className="coll-search">
            <span className="mono">#</span>
            <input className="mono" inputMode="numeric" placeholder="Token ID" value={q} onChange={(e) => setQ(e.target.value.replace(/[^\d]/g, "").slice(0, 4))} aria-label="Search by token ID" />
          </label>
          <label className="coll-select">
            <span className="sr-only">Palette</span>
            <select className="mono" value={palette} onChange={(e) => setPalette(e.target.value)} aria-label="Filter by palette">
              <option value="">All palettes</option>
              {PALETTES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <div className="coll-size" role="group" aria-label="Tile size">
            {(["s", "m", "l"] as Size[]).map((s) => (
              <button key={s} type="button" className={`tbtn${size === s ? " tbtn-on" : ""}`} aria-pressed={size === s} onClick={() => setSize(s)}>{s.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </div>

      <Wall ids={ids} book={book} size={size} onPick={setSel} />

      {sel !== null && book.get(sel) && (
        <Popup onClose={() => setSel(null)} onPrev={() => go(-1)} onNext={() => go(1)} label={`Trencher #${sel}`}>
          <Detail id={sel} b={book.get(sel)!} sim={sim} />
        </Popup>
      )}
    </div>
  );
}

const TILE: Record<Size, number> = { s: 40, m: 68, l: 112 };
const GAP: Record<Size, number> = { s: 3, m: 5, l: 8 };

/** The tile wall: only the rows on screen are drawn, each tile as crisp vector art. */
function Wall({ ids, book, size, onPick }: { ids: number[]; book: Map<number, Sample & { mine: boolean }>; size: Size; onPick: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [view, setView] = useState({ top: 0, h: 900 });
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el); setW(el.clientWidth);
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setView({ top: -el.getBoundingClientRect().top, h: window.innerHeight })); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { ro.disconnect(); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(raf); };
  }, []);
  const small = w > 0 && w < 600;
  const want = small ? Math.round(TILE[size] * 0.8) : TILE[size];
  const gap = GAP[size];
  const cols = Math.max(1, Math.floor((w + gap) / (want + gap)));
  const tile = w ? (w - gap * (cols - 1)) / cols : want;
  const rowH = tile + gap;
  const rows = Math.ceil(ids.length / cols);
  const buffer = 3;
  const first = Math.max(0, Math.floor(view.top / rowH) - buffer);
  const last = Math.min(rows - 1, Math.ceil((view.top + view.h) / rowH) + buffer);
  const shown: { id: number; x: number; y: number }[] = [];
  if (w) for (let r = first; r <= last; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; if (i >= ids.length) break;
    shown.push({ id: ids[i], x: c * (tile + gap), y: r * rowH });
  }
  return (
    <div ref={ref} className={`wall wall-${size}`} style={{ height: rows ? rows * rowH - gap : 120 }}>
      {shown.map(({ id, x, y }) => {
        const b = book.get(id)!;
        return (
          <button key={id} type="button" className={`tile t-${b.status}${b.mine ? " t-mine" : ""}${id <= 5 ? " t-house" : ""}`}
            style={{ transform: `translate(${x}px, ${y}px)`, width: tile, height: tile }}
            onClick={() => onPick(id)} aria-label={`Trencher #${id}, ${STATUS_LABEL[b.status]}`}>
            <ArtCanvas id={id} size={Math.round(tile)} />
            <span className="tile-id mono">#{id}</span>
          </button>
        );
      })}
      {!ids.length && <p className="coll-empty mono">No Trenchers match these filters.</p>}
    </div>
  );
}

function Popup({ children, onClose, onPrev, onNext, label }: { children: React.ReactNode; onClose: () => void; onPrev: () => void; onNext: () => void; label: string }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowLeft") onPrev(); if (e.key === "ArrowRight") onNext(); };
    window.addEventListener("keydown", key);
    document.documentElement.classList.add("menu-open");
    return () => { window.removeEventListener("keydown", key); document.documentElement.classList.remove("menu-open"); };
  }, [onClose, onPrev, onNext]);
  return (
    <div className="pop-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pop" role="dialog" aria-modal="true" aria-label={label}>
        <div className="pop-nav">
          <button type="button" className="tbtn" onClick={onPrev} aria-label="Previous Trencher">← Prev</button>
          <button type="button" className="tbtn" onClick={onNext} aria-label="Next Trencher">Next →</button>
          <button type="button" className="tbtn pop-close" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Detail({ id, b, sim }: { id: number; b: Sample & { mine: boolean }; sim: Sim | null }) {
  const agent = b.status === "live" && !b.mine ? sim?.agents.find((a) => a.id === id) : undefined;
  const house = id <= 5;
  const strategy = agent ? (agent.rule ? "Custom, guided by holder" : `${agent.strategy} (template)`) : b.strategy === "Custom" ? "Custom, guided by holder" : b.strategy ? `${b.strategy} (template)` : null;
  const owner = agent?.owner ?? b.owner;
  const wallet = agent?.wallet ?? b.wallet;
  const coin = agent ? agent.token : b.coin;
  const coinAddress = agent ? agent.tokenAddress : b.coinAddress;
  const ret = agent ? pct(agent) : null;
  return (
    <div className="cd">
      <div className="cd-art-col">
        <ArtCanvas id={id} size={440} className="cd-art" />
        <div className="cd-traits">
          <h3 className="mono">Traits</h3>
          <dl>
            {traits(id).map((t) => <div key={t.key}><dt>{t.key}</dt><dd>{t.value}</dd></div>)}
          </dl>
        </div>
      </div>
      <div className="cd-info">
        <div className="cd-title">
          <h2>Trencher #{id}</h2>
          <div className="cd-badges">
            <span className={`cd-status s-${b.status}`}><i />{STATUS_LABEL[b.status]}</span>
            {house && <span className="house">House agent</span>}
            {b.mine && <span className="cd-yours mono">Yours</span>}
          </div>
        </div>

      <dl className="cd-facts">
        <div><dt>Starter ETH</dt><dd className="mono">{id <= 5 ? <span className="cd-muted">House agent</span> : b.status === "idle" ? <span className="up">0.01 ETH claimable</span> : <span className="cd-muted">Claimed</span>}</dd></div>
        <div><dt>Owner</dt><dd className="mono">{b.mine ? `You · ${short(owner)}` : owner.startsWith("0x") ? short(owner) : owner}</dd></div>
        {b.status !== "idle" && (
          <div><dt>Funding</dt><dd className="mono">{coin && coinAddress
            ? <a className="fund-coin" href={gmgnToken(coinAddress)} target="_blank" rel="noreferrer">Coin ${coin} ↗</a>
            : <span className="fund-self">Self-funded</span>}</dd></div>
        )}
        <div><dt>Strategy</dt><dd>{strategy ?? <span className="cd-muted">{b.status === "idle" ? "None, dormant" : "Not set yet"}</span>}</dd></div>
        {wallet && <div><dt>Agent wallet</dt><dd className="mono">{short(wallet)}</dd></div>}
        {b.identity && <div><dt>Identity</dt><dd className="mono">ERC-8004 #{b.identity}</dd></div>}
        {agent ? (<>
          <div><dt>Agent value</dt><dd className="mono">{agent.nav.toFixed(3)} ETH</dd></div>
          <div><dt>This week</dt><dd className={`mono ${ret! >= 0 ? "up" : "down"}`}>{ret! >= 0 ? "+" : ""}{ret!.toFixed(1)}%</dd></div>
          <div><dt>Arena rank</dt><dd className="mono">#{agent.rank + 1} of {sim!.agents.length}</dd></div>
          <div><dt>Self-funded</dt><dd className="mono">{(agent.tokenFees + agent.shareFees).toFixed(4)} ETH</dd></div>
          <div><dt>Win rate</dt><dd className="mono">{agent.closed ? Math.round((agent.wins / agent.closed) * 100) : 0}% · {agent.trades.length} trades</dd></div>
        </>) : b.balance !== null ? (
          <div><dt>Balance</dt><dd className="mono">{b.balance.toFixed(3)} ETH</dd></div>
        ) : (
          <div><dt>Market</dt><dd>{b.listed ? "Listed for resale on OpenSea" : "Held, not listed"}</dd></div>
        )}
      </dl>

      {wallet && (
        <div className="cd-verify">
          <span className="mono">Verify trading activity</span>
          <AgentLinks wallet={wallet} />
        </div>
      )}

      <div className="cd-actions">
        {b.status === "live" && <TextButton href={`${ROUTES.arena}#agent-${id}`}>View in the Arena</TextButton>}
        {b.mine && <TextButton href={ROUTES.agents}>Manage agent</TextButton>}
        {OPENSEA_URL ? <TextButton href={OPENSEA_URL} external>OpenSea</TextButton> : <span className="tbtn tbtn-static">OpenSea</span>}
      </div>

      <p className="cd-note">Sample data until the contracts are live.</p>
      </div>
    </div>
  );
}
