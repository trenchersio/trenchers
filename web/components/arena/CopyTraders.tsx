"use client";
import { useEffect, useState } from "react";
import { ENGINE_URL, PONS_TOKEN_URL, ROUTES } from "@/lib/constants";
import { copyWalletRule } from "@/lib/custom-strategy";
import { short } from "@/lib/wallet";

/** The Arena's Copytrade tab: top FOMO traders as cards; pick one and your agent copies their Pons trades. */

type Recent = { token: string; symbol?: string; side: "buy" | "sell"; eth: number | null; time: number; tx: string };
export type CopyTrader = {
  name: string; wallet: string; pic: string; trades: number; buys: number; sells: number; volumeEth: number; coins: number;
  top: string[]; realizedEth: number | null; last: number | null; copiedBy: number; recent: Recent[];
};

/** The traders, so the cards show even before the engine answers (same list as engine/src/fomo.ts). */
const LIST: Pick<CopyTrader, "name" | "wallet" | "pic">[] = [
  { name: "Rasmr", wallet: "0x2fbd041a069bb3d7099d55179169091cfeec4221", pic: "rasmr" },
  { name: "Frank", wallet: "0x696d1265c8fc4f14797abebfae3c43ebfa9d8e28", pic: "frank" },
  { name: "Unipcs", wallet: "0x0a6ebed0155edb4b21d92ad02897a626cd90119e", pic: "unipcs" },
  { name: "TM", wallet: "0x1a2acf82601cb26db5160e707a78a5dd9dbaa8e8", pic: "tm" },
  { name: "Fartman Sacks", wallet: "0x7f6e4e1e59be05dc717c8e5429154a7408609ee2", pic: "fartman" },
];
const TONE: Record<string, string> = { rasmr: "green", frank: "ice", unipcs: "amber", tm: "violet", fartman: "pink" };

const ago = (s: number) => (s < 60 ? `${Math.max(0, Math.floor(s))}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`);
const eth = (v: number) => (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(3));
const sym = (r: Recent) => `$${r.symbol ?? r.token.slice(2, 8)}`;

export function useCopyTraders() {
  const [data, setData] = useState<{ traders: CopyTrader[]; chainId: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch(`${ENGINE_URL}/copytraders`, { cache: "no-store", signal: AbortSignal.timeout(15_000) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j?.traders) setData(j); }).catch(() => {});
    load();
    const iv = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  return data;
}

