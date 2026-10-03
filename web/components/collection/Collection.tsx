"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { TextButton } from "@/components/TextButton";
import { useWallet, short } from "@/lib/wallet";
import { ownedIds, loadAgent } from "@/lib/agents-store";
import { createSim, pct, type Sim } from "@/lib/arena-sim";
import { PALETTES, STATUS_LABEL, SUPPLY, paletteOf, sample, sheetOf, sprite, traits, type Sample, type Status } from "@/lib/collection";
import { LIST_PRICE_ETH, OPENSEA_URL, ROUTES } from "@/lib/constants";
import { AgentLinks } from "@/components/AgentLinks";

const PREVIEW = process.env.NEXT_PUBLIC_PREVIEW === "1";
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
  const [sel, setSel] = useState(1);
  const [sheet, setSheet] = useState(false); // detail as a bottom sheet on small screens
  const [sim, setSim] = useState<Sim | null>(null);
  useEffect(() => { const t = setTimeout(() => setSim(createSim()), 50); return () => clearTimeout(t); }, []);

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

  // Load each sprite sheet only once one of its tiles comes near the screen.
  const [sheets, setSheets] = useState<Set<number>>(() => new Set([0]));
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = gridRef.current; if (!root) return;
    const io = new IntersectionObserver((entries) => {
      const add: number[] = [];
      for (const e of entries) if (e.isIntersecting) add.push(Number((e.target as HTMLElement).dataset.sheet));
      if (add.length) setSheets((s) => { const n = new Set(s); add.forEach((x) => n.add(x)); return n.size === s.size ? s : n; });
    }, { rootMargin: "800px 0px" });
    root.querySelectorAll<HTMLElement>("[data-edge]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [ids]);

  const edges = useMemo(() => {
    const e = new Set<number>();
    ids.forEach((id, i) => {
      if (i === 0 || sheetOf(ids[i - 1]) !== sheetOf(id) || i === ids.length - 1 || sheetOf(ids[i + 1]) !== sheetOf(id) || i % 40 === 0) e.add(id);
    });
    return e;
  }, [ids]);

  function choose(id: number) {
    setSel(id);
    if (window.matchMedia("(max-width: 1000px)").matches) setSheet(true);
  }

  const FILTERS: [Filter, string, number][] = [
    ["all", "All", SUPPLY], ["live", "In the Arena", counts.live], ["registered", "Registered", counts.registered], ["idle", "Not registered", counts.idle],
  ];
  if (address) FILTERS.push(["mine", "Yours", counts.mine]);

  return (
    <div className="coll">
      <header className="coll-head">
        <div>
          <p className="eyebrow">Collection</p>
          <h1>2,000 agents</h1>
          <p className="coll-lede">Every Trencher, in colour once it is registered as an agent. Greyed-out ones are waiting for a holder to wake them up. Select any of them for its owner, strategy and traits.</p>
        </div>
        <dl className="coll-stats">
          <div><dt className="mono">In the Arena</dt><dd><i className="lg-live" />{counts.live}</dd></div>
          <div><dt className="mono">Registered</dt><dd><i className="lg-reg" />{counts.registered}</dd></div>
          <div><dt className="mono">Not registered</dt><dd><i className="lg-idle" />{counts.idle}</dd></div>
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

      <div className="coll-body">
        <div ref={gridRef} className={`coll-grid coll-${size}`}>
          {ids.map((id) => {
            const b = book.get(id)!;
            const sh = sheetOf(id);
            return (
              <button key={id} type="button" data-sheet={sh} data-edge={edges.has(id) ? "" : undefined}
                className={`tile t-${b.status}${sel === id ? " t-sel" : ""}${b.mine ? " t-mine" : ""}${id <= 5 ? " t-house" : ""}`}
                style={sheets.has(sh) ? sprite(id) : undefined}
                onClick={() => choose(id)} aria-label={`Trencher #${id}, ${STATUS_LABEL[b.status]}`} aria-pressed={sel === id}>
                <span className="tile-id mono">{id}</span>
              </button>
            );
          })}
          {!ids.length && <p className="coll-empty mono">No Trenchers match these filters.</p>}
        </div>

        <aside className={`coll-detail${sheet ? " open" : ""}`} aria-label={`Trencher #${sel}`}>
          <div className="coll-detail-inner">
            <button type="button" className="tbtn coll-close" onClick={() => setSheet(false)}>Close</button>
            <Detail id={sel} b={book.get(sel)!} sim={sim} />
          </div>
        </aside>
        {sheet && <button type="button" className="coll-scrim" aria-label="Close details" onClick={() => setSheet(false)} />}
      </div>
    </div>
  );
}

