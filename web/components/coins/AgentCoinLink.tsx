"use client";
import { useEffect, useState } from "react";
import { parseAbi, zeroAddress, type Address } from "viem";
import { reader } from "@/lib/chain";
import { EXPLORER, gmgnToken } from "@/lib/constants";
import { useCoins, ethFmt } from "./coins";
import { CoinChartButton } from "./CoinChart";

const AGENT = parseAbi(["function coin() view returns (address)"]);
const ERC20 = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
export type AgentCoin = { address: Address; symbol: string; name: string };

/** An agent wallet's own coin (if it launched one), read from the chain. */
export function useAgentCoin(wallet?: string | null) {
  const [coin, setCoin] = useState<AgentCoin | null | undefined>(undefined);
  useEffect(() => {
    setCoin(undefined);
    if (!wallet) { setCoin(null); return; }
    const c = reader();
    c.readContract({ address: wallet as Address, abi: AGENT, functionName: "coin" }).then(async (a) => {
      if (!a || a === zeroAddress) { setCoin(null); return; }
      const [symbol, name] = await Promise.all([
        c.readContract({ address: a, abi: ERC20, functionName: "symbol" }).catch(() => "?"),
        c.readContract({ address: a, abi: ERC20, functionName: "name" }).catch(() => ""),
      ]);
      setCoin({ address: a, symbol, name });
    }).catch(() => setCoin(null));
  }, [wallet]);
  return coin;
}

/** "Agent coin $T7 · fees earned · Chart · GMGN ↗ · Etherscan ↗" for public pages (collection, Arena). */
export function AgentCoinLine({ wallet }: { wallet?: string | null }) {
  const onChain = useAgentCoin(wallet);
  const coins = useCoins();
  const info = coins?.find((c) => wallet && c.wallet.toLowerCase() === wallet.toLowerCase()) ?? null;
  const address = onChain?.address ?? info?.coin;
  if (!address) return null;
  const symbol = onChain?.symbol ?? info?.symbol ?? "?";
  return (
    <div className="agent-coin-line">
      <span className="mono agent-coin-tag">Agent coin</span>
      <b className="mono">${symbol}</b>{onChain?.name && <span className="muted-note">{onChain.name}</span>}
      {info && <span className="mono agent-coin-fees">{ethFmt(info.feesEth)} ETH creator fees earned</span>}
      <span className="agent-links">
        {info && <CoinChartButton coin={info} />}
        <a className="tbtn" href={gmgnToken(address)} target="_blank" rel="noreferrer">GMGN ↗</a>
        <a className="tbtn" href={`${EXPLORER}/token/${address}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
      </span>
    </div>
  );
}
