import { EXPLORER, EXPLORER_NAME, explorerAddress, gmgnAddress } from "@/lib/constants";

/** Links to verify an agent wallet's activity on the block explorer and on GMGN. */
export function AgentLinks({ wallet, className = "" }: { wallet: string | null | undefined; className?: string }) {
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return null;
  return (
    <span className={`agent-links ${className}`}>
      {EXPLORER && <a className="tbtn" href={explorerAddress(wallet)} target="_blank" rel="noreferrer">{EXPLORER_NAME} ↗</a>}
      <a className="tbtn" href={gmgnAddress(wallet)} target="_blank" rel="noreferrer">GMGN ↗</a>
    </span>
  );
}
