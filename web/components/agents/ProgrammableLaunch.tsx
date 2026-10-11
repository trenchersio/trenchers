"use client";
import { useEffect, useMemo, useState } from "react";
import { formatEther, getAddress, parseEther, type Address, type Hex } from "viem";
import { reader, sendCall } from "@/lib/chain";
import {
  AGENT_V4_ABI, FOUNDATION_FACTORY_ABI, TRENCHERS_TOKEN, bpsToPercent, encodeFundingPath, encodeLaunch, mineHookSalt,
  percentToBps, programmableCoinUrl, randomSalt, startTick, TRENCHERS_PONS_URL,
  type ComposeResult, type LaunchParams, type ModuleField, type ProgrammableCatalog, type ProgrammableModule,
} from "@/lib/programmable";

type Form = { name: string; symbol: string; description: string; x: string; telegram: string };
type Props = {
  id: number; wallet: Address; me: Address; busy: boolean; form: Form; valid: boolean;
  /** The agent wallet runs version 4 with this Programmable factory: the agent itself can launch. */
  agentFactory: Address | null;
  /** Version 4 is offered to holders (switching takes one transaction). */
  v4Offered: Address | null;
  /** What the agent wallet can spend right now (free balance), for launches from the agent wallet. */
  free: bigint;
  onSwitchV4: () => void;
  run: (label: string, fn: (ph: (p: "sign" | "chain") => void) => Promise<unknown>, refreshId?: number) => Promise<boolean>;
  onLaunched: (coin: Address) => void;
};

const SLIPPAGE_BPS = 200n;
const fmt = (v: bigint) => Number(formatEther(v)).toFixed(6).replace(/\.?0+$/, "") || "0";

/** The value our form shows for a field's default, from the catalog's raw default. */
function shownDefault(f: ModuleField): string {
  if (f.default === undefined) return "";
  if (f.kind === "percent") return bpsToPercent(f.default);
  if (f.kind === "token" || f.kind === "quote") return formatEther(BigInt(f.default));
  return f.default;
}
const unitOf = (f: ModuleField) => f.kind === "percent" ? "%" : f.kind === "quote" ? "$TRENCHERS" : f.kind === "token" ? "coins" : f.unit === "seconds" ? "sec" : f.unit === "minutes" ? "min" : "";

/** What Programmable's compose step expects for a field: percents as "2.5", amounts in whole units, the rest as text. */
function composeValue(f: ModuleField, v: string): string {
  const t = v.trim();
  if (f.kind === "percent") { percentToBps(t); return t; }
  if (f.kind === "quote" || f.kind === "token") { if (!/^\d+(\.\d{1,18})?$/.test(t)) throw new Error(`"${f.label}" needs a number.`); return t; }
  if (f.kind === "integer") { if (!/^\d+$/.test(t)) throw new Error(`"${f.label}" needs a whole number.`); return t; }
  getAddress(t); return t;
}

