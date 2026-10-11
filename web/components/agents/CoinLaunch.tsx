"use client";
import { useEffect, useState } from "react";
import { decodeAbiParameters, encodeFunctionData, formatEther, keccak256, parseAbi, toHex, zeroAddress, zeroHash, type Address } from "viem";
import { ABI, DEPLOYMENT, reader, sendCall } from "@/lib/chain";
import { EXPLORER, gmgnToken } from "@/lib/constants";
import { useCoins, ethFmt } from "@/components/coins/coins";
import { CoinChartButton } from "@/components/coins/CoinChart";
import { useCoinInfo } from "@/components/coins/chainCoin";
import { ProgrammableLaunch } from "./ProgrammableLaunch";
import { AGENT_V4_ABI, FOUNDATION_LEDGER_ABI, programmableCoinUrl } from "@/lib/programmable";

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
  "function launchCoin(bytes data, uint256 fee) returns (address coin, address curve)",
  "function claimCoinFees() returns (uint256 amount)",
  "function VERSION() view returns (uint256)",
  "function agentLogic() view returns (address)",
  "function setAgentVersion(address logic)",
]);
const SOC = "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }";
const BASE = "string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics";
/** The Pons launch call in both formats: newer factories take a bytes32 salt at the end of TokenParams. */
const FACTORY = {
  salt: parseAbi([SOC, `struct TokenParams { ${BASE}; bytes32 salt; }`, "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)"]),
  plain: parseAbi([SOC, `struct TokenParams { ${BASE}; }`, "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)"]),
};
const STARTER = parseAbi(["function starterLocked() view returns (uint256)"]);
const CFG = parseAbi(["function accountLogic() view returns (address)", "function isAccountLogic(address) view returns (bool)"]);
const PONS = parseAbi(["function launchFee() view returns (uint256)"]);
const ERC20 = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
const SITE = "https://www.trenchers.io";
const tk = (v: bigint) => { const n = Number(formatEther(v)); return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(2); };
const fmt = (v: bigint) => Number(formatEther(v)).toFixed(6).replace(/\.?0+$/, "") || "0";

type Props = { id: number; wallet: Address; me: Address; bal: bigint; busy: boolean; run: (label: string, fn: (ph: (p: "sign" | "chain") => void) => Promise<unknown>, refreshId?: number) => Promise<boolean> };
type State = { ready: boolean; opens: number | null; v2: Address | null; v2n: number; onV2: boolean; fee: bigint | null; walletVersion: number; free: bigint; need: bigint; v3: Address | null; v3At: number | null; newest: number;
  /** Agent wallet version 4 (launches on Programmable itself): offered to holders, and this wallet's Programmable factory. */
  v4: Address | null; agentFactory: Address | null;
  /** A Programmable coin launched by this agent wallet: its fee ledger, fees waiting there and fees already in the wallet for the holder ($TRENCHERS). */
  ledger: Address | null; feesPending: bigint; feesReady: bigint };

