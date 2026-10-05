"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cardBlob, renderPnlCard, type PnlCardData } from "@/lib/pnl-card";

/** "PnL card" button: opens a preview of the agent's card with Download and Copy image. */
export function PnlCardButton({ data, prefix = "", label = "PnL card" }: { data: PnlCardData; prefix?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="tbtn pnl-btn" onClick={() => setOpen(true)}>{label}</button>
      {open && <PnlCardModal data={data} prefix={prefix} onClose={() => setOpen(false)} />}
    </>
  );
}

function PnlCardModal({ data, prefix, onClose }: { data: PnlCardData; prefix: string; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    renderPnlCard(ref.current, data, { scale: 2, prefix }).then(() => setReady(true));
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = async () => {
    const blob = await cardBlob(ref.current!); if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = data.trade ? `trencher-${data.id}-${data.trade.sym}-trade.png` : `trencher-${data.id}-pnl.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const copy = async () => {
    try {
      const blob = await cardBlob(ref.current!); if (!blob) throw new Error();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setMsg("Copied. Paste it into your post.");
    } catch { setMsg("Your browser can't copy images. Use Download instead."); }
    setTimeout(() => setMsg(null), 2500);
  };
  const share = `https://x.com/intent/post?text=${encodeURIComponent(`Trencher #${data.id}: ${data.returnPct >= 0 ? "+" : ""}${data.returnPct.toFixed(1)}% ${data.period ? data.period.toLowerCase() : ""} 🟩\nSelf-funding trading agents with an identity\ntrenchers.io`)}`;

  // Rendered at the end of <body>, so nothing on the page (leaderboard rows, sticky headers) can sit on top of it.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal pnl-modal" role="dialog" aria-modal="true" aria-label={`PnL card for Trencher #${data.id}`}>
        <div className="modal-head"><h2>PnL card · Trencher #{data.id}</h2><button type="button" className="tbtn" onClick={onClose}>Close</button></div>
        <div className="pnl-body">
          <canvas ref={ref} className={`pnl-canvas${ready ? " ready" : ""}`} />
          <div className="pnl-actions">
            <button type="button" className="pnl-primary" onClick={download} disabled={!ready}>Download PNG</button>
            <button type="button" className="tbtn" onClick={copy} disabled={!ready}>Copy image</button>
            <a className="tbtn" href={share} target="_blank" rel="noreferrer">Post on X</a>
            {msg && <span className="pnl-msg mono">{msg}</span>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
