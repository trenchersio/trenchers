"use client";
// Optional: Pearl's open-weight models (DeepSeek, GLM, Qwen, Gemma), served on Pearl's own GPU network. Ask for a
// model as `pearl/<id>` and the desk runs it on Pearl, billed from the same $TRENCHERS-funded balance as everything
// else. Same key, same credit; nothing changes unless you pick a Pearl model.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Model } from "@/lib/inference";
import { CopyBtn } from "./Endpoint";

const EXAMPLE = "pearl/zai-org/GLM-5.3";

const PLANNED = ["deepseek-ai/DeepSeek-V4-Pro-0813", "deepseek-ai/DeepSeek-V4.1-Flash", "zai-org/GLM-5.3", "zai-org/GLM-5.3-Flash", "Qwen/Qwen3.8-27B", "Qwen/Qwen3.8-Flash-Next", "google/gemma-4-31B-it"];
// eslint-disable-next-line @next/next/no-img-element
const PearlMark = ({ size }: { size: number }) => <img src="/partners/pearl.webp" alt="" width={size} height={size} className="ipartner-mark" />;

export function PearlOption({ endpoint, prefix, models, on }: { endpoint: string; prefix: string; models: Model[] | null; on: boolean }) {
  const [open, setOpen] = useState(false);
  const pearl = (models ?? []).filter((m) => m.id.startsWith("pearl/"));
  const live = on && pearl.length > 0;
  const example = pearl.find((m) => m.id === EXAMPLE)?.id ?? pearl[0]?.id ?? EXAMPLE;
  const key = `${prefix}_live_…`;
  const py = `from openai import OpenAI\n\nclient = OpenAI(base_url="${endpoint}", api_key="${key}")\nreply = client.chat.completions.create(\n    model="${example}",\n    messages=[{"role": "user", "content": "gm"}],\n    extra_body={"reasoning": {"effort": "medium"}},\n)`;
  const curl = `curl ${endpoint}/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${example}", "messages": [{"role": "user", "content": "gm"}]}'`;
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", esc); const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [open]);
  const ctx = (n: number | null) => (n ? (n >= 1_000_000 ? `${Math.round(n / 1_000_00) / 10}M` : `${Math.round(n / 1000)}k`) : "");
  return (
    <div className="ipartner">
      <button type="button" className="ipartner-btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <PearlMark size={34} />
        <span><b>Use it via Pearl</b><em>Open-weight models on Pearl&apos;s network. {live ? "Still paid" : "Paid"} in $TRENCHERS.</em></span>
        {live ? <i className="mono" aria-hidden="true">→</i> : <i className="ipartner-cta mono">Coming soon</i>}
      </button>
      {open && createPortal(
        <div className="ipartner-back" onClick={() => setOpen(false)}>
          <div className="ipartner-modal" role="dialog" aria-modal="true" aria-labelledby="ipearl-t" onClick={(e) => e.stopPropagation()}>
            <div className="ipartner-head">
              <PearlMark size={40} />
              <div>{/* eslint-disable-next-line @next/next/no-img-element */}<h3 id="ipearl-t"><img src="/partners/pearl-wordmark.webp" alt="Pearl" height={22} className="ipartner-word" />{!live && <small className="ipartner-soon mono">Coming soon</small>}</h3><p>Open-weight models on Pearl&apos;s network. {live ? "Still paid" : "Paid"} in $TRENCHERS.</p></div>
              <button type="button" className="ipartner-x" aria-label="Close" onClick={() => setOpen(false)} autoFocus>✕</button>
            </div>
            <div className="ipartner-body">
              {!live && <p className="ipartner-note">Pearl models are coming soon. We&apos;re waiting on access to Pearl&apos;s API; this is how it will work once it&apos;s on.</p>}
              <p>Buy credit exactly as usual. Then ask for a model as <code>pearl/&lt;id&gt;</code>, for example <code>{example}</code>. <a href="https://platform.pearlresearch.ai/docs" target="_blank" rel="noreferrer">Pearl</a> runs open-weight models (DeepSeek, GLM, Qwen, Gemma) on its own distributed GPUs, with reasoning, tool calling, JSON mode and up to 1M tokens of context.</p>
              <ul>
                <li>Same key, same balance: paid from your $TRENCHERS credit, and every $TRENCHERS is still burned.</li>
                <li>Billed on Pearl&apos;s own token count for the call (input, cached input and output). Reasoning tokens count as output.</li>
                <li>Reasoning: send <code>{`"reasoning": {"effort": "low" | "medium" | "high"}`}</code>. <code>reasoning_effort</code> is translated for you.</li>
                <li>Images go inline as <code>data:image/…;base64,…</code>; Pearl does not fetch image links.</li>
                <li>Models without <code>pearl/</code> in front work exactly as before.</li>
              </ul>
              <div className="ipartner-models">
                <div className="ipartner-copy"><span className="mono">{live ? "Pearl models on the desk" : "Planned Pearl models"}</span><span className="mono">{live ? pearl.length : "soon"}</span></div>
                {live ? (
                  <ul>{pearl.map((m) => <li key={m.id}><code>{m.id}</code><span className="mono">{ctx(m.context_length)}</span><CopyBtn text={m.id} label="Copy" /></li>)}</ul>
                ) : <ul>{PLANNED.map((id) => <li key={id}><code>pearl/{id}</code></li>)}</ul>}
              </div>
              <div className="ipartner-code">
                <div className="ipartner-copy"><span className="mono">Python{live ? "" : " · once live"}</span><CopyBtn text={py} /></div>
                <pre className="mono">{py}</pre>
                <div className="ipartner-copy"><span className="mono">curl</span><CopyBtn text={curl} /></div>
                <pre className="mono">{curl}</pre>
              </div>
              <p className="inf-fine">A request for a <code>pearl/</code> model is sent to Pearl to run, the same way other models are sent to their provider. Requests for other models never go to Pearl.</p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
