"use client";
import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEventLogs } from "viem";
import {
  useAccount, useChainId, useReadContracts, useSwitchChain, useWaitForTransactionReceipt, useWriteContract,
} from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { nftAbi } from "@/lib/abi";
import { chain, EXPLORER, NFT_ADDRESS, OPENSEA_URL } from "@/lib/constants";

const PRICE = 100_000_000_000_000_000n; // 0.1 ETH, matches TrenchersNFT.PRICE
const MAX_PER_TX = 20;                  // UI convenience only; the contract has no wallet limit
const contract = { address: NFT_ADDRESS, abi: nftAbi, chainId: chain.id } as const;

export function MintPanel() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { openConnectModal } = useConnectModal();
  const [qty, setQty] = useState(1);

  const reads = useReadContracts({
    contracts: [
      { ...contract, functionName: "mintOpen" },
      { ...contract, functionName: "totalSupply" },
      { ...contract, functionName: "MAX_SUPPLY" },
    ],
    query: { refetchInterval: 6_000 },
  });
  const [openR, supplyR, maxR] = reads.data ?? [];
  const open = Boolean(openR?.result);
  const supply = Number(supplyR?.result ?? 0n);
  const max = Number(maxR?.result ?? 2000n);
  const remaining = Math.max(0, max - supply);
  const cap = Math.min(remaining, MAX_PER_TX);
  const soldOut = reads.isSuccess && remaining === 0;

  useEffect(() => setQty((q) => Math.min(Math.max(1, q), Math.max(1, cap))), [cap]);

  const { writeContract, data: hash, isPending, error: writeError, reset } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const mintedIds = useMemo(() => {
    if (!receipt.data) return [];
    return parseEventLogs({ abi: nftAbi, logs: receipt.data.logs, eventName: "Transfer" })
      .filter((l) => l.args.to.toLowerCase() === address?.toLowerCase())
      .map((l) => l.args.tokenId.toString());
  }, [receipt.data, address]);
  useEffect(() => { if (receipt.isSuccess) reads.refetch(); }, [receipt.isSuccess]); // eslint-disable-line

  const value = PRICE * BigInt(qty);
  const wrongChain = isConnected && chainId !== chain.id;

  function onMint() {
    reset();
    writeContract({ ...contract, functionName: "mint", args: [BigInt(qty)], value });
  }

  let action: React.ReactNode;
  if (soldOut) action = <a className="primary" href={OPENSEA_URL} target="_blank" rel="noreferrer">Sold out · buy on OpenSea</a>;
  else if (!isConnected) action = <button className="primary" onClick={openConnectModal}>Connect wallet</button>;
  else if (wrongChain) action = <button className="primary" onClick={() => switchChain({ chainId: chain.id })}>Switch to {chain.name}</button>;
  else if (!open) action = <button className="primary" disabled>Mint not open yet</button>;
  else action = (
    <button className="primary" onClick={onMint} disabled={isPending || receipt.isLoading}>
      {isPending ? "Confirm in wallet…" : receipt.isLoading ? "Minting…" : `Mint ${qty} · ${formatEther(value)} ETH`}
    </button>
  );

  const pct = max ? (supply / max) * 100 : 0;
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="tag">{soldOut ? "Sold out" : open ? "Mint live" : "Mint closed"}</span>
        <span className="mono">{chain.name}</span>
      </div>
      <div className="count mono"><b>{supply.toLocaleString()}</b> / {max.toLocaleString()} minted</div>
      <div className="meter" role="progressbar" aria-valuenow={supply} aria-valuemax={max}><div style={{ width: `${pct}%` }} /></div>

      <div className="qty">
        <button aria-label="One fewer" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>−</button>
        <span className="mono">{qty}</span>
        <button aria-label="One more" onClick={() => setQty((q) => Math.min(Math.max(1, cap), q + 1))} disabled={qty >= cap}>+</button>
        <span className="hint">0.1 ETH each</span>
      </div>

      {action}

      {hash && (
        <p className="status">
          {receipt.isSuccess ? "Minted " + mintedIds.map((i) => `#${i}`).join(", ") + ". " : "Transaction sent. "}
          <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">View on explorer</a>
        </p>
      )}
      {(writeError || receipt.error) && (
        <p className="status error">{(writeError as { shortMessage?: string })?.shortMessage ?? receipt.error?.message ?? "Transaction failed"}</p>
      )}
      {reads.isError && <p className="status error">Could not read the mint contract. Check the network and contract address.</p>}
    </div>
  );
}