export function ProgrammableLaunch({ id, wallet, me, busy, form, valid, agentFactory, v4Offered, free, onSwitchV4, run, onLaunched }: Props) {
  const [cat, setCat] = useState<ProgrammableCatalog | null>(null);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Record<string, string>>>({});
  const [feePct, setFeePct] = useState(5);
  const [firstBuy, setFirstBuy] = useState("0.0015");
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/programmable/catalog", { cache: "no-store" }).then(async (r) => {
      const j = await r.json();
      if (!alive) return;
      if (!r.ok) setCatErr(j.error ?? "Programmable is unavailable right now."); else setCat(j);
    }).catch(() => alive && setCatErr("Programmable is unavailable right now."));
    return () => { alive = false; };
  }, []);

  // From the agent wallet when it runs version 4 against the live factory; otherwise from the holder's own wallet.
  const fromAgent = !!agentFactory && !!cat && agentFactory.toLowerCase() === cat.factory.toLowerCase();
  const budget = useMemo(() => { try { return parseEther(firstBuy || "0"); } catch { return -1n; } }, [firstBuy]);
  const agentShort = fromAgent && budget > free ? budget - free : 0n;
  const live = cat?.modules.filter((m) => m.available) ?? [];
  const soon = cat?.modules.filter((m) => m.comingSoon) ?? [];

  const toggle = (m: ProgrammableModule) => setPicked((p) => {
    if (p[m.id]) { const { [m.id]: _drop, ...rest } = p; return rest; }
    return { ...p, [m.id]: Object.fromEntries(m.fields.map((f) => [f.key, shownDefault(f)])) };
  });
  const setField = (mid: string, key: string, v: string) => setPicked((p) => ({ ...p, [mid]: { ...p[mid], [key]: v } }));

  const launch = () => {
    if (!cat) return;
    setErr(null);
    const creator = fromAgent ? wallet : me;
    return run(`Launching $${form.symbol} on Programmable for Trencher #${id}`, async (ph) => {
      // 1. Modules and their settings, as Programmable expects them.
      const modules = Object.entries(picked).map(([mid, values]) => {
        const mod = cat.modules.find((m) => m.id === mid)!;
        const configuration: Record<string, string> = {};
        for (const f of mod.fields) {
          const v = values[f.key] ?? "";
          if (!v.trim()) { if (f.required && f.default === undefined) throw new Error(`${mod.name}: fill in "${f.label}".`); continue; }
          configuration[f.key] = composeValue(f, v);
        }
        return { id: mid, configuration };
      });
      // 2. Programmable composes the launch: coin metadata, encoded modules, starting price, ETH → $TRENCHERS route.
      setStage("Preparing the launch with Programmable…");
      const tokenSalt = randomSalt();
      const r = await fetch("/api/programmable/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        id, account: creator, tokenSalt, name: form.name.trim(), symbol: form.symbol.trim(), description: form.description.trim(), x: form.x, telegram: form.telegram,
        creatorFeeBps: feePct * 100, initialBuy: firstBuy.trim(), modules,
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? (j.diagnostics?.[0]?.message) ?? "Programmable couldn't prepare this launch.");
      const c = j as ComposeResult;
      if (!c.ethFunding) throw new Error("Programmable didn't return a first-buy route. Try again.");
      // 3. The launch parameters: starting tick (~$5,000 market cap), a 15-minute deadline, then the hook address.
      setStage("Pricing the coin…");
      const client = reader();
      const block = await client.getBlock();
      const p: LaunchParams = {
        metadata: c.metadata, quote: TRENCHERS_TOKEN, quoteDecimals: 18, initialTick: startTick(c.token, 18, c.startPrice), creatorFeeBps: feePct * 100,
        additionalQuoteAmount: 0n, initialBuyQuoteAmount: BigInt(c.ethFunding.quoteAmount), initialBuyMinimumTokenAmount: 1n,
        deadline: block.timestamp + 900n, tokenSalt, hookSalt: `0x${"0".repeat(64)}` as Hex, modules: c.modules,
      };
      const initCodeHash = await client.readContract({ address: cat.factory, abi: FOUNDATION_FACTORY_ABI, functionName: "hookInitCodeHash", args: [creator, c.token, p] });
      setStage("Finding the coin's hook address…");
      const mined = await mineHookSalt(cat.hookDeployer, initCodeHash, (n) => setStage(`Finding the coin's hook address… ${Math.round(n / 1000)}k tries`));
      p.hookSalt = mined.salt;
      const value = BigInt(c.ethFunding.maximumEth), path = c.ethFunding.path;
      // 4. Simulate the real launch to set the minimum first-buy output (2% slippage), then once more as sent.
      setStage("Simulating the launch…");
      const sim = await client.simulateContract({ address: cat.factory, abi: FOUNDATION_FACTORY_ABI, functionName: "launchWithEthRoute", args: [p, encodeFundingPath(path)], value, account: creator });
      const res = sim.result as { token: Address; hook: Address; initialBuyTokenAmount: bigint };
      if (getAddress(res.token) !== getAddress(c.token) || getAddress(res.hook) !== getAddress(mined.hook)) throw new Error("The simulated launch doesn't match its plan. Try again.");
      p.initialBuyMinimumTokenAmount = (res.initialBuyTokenAmount * (10_000n - SLIPPAGE_BPS)) / 10_000n;
      if (p.initialBuyMinimumTokenAmount === 0n) throw new Error("The first buy is too small. Raise it a little.");
      const data = encodeLaunch(p, path);
      // 5. Sign: through the agent wallet (it becomes the creator) or from the holder's own wallet.
      setStage(null);
      const hash = fromAgent
        ? await sendCall(me, { address: wallet, abi: AGENT_V4_ABI, functionName: "launchProgrammable", args: [data, value] }, ph)
        : await sendCall(me, { address: cat.factory, abi: FOUNDATION_FACTORY_ABI, functionName: "launchWithEthRoute", args: [p, encodeFundingPath(path)], value }, ph);
      fetch("/api/programmable/confirmed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: c.token, transactionHash: hash }) }).catch(() => {});
      onLaunched(c.token);
    }, id).then((ok) => { setStage(null); if (!ok) setErr("The launch didn't go through. Nothing was spent if the transaction wasn't sent."); });
  };

  const pickedCount = Object.keys(picked).length;
  return (
    <div className="pg">
      <div className="pg-pair">
        <div className="pg-pair-l">
          <span className="pg-pair-tag mono">Pair</span>
          <a className="pg-pair-link" href={TRENCHERS_PONS_URL} target="_blank" rel="noreferrer" title="$TRENCHERS on Pons">$TRENCHERS ↗</a>
          <span className="muted-note">Every Programmable agent coin trades against $TRENCHERS instead of ETH, so buying it with ETH buys $TRENCHERS first.</span>
        </div>
        <span className="pg-lock mono" title="The pair is fixed for Trenchers agent coins">Locked</span>
      </div>

      <div className="pg-who">
        {fromAgent ? (
          <p><b>Launched by the agent wallet.</b> Agent wallet version 4 makes the agent itself the coin&apos;s creator. Its creator fees ($TRENCHERS) are collected through the agent and sent to you, the holder, any time. The first buy is a real purchase of the coin, paid from the agent&apos;s free balance (not the locked starter): deposit it first.</p>
        ) : (
          <p><b>Launched from your wallet.</b> You sign as the coin&apos;s creator, so its creator fees ($TRENCHERS) go to your wallet, and the first buy is paid from your wallet. It&apos;s linked to Trencher #{id} through its collection page.{v4Offered ? " Want the agent to be the creator instead? Switch to agent wallet version 4 first." : ""}</p>
        )}
        {!fromAgent && v4Offered && <button type="button" className="tbtn" onClick={onSwitchV4} disabled={busy}>Switch to version 4</button>}
      </div>

      <div className="pg-mods">
        <div className="pg-mods-head"><span className="mono">Modules <em className="pg-hooks">V4 Hooks</em></span><em>{catErr ? "" : cat ? `${pickedCount} selected · optional` : "Loading Programmable…"}</em></div>
        {catErr && <p className="tp-err">{catErr}</p>}
        {live.map((m) => {
          const on = !!picked[m.id];
          return (
            <div key={m.id} className={`pg-mod${on ? " on" : ""}`}>
              <button type="button" className="pg-mod-row" onClick={() => toggle(m)} disabled={busy} aria-pressed={on}>
                <span className={`pg-switch${on ? " on" : ""}`} aria-hidden="true"><i /></span>
                <span className="pg-mod-txt"><b>{m.name}</b><small>{m.summary}</small></span>
                <span className="pg-mod-cat mono">{m.category}</span>
              </button>
              {on && m.fields.length > 0 && (
                <div className="pg-fields">
                  {m.fields.map((f) => (
                    <label key={f.key} className={f.kind === "address" ? "wide" : ""}>
                      <span className="mono">{f.label}</span>
                      <span className="pg-input">
                        <input className={f.kind === "address" ? "mono" : ""} inputMode={f.kind === "address" ? "text" : "decimal"} placeholder={f.kind === "address" ? "0x…" : ""}
                          value={picked[m.id][f.key] ?? ""} onChange={(e) => setField(m.id, f.key, e.target.value)} disabled={busy} />
                        {unitOf(f) && <em className="mono">{unitOf(f)}</em>}
                      </span>
                      {f.help && <small>{f.help}</small>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {soon.length > 0 && <p className="pg-soon mono">Coming soon on Programmable: {soon.map((m) => m.name).join(" · ")}</p>}
      </div>

      <div className="pg-econ">
        <label>
          <span className="mono">Creator fee</span>
          <span className="pg-fee">
            {[0, 1, 2, 3, 5, 10].map((v) => (
              <button key={v} type="button" className={`tbtn${feePct === v ? " tbtn-on" : ""}`} onClick={() => setFeePct(v)} disabled={busy}>{v}%</button>
            ))}
          </span>
          <small>On every buy and sell, paid in $TRENCHERS to the creator. Programmable adds its own 0.30%.</small>
        </label>
        <label>
          <span className="mono">First buy</span>
          <span className="pg-input"><input inputMode="decimal" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value.replace(/[^0-9.]/g, ""))} disabled={busy} /><em className="mono">ETH</em></span>
          <small>Required by Programmable (about $2 minimum). It buys $TRENCHERS, then the first coins; unused ETH comes back. The coin starts near a $5,000 market cap.</small>
        </label>
      </div>

      {agentShort > 0n && <p className="tp-err">The agent needs {fmt(agentShort)} ETH more free balance for this first buy (the locked starter can&apos;t pay it). Deposit it (Balance → Deposit) or lower the first buy.</p>}
      {stage && <p className="pg-stage mono">{stage}</p>}
      {err && <p className="tp-err">{err}</p>}
      <button type="button" className="gf-btn go pg-go" onClick={launch} disabled={busy || !valid || !cat || !cat.available || budget <= 0n || agentShort > 0n}>
        Launch ${form.symbol || "…"} on Programmable
      </button>
      <p className="muted-note pg-note">Your coin, its Uniswap v4 pool and the first buy are created in one transaction on Programmable&apos;s launch contract. Modules are Programmable&apos;s and can&apos;t be changed after launch.</p>
    </div>
  );
}
