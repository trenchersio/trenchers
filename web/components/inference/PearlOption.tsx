"use client";
// Optional: Pearl's open-weight models (DeepSeek, GLM, Qwen, Gemma), served on Pearl's own GPU network. Ask for a
// model as `pearl/<id>` and the desk runs it on Pearl, billed from the same $TRENCHERS-funded balance as everything
// else. Same key, same credit; nothing changes unless you pick a Pearl model.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Model } from "@/lib/inference";
import { CopyBtn } from "./Endpoint";

const EXAMPLE = "pearl/zai-org/GLM-5.3";

/** A pearl: a small lit sphere, drawn here (not anyone's logo). */
function PearlMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="ipartner-mark">
      <defs>
        <radialGradient id="ipearl-g" cx="38%" cy="34%" r="70%"><stop offset="0" stopColor="#ffffff" /><stop offset=".45" stopColor="#e7ecf1" /><stop offset=".8" stopColor="#b7c2cf" /><stop offset="1" stopColor="#8d99a8" /></radialGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="#141a22" />
      <circle cx="20" cy="21" r="11" fill="url(#ipearl-g)" />
      <ellipse cx="16.5" cy="17" rx="3.4" ry="2.2" fill="#fff" opacity=".85" transform="rotate(-30 16.5 17)" />
    </svg>
  );
}

export function PearlOption({ endpoint, prefix, models, on }: { endpoint: string; prefix: string; models: Model[] | null; on: boolean }) {
  const [open, setOpen] = useState(false);
  const pearl = (models ?? []).filter((m) => m.id.startsWith("pearl/"));
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
        <span><b>Use it via Pearl</b><em>Open-weight models on Pearl&apos;s network. Still paid in $TRENCHERS.</em></span>
        <i className="mono" aria-hidden="true">→</i>
      </button>
      {open && createPortal(
        <div className="ipartner-back" onClick={() => setOpen(false)}>
          <div className="ipartner-modal" role="dialog" aria-modal="true" aria-labelledby="ipearl-t" onClick={(e) => e.stopPropagation()}>
            <div className="ipartner-head">
              <PearlMark size={40} />
              <div><h3 id="ipearl-t">Use it via Pearl</h3><p>Open-weight models on Pearl&apos;s network. Still paid in $TRENCHERS.</p></div>
              <button type="button" className="ipartner-x" aria-label="Close" onClick={() => setOpen(false)} autoFocus>✕</button>
            </div>
            <div className="ipartner-body">
              <p>Buy credit exactly as usual. Then ask for a model as <code>pearl/&lt;id&gt;</code>, for example <code>{example}</code>. <a href="https://platform.pearlresearch.ai/docs" target="_blank" rel="noreferrer">Pearl</a> runs open-weight models (DeepSeek, GLM, Qwen, Gemma) on its own distributed GPUs, with reasoning, tool calling, JSON mode and up to 1M tokens of context.</p>
              <ul>
                <li>Same key, same balance: paid from your $TRENCHERS credit, and every $TRENCHERS is still burned.</li>
                <li>Billed on Pearl&apos;s own token count for the call (input, cached input and output). Reasoning tokens count as output.</li>
                <li>Reasoning: send <code>{`"reasoning": {"effort": "low" | "medium" | "high"}`}</code>. <code>reasoning_effort</code> is translated for you.</li>
                <li>Images go inline as <code>data:image/…;base64,…</code>; Pearl does not fetch image links.</li>
                <li>Models without <code>pearl/</code> in front work exactly as before.</li>
              </ul>
              <div className="ipartner-models">
                <div className="ipartner-copy"><span className="mono">Pearl models on the desk</span><span className="mono">{pearl.length || "–"}</span></div>
                {pearl.length ? (
                  <ul>{pearl.map((m) => <li key={m.id}><code>{m.id}</code><span className="mono">{ctx(m.context_length)}</span><CopyBtn text={m.id} label="Copy" /></li>)}</ul>
                ) : <p className="inf-fine">{on ? "Pearl is switched on; its models appear here as soon as their prices are loaded." : "Pearl models appear here once the option is switched on."}</p>}
              </div>
              <div className="ipartner-code">
                <div className="ipartner-copy"><span className="mono">Python</span><CopyBtn text={py} /></div>
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
