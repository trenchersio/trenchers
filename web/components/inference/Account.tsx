"use client";
// The account: a sample dashboard until you sign in, then your own, with the keys beside it.
// One action, one signature: a write's own answer is folded into the view instead of reloading it behind a second prompt.
import { useCallback, useEffect, useState } from "react";
import { useWallet, short } from "@/lib/wallet";
import { deskApi, signText, tokens, usd, when, type AccountView, type Key } from "@/lib/inference";
import { EXPLORER } from "@/lib/constants";
import { Dash, SAMPLE } from "./Dash";
import { CopyBtn } from "./Endpoint";

export function Account({ prefix }: { prefix: string }) {
  const w = useWallet();
  const [view, setView] = useState<AccountView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stage, setStage] = useState<"server" | "wallet">("server");
  const [err, setErr] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [limit, setLimit] = useState("");

  useEffect(() => { setView(null); setFresh(null); }, [w.address]);

  const proved = useCallback(async (extra: Record<string, unknown> = {}) => {
    if (!w.address) throw new Error("Connect a wallet first.");
    if (w.kind === "demo") throw new Error("The demo wallet cannot sign. Connect a browser wallet to open your account.");
    const { message } = await deskApi<{ nonce: string; message: string }>("/nonce", { method: "POST", body: { address: w.address } });
    setStage("wallet");
    const signature = await signText(w.address, message);
    setStage("server");
    return { address: w.address, signature, ...extra };
  }, [w.address, w.kind]);

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setErr(null); setStage("server");
    try { await fn(); }
    catch (e) { const m = (e as Error).message; setErr(/denied|rejected/i.test(m) ? "You cancelled the signature, so nothing happened." : m); }
    finally { setBusy(null); setStage("server"); }
  };
  const saying = (own: string, idle: string) => (busy === own ? (stage === "wallet" ? "Check your wallet…" : "Working…") : idle);

  const load = () => run("load", async () => { setView(await deskApi<AccountView>("/account", { method: "POST", body: await proved() })); });
  const mint = () => run("mint", async () => {
    const out = await deskApi<{ secret: string; key: Key }>("/keys", { method: "POST", body: await proved({ label: label.trim() || undefined, spendLimitUsd: limit.trim() || undefined }) });
    setFresh(out.secret); setLabel(""); setLimit("");
    setView((v) => (v ? { ...v, keys: [out.key, ...v.keys] } : v));
  });
  const revoke = (id: string) => run(`revoke:${id}`, async () => {
    await deskApi(`/keys/${id}/revoke`, { method: "POST", body: await proved() });
    setView((v) => (v ? { ...v, keys: v.keys.map((k) => (k.id === id ? { ...k, disabled: true } : k)) } : v));
  });

  return (
    <div className="iacct">
      <div className="iacct-main">
        {view ? <Dash account={view.account} charges={view.charges} where={`${short(view.account.owner)} · your account`} />
          : <Dash account={SAMPLE.account} charges={SAMPLE.charges} isSample where="trenchers.io/inference" />}

        {view && (view.deposits.length > 0 || view.charges.length > 0) && (
          <div className="ihist">
            <div className="ihist-col">
              <div className="ipanel-head"><span className="ipanel-dot" /><span>Credit bought</span></div>
              <ul>
                {view.deposits.map((d) => (
                  <li key={d.id}>
                    <span className="mono">{when(d.createdAt)}</span>
                    <span>{tokens(d.tokenUnits)} $TRENCHERS {d.burnTx && (EXPLORER ? <a className="iburned" href={`${EXPLORER}/tx/${d.burnTx}`} target="_blank" rel="noreferrer">burned ↗</a> : <span className="iburned">burned</span>)}</span>
                    <span className="mono ok">+{usd(d.creditedMicroUsd)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="ihist-col">
              <div className="ipanel-head"><span className="ipanel-dot" /><span>Recent calls</span></div>
              <ul>
                {view.charges.slice(0, 8).map((c) => (
                  <li key={c.id}>
                    <span className="mono">{when(c.at)}</span>
                    <span className="mono ihist-model">{c.model}<em>{c.tokensIn.toLocaleString("en-US")} in · {c.tokensOut.toLocaleString("en-US")} out</em></span>
                    <span className="mono">{c.state === "settled" ? usd(c.costMicroUsd, 4) : <i className="ihist-state">{c.state}</i>}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <aside className="ikeys">
        <div className="ipanel-head"><span className="ipanel-dot" /><span>API keys</span>{view && <span className="mono ikeys-n">{view.keys.filter((k) => !k.disabled).length} active</span>}</div>
        {!view ? (
          <div className="ikeys-gate">
            <p><b>This is a sample.</b> {w.address ? "One signature opens your own account: the balance, the keys and every call they have made." : "Connect the wallet you pay from to see your own: the balance, every call and what it cost."}</p>
            <button type="button" className="ibtn" onClick={w.address ? load : w.openModal} disabled={busy !== null}>
              {w.address ? saying("load", "Sign in with your wallet") : "Connect wallet"}
            </button>
            <p className="inf-fine">A signature, not a transaction. Nothing moves and there is no gas.</p>
            <ul className="ikeys-list ikeys-ghost" aria-hidden="true">
              <li><code>{prefix}_live_9f2c…a41e</code><span>trading bot</span></li>
              <li><code>{prefix}_live_1b07…cc92</code><span>laptop · $5 ceiling</span></li>
            </ul>
          </div>
        ) : (
          <div className="ikeys-body">
            {fresh && (
              <div className="ikeys-fresh">
                <b>Copy this now. It is not shown again.</b>
                <code>{fresh}</code>
                <CopyBtn text={fresh} label="Copy key" />
                <p className="inf-fine">Only a hash of it is stored, so it cannot be shown again. Lose it and make another; revoking costs nothing.</p>
              </div>
            )}
            <ul className="ikeys-list">
              {view.keys.map((k) => (
                <li key={k.id} className={k.disabled ? "off" : undefined}>
                  <div>
                    <code>{k.display}</code>
                    <span>{k.label ?? "no label"}{k.disabled ? " · revoked" : ""}</span>
                    <span className="mono">spent {usd(k.spentMicroUsd)}{k.spendLimitMicroUsd ? ` of ${usd(k.spendLimitMicroUsd)}` : ""} · {k.lastUsedAt ? `used ${when(k.lastUsedAt)}` : "never used"}</span>
                  </div>
                  {!k.disabled && <button type="button" className="tbtn" onClick={() => revoke(k.id)} disabled={busy !== null}>{busy === `revoke:${k.id}` ? "…" : "Revoke"}</button>}
                </li>
              ))}
            </ul>
            <div className="ikeys-mint">
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What is it for? (optional)" maxLength={80} />
              <input value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Spend ceiling in $ (optional)" inputMode="decimal" />
              <button type="button" className="ibtn" onClick={mint} disabled={busy !== null}>{saying("mint", "Make a key")}</button>
            </div>
            <p className="inf-fine">A ceiling caps what one key can ever spend, whatever the account holds. Useful for a key you put into something you do not entirely trust.</p>
          </div>
        )}
        {err && <p className="ibuy-err" style={{ margin: "0 16px 16px" }}>{err}</p>}
      </aside>
    </div>
  );
}
