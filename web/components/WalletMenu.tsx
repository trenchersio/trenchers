"use client";
import { useEffect, useRef, useState } from "react";
import { TextButton } from "./TextButton";
import { ROUTES } from "@/lib/constants";
import { short, useWallet } from "@/lib/wallet";

/** Header wallet control: Connect, or the connected address, which opens the NFT / Agent Profile link and Disconnect. */
export function WalletMenu() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!w.address) return <TextButton onClick={w.openModal}>Connect wallet</TextButton>;
  return (
    <div className="wallet-menu" ref={ref}>
      <button type="button" className={`tbtn addr-btn${open ? " tbtn-on" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`dot ${w.kind === "demo" ? "dot-demo" : ""}`} />{short(w.address)}<span className="nd-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="addr-pop" role="menu">
          <p className="mono">{w.kind === "demo" ? "Demo wallet, sample data only" : "Browser wallet"}</p>
          <a className="addr-link" href={ROUTES.agents}>NFT / Agent Profile →</a>
          <TextButton onClick={() => { w.disconnect(); setOpen(false); }}>Disconnect</TextButton>
        </div>
      )}
    </div>
  );
}
