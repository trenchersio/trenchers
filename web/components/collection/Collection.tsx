"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseAbiItem, formatEther, type Address } from "viem";
import { TextButton } from "@/components/TextButton";
import { useWallet, short } from "@/lib/wallet";
import { PALETTES, STATUS_LABEL, SUPPLY, paletteOf, traits, type Status } from "@/lib/collection";
import { loadArt } from "@/lib/art-vector";
import { ArtCanvas } from "./ArtCanvas";
import { ENGINE_URL, LIST_PRICE_ETH, OPENSEA_URL, ROUTES, openseaItem } from "@/lib/constants";
import { ABI, DEPLOYMENT, cachedOwned, ownedTrenchers, reader } from "@/lib/chain";
import { AgentLinks } from "@/components/AgentLinks";

const ALL = Array.from({ length: SUPPLY }, (_, i) => i + 1);
type Filter = "all" | Status | "mine";
type Size = "s" | "m" | "l";
type EngineAgent = { id: number; rank: number; live: boolean; rule: string | null; ruleVersion: number; nav: number; pnlPct: number; trades: number; wins: number; closed: number; wallet: string };
type Entry = { status: Status; mine: boolean; agent: EngineAgent | null };
const CLAIMED = parseAbiItem("event Claimed(uint256 indexed tokenId, address indexed holder, address indexed agentWallet, uint256 amount)");

/** The live state of all 2,000 Trenchers: minted or not, dormant or awake, trading in the Arena, and yours. */
function useBook(address: string | null) {
  const [supply, setSupply] = useState<number | null>(null);
  const [claimed, setClaimed] = useState<Set<number>>(new Set());
  const [agents, setAgents] = useState<Map<number, EngineAgent>>(new Map());
  const [mine, setMine] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!DEPLOYMENT) { setSupply(0); return; }
    const d = DEPLOYMENT, c = reader();
    let alive = true;
    const load = async () => {
      try {
        const [s, head] = await Promise.all([c.readContract({ address: d.nft, abi: ABI.nft, functionName: "totalSupply" }), c.getBlockNumber()]);
        const STEP = 50_000n, ranges: [bigint, bigint][] = [];
        for (let f = BigInt(d.startBlock); f <= head; f += STEP) ranges.push([f, f + STEP - 1n < head ? f + STEP - 1n : head]);
        const logs = (await Promise.all(ranges.map(([a, b]) => c.getLogs({ address: d.fund, event: CLAIMED, fromBlock: a, toBlock: b })))).flat();
        if (!alive) return;
        setSupply(Number(s));
        setClaimed(new Set(logs.map((l) => Number(l.args.tokenId))));
      } catch { if (alive) setSupply((x) => x ?? 0); }
    };
    const feed = () => fetch(`${ENGINE_URL}/arena`, { cache: "no-store" }).then((r) => r.json()).then((j: { agents?: EngineAgent[] }) => {
      if (alive && j.agents) setAgents(new Map(j.agents.map((a) => [a.id, a])));
    }).catch(() => {});
    load(); feed();
    const iv = setInterval(() => { load(); feed(); }, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  useEffect(() => {
    if (!address || !DEPLOYMENT) { setMine(new Set()); return; }
    setMine(new Set(cachedOwned(address as Address) ?? []));
    ownedTrenchers(address as Address).then((ids) => setMine(new Set(ids))).catch(() => {});
  }, [address]);
  const book = useMemo(() => {
    const m = new Map<number, Entry>();
    for (const id of ALL) {
      const agent = agents.get(id) ?? null;
      const minted = supply !== null && id <= supply;
      const awake = minted && (id <= 5 || claimed.has(id));
      const status: Status = !minted ? "unminted" : agent?.live ? "live" : awake ? "registered" : "idle";
      m.set(id, { status, mine: mine.has(id), agent });
    }
    return m;
  }, [supply, claimed, agents, mine]);
  return { book, supply };
}

export function Collection() {
  const { address } = useWallet();
  const { book, supply } = useBook(address);
  const [filter, setFilter] = useState<Filter>("all");
  const [palette, setPalette] = useState("");
  const [q, setQ] = useState("");
  const [size, setSize] = useState<Size>("m");
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => { loadArt().catch(() => {}); }, []);

  const counts = useMemo(() => {
    const c = { live: 0, registered: 0, idle: 0, unminted: 0, mine: 0 };
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
    ["all", "All", SUPPLY], ["live", "In the Arena", counts.live], ["registered", "Awake", counts.registered], ["idle", "Dormant · 0.01 claimable", counts.idle], ["unminted", "Not minted yet", counts.unminted],
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
          <p className="coll-lede">Every Trencher, live from Robinhood Chain: in colour once its agent is awake, grey while it&apos;s dormant (its 0.01 ETH starter balance still waiting to be claimed), faded until it&apos;s minted. The NFT&apos;s own metadata follows the same state on OpenSea. Select any of them for its owner, agent wallet, strategy and traits.</p>
        </div>
        <dl className="coll-stats">
          <div><dt className="mono">In the Arena</dt><dd><i className="lg-live" />{counts.live}</dd></div>
          <div><dt className="mono">Awake</dt><dd><i className="lg-reg" />{counts.registered}</dd></div>
          <div><dt className="mono">Dormant</dt><dd><i className="lg-idle" />{counts.idle}</dd></div>
          <div><dt className="mono">Minted</dt><dd>{supply === null ? "…" : supply.toLocaleString("en-US")} <small>/ 2,000</small></dd></div>
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
          <Detail id={sel} b={book.get(sel)!} of={[...book.values()].filter((x) => x.agent).length} />
        </Popup>
      )}
    </div>
  );
}

