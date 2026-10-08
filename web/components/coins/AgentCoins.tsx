"use client";
import { useEffect, useState } from "react";
import { parseAbi, zeroAddress, type Address } from "viem";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { TextButton } from "@/components/TextButton";
import { Loader } from "@/components/Loader";
import { ABI, DEPLOYMENT, reader } from "@/lib/chain";
import { ENGINE_URL, EXPLORER, ROUTES, gmgnToken } from "@/lib/constants";
import { useCoins, ethFmt } from "./coins";
import { CoinChartButton, PriceChart } from "./CoinChart";
import { useCoinInfo } from "./chainCoin";

/**
 * Agent coins: every coin a Trencher's agent wallet launched on Pons (the agent wallet is its deployer and creator,
 * and its creator fees fund the agent). Agents, their coins and each coin's trades are all read from the chain.
 */
const AGENT = parseAbi(["function coin() view returns (address)"]);
const ERC20 = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
type Row = { id: number; wallet: Address; coin: Address; symbol: string; name: string; trading: boolean; pnlPct: number | null };

export function AgentCoins() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const info = useCoins();
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Every minted Trencher's agent wallet, straight from the chain (works even when the Arena engine is down).
        const c = reader();
        const d = DEPLOYMENT!;
        const supply = Number(await c.readContract({ address: d.nft as Address, abi: ABI.nft, functionName: "totalSupply" }));
        const ids = Array.from({ length: supply }, (_, i) => i + 1);
        const ws = await c.multicall({ contracts: ids.map((id) => ({ address: d.fund as Address, abi: ABI.fund, functionName: "agentWallet", args: [BigInt(id)] }) as const), allowFailure: true });
        const agents = ids.map((id, i) => ({ id, wallet: ws[i].status === "success" ? (ws[i].result as Address) : null })).filter((a): a is { id: number; wallet: Address } => !!a.wallet && a.wallet !== zeroAddress);
        const coins = agents.length ? await c.multicall({ contracts: agents.map((a) => ({ address: a.wallet, abi: AGENT, functionName: "coin" }) as const), allowFailure: true }) : [];
        const withCoin = agents.map((a, i) => ({ a, coin: coins[i]?.status === "success" ? (coins[i].result as Address) : zeroAddress })).filter((x) => x.coin !== zeroAddress);
        const meta = withCoin.length ? await c.multicall({ contracts: withCoin.flatMap((x) => [{ address: x.coin, abi: ERC20, functionName: "symbol" } as const, { address: x.coin, abi: ERC20, functionName: "name" } as const]), allowFailure: true }) : [];
        // Trading status and PnL from the Arena, when it answers.
        const arena = (await fetch(`${ENGINE_URL}/arena`, { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as { agents?: { id: number; live: boolean; pnlPct: number }[] } | null;
        const live = new Map((arena?.agents ?? []).map((a) => [a.id, a]));
        const out = withCoin.map((x, i) => ({
          id: x.a.id, wallet: x.a.wallet, coin: x.coin, trading: !!live.get(x.a.id)?.live, pnlPct: live.get(x.a.id)?.pnlPct ?? null,
          symbol: meta[2 * i]?.status === "success" ? String(meta[2 * i].result) : "?", name: meta[2 * i + 1]?.status === "success" ? String(meta[2 * i + 1].result) : "",
        }));
        if (alive) setRows(out);
      } catch { if (alive) { setError(true); setRows((r) => r ?? []); } }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="coins">
      <header className="coins-head">
        <div>
          <p className="eyebrow">Agent coins</p>
          <h1>Coins launched by agents</h1>
          <p className="coll-lede">Every Trencher can launch its own coin on Pons, once. <b>The agent&apos;s wallet deploys it itself</b>, so the agent is the coin&apos;s creator: every trade in it pays creator fees into the agent&apos;s wallet to trade with, and the coin&apos;s fee stream moves with the NFT when it&apos;s sold. The trading engine never trades an agent&apos;s own coin.</p>
        </div>
        <div className="coins-cta"><TextButton href={ROUTES.agents}>Launch your agent&apos;s coin</TextButton></div>
      </header>

      {rows === null && info === null ? <Loader label="Finding agent coins" sub="Reading every agent wallet on Robinhood Chain" /> : merge(rows ?? [], info ?? []).length === 0 ? (
        <p className="coll-empty mono">{error ? "Couldn't reach Robinhood Chain right now. Refresh in a moment." : "No agent has launched its coin yet. Be the first: open your agent's profile, Funding → Its own coin."}</p>
      ) : (
        <ul className="coins-grid">
          {merge(rows ?? [], info ?? []).map(({ r, c }) => <CoinCard key={r.coin} r={r} engine={c} />)}
        </ul>
      )}
    </div>
  );
}

/** Coins recorded in agent wallets, plus any the engine saw an agent wallet launch (even if the wallet didn't record it). */
function merge(rows: Row[], info: import("./coins").CoinInfo[]) {
  const by = new Map(rows.map((r) => [r.coin.toLowerCase(), { r, c: null as import("./coins").CoinInfo | null }]));
  for (const c of info) {
    const k = c.coin.toLowerCase(), hit = by.get(k);
    if (hit) hit.c = c;
    else by.set(k, { r: { id: c.agent, wallet: c.wallet as Address, coin: c.coin as Address, symbol: c.symbol, name: "", trading: false, pnlPct: null }, c });
  }
  return [...by.values()].sort((a, b) => a.r.id - b.r.id);
}

function CoinCard({ r, engine }: { r: Row; engine: import("./coins").CoinInfo | null }) {
  const c = useCoinInfo(r.id, r.wallet, r.coin) ?? engine;
  return (
    <li className="coin-card">
      <div className="coin-card-top">
        <span className="coin-face"><ArtCanvas id={r.id} size={88} /></span>
        <div className="coin-card-id">
          <b className="mono coin-sym">${r.symbol}</b>
          {r.name && <span className="coin-name">{r.name}</span>}
          <span className="mono coin-by">by Trencher #{r.id}{r.trading ? " · trading" : ""}</span>
        </div>
      </div>
      {c ? <PriceChart pts={c.chart} h={70} mini /> : <div className="coin-chart empty mini" style={{ height: 70 }} />}
      <dl className="coin-card-stats">
        <div><dt>Creator fees earned</dt><dd className="mono up">{c ? `${ethFmt(c.feesEth)} ETH` : "…"}</dd></div>
        <div><dt>Volume</dt><dd className="mono">{c ? `${ethFmt(c.volumeEth)} ETH` : "…"}</dd></div>
        <div><dt>Trades</dt><dd className="mono">{c ? c.trades : "…"}</dd></div>
      </dl>
      <p className="mono coin-addr">{r.coin.slice(0, 10)}…{r.coin.slice(-6)}</p>
      <div className="agent-links">
        <CoinChartButton coin={c} fallback={{ agent: r.id, coin: r.coin, symbol: r.symbol }} />
        <a className="tbtn" href={gmgnToken(r.coin)} target="_blank" rel="noreferrer">GMGN ↗</a>
        <a className="tbtn" href={`${EXPLORER}/token/${r.coin}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
        <a className="tbtn" href={`${ROUTES.collection}#${r.id}`}>Trencher #{r.id}</a>
      </div>
    </li>
  );
}
