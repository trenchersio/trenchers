"use client";
import { useState } from "react";

const copyText = async (t: string) => {
  try { await navigator.clipboard.writeText(t); return true; } catch { return false; }
};

export function CopyBtn({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="icopy" onClick={async () => { if (await copyText(text)) { setDone(true); setTimeout(() => setDone(false), 1400); } }}>
      {done ? "Copied" : label}
    </button>
  );
}

type Lang = "curl" | "python" | "node";

/** The product, in one card: the base URL and the three lines that call it. */
export function Endpoint({ endpoint, prefix }: { endpoint: string; prefix: string }) {
  const [lang, setLang] = useState<Lang>("curl");
  const key = `${prefix}_live_…`;
  const code: Record<Lang, string> = {
    curl: `curl ${endpoint}/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "anthropic/claude-sonnet-4.5",
       "messages": [{"role": "user", "content": "gm"}]}'`,
    python: `from openai import OpenAI

client = OpenAI(base_url="${endpoint}", api_key="${key}")
reply = client.chat.completions.create(
    model="google/gemini-2.5-pro",
    messages=[{"role": "user", "content": "gm"}],
)`,
    node: `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${endpoint}", apiKey: "${key}" });
const reply = await client.chat.completions.create({
  model: "x-ai/grok-4",
  messages: [{ role: "user", content: "gm" }],
});`,
  };
  return (
    <div className="iend">
      <div className="ipanel-head">
        <span className="ipanel-dot" /><span>Endpoint</span>
        <span className="iend-tabs" role="tablist" aria-label="Example">
          {(["curl", "python", "node"] as Lang[]).map((l) => (
            <button key={l} type="button" role="tab" aria-selected={lang === l} className={lang === l ? "on" : ""} onClick={() => setLang(l)}>{l}</button>
          ))}
        </span>
      </div>
      <div className="iend-url">
        <span className="iend-method mono">BASE</span>
        <code>{endpoint}</code>
        <CopyBtn text={endpoint} />
      </div>
      <pre className="iend-code"><code>{highlight(code[lang])}</code></pre>
      <div className="iend-foot mono">
        <span>Works with any OpenAI-compatible client</span>
        <span>Streaming · tools · JSON mode</span>
      </div>
    </div>
  );
}

/** Just enough colour to read: strings, keywords and the key. */
function highlight(src: string) {
  const parts = src.split(/("[^"]*"|'[^']*'|\b(?:from|import|const|await|new)\b)/g);
  return parts.map((p, i) => {
    if (!p) return null;
    if (/^["']/.test(p)) return <span key={i} className={p.includes("_live_") ? "hk" : "hs"}>{p}</span>;
    if (/^(from|import|const|await|new)$/.test(p)) return <span key={i} className="hw">{p}</span>;
    return <span key={i}>{p}</span>;
  });
}
