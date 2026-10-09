"use client";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { ABI, DEPLOYMENT, cachedOwned, ownedTrenchers, reader } from "@/lib/chain";
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
      if (!ids.length) return;
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
    <div className="wake-banner" role="status">
      <span className="wake-dot" aria-hidden="true" />
      <p><b>{n === 1 ? `Trencher #${sleeping[0]} is still asleep.` : `${n} of your Trenchers are still asleep.`}</b> {n === 1 ? `${STARTER_ETH} ETH is waiting for its own wallet.` : `${STARTER_ETH} ETH is waiting for each of them.`} Awaken {n === 1 ? "it" : "them"} to start trading.</p>
      <a className="wake-go" href={ROUTES.agents}>Awaken</a>
      <button type="button" className="wake-x" onClick={dismiss} aria-label="Hide for a day">×</button>
    </div>
  );
}
