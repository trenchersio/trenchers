"use client";
import { useEffect } from "react";
import { TextButton } from "./TextButton";
import { useWallet } from "@/lib/wallet";
import { chain } from "@/lib/constants";
import { WalletPicker } from "./WalletPicker";

export function ConnectModal() {
  const w = useWallet();
  useEffect(() => {
    if (!w.modalOpen) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && w.closeModal();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [w.modalOpen, w]);
  if (!w.modalOpen) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && w.closeModal()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="connect-title">
        <div className="modal-head">
          <h2 id="connect-title">Connect a wallet</h2>
          <TextButton onClick={w.closeModal}>Close</TextButton>
        </div>
        <div className="modal-body">
          <div className="wallet-opt wallet-opt-col">
            <div>
              <h3>Browser wallet</h3>
              <p>Pick the wallet you want to use, on {chain.name}.</p>
            </div>
            <WalletPicker onPick={(x) => w.connectBrowser(x.info.rdns)} pending={w.pendingWallet} />
          </div>
          <div className="wallet-opt">
            <div>
              <h3>Demo wallet</h3>
              <p>Try awakening and guiding an agent with sample data. Nothing is sent on-chain.</p>
            </div>
            <TextButton onClick={w.connectDemo}>Use demo</TextButton>
          </div>
          {w.error && <p className="modal-error">{w.error}</p>}
        </div>
      </div>
    </div>
  );
}
