"use client";
// The live model list: name, slug and context window. No prices, on purpose.
import { useMemo, useState } from "react";
import { FAMILIES, ctx, family, type Model } from "@/lib/inference";
import { CopyBtn } from "./Endpoint";

const ORDER = FAMILIES.map((f) => f.id);

export function Catalogue({ models, failed }: { models: Model[] | null; failed: boolean }) {
  const [q, setQ] = useState("");
  const [fam, setFam] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  const rows = useMemo(() => {
    if (!models) return [];
    const rank = (id: string) => { const i = ORDER.indexOf(family(id).id); return i === -1 ? ORDER.length : i; };
    return models.slice().sort((a, b) => rank(a.id) - rank(b.id) || (b.context_length ?? 0) - (a.context_length ?? 0));
  }, [models]);
  const fams = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) { const f = family(r.id).id; m.set(f, (m.get(f) ?? 0) + 1); }
    return FAMILIES.filter((f) => m.has(f.id)).map((f) => ({ ...f, n: m.get(f.id)! }));
  }, [rows]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => (!fam || family(r.id).id === fam) && (!s || r.id.toLowerCase().includes(s) || (r.name ?? "").toLowerCase().includes(s)));
  }, [rows, q, fam]);
  const maxCtx = Math.log10(2_000_000), minCtx = Math.log10(8_000);
  const list = all || q || fam ? shown : shown.slice(0, 12);

  if (failed) return <p className="inf-muted">The catalogue could not be read just now. The endpoint still answers; try again in a moment.</p>;

  return (
    <div className="icat">
      <div className="icat-bar">
        <label className="icat-search">
          <span aria-hidden="true">⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" aria-label="Search models" />
        </label>
        <div className="icat-fams" role="group" aria-label="Model family">
          <button type="button" className={!fam ? "on" : ""} onClick={() => setFam(null)}>All <i>{rows.length || ""}</i></button>
          {fams.map((f) => (
            <button key={f.id} type="button" className={fam === f.id ? "on" : ""} onClick={() => setFam(fam === f.id ? null : f.id)} style={{ ["--fc" as string]: f.color }}>
              <span className="icat-sw" />{f.label} <i>{f.n}</i>
            </button>
          ))}
        </div>
      </div>

      <div className="icat-head mono"><span>Model</span><span>Slug</span><span>Context</span></div>
      <div className="icat-rows">
        {!models ? Array.from({ length: 8 }, (_, i) => <div className="icat-row icat-skel" key={i}><i /></div>)
          : list.length === 0 ? <p className="inf-muted" style={{ padding: "18px 16px", margin: 0 }}>No model matches that.</p>
          : list.map((m) => {
            const f = family(m.id);
            const c = m.context_length ?? 0;
            const pct = c ? Math.max(6, Math.min(100, ((Math.log10(c) - minCtx) / (maxCtx - minCtx)) * 100)) : 0;
            return (
              <div className="icat-row" key={m.id} style={{ ["--fc" as string]: f.color }}>
                <span className="icat-name">
                  <span className="icat-mono" aria-hidden="true">{(f.label[0] ?? "?").toUpperCase()}</span>
                  <span><b>{m.name || m.id.split("/").pop()}</b><em>{f.label}</em></span>
                </span>
                <span className="icat-slug"><code>{m.id}</code><CopyBtn text={m.id} /></span>
                <span className="icat-ctx"><span className="icat-track"><i style={{ width: `${pct}%` }} /></span><b className="mono">{c ? ctx(c) : "–"}</b></span>
              </div>
            );
          })}
      </div>
      {!q && !fam && rows.length > 12 && (
        <button type="button" className="icat-more" onClick={() => setAll((v) => !v)}>{all ? "Show fewer" : `Show all ${rows.length} models`}</button>
      )}
    </div>
  );
}
