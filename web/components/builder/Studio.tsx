"use client";
// The launch studio: five short steps on the left, the coin's blueprint on the right, one transaction at the end.
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { useWallet } from "@/lib/wallet";
import { EXPLORER } from "@/lib/constants";
import { MODULES, PLATFORM_FEE_BPS, moduleDef, type BuilderCoin, type BuilderConfig, type ModuleDef, type ModuleKey } from "@/lib/v4builder";
import type { LaunchForm, LaunchStep } from "@/lib/v4builder-actions";
import { Avatar, Marks, num } from "./bits";

const GROUPS: ModuleDef["group"][] = ["Trading rules", "Fee engines", "Games and rewards", "Linked pools"];
const MAX_MODULES = 8;
const PRESETS = { eth: ["0.5", "1", "2.5", "5"], trenchers: ["10000000", "25000000", "50000000", "100000000"] };

const STEP_LABEL: Record<LaunchStep, string> = {
  probe: "Checking modules on-chain",
  predict: "Reserving the coin's address",
  mine: "Finding the hook address",
  simulate: "Dry-running the launch",
  sign: "Confirm in your wallet",
  chain: "Launching on Robinhood Chain",
};
const ORDER: LaunchStep[] = ["probe", "predict", "mine", "simulate", "sign", "chain"];

type Picked = { key: ModuleKey; values: Record<string, string>; sharePct: number };

const unitFor = (t: string, pair: "eth" | "trenchers") =>
  t === "quote" ? (pair === "eth" ? "ETH" : "$TRENCHERS") : t === "tokens" ? "coins" : t === "percent" ? "%" : t === "seconds" ? "sec" : t === "minutes" ? "min" : t === "hours" ? "hours" : t === "hour" ? "UTC" : t === "count" ? "" : "";

function defaults(def: ModuleDef, pair: "eth" | "trenchers"): Record<string, string> {
  // Quote amounts are written for an ETH pair; a $TRENCHERS pair gets the same idea in $TRENCHERS.
  const scale = pair === "trenchers" ? 20_000_000 : 1;
  return Object.fromEntries(def.fields.map((f) => [f.key, f.type === "quote" && scale !== 1 ? String(Number(f.default) * scale) : f.default]));
}

