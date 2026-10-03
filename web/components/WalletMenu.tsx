"use client";
import { useEffect, useRef, useState } from "react";
import { TextButton } from "./TextButton";
import { ROUTES } from "@/lib/constants";
import { short, useWallet } from "@/lib/wallet";

/** Header wallet control: Connect, or Register / View NFT plus the connected address. */
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

  if (!w.ready) return <span className="wallet-slot" aria-hidden="true" />;
  if (!w.address) return <TextButton onClick={w.openModal}>Connect wallet</TextButton>;
  return (
    <div className="wallet-menu" ref={ref}>
      <TextButton href={ROUTES.agents}>Register / View NFT</TextButton>
      <button type="button" className={`tbtn addr-btn${open ? " tbtn-on" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className={`dot ${w.kind === "demo" ? "dot-demo" : ""}`} />{short(w.address)}
      </button>
      {open && (
        <div className="addr-pop" role="menu">
          <p className="mono">{w.kind === "demo" ? "Demo wallet, sample data only" : "Browser wallet"}</p>
          <TextButton onClick={() => { w.disconnect(); setOpen(false); }}>Disconnect</TextButton>
        </div>
      )}
    </div>
  );
}