export function CoinLaunch({ id, wallet, me, bal, busy, run }: Props) {
  const [st, setSt] = useState<State | undefined>(undefined);
  const [coin, setCoin] = useState<{ address: Address; symbol: string; name: string } | null>(null);
  const [f, setF] = useState({ name: `Trencher ${id}`, symbol: `T${id}`, description: `The coin of Trencher #${id}, an AI trading agent on Robinhood Chain, powered by the Trenchers Network. Its creator fees fund the agent.`, x: "", telegram: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [ver, setVer] = useState(0);
  const [venue, setVenue] = useState<"pons" | "programmable">("pons");

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
      // The newest coin-capable wallet version (3, else 2): the offered one, or the one waiting out its 48-hour notice.
      const ver = (a: Address) => (a === zeroAddress ? Promise.resolve(0) : c.readContract({ address: a, abi: AGENT_V2, functionName: "VERSION" }).then(Number).catch(() => 0));
      const [vc, vp] = await Promise.all([ver(current), ver(pV[0])]);
      const v2 = vp >= 2 && vp >= vc ? pV[0] : vc >= 2 ? current : null;
      const v2n = v2 === pV[0] ? vp : vc;
      const launcherOk = launcher.toLowerCase() === PONS_FACTORY.toLowerCase();
      const [walletVersion, free, lockedNow, starterLocked, balance] = await Promise.all([
        c.readContract({ address: wallet, abi: AGENT_V2, functionName: "VERSION" }).then(Number).catch(() => 1),
        c.readContract({ address: wallet, abi: ABI.agent, functionName: "withdrawable" }).catch(() => 0n),
        c.readContract({ address: wallet, abi: ABI.agent, functionName: "lockedNow" }).catch(() => 0n),
        c.readContract({ address: wallet, abi: STARTER, functionName: "starterLocked" }).catch(() => 0n),
        c.getBalance({ address: wallet }).catch(() => 0n),
      ]);
      // Version 4: the agent wallet launches on Programmable itself; its coin's fee ledger pays the agent in $TRENCHERS.
      const v4r = walletVersion >= 4 ? await Promise.all([
        c.readContract({ address: wallet, abi: AGENT_V4_ABI, functionName: "programmableFactory" }).catch(() => null),
        c.readContract({ address: wallet, abi: AGENT_V4_ABI, functionName: "coinLedger" }).catch(() => zeroAddress),
        c.readContract({ address: wallet, abi: AGENT_V4_ABI, functionName: "coinFeeTokensOwed" }).catch(() => 0n),
      ]) : [null, zeroAddress, 0n] as const;
      const ledger = v4r[1] && v4r[1] !== zeroAddress ? v4r[1] as Address : null;
      const feesPending = ledger ? await Promise.all([
        c.readContract({ address: ledger, abi: FOUNDATION_LEDGER_ABI, functionName: "creatorCredited" }),
        c.readContract({ address: ledger, abi: FOUNDATION_LEDGER_ABI, functionName: "creatorClaimed" }),
      ]).then(([a, b]) => (a > b ? a - b : 0n)).catch(() => 0n) : 0n;
      // How much to deposit so the free balance covers the fee. While the starter is locked and the agent holds less
      // than its starter (trading losses), a deposit first refills the locked part, so it takes more than the fee.
      const f0 = fee ?? 0n;
      const need = free >= f0 ? 0n : lockedNow > 0n && balance <= starterLocked ? starterLocked + f0 - balance : f0 - free;
      // Coin launches only need Pons as the launcher: the original wallet code (1) and version 3 launch directly on it.
      setSt({ ready: launcherOk, opens: launcherOk ? null : (pL[0].toLowerCase() === PONS_FACTORY.toLowerCase() ? Number(pL[1]) : null), v2, v2n, onV2: !!v2 && logic.toLowerCase() === v2.toLowerCase(), fee, walletVersion, free, need,
        // Version 3 (fee paid from the starter) once it's switched on for holders, or when its 48-hour notice ends.
        v3: vc >= 3 ? current : null, newest: vc, v3At: vc < 3 && vp >= 3 ? Number(pV[1]) : null,
        v4: vc >= 4 && walletVersion < 4 ? current : null, agentFactory: (v4r[0] as Address | null) ?? null, ledger, feesPending, feesReady: v4r[2] as bigint });
      if (own !== zeroAddress) {
        const [symbol, name] = await Promise.all([c.readContract({ address: own, abi: ERC20, functionName: "symbol" }).catch(() => "?"), c.readContract({ address: own, abi: ERC20, functionName: "name" }).catch(() => "")]);
        setCoin({ address: own, symbol, name });
      } else setCoin(null);
    })();
  }, [wallet, ver]);

  const coins = useCoins();
  const seen = coins?.find((c) => c.wallet.toLowerCase() === wallet.toLowerCase()) ?? null;
  // The engine saw this agent wallet launch a coin even if the wallet didn't record it: show that coin (no second launch).
  const shown = coin ?? (seen ? { address: seen.coin as Address, symbol: seen.symbol, name: "" } : null);
  // Fees, volume and chart: read from the coin's own trades on-chain (the engine's figures stand in until then).
  const info = useCoinInfo(id, wallet, shown?.address) ?? seen;
  const sym = f.symbol.trim().toUpperCase();
  // A Programmable coin: launched by the agent wallet (version 4, it has a fee ledger) or from the holder's wallet (seen by the engine).
  const onProgrammable = !!st?.ledger || seen?.venue === "programmable";
  const fromHolder = onProgrammable && !st?.ledger;

  const launch = () => run(`Launching $${sym} for Trencher #${id}`, async (ph) => {
    if (!st?.ready) throw new Error("Coin launches aren't switched on yet.");
    const fee = st.fee ?? 0n;
    const params = {
      name: f.name.trim(), symbol: sym, logo: `${SITE}/meta/img/awake/${id}.png`, description: f.description.trim(),
      socials: { twitter: f.x.trim(), telegram: f.telegram.trim(), discord: "", website: `${SITE}/collection#${id}`, farcaster: "" },
      creatorFeeRecipient: wallet, creatorTaxBps: 0, buybackEnabled: false, expectedEconomics: zeroHash,
    };
    // The Pons launch call, in the format the live factory accepts (tested first): newer factories add a salt.
    const salt = keccak256(toHex(`${wallet}:${Date.now()}`));
    const tries = [encodeFunctionData({ abi: FACTORY.salt, functionName: "launchToken", args: [{ ...params, salt }, 0n, zeroAddress] }), encodeFunctionData({ abi: FACTORY.plain, functionName: "launchToken", args: [params, 0n, zeroAddress] })];
    let last: unknown = null;
    for (const data of tries) {
      if (st.walletVersion >= 3) {
        try { await reader().simulateContract({ address: wallet, abi: AGENT_V2, functionName: "launchCoin", args: [data, fee], account: me }); } catch (e) { last = e; continue; }
        await sendCall(me, { address: wallet, abi: AGENT_V2, functionName: "launchCoin", args: [data, fee] }, ph);
        return;
      }
      // Original wallet code: the agent wallet calls Pons itself (deployer and creator); the fee comes from its free balance.
      if (st.free < fee) throw new Error(`Deposit ${fmt(st.need)} ETH into the agent first (Funding → Deposit): the launch fee comes from its free balance.`);
      let coinAddr: Address;
      try {
        const sim = await reader().simulateContract({ address: wallet, abi: ABI.agent, functionName: "launchCoin", args: [data, fee, zeroAddress], account: me });
        [coinAddr] = decodeAbiParameters([{ type: "address" }, { type: "address" }], sim.result as `0x${string}`) as unknown as [Address];
      } catch (e) { last = e; continue; }
      await sendCall(me, { address: wallet, abi: ABI.agent, functionName: "launchCoin", args: [data, fee, coinAddr] }, ph);
      return;
    }
    throw last ?? new Error("Pons refused the launch.");
  }, id).then((ok) => { if (ok) { setMsg(null); setVer((v) => v + 1); } });

  const toOriginal = () => run(`Switching Trencher #${id} back to the original wallet code`, (ph) =>
    sendCall(me, { address: wallet, abi: AGENT_V2, functionName: "setAgentVersion", args: [zeroAddress] }, ph), id).then((ok) => { if (ok) setVer((v) => v + 1); });

  const toV3 = () => run(`Switching Trencher #${id} to agent wallet version ${st?.newest ?? 3}`, (ph) =>
    sendCall(me, { address: wallet, abi: AGENT_V2, functionName: "setAgentVersion", args: [st!.v3!] }, ph), id).then((ok) => { if (ok) setVer((v) => v + 1); });

  const toV4 = () => run(`Switching Trencher #${id} to agent wallet version 4`, (ph) =>
    sendCall(me, { address: wallet, abi: AGENT_V2, functionName: "setAgentVersion", args: [st!.v4!] }, ph), id).then((ok) => { if (ok) setVer((v) => v + 1); });

  const collect = () => run(`Collecting $${shown?.symbol ?? ""} creator fees for Trencher #${id}`, (ph) =>
    sendCall(me, { address: wallet, abi: AGENT_V2, functionName: "claimCoinFees" }, ph), id).then((ok) => { if (ok) { setMsg(st?.ledger ? "Creator fees collected and sent to your wallet in $TRENCHERS." : "Creator fees collected into the agent wallet. They're free balance: withdraw them any time."); setVer((v) => v + 1); } });

  const valid = f.name.trim().length >= 2 && /^[A-Za-z0-9]{2,10}$/.test(f.symbol.trim());
  const opens = st?.opens ? new Date(st.opens * 1000) : null;

  return (
    <section className="panel-card coin-launch">
      <h3>Its own coin</h3>
      {shown && onProgrammable ? (
        <div className="coin-own">
          <div className="coin-own-id">
            <b className="mono coin-own-sym">${shown.symbol}</b>
            {shown.name && <span className="coin-own-name">{shown.name}</span>}
            <span className="pg-badge mono">Programmable · /$TRENCHERS</span>
          </div>
          {st?.ledger ? (
            <p className="mono agent-coin-fees">{`${tk(st.feesPending + st.feesReady)} $TRENCHERS creator fees to collect`}</p>
          ) : null}
          <p className="muted-note">{fromHolder
            ? "Launched on Programmable from the holder's wallet and linked to this Trencher. Its creator fees, in $TRENCHERS, go to the wallet that launched it (claim them on Programmable). The engine never trades it."
            : "Launched on Programmable by this agent's wallet, paired with $TRENCHERS. Every trade pays creator fees in $TRENCHERS; collecting them sends them to the holder. The engine never trades its own coin."}</p>
          <div className="agent-actions">
            {st?.ledger && <button type="button" className="gf-btn go" onClick={collect} disabled={busy || st.feesPending + st.feesReady === 0n}>Collect creator fees</button>}
            <span className="agent-links">
              <a className="tbtn" href={programmableCoinUrl(shown.address)} target="_blank" rel="noreferrer">Programmable ↗</a>
              <a className="tbtn" href={`${EXPLORER}/token/${shown.address}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
            </span>
          </div>
          {msg && <p className="muted-note">{msg}</p>}
        </div>
      ) : shown ? (
        <div className="coin-own">
          <div className="coin-own-id">
            <b className="mono coin-own-sym">${shown.symbol}</b>
            {shown.name && <span className="coin-own-name">{shown.name}</span>}
          </div>
          <p className="mono agent-coin-fees">{info ? `${ethFmt(info.feesEth)} ETH creator fees earned · ${ethFmt(info.volumeEth)} ETH volume · ${info.trades} trades` : "Reading its trades…"}</p>
          <p className="muted-note">Launched on Pons by this agent&apos;s wallet. Every trade pays creator fees to the agent, and the engine never trades its own coin.</p>
          <div className="agent-actions">
            {(st?.walletVersion ?? 0) >= 3 && <button type="button" className="gf-btn go" onClick={collect} disabled={busy}>Collect creator fees</button>}
            <span className="agent-links">
              <CoinChartButton coin={info} fallback={{ agent: id, coin: shown.address, symbol: shown.symbol }} />
              <a className="tbtn" href={gmgnToken(shown.address)} target="_blank" rel="noreferrer">GMGN ↗</a>
              <a className="tbtn" href={`${EXPLORER}/token/${shown.address}`} target="_blank" rel="noreferrer">Etherscan ↗</a>
            </span>
          </div>
          {(st?.walletVersion ?? 0) < 3 && <p className="muted-note">Its creator fees build up for the agent wallet at Pons. Collecting them during the starter lock arrives with the next agent wallet version.</p>}
          {msg && <p className="muted-note">{msg}</p>}
        </div>
      ) : st === undefined ? (
        <p className="muted-note">Checking…</p>
      ) : (
        <div className={st.ready || venue === "programmable" ? "" : "coin-soon"}>
          <div className="coin-venue" role="radiogroup" aria-label="Where to launch">
            <button type="button" role="radio" aria-checked={venue === "pons"} className={`cv${venue === "pons" ? " on" : ""}`} onClick={() => setVenue("pons")}>
              <b>Pons</b><small>Paired with ETH. The agent wallet launches it; fees in ETH.</small>
            </button>
            <button type="button" role="radio" aria-checked={venue === "programmable"} className={`cv${venue === "programmable" ? " on" : ""}`} onClick={() => setVenue("programmable")}>
              <b>Programmable <em className="mono">New</em></b><small>Paired with $TRENCHERS. Pick any of Programmable&apos;s modules.</small>
            </button>
          </div>
          {venue === "programmable" ? (<>
            <fieldset className="coin-form" disabled={busy}>
              <label><span className="mono">Name</span><input value={f.name} maxLength={32} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              <label><span className="mono">Ticker</span><input className="mono" value={f.symbol} maxLength={10} onChange={(e) => setF({ ...f, symbol: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })} /></label>
              <label className="wide"><span className="mono">Description</span><textarea rows={3} maxLength={280} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
              <label><span className="mono">X (optional)</span><input placeholder="https://x.com/…" value={f.x} onChange={(e) => setF({ ...f, x: e.target.value })} /></label>
              <label><span className="mono">Telegram (optional)</span><input placeholder="https://t.me/…" value={f.telegram} onChange={(e) => setF({ ...f, telegram: e.target.value })} /></label>
            </fieldset>
            <ProgrammableLaunch id={id} wallet={wallet} me={me} busy={busy} form={{ ...f, symbol: sym }} valid={valid}
              agentFactory={st.agentFactory} v4Offered={st.v4} free={st.free} onSwitchV4={toV4} run={run}
              onLaunched={() => { setMsg(null); setVer((v) => v + 1); }} />
          </>) : (<>
          {!st.ready && <p className="coin-soon-tag">{opens ? `Opens ${opens.toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : "Coming soon"}</p>}
          <p className="muted-note">Launch your agent&apos;s own coin on Pons, once. <b>The agent wallet deploys it itself</b>, so it is the coin&apos;s creator: every trade in it pays creator fees into the agent&apos;s wallet, and its art becomes the coin&apos;s logo. Pons charges a launch fee of {st.fee === null ? "…" : `${fmt(st.fee)} ETH`}{st.walletVersion >= 3 ? ", taken from the agent's balance (the starter can pay it)." : ", paid from the agent's free balance: deposit it first."}</p>
          {st.ready && st.walletVersion < 3 && st.v3 && (st.walletVersion === 2 || (st.fee !== null && st.free < st.fee)) && (
            <div className="coin-step">
              <p><b>Step 1 · Switch to agent wallet version {st.newest}.</b> Instant, one transaction. Version {st.newest} pays the launch fee from the agent&apos;s starter, so there&apos;s nothing to deposit. Same address, balance, rules and track record.</p>
              <button type="button" className="gf-btn go" onClick={toV3} disabled={busy}>Switch to version {st.newest}</button>
            </div>
          )}
          {st.ready && st.walletVersion === 2 && !st.v3 && (
            <div className="coin-step">
              <p><b>Step 1 · Switch back to the original wallet code.</b> Instant, one transaction. Version 2 can&apos;t launch on the live Pons factory; the original can. Same address, balance, rules and track record.{st.v3At ? ` Or wait for version 3 (free launches), which can be switched on from ${new Date(st.v3At * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}.` : ""}</p>
              <button type="button" className="gf-btn go" onClick={toOriginal} disabled={busy}>Switch to the original</button>
            </div>
          )}
          {st.ready && st.walletVersion < 2 && !st.v3 && st.fee !== null && st.free < st.fee && (
            <div className="coin-step">
              <p><b>Step 1 · Deposit the launch fee.</b> Deposit at least <b>{fmt(st.need)} ETH</b> into the agent (Balance → Deposit, just left). The locked starter can&apos;t pay it on this wallet version.{st.need > st.fee ? " This agent holds less than its starter right now, so a deposit first tops the locked starter back up: only what's above it can pay the fee. Waiting for the next wallet version (free launches) is cheaper for this agent." : ""}</p>
            </div>
          )}
          <fieldset className="coin-form" disabled={!st.ready || st.walletVersion === 2 || (st.walletVersion < 2 && st.fee !== null && st.free < st.fee) || busy}>
            <label><span className="mono">Name</span><input value={f.name} maxLength={32} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label><span className="mono">Ticker</span><input className="mono" value={f.symbol} maxLength={10} onChange={(e) => setF({ ...f, symbol: e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase() })} /></label>
            <label className="wide"><span className="mono">Description</span><textarea rows={3} maxLength={280} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <label><span className="mono">X (optional)</span><input placeholder="https://x.com/…" value={f.x} onChange={(e) => setF({ ...f, x: e.target.value })} /></label>
            <label><span className="mono">Telegram (optional)</span><input placeholder="https://t.me/…" value={f.telegram} onChange={(e) => setF({ ...f, telegram: e.target.value })} /></label>
          </fieldset>
          {msg && <p className="muted-note">{msg}</p>}
          <button type="button" className="gf-btn go" onClick={launch} disabled={!st.ready || st.walletVersion === 2 || (st.walletVersion < 2 && st.fee !== null && st.free < st.fee) || busy || !valid}>
            {!st.ready ? `Launch $${sym || "…"} · ${opens ? "opens soon" : "coming soon"}` : `Launch $${sym || "…"}`}
          </button>
          </>)}
        </div>
      )}
    </section>
  );
}
