"use client";
// Optional: smart routing through Raeto. The caller asks for the model `raeto/auto`; Raeto picks the cheapest of
// three tiers that can handle each request, and the desk runs and bills it like any other call, from the same
// $TRENCHERS-funded balance. Off unless you ask for it.
import { useState } from "react";
import { CopyBtn } from "./Endpoint";

export function RaetoOption({ endpoint, prefix }: { endpoint: string; prefix: string }) {
  const [open, setOpen] = useState(false);
  const key = `${prefix}_live_…`;
  const py = `from openai import OpenAI\n\nclient = OpenAI(base_url="${endpoint}", api_key="${key}")\nreply = client.chat.completions.create(model="raeto/auto", messages=[{"role": "user", "content": "gm"}])`;
  const curl = `curl ${endpoint}/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "raeto/auto", "messages": [{"role": "user", "content": "gm"}]}'`;
  return (
    <div className={`iraeto${open ? " open" : ""}`}>
      <button type="button" className="iraeto-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/partners/raeto.webp" alt="" width={34} height={34} />
        <span><b>Use it via Raeto</b><em>Optional smart routing. Still paid in $TRENCHERS.</em></span>
        <i className="mono" aria-hidden="true">{open ? "−" : "+"}</i>
      </button>
      {open && (
        <div className="iraeto-body">
          <p>Buy credit exactly as above. Then ask for the model <code>raeto/auto</code> instead of a named one: <a href="https://raeto.cc/routing" target="_blank" rel="noreferrer">Raeto</a> looks at each request and picks the cheapest tier that can handle it, a fast, a mid or a top model. Simple requests cost less; hard ones still get a strong model.</p>
          <ul>
            <li>Same key, same balance, same prices: paid from your $TRENCHERS credit, and every $TRENCHERS is still burned.</li>
            <li>Each reply says which model ran (<code>x-raeto-model</code> header and the reply&apos;s own model id).</li>
            <li>Want your own tiers? Add <code>{`"raeto": {"models": {"fast": "…", "mid": "…", "top": "…"}}`}</code> to the request.</li>
            <li>If Raeto is slow or unreachable, the call runs on the mid tier rather than failing.</li>
          </ul>
          <div className="iraeto-code">
            <div className="iraeto-copy"><span className="mono">Python</span><CopyBtn text={py} /></div>
            <pre className="mono">{py}</pre>
            <div className="iraeto-copy"><span className="mono">curl</span><CopyBtn text={curl} /></div>
          </div>
          <p className="inf-fine">To pick a model, Raeto sees the messages of a routed request (not your key or the reply). Requests that name a model directly never go to Raeto.</p>
        </div>
      )}
    </div>
  );
}
