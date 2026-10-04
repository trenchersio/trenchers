"use client";
import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, fallback, formatEther, http, parseAbi, parseEther, type Address } from "viem";
import { LIST_PRICE_ETH, NFT_ADDRESS, OPENSEA_URL, chain } from "@/lib/constants";
import { connectedProvider, useWallet } from "@/lib/wallet";

/** The public mint on trenchers.io: up to 10 per transaction at the list price. Resales happen on OpenSea. */
const ABI = parseAbi([
  "function mint(uint256 quantity) payable",
  "function totalSupply() view returns (uint256)",
  "function mintOpen() view returns (bool)",
]);
const LIVE = NFT_ADDRESS !== "0x0000000000000000000000000000000000000000";
const PRICE = parseEther(LIST_PRICE_ETH);

export function MintPanel() {
  const w = useWallet();
  const [qty, setQty] = useState(1);
  const [supply, setSupply] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ phase: "sign" | "chain" | "done" | "error"; note?: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!LIVE) return;
    const p = connectedProvider();
    const pub = createPublicClient({ chain, transport: p ? fallback([http(), custom(p)]) : http() });
    Promise.all([
      pub.readContract({ address: NFT_ADDRESS as Address, abi: ABI, functionName: "totalSupply" }),
      pub.readContract({ address: NFT_ADDRESS as Address, abi: ABI, functionName: "mintOpen" }),
    ]).then(([s, o]) => { setSupply(Number(s)); setOpen(o); }).catch(() => {});
  }, [tick]);

  const mint = async () => {
    if (!w.address) { w.openModal(); return; }
    const p = connectedProvider();
    if (!p || w.kind !== "wallet") { setState({ phase: "error", note: "Connect a browser wallet to mint (the demo wallet can't)." }); return; }
    try {
      setState({ phase: "sign" });
      const wallet = createWalletClient({ chain, transport: custom(p) });
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: chain.id }); } catch { /* the wallet shows its own prompt */ }
      const hash = await wallet.writeContract({ address: NFT_ADDRESS as Address, abi: ABI, functionName: "mint", args: [BigInt(qty)], value: PRICE * BigInt(qty), account, chain });
      setState({ phase: "chain" });
      await createPublicClient({ chain, transport: custom(p) }).waitForTransactionReceipt({ hash });
      setState({ phase: "done" }); setTick((t) => t + 1);
    } catch (e) {
      const m = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
      setState({ phase: "error", note: /rejected|denied/i.test(m) ? "Cancelled in your wallet." : m.split("\n")[0] });
    }
  };

  const total = Number(formatEther(PRICE * BigInt(qty)));
  const soon = !LIVE || !open;
  return (
    <div className="mintp">
      <div className="mintp-head">
        <span className="mono mintp-k">Mint on trenchers.io</span>
        <span className="mono mintp-count">{supply === null ? "2,000 Trenchers" : `${supply.toLocaleString("en-US")} / 2,000 minted`}</span>
      </div>
      <div className="mintp-bar"><i style={{ width: `${supply ? Math.min(100, supply / 20) : 0}%` }} /></div>
      <div className="mintp-row">
        <div className="mintp-qty">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1 || soon} aria-label="One less">−</button>
          <span className="mono">{qty}</span>
          <button type="button" onClick={() => setQty((q) => Math.min(10, q + 1))} disabled={qty >= 10 || soon} aria-label="One more">+</button>
        </div>
        <button type="button" className="mintp-btn" onClick={mint} disabled={soon || state?.phase === "sign" || state?.phase === "chain"}>
          {soon ? "Mint opens soon" : state?.phase === "sign" ? "Confirm in your wallet…" : state?.phase === "chain" ? "Minting…" : `Mint ${qty} · ${total} ETH`}
        </button>
      </div>
      {state?.phase === "done" && <p className="mintp-msg ok">Minted. Open your <a href="agents">NFT / Agent Profile</a> to awaken it.</p>}
      {state?.phase === "error" && <p className="mintp-msg err">{state.note}</p>}
      <p className="mintp-note">Up to 10 per transaction. Already minted out? Trenchers trade on {OPENSEA_URL ? <a href={OPENSEA_URL} target="_blank" rel="noreferrer">OpenSea</a> : "OpenSea"}.</p>
    </div>
  );
}