const TILE: Record<Size, number> = { s: 40, m: 68, l: 112 };
const GAP: Record<Size, number> = { s: 3, m: 5, l: 8 };

/** The tile wall: only the rows on screen are drawn, each tile as crisp vector art. */
function Wall({ ids, book, size, onPick }: { ids: number[]; book: Map<number, Entry>; size: Size; onPick: (id: number) => void }) {
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

function Detail({ id, b, of }: { id: number; b: Entry; of: number }) {
  const house = id <= 5;
  const [owner, setOwner] = useState<string | null>(null);
  const [wallet, setWallet] = useState<{ address: string; bal: bigint; deployed: boolean } | null>(null);
  useEffect(() => {
    setOwner(null); setWallet(null);
    if (!DEPLOYMENT || b.status === "unminted") return;
    const d = DEPLOYMENT, c = reader();
    c.readContract({ address: d.nft, abi: ABI.nft, functionName: "ownerOf", args: [BigInt(id)] }).then(setOwner).catch(() => {});
    if (b.status === "idle") return;
    c.readContract({ address: d.fund, abi: ABI.fund, functionName: "agentWallet", args: [BigInt(id)] }).then(async (w) => {
      const [code, bal] = await Promise.all([c.getCode({ address: w }), c.getBalance({ address: w })]);
      setWallet({ address: w, bal, deployed: !!code && code !== "0x" });
    }).catch(() => {});
  }, [id, b.status]);
  const a = b.agent;
  const ret = a?.pnlPct ?? null;
  return (
    <div className="cd">
      <div className="cd-art-col">
        <ArtCanvas id={id} size={440} className={`cd-art${b.status === "idle" || b.status === "unminted" ? " is-dormant" : ""}`} />
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

      {b.status === "unminted" ? (
        <dl className="cd-facts">
          <div><dt>Status</dt><dd>Not minted yet</dd></div>
          <div><dt>Mint price</dt><dd className="mono">{LIST_PRICE_ETH} ETH, with 0.01 ETH for its agent</dd></div>
        </dl>
      ) : (
        <dl className="cd-facts">
          <div><dt>Starter ETH</dt><dd className="mono">{house ? <span className="cd-muted">House agent, none</span> : b.status === "idle" ? <span className="up">0.01 ETH claimable</span> : <span className="cd-muted">Claimed</span>}</dd></div>
          <div><dt>Owner</dt><dd className="mono">{owner ? (b.mine ? `You · ${short(owner)}` : short(owner)) : "…"}</dd></div>
          <div><dt>Strategy</dt><dd>{a?.rule ?? <span className="cd-muted">{b.status === "idle" ? "None, dormant" : "Not set yet"}</span>}</dd></div>
          {wallet?.deployed && <div><dt>Agent wallet</dt><dd className="mono">{short(wallet.address)}</dd></div>}
          {wallet?.deployed && <div><dt>Balance</dt><dd className="mono">{Number(formatEther(wallet.bal)).toFixed(4)} ETH</dd></div>}
          {a && ret !== null && (<>
            <div><dt>This week</dt><dd className={`mono ${ret >= 0 ? "up" : "down"}`}>{ret >= 0 ? "+" : ""}{ret.toFixed(1)}%</dd></div>
            <div><dt>Arena rank</dt><dd className="mono">#{a.rank} of {of}</dd></div>
            <div><dt>Trades</dt><dd className="mono">{a.trades} · {a.closed ? Math.round((a.wins / a.closed) * 100) : 0}% won</dd></div>
          </>)}
        </dl>
      )}

      {wallet?.deployed && (
        <div className="cd-verify">
          <span className="mono">Verify trading activity</span>
          <AgentLinks wallet={wallet.address} />
        </div>
      )}

      <div className="cd-actions">
        {b.status === "unminted" && <TextButton href={ROUTES.mint}>Mint a Trencher</TextButton>}
        {a && <TextButton href={`${ROUTES.arena}#agent-${id}`}>View in the Arena</TextButton>}
        {b.mine && <TextButton href={ROUTES.agents}>Manage agent</TextButton>}
        {b.status !== "unminted" && <TextButton href={openseaItem(id)} external>OpenSea</TextButton>}
        {b.status === "unminted" && OPENSEA_URL && <TextButton href={OPENSEA_URL} external>OpenSea</TextButton>}
      </div>
      </div>
    </div>
  );
}
