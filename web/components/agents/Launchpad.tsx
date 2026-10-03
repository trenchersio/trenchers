"use client";
import { useEffect, useRef, useState } from "react";
import { TextButton } from "@/components/TextButton";
import { EMPTY_DRAFT, shrinkImage, tokenFees, validateDraft, type AgentToken, type TokenDraft } from "@/lib/agent-token";
import { EXPLORER, EXPLORER_NAME, PONS_TOKEN_URL, SAMPLE_MODE, explorerAddress, gmgnToken } from "@/lib/constants";
import { short } from "@/lib/wallet";
import type { AgentState } from "@/lib/agents-store";

const MIN_GAS = 0.002;

/** Launch the agent's own token on Pons from its agent wallet. One token per agent. */
export function Launchpad({ a, busy, onLaunch }: {
  a: AgentState; busy: boolean; onLaunch: (d: TokenDraft) => Promise<void>;
}) {
  const [d, setD] = useState<TokenDraft>(EMPTY_DRAFT);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const set = (p: Partial<TokenDraft>) => { setErr(null); setD((x) => ({ ...x, ...p })); };

  if (a.token) return <TokenCard t={a.token} id={a.id} />;

  const blocked = !a.registered ? "Register the agent first: the coin is launched from its wallet."
    : a.balance < MIN_GAS ? "Claim the starter balance (or top up the agent) to pay for the launch." : null;

  async function pick(f: File | undefined) {
    if (!f) return;
    if (f.size > 8_000_000) { setErr("Use an image under 8 MB."); return; }
    try { set({ image: await shrinkImage(f) }); } catch (e) { setErr((e as Error).message); }
  }
  async function launch() {
    const problem = validateDraft(d);
    if (problem) { setErr(problem); return; }
    await onLaunch({ ...d, name: d.name.trim(), description: d.description.trim() });
  }

  return (
    <div className="lp">
      <div className="lp-intro">
        <p><b>Option A, optional:</b> let your agent launch its own coin on Pons, paid from its starter balance. The agent is the creator, so <b>the agent wallet receives all of the coin&apos;s creator trading fees</b> and can fund its own trading. One coin per agent.</p>
        {blocked && <p className="notice">{blocked}</p>}
      </div>

      <div className="lp-grid">
        <fieldset className="lp-form" disabled={!!blocked || busy}>
          <div className="lp-image-row">
            <button type="button" className="lp-image" onClick={() => file.current?.click()} aria-label="Choose token image">
              {d.image ? <img src={d.image} alt="" /> : <span className="mono">+ Image</span>}
            </button>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <div className="lp-image-text">
              <span className="field-label">Token image</span>
              <p>Square works best. PNG, JPG, WebP or GIF.</p>
              <TextButton onClick={() => file.current?.click()}>{d.image ? "Change image" : "Upload image"}</TextButton>
            </div>
          </div>
          <div className="lp-row">
            <label className="field"><span>Name</span>
              <input value={d.name} maxLength={32} placeholder={`Trencher ${a.id}`} onChange={(e) => set({ name: e.target.value })} /></label>
            <label className="field"><span>Symbol</span>
              <input className="mono" value={d.symbol} maxLength={10} placeholder={`TRCH${a.id}`} onChange={(e) => set({ symbol: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} /></label>
          </div>
          <label className="field"><span>Description <small>{d.description.length}/280</small></span>
            <textarea rows={3} value={d.description} maxLength={280} placeholder="What this agent trades and what its token is for." onChange={(e) => set({ description: e.target.value })} /></label>
          <div className="lp-row lp-row-3">
            <label className="field"><span>Website</span><input className="mono" value={d.website} placeholder="https://" onChange={(e) => set({ website: e.target.value.trim() })} /></label>
            <label className="field"><span>X</span><input className="mono" value={d.x} placeholder="https://x.com/…" onChange={(e) => set({ x: e.target.value.trim() })} /></label>
            <label className="field"><span>Telegram</span><input className="mono" value={d.telegram} placeholder="https://t.me/…" onChange={(e) => set({ telegram: e.target.value.trim() })} /></label>
          </div>
          {err && <p className="notice">{err}</p>}
          <div className="lp-submit">
            <TextButton onClick={launch} disabled={!!blocked || busy}>Launch on Pons</TextButton>
            <span className="hint-line">Paid from the agent wallet (the starter balance covers it). Your agent never trades its own coin.</span>
          </div>
        </fieldset>

        <div className="lp-preview" aria-label="Preview">
          <span className="field-label">Preview</span>
          <div className="tk">
            <div className="tk-head">
              <div className="tk-img">{d.image ? <img src={d.image} alt="" /> : <img src={`nft/${a.id}.webp`} alt="" className="tk-ph" onError={(e) => (e.currentTarget.style.visibility = "hidden")} />}</div>
              <div>
                <p className="tk-sym mono">${d.symbol || "SYMBOL"}</p>
                <p className="tk-name">{d.name || "Token name"}</p>
              </div>
            </div>
            <p className="tk-desc">{d.description || "Your description shows here."}</p>
            <dl className="tk-meta mono">
              <div><dt>Creator</dt><dd>Trencher #{a.id}</dd></div>
              <div><dt>Fees to</dt><dd>{a.agentWallet ? short(a.agentWallet) : "agent wallet"}</dd></div>
              <div><dt>Launchpad</dt><dd>Pons</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function TokenCard({ t, id }: { t: AgentToken; id: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 2000); return () => clearInterval(i); }, []);
  const fees = tokenFees(t, now);
  return (
    <div className="lp">
      <div className="tk tk-live">
        <div className="tk-head">
          <div className="tk-img"><img src={t.image} alt="" /></div>
          <div>
            <p className="tk-sym mono">${t.symbol} <span className="tk-badge">Live on Pons</span></p>
            <p className="tk-name">{t.name}</p>
          </div>
        </div>
        {t.description && <p className="tk-desc">{t.description}</p>}
        <dl className="tk-stats">
          <div><dt className="mono">Fees earned by the agent</dt><dd className="mono up">{fees.toFixed(5)} ETH</dd></div>
          <div><dt className="mono">Launched</dt><dd className="mono">{new Date(t.launchedAt).toLocaleDateString()}</dd></div>
          <div><dt className="mono">Token</dt><dd className="mono">{short(t.address)}</dd></div>
        </dl>
        <div className="tk-links">
          {PONS_TOKEN_URL ? <TextButton href={PONS_TOKEN_URL.replace("{address}", t.address)} external>Pons ↗</TextButton> : <span className="tbtn tbtn-static">Pons</span>}
          <TextButton href={gmgnToken(t.address)} external>GMGN ↗</TextButton>
          {EXPLORER && <TextButton href={explorerAddress(t.address)} external>{EXPLORER_NAME} ↗</TextButton>}
          {t.website && <TextButton href={t.website} external>Website</TextButton>}
          {t.x && <TextButton href={t.x} external>X</TextButton>}
          {t.telegram && <TextButton href={t.telegram} external>Telegram</TextButton>}
        </div>
        <p className="hint-line">Creator fees from every trade on ${t.symbol} go straight to Trencher #{id}&apos;s wallet and become trading capital. {SAMPLE_MODE && "Sample mode: simulated."}</p>
      </div>
    </div>
  );
}