export function CopyTraders({ explorer }: { explorer: string }) {
  const data = useCopyTraders();
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now() / 1000), 5000); return () => clearInterval(t); }, []);
  const traders = LIST.map((t) => ({ ...t, ...(data?.traders.find((x) => x.wallet === t.wallet) ?? {}) })) as (Pick<CopyTrader, "name" | "wallet" | "pic"> & Partial<CopyTrader>)[];
  const sel = traders.find((t) => t.wallet === open) ?? null;
  return (
    <div className="ct">
      <header className="ct-head">
        <p className="ct-k mono"><span className="ct-fomo">FOMO</span> Copytrade</p>
        <h1>Copy the top FOMO traders</h1>
        <p className="ct-sub">Pick a trader and your Trencher agent buys the Pons coins they buy on Robinhood Chain, at your share of their size, and sells when they sell. Every buy stays inside your agent&apos;s own limits.</p>
      </header>
      <ol className="ct-grid">
        {traders.map((t, i) => (
          <li key={t.wallet}>
            <button type="button" className={`ct-card ct-${TONE[t.pic]}`} onClick={() => setOpen(t.wallet)} aria-label={`Copytrade ${t.name}`}>
              <span className="ct-rank mono">0{i + 1}</span>
              <span className="ct-pic"><img src={`/fomo/${t.pic}.jpg`} alt="" width={96} height={96} className={t.pic === "fartman" ? "px" : undefined} /></span>
              <span className="ct-name">{t.name}</span>
              <span className="ct-wallet mono">{short(t.wallet)}</span>
              <span className="ct-stats">
                <span><b className="mono">{t.trades ?? "—"}</b><small>7d trades</small></span>
                <span><b className="mono">{t.volumeEth !== undefined ? eth(t.volumeEth) : "—"}</b><small>ETH vol</small></span>
                <span><b className="mono">{t.coins ?? "—"}</b><small>coins</small></span>
              </span>
              <span className="ct-tags">
                {t.top?.length ? t.top.map((s) => <em key={s} className="mono">${s}</em>) : <em className="mono ct-quiet">{data ? "No Pons trades this week" : "Reading their wallet…"}</em>}
              </span>
              <span className="ct-foot">
                <span className="mono ct-last">{t.last ? <><i className="dot-g" />last trade {ago(now - t.last)} ago</> : t.copiedBy ? `${t.copiedBy} copying` : "Ready to copy"}</span>
                <span className="ct-go">Copytrade <span aria-hidden="true">→</span></span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="ct-note mono">FOMO traders&apos; public wallets on Robinhood Chain. Past trades don&apos;t predict future ones: only copy with what you can afford to lose.</p>
      {sel && <CopySheet t={sel} explorer={explorer} now={now} onClose={() => setOpen(null)} />}
    </div>
  );
}

function CopySheet({ t, explorer, now, onClose }: { t: Pick<CopyTrader, "name" | "wallet" | "pic"> & Partial<CopyTrader>; explorer: string; now: number; onClose: () => void }) {
  const [pct, setPct] = useState(50);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);
  const rule = copyWalletRule(t.wallet, t.name, pct);
  const href = `${ROUTES.agents}?rule=${encodeURIComponent(rule)}&trader=${encodeURIComponent(t.name)}`;
  return (
    <div className="ct-sheet-bg" onClick={onClose}>
      <div className={`ct-sheet ct-${TONE[t.pic]}`} role="dialog" aria-modal="true" aria-label={`Copytrade ${t.name}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="ct-x" onClick={onClose} aria-label="Close">×</button>
        <div className="ct-sheet-head">
          <span className="ct-pic"><img src={`/fomo/${t.pic}.jpg`} alt="" width={84} height={84} className={t.pic === "fartman" ? "px" : undefined} /></span>
          <div>
            <p className="ct-k mono"><span className="ct-fomo">FOMO</span> trader</p>
            <h2>{t.name}</h2>
            <a className="mono ct-wallet" href={`${explorer}/address/${t.wallet}`} target="_blank" rel="noreferrer">{short(t.wallet)} ↗</a>
          </div>
        </div>
        <dl className="ct-kpis">
          <div><dt>Trades · 7d</dt><dd className="mono">{t.trades ?? "—"}</dd></div>
          <div><dt>Buys / sells</dt><dd className="mono">{t.buys ?? "—"} / {t.sells ?? "—"}</dd></div>
          <div><dt>ETH volume</dt><dd className="mono">{t.volumeEth !== undefined ? eth(t.volumeEth) : "—"}</dd></div>
          <div><dt>Copying now</dt><dd className="mono">{t.copiedBy ?? 0}</dd></div>
        </dl>
        <div className="ct-recent">
          <h3>Latest Pons trades</h3>
          {t.recent?.length ? (
            <ol className="mono">
              {t.recent.map((r) => (
                <li key={`${r.tx}-${r.side}-${r.token}`}>
                  <span className="t-ago">{ago(now - r.time)}</span>
                  <b className={r.side === "buy" ? "up" : "down"}>{r.side.toUpperCase()}</b>
                  <a href={PONS_TOKEN_URL.replace("{address}", r.token)} target="_blank" rel="noreferrer">{sym(r)}</a>
                  <a className="ct-tx" href={`${explorer}/tx/${r.tx}`} target="_blank" rel="noreferrer">{r.eth !== null ? `${r.eth.toFixed(4)} ETH` : "sold"} ↗</a>
                </li>
              ))}
            </ol>
          ) : <p className="empty">No Pons trades seen in the last week. Their next one shows up here.</p>}
        </div>
        <div className="ct-copy">
          <p className="ct-copy-k">Copy size</p>
          <div className="cpa-pct" role="group" aria-label="Copy size">
            {[25, 50, 100].map((p) => <button key={p} type="button" className={pct === p ? "on" : ""} aria-pressed={pct === p} onClick={() => setPct(p)}>{p}%</button>)}
          </div>
          <p className="ct-copy-n">When {t.name} buys a Pons coin for 1 ETH, your agent buys for {(pct / 100).toFixed(2)} ETH, or its per-trade limit if that&apos;s lower. When they sell, your agent sells.</p>
          <a className="gf-btn go ct-cta" href={href}>Copytrade {t.name} at {pct}%</a>
          <p className="ct-copy-s mono">Next: pick your Trencher agent, check its limits, apply. You can stop any time.</p>
        </div>
      </div>
    </div>
  );
}
