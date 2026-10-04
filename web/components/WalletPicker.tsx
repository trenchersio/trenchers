"use client";
import { useEffect, useState } from "react";
import { mobileLinks, useInjectedWallets, type InjectedWallet } from "@/lib/eip6963";

/** List of installed wallets to pick from, with install / open-in-app fallbacks. */
export function WalletPicker({ onPick, pending }: { onPick: (w: InjectedWallet) => void; pending: string | null }) {
  const wallets = useInjectedWallets();
  const [href, setHref] = useState("");
  const [mobile, setMobile] = useState(false);
  useEffect(() => { setHref(location.href); setMobile(/Android|iPhone|iPad/i.test(navigator.userAgent)); }, []);

  if (wallets.length === 0) {
    return (
      <div className="wp">
        <p className="wp-empty">No wallet found in this browser.</p>
        {mobile && href ? (
          <div className="wp-list">
            {mobileLinks(href).map((l) => (
              <a key={l.name} className="wp-item" href={l.url}><span className="wp-ico wp-ico-txt">{l.name[0]}</span><span className="wp-name">Open in {l.name}</span><span className="wp-go mono">↗</span></a>
            ))}
          </div>
        ) : (
          <div className="wp-list">
            <a className="wp-item" href="https://metamask.io/download/" target="_blank" rel="noreferrer"><span className="wp-ico wp-ico-txt">M</span><span className="wp-name">Install MetaMask</span><span className="wp-go mono">↗</span></a>
            <a className="wp-item" href="https://phantom.com/download" target="_blank" rel="noreferrer"><span className="wp-ico wp-ico-txt">P</span><span className="wp-name">Install Phantom</span><span className="wp-go mono">↗</span></a>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="wp-list">
      {wallets.map((w) => (
        <button key={w.info.rdns} type="button" className="wp-item" onClick={() => onPick(w)} disabled={!!pending}>
          {w.info.icon ? <img className="wp-ico" src={w.info.icon} alt="" width={28} height={28} /> : <span className="wp-ico wp-ico-txt">{w.info.name[0]}</span>}
          <span className="wp-name">{w.info.name}</span>
          <span className="wp-go mono">{pending === w.info.rdns ? "Check your wallet…" : "Connect"}</span>
        </button>
      ))}
    </div>
  );
}
