"use client";
import { useEffect, useState } from "react";
import { decodeAbiParameters, encodeFunctionData, formatEther, parseAbi, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { ABI, DEPLOYMENT, reader, sendCall } from "@/lib/chain";
import { EXPLORER, gmgnToken } from "@/lib/constants";

/**
 * "Launch its coin": the agent wallet launches its own Pons coin through the coin launcher set in AgentConfig.
 * The coin's creator fees go to the agent wallet, and the engine never trades it. Paid from the free balance.
 */
const LAUNCHER_ABI = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; }",
  "function launch(TokenParams params, uint256 launchConfigId, address expected) payable returns (address coin)",
]);
const PONS = parseAbi(["function launchFee() view returns (uint256)"]);
const ERC20 = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address;
const SITE = "https://www.trenchers.io";
const fmt = (v: bigint) => Number(formatEther(v)).toFixed(6).replace(/\.?0+$/, "");

type Props = { id: number; wallet: Address; me: Address; free: bigint; busy: boolean; run: (label: string, fn: (ph: (p: "sign" | "chain") => void) => Promise<unknown>, refreshId?: number) => Promise<boolean> };

export function CoinLaunch({ id, wallet, me, free, busy, run }: Props) {
  const [launcher, setLauncher] = useState<Address | null | undefined>(undefined);
  const [eta, setEta] = useState<number | null>(null);
  const [coin, setCoin] = useState<{ address: Address; symbol: string; name: string } | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [f, setF] = useState({ name: `Trencher ${id}`, symbol: `T${id}`, description: `The coin of Trencher #${id}, an AI trading agent on Robinhood Chain. Its creator fees fund the agent.`, x: "", telegram: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [ver, setVer] = useState(0);

  useEffect(() => {
    const d = DEPLOYMENT; if (!d) return;
    const c = reader();
    (async () => {
      const [l, p, own, lf] = await Promise.all([
        c.readContract({ address: d.config, abi: ABI.config, functionName: "launcher" }).catch(() => zeroAddress),
        c.readContract({ address: d.config, abi: ABI.config, functionName: "pending", args: [2] }).catch(() => [zeroAddress, 0n] as const),
        c.readContract({ address: wallet, abi: ABI.agent, functionName: "coin" }).catch(() => zeroAddress),
        c.readContract({ address: PONS_FACTORY, abi: PONS, functionName: "launchFee" }).catch(() => null),
      ]);
      setLauncher(l === zeroAddress ? null : l);
      setEta(p[0] !== zeroAddress ? Number(p[1]) : null);
      setFee(lf);
      if (own !== zeroAddress) {
        const [symbol, name] = await Promise.all([c.readContract({ address: own, abi: ERC20, functionName: "symbol" }).catch(() => "?"), c.readContract({ address: own, abi: ERC20, functionName: "name" }).catch(() => "")]);
        setCoin({ address: own, symbol, name });
      } else setCoin(null);
    })();
  }, [wallet, ver]);

  const params = (expected: Address) => encodeFunctionData({
    abi: LAUNCHER_ABI, functionName: "launch",
    args: [{
      name: f.name.trim(), symbol: f.symbol.trim().toUpperCase(), logo: `${SITE}/meta/img/awake/${id}.png`, description: f.description.trim(),
      socials: { twitter: f.x.trim(), telegram: f.telegram.trim(), discord: "", website: `${SITE}/collection#${id}`, farcaster: "" },
      creatorFeeRecipient: zeroAddress, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: zeroHash,
    }, 0n, expected],
  });

  const launch = () => run(`Launching $${f.symbol.trim().toUpperCase()} for Trencher #${id}`, async (ph) => {
    if (!launcher || fee === null) throw new Error("Coin launches aren't switched on yet.");
    if (free < fee) throw new Error(`Deposit at least ${fmt(fee - free)} ETH more first: the launch fee is paid from the free balance, not the starter.`);
    // Pons gives each new coin the next address, so: work out the address right now, then launch exactly
    // there. If someone else's launch lands first, the launcher refuses (nothing spent) and we try again.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const sim = await reader().simulateContract({ address: wallet, abi: ABI.agent, functionName: "launchCoin", args: [params(zeroAddress), fee, zeroAddress], account: me });
      const [expected] = decodeAbiParameters([{ type: "address" }], sim.result as Hex);
      try {
        await sendCall(me, { address: wallet, abi: ABI.agent, functionName: "launchCoin", args: [params(expected as Address), fee, expected] }, ph);
        return;
      } catch (e) {
        if (attempt === 3 || !/WrongCoin|0x[0-9a-f]{8}/i.test(String((e as Error).message))) throw e;
        setMsg("Someone launched on Pons at the same moment; trying again…");
      }
    }
  }, id).then((ok) => { if (ok) { setMsg(null); setVer((v) => v + 1); } });

  const valid = f.name.trim().length >= 2 && /^[A-Za-z0-9]{2,10}$/.test(f.symbol.trim());
  const opens = eta ? new Date(eta * 1000) : null;

  return (
    <section className="panel-card coin-launch">
      <h3>Its own coin</h3>
      {coin ? (
        <div className="coin-own">
          <p><b>${coin.symbol}</b> {coin.name && <span className="muted-note">· {coin.name}</span>}</p>
          <p className="muted-note">Launched on Pons by this agent. Every trade pays creator fees to its wallet, and the engine never trades its own coin.</p>
          <div className="agent-actions">
            <span className="agent-links">
              <a className="tbtn" href={gmgnToken(coin.address)} target="_blank" rel="noreferrer">GMGN ↗</a>
              <a className="tbtn" href={`${EXPLORER}/token/${coin.address}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
            </span>
          </div>
        </div>
      ) : launcher === undefined ? (
        <p className="muted-note">Checking…</p>
      ) : !launcher ? (
        <p className="muted-note">{opens ? `Agent coins open on ${opens.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}, after the public 48-hour notice.` : "Agent coin launches are coming soon."} Your agent will be able to launch its own coin on Pons once, with the creator fees going to its wallet.</p>
      ) : (
        <>
          <p className="muted-note">Launch your agent&apos;s own coin on Pons, once. Its creator fees go to the agent wallet, and its art becomes the coin&apos;s logo. The launch fee{fee !== null ? ` (${fmt(fee)} ETH)` : ""} comes from the free balance, not the locked starter.</p>
          <div className="coin-form">
            <label><span className="mono">Name</span><input value={f.name} maxLength={32} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label><span className="mono">Ticker</span><input className="mono" value={f.symbol} maxLength={10} onChange={(e) => setF({ ...f, symbol: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })} /></label>
            <label className="wide"><span className="mono">Description</span><textarea rows={3} maxLength={280} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <label><span className="mono">X (optional)</span><input placeholder="https://x.com/…" value={f.x} onChange={(e) => setF({ ...f, x: e.target.value })} /></label>
            <label><span className="mono">Telegram (optional)</span><input placeholder="https://t.me/…" value={f.telegram} onChange={(e) => setF({ ...f, telegram: e.target.value })} /></label>
          </div>
          {fee !== null && free < fee && <p className="notice">Deposit at least {fmt(fee - free)} ETH first.</p>}
          {msg && <p className="muted-note">{msg}</p>}
          <button type="button" className="gf-btn go" onClick={launch} disabled={busy || !valid || fee === null || free < fee}>Launch ${f.symbol.trim().toUpperCase() || "…"}</button>
        </>
      )}
    </section>
  );
}