function Art({ id }: { id: number }) {
  const [failed, setFailed] = useState(PREVIEW);
  useEffect(() => setFailed(PREVIEW), [id]);
  const style: CSSProperties = sprite(id);
  return failed
    ? <div className="cd-art" style={style} role="img" aria-label={`Trencher #${id}`} />
    : <img className="cd-art" src={`nft-md/${id}.webp`} alt={`Trencher #${id}`} width={320} height={320} onError={() => setFailed(true)} />;
}

function Detail({ id, b, sim }: { id: number; b: Sample & { mine: boolean }; sim: Sim | null }) {
  const agent = b.status === "live" && !b.mine ? sim?.agents.find((a) => a.id === id) : undefined;
  const house = id <= 5;
  const strategy = agent?.strategy ?? b.strategy;
  const owner = agent?.owner ?? b.owner;
  const wallet = agent?.wallet ?? b.wallet;
  const ret = agent ? pct(agent) : null;
  return (
    <>
      <div className="cd-top">
        <Art id={id} />
        <div className="cd-title">
          <h2>Trencher #{id}</h2>
          <div className="cd-badges">
            <span className={`cd-status s-${b.status}`}><i />{STATUS_LABEL[b.status]}</span>
            {house && <span className="house">House agent</span>}
            {b.mine && <span className="cd-yours mono">Yours</span>}
          </div>
        </div>
      </div>

      <dl className="cd-facts">
        <div><dt>Owner</dt><dd className="mono">{b.mine ? `You · ${short(owner)}` : owner.startsWith("0x") ? short(owner) : owner}</dd></div>
        <div><dt>Strategy</dt><dd>{strategy ?? <span className="cd-muted">{b.status === "idle" ? "None, not registered" : "Not set yet"}</span>}</dd></div>
        {wallet && <div><dt>Agent wallet</dt><dd className="mono">{short(wallet)}</dd></div>}
        {b.identity && <div><dt>Identity</dt><dd className="mono">ERC-8004 #{b.identity}</dd></div>}
        {agent ? (<>
          <div><dt>Agent value</dt><dd className="mono">{agent.nav.toFixed(3)} ETH</dd></div>
          <div><dt>This week</dt><dd className={`mono ${ret! >= 0 ? "up" : "down"}`}>{ret! >= 0 ? "+" : ""}{ret!.toFixed(1)}%</dd></div>
          <div><dt>Arena rank</dt><dd className="mono">#{agent.rank + 1} of {sim!.agents.length}</dd></div>
          <div><dt>Win rate</dt><dd className="mono">{agent.closed ? Math.round((agent.wins / agent.closed) * 100) : 0}% · {agent.trades.length} trades</dd></div>
        </>) : b.balance !== null ? (
          <div><dt>Balance</dt><dd className="mono">{b.balance.toFixed(3)} ETH</dd></div>
        ) : (
          <div><dt>Market</dt><dd>{b.listed ? `Listed on OpenSea · ${LIST_PRICE_ETH} ETH` : "Held, not listed"}</dd></div>
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

      <div className="cd-traits">
        <h3 className="mono">Traits</h3>
        <dl>
          {traits(id).map((t) => <div key={t.key}><dt>{t.key}</dt><dd>{t.value}</dd></div>)}
        </dl>
      </div>
      <p className="cd-note">Sample data until the contracts are live.</p>
    </>
  );
}
