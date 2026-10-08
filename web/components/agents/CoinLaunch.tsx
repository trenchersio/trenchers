"use client";
import { useEffect, useState } from "react";
import { formatEther, parseAbi, zeroAddress, zeroHash, type Address } from "viem";
import { ABI, DEPLOYMENT, reader, sendCall } from "@/lib/chain";
import { EXPLORER, gmgnToken } from "@/lib/constants";

/**
 * "Its own coin": with agent wallet version 2 the agent wallet itself calls the Pons launch factory, so Pons records
 * the agent wallet as the coin's deployer and creator. The Pons launch fee comes out of the agent's balance (the
 * starter may pay it). Creator fees go to the agent wallet and can be collected any time; the engine never trades it.
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address;
const AGENT_V2 = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; }",
  "function launchCoin(TokenParams params, uint256 launchConfigId) returns (address coin, address curve)",
  "function claimCoinFees() returns (uint256 amount)",
  "function VERSION() view returns (uint256)",
  "function agentLogic() view returns (address)",
  "function setAgentVersion(address logic)",
]);
const CFG = parseAbi(["function accountLogic() view returns (address)", "function isAccountLogic(address) view returns (bool)"]);
const PONS = parseAbi(["function launchFee() view returns (uint256)"]);
const ERC20 = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
const SITE = "https://www.trenchers.io";
const fmt = (v: bigint) => Number(formatEther(v)).toFixed(6).replace(/\.?0+$/, "") || "0";

type Props = { id: number; wallet: Address; me: Address; bal: bigint; busy: boolean; run: (label: string, fn: (ph: (p: "sign" | "chain") => void) => Promise<unknown>, refreshId?: number) => Promise<boolean> };
type State = { ready: boolean; opens: number | null; v2: Address | null; onV2: boolean; fee: bigint | null };

export function CoinLaunch({ id, wallet, me, bal, busy, run }: Props) {
  const [st, setSt] = useState<State | undefined>(undefined);
  const [coin, setCoin] = useState<{ address: Address; symbol: string; name: string } | null>(null);
  const [f, setF] = useState({ name: `Trencher ${id}`, symbol: `T${id}`, description: `The coin of Trencher #${id}, an AI trading agent on Robinhood Chain, powered by the Trenchers Network. Its creator fees fund the agent.`, x: "", telegram: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [ver, setVer] = useState(0);

  useEffect(() => {
    const d = DEPLOYMENT; if (!d) return;
    const c = reader();
    (async () => {
      const [launcher, pL, pV, current, own, fee, logic] = await Promise.all([
        c.readContract({ address: d.config, abi: ABI.config, functionName: "launcher" }).catch(() => zeroAddress),
        c.readContract({ address: d.config, abi: ABI.config, functionName: "pending", args: [2] }).catch(() => [zeroAddress, 0n] as const),
        c.readContract({ address: d.config, abi: ABI.config, functionName: "pending", args: [4] }).catch(() => [zeroAddress, 0n] as const),
        c.readContract({ address: d.config, abi: CFG, functionName: "accountLogic" }).catch(() => zeroAddress),
        c.readContract({ address: wallet, abi: ABI.agent, functionName: "coin" }).catch(() => zeroAddress),
        c.readContract({ address: PONS_FACTORY, abi: PONS, functionName: "launchFee" }).catch(() => null),
        c.readContract({ address: wallet, abi: AGENT_V2, functionName: "agentLogic" }).catch(() => zeroAddress),
      ]);
      // Version 2: the offered one, or the one waiting out its 48-hour notice.
      const isV2 = (a: Address) => (a === zeroAddress ? Promise.resolve(false) : c.readContract({ address: a, abi: AGENT_V2, functionName: "VERSION" }).then((v) => v === 2n).catch(() => false));
      const v2 = (await isV2(current)) ? current : (await isV2(pV[0])) ? pV[0] : null;
      const offered = v2 ? await c.readContract({ address: d.config, abi: CFG, functionName: "isAccountLogic", args: [v2] }).catch(() => false) : false;
      const launcherOk = launcher.toLowerCase() === PONS_FACTORY.toLowerCase();
      const ready = launcherOk && offered;
      const etas = [!launcherOk && pL[0].toLowerCase() === PONS_FACTORY.toLowerCase() ? Number(pL[1]) : 0, !offered && v2 && pV[0] === v2 ? Number(pV[1]) : 0];
      setSt({ ready, opens: ready ? null : Math.max(...etas) || null, v2, onV2: !!v2 && logic.toLowerCase() === v2.toLowerCase(), fee });
      if (own !== zeroAddress) {
        const [symbol, name] = await Promise.all([c.readContract({ address: own, abi: ERC20, functionName: "symbol" }).catch(() => "?"), c.readContract({ address: own, abi: ERC20, functionName: "name" }).catch(() => "")]);
        setCoin({ address: own, symbol, name });
      } else setCoin(null);
    })();
  }, [wallet, ver]);

  const sym = f.symbol.trim().toUpperCase();
  const switchV2 = () => run(`Switching Trencher #${id} to agent wallet version 2`, (ph) =>
    sendCall(me, { address: wallet, abi: AGENT_V2, functionName: "setAgentVersion", args: [st!.v2!] }, ph), id).then((ok) => { if (ok) setVer((v) => v + 1); });

  const launch = () => run(`Launching $${sym} for Trencher #${id}`, async (ph) => {
    if (!st?.ready) throw new Error("Coin launches aren't switched on yet.");
    if (!st.onV2) throw new Error("Switch this agent to wallet version 2 first.");
    if (st.fee !== null && bal < st.fee) throw new Error(`The agent needs ${fmt(st.fee)} ETH for the Pons launch fee. Deposit ${fmt(st.fee - bal)} ETH first.`);
    const params = {
      name: f.name.trim(), symbol: sym, logo: `${SITE}/meta/img/awake/${id}.png`, description: f.description.trim(),
      socials: { twitter: f.x.trim(), telegram: f.telegram.trim(), discord: "", website: `${SITE}/collection#${id}`, farcaster: "" },
      creatorFeeRecipient: wallet, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: zeroHash,
    };
    await sendCall(me, { address: wallet, abi: AGENT_V2, functionName: "launchCoin", args: [params, 0n] }, ph);
  }, id).then((ok) => { if (ok) { setMsg(null); setVer((v) => v + 1); } });

  const collect = () => run(`Collecting $${coin?.symbol ?? ""} creator fees for Trencher #${id}`, (ph) =>
    sendCall(me, { address: wallet, abi: AGENT_V2, functionName: "claimCoinFees" }, ph), id).then((ok) => { if (ok) setMsg("Creator fees collected into the agent wallet. They're free balance: withdraw them any time."); });

  const valid = f.name.trim().length >= 2 && /^[A-Za-z0-9]{2,10}$/.test(f.symbol.trim());
  const opens = st?.opens ? new Date(st.opens * 1000) : null;

  return (
    <section className="panel-card coin-launch">
      <h3>Its own coin</h3>
      {coin ? (
        <div className="coin-own">
          <p><b>${coin.symbol}</b> {coin.name && <span className="muted-note">· {coin.name}</span>}</p>
          <p className="muted-note">Launched on Pons by this agent&apos;s wallet. Every trade pays creator fees to the agent, and the engine never trades its own coin.</p>
          <div className="agent-actions">
            {st?.onV2 && <button type="button" className="gf-btn go" onClick={collect} disabled={busy}>Collect creator fees</button>}
            <span className="agent-links">
              <a className="tbtn" href={gmgnToken(coin.address)} target="_blank" rel="noreferrer">GMGN ↗</a>
              <a className="tbtn" href={`${EXPLORER}/token/${coin.address}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
            </span>
          </div>
          {msg && <p className="muted-note">{msg}</p>}
        </div>
      ) : st === undefined ? (
        <p className="muted-note">Checking…</p>
      ) : (
        <div className={st.ready ? "" : "coin-soon"}>
          {!st.ready && <p className="coin-soon-tag">{opens ? `Opens ${opens.toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : "Coming soon"}</p>}
          <p className="muted-note">Launch your agent&apos;s own coin on Pons, once. <b>The agent wallet deploys it itself</b>, so it is the coin&apos;s creator: every trade in it pays creator fees into the agent&apos;s wallet, and its art becomes the coin&apos;s logo. The Pons launch fee ({st.fee === null ? "…" : `${fmt(st.fee)} ETH`}) comes out of the agent&apos;s balance, so it works with just the starter.</p>
          {st.ready && !st.onV2 && (
            <div className="coin-step">
              <p><b>Step 1 · Switch to agent wallet version 2.</b> One transaction. Same wallet address, balance, rules and track record; you can switch back any time.</p>
              <button type="button" className="gf-btn go" onClick={switchV2} disabled={busy}>Switch to version 2</button>
            </div>
          )}
          <fieldset className="coin-form" disabled={!st.ready || !st.onV2 || busy}>
            <label><span className="mono">Name</span><input value={f.name} maxLength={32} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label><span className="mono">Ticker</span><input className="mono" value={f.symbol} maxLength={10} onChange={(e) => setF({ ...f, symbol: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })} /></label>
            <label className="wide"><span className="mono">Description</span><textarea rows={3} maxLength={280} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <label><span className="mono">X (optional)</span><input placeholder="https://x.com/…" value={f.x} onChange={(e) => setF({ ...f, x: e.target.value })} /></label>
            <label><span className="mono">Telegram (optional)</span><input placeholder="https://t.me/…" value={f.telegram} onChange={(e) => setF({ ...f, telegram: e.target.value })} /></label>
          </fieldset>
          {msg && <p className="muted-note">{msg}</p>}
          <button type="button" className="gf-btn go" onClick={launch} disabled={!st.ready || !st.onV2 || busy || !valid}>
            {!st.ready ? `Launch $${sym || "…"} · ${opens ? "opens soon" : "coming soon"}` : !st.onV2 ? `Step 2 · Launch $${sym || "…"}` : `Launch $${sym || "…"}`}
          </button>
        </div>
      )}
    </section>
  );
}