export function Studio({ config, coins, onLaunched }: { config: BuilderConfig | null; coins: BuilderCoin[] | null; onLaunched?: (token: string) => void }) {
  const w = useWallet();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [imgNote, setImgNote] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [useLink, setUseLink] = useState(false);
  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    setImgBusy(true); setImgNote(null);
    try { const { imageToDataUri } = await import("@/lib/image-upload"); setImage(await imageToDataUri(file)); setImgNote(file.name); }
    catch (e) { setImgNote((e as Error).message); }
    finally { setImgBusy(false); }
  };
  const [website, setWebsite] = useState("");
  const [pair, setPair] = useState<"eth" | "trenchers">("eth");
  const [startCap, setStartCap] = useState("1");
  const [buyFee, setBuyFee] = useState(3);
  const [sellFee, setSellFee] = useState(3);
  const [firstBuy, setFirstBuy] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [group, setGroup] = useState<ModuleDef["group"]>("Trading rules");
  const [step, setStep] = useState<LaunchStep | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ token: string; hash: string } | null>(null);

  const switchPair = (p: "eth" | "trenchers") => {
    if (p === pair) return;
    setPair(p); setStartCap(p === "eth" ? "1" : "25000000"); setFirstBuy("");
    setPicked((list) => list.map((m) => ({ ...m, values: defaults(moduleDef(m.key), p) })));
  };
  const toggle = (def: ModuleDef) => {
    setErr(null);
    setPicked((list) => list.some((m) => m.key === def.key) ? list.filter((m) => m.key !== def.key)
      : list.length >= MAX_MODULES ? list
      : [...list, { key: def.key, values: defaults(def, pair), sharePct: def.budget ? 25 : 0 }]);
  };
  const setVal = (k: ModuleKey, field: string, v: string) => setPicked((l) => l.map((m) => m.key === k ? { ...m, values: { ...m.values, [field]: v } } : m));
  const setShare = (k: ModuleKey, v: number) => setPicked((l) => l.map((m) => m.key === k ? { ...m, sharePct: v } : m));

  const shareTotal = picked.reduce((s, m) => s + (moduleDef(m.key).budget ? m.sharePct : 0), 0);
  const linkable = (coins ?? []).filter((c) => c.quote.toLowerCase() === (pair === "eth" ? "0x0bd7d308f8e1639fab988df18a8011f41eacad73" : "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a"));

  const problem = useMemo(() => {
    if (!name.trim()) return "Give your coin a name.";
    if (name.trim().length > 32) return "Keep the name to 32 characters.";
    if (!/^[A-Za-z0-9]{1,10}$/.test(symbol.trim())) return "The ticker is 1 to 10 letters or numbers.";
    if (/^trenchers$/i.test(symbol.trim())) return "That ticker belongs to $TRENCHERS. Pick your own.";
    if (image.trim() && !/^(https|ipfs):\/\/\S+$/.test(image.trim()) && !/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(image.trim())) return "The image link has to start with https:// or ipfs://";
    if (image.trim().length > 2048) return "The image link is too long.";
    if (website.trim() && !/^https:\/\/\S+$/.test(website.trim())) return "The website has to start with https://";
    if (!(Number(startCap) > 0)) return "Set a starting value.";
    if (firstBuy && !(Number(firstBuy) >= 0)) return "The first buy has to be a number.";
    if (shareTotal > 100) return "The modules' shares of your fee add up to more than 100%.";
    for (const m of picked) {
      const def = moduleDef(m.key);
      if (def.budget && m.sharePct < 1) return `${def.name} needs a share of your fee to run on.`;
      if (def.budget && buyFee + sellFee === 0) return `${def.name} runs on your creator fee, so set a fee above 0%.`;
      for (const f of def.fields) {
        const v = m.values[f.key] ?? "";
        if (f.type === "address") { if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return `${def.name}: choose the linked coin.`; continue; }
        const n = Number(v);
        if (v === "" || !isFinite(n) || n < 0) return `${def.name}: ${f.label.toLowerCase()} needs a number.`;
        if (f.min !== undefined && n < f.min) return `${def.name}: ${f.label.toLowerCase()} is at least ${f.min}.`;
        if (f.max !== undefined && n > f.max) return `${def.name}: ${f.label.toLowerCase()} is at most ${f.max}.`;
      }
      if (def.group === "Fee engines" && Number(m.values.maximum) < Number(m.values.minimum)) return `${def.name}: the largest batch can't be smaller than the smallest.`;
      if (m.key === "reactivePair" && !(Number(m.values.min) <= Number(m.values.base) && Number(m.values.base) <= Number(m.values.max))) return "Linked buy cap: smallest cap ≤ cap now ≤ largest cap.";
      if (m.key === "growingBuyLimit" && Number(m.values.final) < Number(m.values.initial)) return "Growing buy limit: the final cap can't be smaller than the cap at launch.";
    }
    return null;
  }, [name, symbol, image, website, startCap, firstBuy, shareTotal, picked, buyFee, sellFee]);

  const live = !!config?.ready;
  const busy = step !== null && !err && !done;

  async function launch() {
    if (!w.address) { w.openModal(); return; }
    if (w.kind === "demo") { setErr("The demo wallet can look around but can't launch. Connect a browser wallet."); return; }
    if (problem || !config) return;
    setErr(null); setDone(null); setDetail(null);
    const form: LaunchForm = {
      name, symbol, description, image, website, pair, startCap, buyFeePct: buyFee, sellFeePct: sellFee,
      firstBuyEth: pair === "eth" ? firstBuy || "0" : "0", firstBuyTrenchers: pair === "trenchers" ? firstBuy || "0" : "0",
      modules: picked.map((m) => ({ key: m.key, values: m.values, sharePct: m.sharePct })),
    };
    if (config.mock) {
      // Local preview: walk through the steps without touching a chain.
      for (const s of ORDER) { setStep(s); await new Promise((r) => setTimeout(r, s === "mine" ? 1100 : 600)); }
      setDone({ token: "0xa000a000a000a000a000a000a000a000a000a000", hash: "0x" + "0".repeat(64) });
      return;
    }
    const { prepareLaunch, sendLaunch, reason } = await import("@/lib/v4builder-actions");
    try {
      const from = w.address as Address;
      const prep = await prepareLaunch(config, from, form, (s, d) => { setStep(s); setDetail(d ?? null); });
      setDetail(null);
      const hash = await sendLaunch(config, from, prep, setStep);
      setDone({ token: prep.token, hash });
      onLaunched?.(prep.token);
    } catch (e) {
      setErr(reason(e));
    }
  }

  const quoteSym = pair === "eth" ? "ETH" : "$TRENCHERS";
  const creatorKeep = Math.max(0, 100 - shareTotal);
  const label = !live ? "Launching opens soon"
    : busy ? STEP_LABEL[step!]
    : !w.address ? "Connect wallet to launch"
    : problem ? problem
    : `Launch ${symbol.trim() ? `$${symbol.trim().toUpperCase()}` : "coin"}`;

  return (
    <div className="vb-studio">
      <div className="vb-sheet">
        <Marks />
        {/* 01 identity */}
        <fieldset className="vb-step">
          <legend><span className="vb-n mono">01</span>Identity</legend>
          <div className="vb-grid2">
            <label className="vb-f"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tidewatch" maxLength={32} /></label>
            <label className="vb-f"><span>Ticker</span><span className="vb-pre"><i className="mono">$</i><input value={symbol} onChange={(e) => setSymbol(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} placeholder="TIDE" maxLength={10} /></span></label>
          </div>
          <label className="vb-f"><span>What is it? <em>optional</em></span><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={280} placeholder="One or two lines people see on the coin page." /></label>
          <div className="vb-grid2">
            <div className="vb-f">
              <span>Image <em>optional, or we make a badge</em></span>
              {useLink ? (
                <input value={image.startsWith("data:") ? "" : image} onChange={(e) => setImage(e.target.value.trim())} placeholder="https://…/logo.png" aria-label="Image link" />
              ) : (
                <label className={`vb-upload${image.startsWith("data:") ? " has" : ""}`}>
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => { onPickImage(e.target.files?.[0]); e.currentTarget.value = ""; }} />
                  {image.startsWith("data:") ? <img src={image} alt="" /> : <i aria-hidden="true">↑</i>}
                  <span className="mono">{imgBusy ? "Shrinking…" : image.startsWith("data:") ? "Change image" : "Upload an image"}</span>
                  {image.startsWith("data:") && <button type="button" className="vb-upload-x mono" onClick={(e) => { e.preventDefault(); setImage(""); setImgNote(null); }}>Remove</button>}
                </label>
              )}
              <small className="vb-upload-note mono">
                {imgNote && !image ? <b>{imgNote}</b> : "PNG, JPG, GIF or WebP. Cropped square and stored in the coin itself."}{" "}
                <button type="button" className="vb-linkbtn" onClick={() => { setUseLink(!useLink); setImage(""); setImgNote(null); }}>{useLink ? "Upload instead" : "Use a link instead"}</button>
              </small>
            </div>
            <label className="vb-f"><span>Website or X <em>optional</em></span><input value={website} onChange={(e) => setWebsite(e.target.value.trim())} placeholder="https://x.com/…" /></label>
          </div>
        </fieldset>

        {/* 02 pair and starting value */}
        <fieldset className="vb-step">
          <legend><span className="vb-n mono">02</span>Pair and starting value</legend>
          <div className="vb-pair" role="radiogroup" aria-label="Pair with">
            <button type="button" role="radio" aria-checked={pair === "eth"} className={pair === "eth" ? "on" : ""} onClick={() => switchPair("eth")}>
              <b>ETH</b><span>Trades against wrapped ETH. The simplest pair.</span>
            </button>
            <button type="button" role="radio" aria-checked={pair === "trenchers"} className={pair === "trenchers" ? "on on-t" : ""} onClick={() => switchPair("trenchers")}>
              <b>$TRENCHERS</b><span>Every buy of your coin is a buy of $TRENCHERS first.</span>
            </button>
          </div>
          <label className="vb-f">
            <span>Whole supply starts valued at</span>
            <span className="vb-pre vb-pre-r"><input value={startCap} onChange={(e) => setStartCap(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /><i className="mono">{quoteSym}</i></span>
          </label>
          <div className="vb-chips">
            {PRESETS[pair].map((p) => <button key={p} type="button" className={startCap === p ? "on" : ""} onClick={() => setStartCap(p)}>{num(Number(p))} {pair === "eth" ? "ETH" : ""}</button>)}
          </div>
          <p className="vb-note">All 1,000,000,000 coins go into the pool at this price and the liquidity is locked forever. Nobody, including you, holds coins before trading opens except through the first buy below.</p>
        </fieldset>

        {/* 03 fees */}
        <fieldset className="vb-step">
          <legend><span className="vb-n mono">03</span>Your fees</legend>
          <div className="vb-grid2">
            {([["On buys", buyFee, setBuyFee], ["On sells", sellFee, setSellFee]] as const).map(([l, v, set]) => (
              <div key={l} className="vb-fee">
                <div className="vb-fee-top"><span>{l}</span><b className="mono">{v}%</b></div>
                <input type="range" min={0} max={10} step={1} value={v} onChange={(e) => set(Number(e.target.value))} aria-label={`Creator fee ${l.toLowerCase()}`} />
                <div className="vb-fee-scale mono"><span>0%</span><span>5%</span><span>10%</span></div>
              </div>
            ))}
          </div>
          <p className="vb-note">Paid to you in {pair === "eth" ? "WETH" : "$TRENCHERS"} on every trade, claimable any time. A separate {PLATFORM_FEE_BPS / 100}% Trenchers fee on each trade funds the $TRENCHERS buyback.</p>
        </fieldset>

        {/* 04 modules */}
        <fieldset className="vb-step">
          <legend><span className="vb-n mono">04</span>Modules <em className="mono">{picked.length}/{MAX_MODULES}</em></legend>
          <div className="vb-tabs" role="tablist">
            {GROUPS.map((g) => (
              <button key={g} type="button" role="tab" aria-selected={group === g} className={group === g ? "on" : ""} onClick={() => setGroup(g)}>
                {g}<i className="mono">{picked.filter((m) => moduleDef(m.key).group === g).length || ""}</i>
              </button>
            ))}
          </div>
          <div className="vb-mods">
            {MODULES.filter((m) => m.group === group).map((def) => {
              const on = picked.some((m) => m.key === def.key);
              const full = !on && picked.length >= MAX_MODULES;
              return (
                <button key={def.key} type="button" className={`vb-mod${on ? " on" : ""}`} onClick={() => toggle(def)} disabled={full} aria-pressed={on}>
                  <span className="vb-mod-box" aria-hidden="true" />
                  <b>{def.name}</b>
                  <span>{def.blurb}</span>
                  {def.budget && <em className="mono">runs on your fee</em>}
                </button>
              );
            })}
          </div>

          {picked.length > 0 && (
            <div className="vb-cfgs">
              {picked.map((m, i) => {
                const def = moduleDef(m.key);
                return (
                  <div key={m.key} className="vb-cfg">
                    <div className="vb-cfg-head">
                      <span className="mono vb-cfg-i">M{i + 1}</span><b>{def.name}</b><span className="vb-cfg-g mono">{def.group}</span>
                      <button type="button" className="vb-x" onClick={() => toggle(def)} aria-label={`Remove ${def.name}`}>×</button>
                    </div>
                    <div className="vb-cfg-body">
                      {def.fields.map((f) => f.type === "address" ? (
                        <label key={f.key} className="vb-f vb-f-wide">
                          <span>{f.label.replace("'s hook", "")}</span>
                          <select value={m.values[f.key]} onChange={(e) => setVal(m.key, f.key, e.target.value)}>
                            <option value="">{linkable.length ? "Choose a coin with the same pair" : "No coins with this pair yet"}</option>
                            {linkable.map((c) => <option key={c.hook} value={c.hook}>${c.symbol} · {c.name}</option>)}
                          </select>
                        </label>
                      ) : (
                        <label key={f.key} className="vb-f">
                          <span>{f.label}</span>
                          <span className="vb-pre vb-pre-r"><input value={m.values[f.key]} onChange={(e) => setVal(m.key, f.key, e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" /><i className="mono">{unitFor(f.type, pair)}</i></span>
                        </label>
                      ))}
                      {def.budget && (
                        <label className="vb-f vb-f-wide vb-share">
                          <span>Share of your fee it runs on <b className="mono">{m.sharePct}%</b></span>
                          <input type="range" min={1} max={100} value={m.sharePct} onChange={(e) => setShare(m.key, Number(e.target.value))} />
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </fieldset>

        {/* 05 first buy */}
        <fieldset className="vb-step">
          <legend><span className="vb-n mono">05</span>First buy <em>optional</em></legend>
          <label className="vb-f">
            <span>{pair === "eth" ? "Buy at launch with" : "Spend at launch"}</span>
            <span className="vb-pre vb-pre-r"><input value={firstBuy} onChange={(e) => setFirstBuy(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" /><i className="mono">{quoteSym}</i></span>
          </label>
          <p className="vb-note">{pair === "eth"
            ? "Paid in ETH, in the same transaction as the launch, so you are the first holder before anyone else can trade."
            : "Paid in ETH: the launch buys exactly this much $TRENCHERS through its pool, then your coin with it. Unspent ETH comes straight back."}</p>
        </fieldset>
      </div>

      {/* the blueprint */}
      <aside className="vb-print" aria-label="Your coin">
        <div className="vb-print-in">
          <div className="vb-print-head mono"><span>blueprint</span><span>{symbol ? `$${symbol}` : "untitled"}.v4</span></div>
          <div className="vb-card">
            <Avatar image={image} symbol={symbol || "?"} size={52} />
            <div className="vb-card-t">
              <b>{name || "Your coin"}</b>
              <span className="mono">${symbol || "TICKER"} / {pair === "eth" ? "ETH" : "TRENCHERS"}</span>
            </div>
          </div>
          {description && <p className="vb-card-d">{description}</p>}

          <dl className="vb-spec mono">
            <div><dt>supply</dt><dd>1,000,000,000</dd></div>
            <div><dt>start value</dt><dd>{num(Number(startCap) || 0)} {pair === "eth" ? "ETH" : "TRENCHERS"}</dd></div>
            <div><dt>liquidity</dt><dd>locked forever</dd></div>
            <div><dt>hook</dt><dd>own contract</dd></div>
          </dl>

          <div className="vb-split">
            <div className="vb-split-k mono">every trade pays</div>
            <div className="vb-split-row"><span>Buys</span><b className="mono">{(buyFee + PLATFORM_FEE_BPS / 100).toFixed(1)}%</b></div>
            <div className="vb-split-row"><span>Sells</span><b className="mono">{(sellFee + PLATFORM_FEE_BPS / 100).toFixed(1)}%</b></div>
            <div className="vb-bar" aria-hidden="true">
              <i className="c" style={{ flex: creatorKeep || 0.001 }} />
              {picked.filter((m) => moduleDef(m.key).budget).map((m) => <i key={m.key} className="m" style={{ flex: m.sharePct }} title={moduleDef(m.key).name} />)}
            </div>
            <div className="vb-legend mono">
              <span><i className="c" />you {creatorKeep}%</span>
              {shareTotal > 0 && <span><i className="m" />modules {shareTotal}%</span>}
              <span className="vb-legend-t">of your fee · +0.3% Trenchers buyback</span>
            </div>
          </div>

          <div className="vb-rules">
            <div className="vb-split-k mono">rules and mechanics</div>
            {picked.length === 0 ? <p className="vb-empty">No modules: a plain v4 coin with your fees. Add rules, fee engines or games in step 04.</p> : (
              <ol>{picked.map((m) => <li key={m.key}><b>{moduleDef(m.key).name}</b><span>{moduleDef(m.key).group}</span></li>)}</ol>
            )}
          </div>

          {(busy || done || (err && step)) && (
            <ol className="vb-prog mono" aria-live="polite">
              {ORDER.map((s) => {
                const i = ORDER.indexOf(s), at = step ? ORDER.indexOf(step) : -1;
                const st = done || i < at ? "ok" : i === at ? (err ? "bad" : "now") : "";
                return <li key={s} className={st}><i />{STEP_LABEL[s]}{s === "mine" && i === at && detail && !done ? <em>{detail}</em> : null}</li>;
              })}
            </ol>
          )}

          {done ? (
            <div className="vb-done">
              <b>Launched.</b>
              <span>Your coin is live and tradable.</span>
              <div className="vb-done-row">
                <a className="vb-btn" href={`?coin=${done.token}`}>Open the coin</a>
                {EXPLORER && !config?.mock && <a className="vb-ghost" href={`${EXPLORER}/tx/${done.hash}`} target="_blank" rel="noreferrer">Transaction</a>}
              </div>
            </div>
          ) : (
            <button type="button" className="vb-btn vb-btn-wide" disabled={!live || busy || (!!w.address && !!problem)} onClick={launch}>{label}</button>
          )}
          {err && <p className="vb-err">{err}</p>}
          {!live && config && <p className="vb-note vb-note-c">{config.reason ?? "The builder's contracts are being deployed."} You can design your coin now.</p>}
          <p className="vb-fine">One transaction: coin, hook, pool, locked liquidity{firstBuy && Number(firstBuy) > 0 ? " and your first buy" : ""}. You pay the network fee.</p>
        </div>
      </aside>
    </div>
  );
}
