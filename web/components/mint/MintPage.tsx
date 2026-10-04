"use client";
import { useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, encodeFunctionData, formatEther, parseAbi, parseEther, parseEventLogs, zeroAddress, type Address } from "viem";
import { ArtCanvas } from "@/components/collection/ArtCanvas";
import { DEPLOYMENT, reader, txParams } from "@/lib/chain";
import { EXPLORER, LIST_PRICE_ETH, NFT_ADDRESS, OPENSEA_URL, ROUTES, STARTER_ETH, chain } from "@/lib/constants";
import { connectedProvider, short, useWallet } from "@/lib/wallet";

/**
 * The mint page. Mints are sequential, so the page shows the exact Trenchers you'll get before you mint:
 * grey (dormant) until you awaken them on your agent profile.
 */
const ABI = parseAbi([
  "function mint(uint256 quantity) payable",
  "function totalSupply() view returns (uint256)",
  "function mintOpen() view returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const PRICE = parseEther(LIST_PRICE_ETH);
const MAX = 2000;
const LIVE = NFT_ADDRESS !== zeroAddress;
type Phase = { phase: "sign" | "chain" | "done" | "error"; note?: string; ids?: number[]; tx?: string };
type Recent = { id: number; to: Address; block: bigint };

export function MintPage() {
  const w = useWallet();
  const [supply, setSupply] = useState<number | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  const [qty, setQty] = useState(1);
  const [state, setState] = useState<Phase | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState(false);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(false), 12_000); return () => clearTimeout(t); }, [toast]);

  useEffect(() => {
    if (!LIVE) { setSupply(5); setOpen(false); return; }
    const c = reader();
    let alive = true;
    const load = () => Promise.all([
      c.readContract({ address: NFT_ADDRESS, abi: ABI, functionName: "totalSupply" }),
      c.readContract({ address: NFT_ADDRESS, abi: ABI, functionName: "mintOpen" }),
    ]).then(([s, o]) => { if (alive) { setSupply(Number(s)); setOpen(o); } }).catch(() => {});
    load();
    const iv = setInterval(load, 15_000);
    return () => { alive = false; clearInterval(iv); };
  }, [tick]);

  // The latest mints, straight from the chain.
  useEffect(() => {
    if (!LIVE || !DEPLOYMENT) return;
    const c = reader();
    let alive = true;
    (async () => {
      try {
        const head = await c.getBlockNumber();
        const STEP = 50_000n, ranges: [bigint, bigint][] = [];
        for (let f = BigInt(DEPLOYMENT!.startBlock); f <= head; f += STEP) ranges.push([f, f + STEP - 1n < head ? f + STEP - 1n : head]);
        const logs = (await Promise.all(ranges.map(([a, b]) => c.getLogs({ address: NFT_ADDRESS, event: ABI[3], args: { from: zeroAddress }, fromBlock: a, toBlock: b })))).flat();
        const list = logs.map((l) => ({ id: Number(l.args.tokenId), to: l.args.to as Address, block: l.blockNumber! }))
          .filter((m) => m.id > 5).sort((a, b) => b.id - a.id).slice(0, 12);
        if (alive) setRecent(list);
      } catch { /* the list is a bonus */ }
    })();
    return () => { alive = false; };
  }, [tick]);

  const next = (supply ?? 5) + 1;
  const left = MAX - (supply ?? 5);
  const maxQty = Math.max(1, Math.min(10, left));
  const ids = useMemo(() => Array.from({ length: Math.min(qty, left) }, (_, i) => next + i), [qty, next, left]);
  const busy = state?.phase === "sign" || state?.phase === "chain";
  const soldOut = supply !== null && supply >= MAX;
  const closed = open === false;
  const minted = state?.phase === "done" ? state.ids ?? [] : [];
  const hero = minted[0] ?? next;

  const mint = async () => {
    if (!w.address) { w.openModal(); return; }
    const p = connectedProvider();
    if (!p || w.kind !== "wallet") { setState({ phase: "error", note: "Connect a browser wallet to mint." }); return; }
    try {
      setState({ phase: "sign" });
      const wallet = createWalletClient({ chain, transport: custom(p) });
      const [account] = await wallet.requestAddresses();
      try { await wallet.switchChain({ id: chain.id }); } catch { /* the wallet shows its own prompt */ }
      const value = PRICE * BigInt(qty);
      const extra = await txParams({ account, to: NFT_ADDRESS, value, data: encodeFunctionData({ abi: ABI, functionName: "mint", args: [BigInt(qty)] }) });
      const hash = await wallet.writeContract({ address: NFT_ADDRESS, abi: ABI, functionName: "mint", args: [BigInt(qty)], value, account, chain, ...extra });
      setState({ phase: "chain", tx: hash });
      const receipt = await reader().waitForTransactionReceipt({ hash, pollingInterval: 1_000 });
      const got = parseEventLogs({ abi: ABI, logs: receipt.logs, eventName: "Transfer" }).map((l) => Number(l.args.tokenId)).sort((a, b) => a - b);
      setState({ phase: "done", ids: got, tx: hash });
      setToast(true);
      setTick((t) => t + 1);
    } catch (e) {
      const m = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
      setState({ phase: "error", note: /rejected|denied/i.test(m) ? "You cancelled it in your wallet. Nothing was spent." : /insufficient/i.test(m) ? `Not enough ETH on ${chain.name} for ${formatEther(PRICE * BigInt(qty))} ETH plus gas.` : m.split("\n")[0] });
    }
  };

  const label = !LIVE || closed ? "Mint opens soon"
    : soldOut ? "Minted out"
    : !w.address ? "Connect wallet to mint"
    : state?.phase === "sign" ? "Confirm in your wallet…"
    : state?.phase === "chain" ? "Minting…"
    : `Mint ${qty} for ${formatEther(PRICE * BigInt(qty))} ETH`;

  return (
    <div className="mint">
      {toast && minted.length > 0 && (
        <div className="mint-toast" role="status" aria-live="polite">
          <div className="mint-toast-arts">{minted.slice(0, 4).map((id) => <ArtCanvas key={id} id={id} size={40} />)}</div>
          <div className="mint-toast-txt">
            <b>Success: minted {minted.map((i) => `#${i}`).join(", ")}</b>
            <span>Now awaken {minted.length > 1 ? "them" : "it"} to give {minted.length > 1 ? "each one" : "it"} its wallet and {STARTER_ETH} ETH.</span>
          </div>
          <a className="mint-toast-go" href={ROUTES.agents}>Awaken</a>
          <button type="button" className="mint-toast-x" onClick={() => setToast(false)} aria-label="Close">×</button>
        </div>
      )}
      <section className="mint-stage" aria-label="The Trenchers you'll mint">
        <div className={`mint-hero${minted.length ? " is-minted" : ""}`}>
          <ArtCanvas id={hero} size={520} className={`mint-hero-art${minted.length ? "" : " is-dormant"}`} label={`Trencher #${hero}`} />
          <div className="mint-hero-cap">
            <span className="mint-hero-id">#{hero}</span>
            <span className="mint-hero-state">{minted.length ? "Yours. This is how it looks once awake." : "Next to be minted · hover to see it awake"}</span>
          </div>
        </div>
        {(minted.length > 1 || ids.length > 1) && <div className="mint-strip" aria-label={minted.length ? "Minted" : "You'll mint"}>
          {(minted.length ? minted : ids).map((id) => (
            <a key={id} className="mint-chip" href={minted.length ? ROUTES.agents : `${ROUTES.collection}#${id}`}>
              <ArtCanvas id={id} size={64} className="is-dormant" />
              <span>#{id}</span>
            </a>
          ))}
        </div>}
      </section>

      <section className="mint-panel" aria-label="Mint">
        <h1 className="mint-title">Mint a Trencher</h1>
        <p className="mint-lede">An AI trading agent with its own wallet. You set the strategy; it trades new Pons launches around the clock.</p>

        <div className="mint-supply">
          <div className="mint-supply-row">
            <span><b>{supply === null ? "…" : supply.toLocaleString("en-US")}</b> of 2,000 minted</span>
            <span>{supply === null ? "" : `${left.toLocaleString("en-US")} left`}</span>
          </div>
          <div className="mint-meter" role="progressbar" aria-valuemin={0} aria-valuemax={MAX} aria-valuenow={supply ?? 0}>
            <i style={{ width: `${Math.max(0.6, ((supply ?? 0) / MAX) * 100)}%` }} />
          </div>
        </div>

        <div className="mint-buy">
          <div className="mint-price">
            <span className="mint-price-k">Price</span>
            <span className="mint-price-v">{LIST_PRICE_ETH} <small>ETH each</small></span>
          </div>
          <div className="mint-qty" role="group" aria-label="How many">
            <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1 || busy} aria-label="One less">−</button>
            <output aria-live="polite">{qty}</output>
            <button type="button" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty || busy} aria-label="One more">+</button>
          </div>
        </div>

        <button type="button" className="mint-go" onClick={mint} disabled={!LIVE || closed || soldOut || busy}>{label}</button>

        {state?.phase === "chain" && <p className="mint-msg">Minting on {chain.name}. This usually takes a few seconds{state.tx ? <>; <a href={`${EXPLORER}/tx/${state.tx}`} target="_blank" rel="noreferrer">follow it here</a></> : null}. Your wallet may keep saying &quot;queued&quot; for a while after it&apos;s done; this page tells you the moment it is.</p>}
        {state?.phase === "sign" && <p className="mint-msg">Your wallet window can open behind the browser. If it shows the transaction as queued, open it and confirm.</p>}
        {state?.phase === "done" && (
          <div className="mint-done">
            <p>Minted {minted.map((i) => `#${i}`).join(", ")}. Each one is dormant until you awaken it, which puts {STARTER_ETH} ETH in its own wallet.</p>
            <a className="mint-go mint-go-alt" href={ROUTES.agents}>Awaken your agent</a>
          </div>
        )}
        {state?.phase === "error" && <p className="mint-msg mint-err">{state.note}</p>}


        <a className="mint-alt" href={OPENSEA_URL || "https://opensea.io"} target="_blank" rel="noreferrer">
          <span><b>Want one that&apos;s already trading?</b><small>Buy a Trencher with its wallet and track record on OpenSea.</small></span>
          <em aria-hidden="true">↗</em>
        </a>
      </section>

        <section className="mint-how" aria-label="How it works">
          <h2>How it works</h2>
          <ol className="mint-steps">
            <li><b>Mint</b><span>Up to 10 per transaction. {STARTER_ETH} ETH of every mint is set aside for that Trencher&apos;s own agent.</span></li>
            <li><b>Awaken</b><span>One click gives it its own on-chain wallet and puts the {STARTER_ETH} ETH inside. The art turns from grey to colour.</span></li>
            <li><b>Fund it</b><span>Top up its wallet with your own ETH any time and withdraw it again whenever you like. Soon it can also launch its own coin on Pons and earn the creator fees.</span></li>
            <li><b>Guide</b><span>Tell it how to trade in plain words and set hard limits. It trades Pons launches and climbs the Arena.</span></li>
            <li><b>Keep or sell</b><span>Its wallet, rules and track record move with the NFT, so a proven agent can be sold on OpenSea.</span></li>
          </ol>
        </section>

      {recent.length > 0 && (
        <section className="mint-recent" aria-label="Latest mints">
          <h2>Just minted</h2>
          <ul>
            {recent.map((m) => (
              <li key={m.id}>
                <a href={`${ROUTES.collection}#${m.id}`}>
                  <ArtCanvas id={m.id} size={72} className="is-dormant" />
                  <span className="mint-recent-id">#{m.id}</span>
                  <span className="mint-recent-to">{w.address && m.to.toLowerCase() === w.address.toLowerCase() ? "you" : short(m.to)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
