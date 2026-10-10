"use client";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { ABI, DEPLOYMENT, cachedOwned, ownedTrenchers, reader } from "@/lib/chain";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { ROUTES, STARTER_ETH } from "@/lib/constants";
import { useWallet } from "@/lib/wallet";

/**
 * A reminder for holders whose Trenchers are still asleep: each one has 0.01 ETH waiting for its own wallet.
 * Shown under the menu on every page except the agents page; it can be dismissed for a day.
 */
export function WakeBanner({ page }: { page: string }) {
  const w = useWallet();
  const me = w.address as Address | null;
  const [sleeping, setSleeping] = useState<number[]>([]);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    setSleeping([]);
    if (!me || !DEPLOYMENT || page === "agents") return;
    try { const until = Number(localStorage.getItem(`trenchers:wake-hide:${me.toLowerCase()}`) || 0); setHidden(until > Date.now()); } catch { setHidden(false); }
    let alive = true;
    const check = async (ids: number[]) => {
      // #1 to #5 are the team's house agents (always awake, no starter balance) and #2001+ are awake from mint.
      ids = ids.filter((id) => id > 5 && id <= 2000);
      if (!ids.length) { if (alive) setSleeping([]); return; }
      const res = await Promise.all(ids.slice(0, 50).map((id) => reader().readContract({ address: DEPLOYMENT!.fund, abi: ABI.fund, functionName: "claimed", args: [BigInt(id)] }).then((c) => (c ? null : id)).catch(() => null)));
      if (alive) setSleeping(res.filter((x): x is number => x !== null));
    };
    const cached = cachedOwned(me);
    if (cached?.length) check(cached);
    ownedTrenchers(me).then(check).catch(() => {});
    return () => { alive = false; };
  }, [me, page]);

  if (!sleeping.length || hidden) return null;
  const n = sleeping.length;
  const dismiss = () => { try { localStorage.setItem(`trenchers:wake-hide:${me!.toLowerCase()}`, String(Date.now() + 86_400_000)); } catch { /* */ } setHidden(true); };
  return (
    <div className="wake-wrap">
      <div className="wake-banner" role="status">
        <div className="wake-arts" aria-hidden="true">
          {sleeping.slice(0, 3).map((id) => <ArtCanvas key={id} id={id} size={36} className="wake-art" />)}
          {n > 3 && <span className="wake-more mono">+{n - 3}</span>}
        </div>
        <div className="wake-text">
          <b>{n === 1 ? `Trencher #${sleeping[0]} is still asleep` : `${n} of your Trenchers are still asleep`}</b>
          <span>{n === 1 ? `${STARTER_ETH} ETH is waiting for its wallet.` : `${STARTER_ETH} ETH is waiting for each of them.`} Awaken {n === 1 ? "it" : "them"} to start trading.</span>
        </div>
        <a className="wake-go" href={ROUTES.agents}>Awaken</a>
        <button type="button" className="wake-x" onClick={dismiss} aria-label="Hide for a day" title="Hide for a day">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
