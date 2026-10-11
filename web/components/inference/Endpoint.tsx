"use client";
import { useEffect, useState } from "react";

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

const ROTATE: [string, string, string][] = [
  ["anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5", "#E9A27A"],
  ["openai/gpt-5", "GPT-5", "#7FE3C4"],
  ["google/gemini-2.5-pro", "Gemini 2.5 Pro", "#7AA8FF"],
  ["x-ai/grok-4", "Grok 4", "#E8ECE9"],
  ["deepseek/deepseek-r1", "DeepSeek R1", "#6C8CFF"],
  ["qwen/qwen3-coder", "Qwen3 Coder", "#B48CFF"],
  ["moonshotai/kimi-k2", "Kimi K2", "#FF7AB6"],
];

/**
 * The product, as a wiring diagram rather than a terminal: three plugs (where, which key, which model) feeding one
 * desk that fans out to every model family. The code is one click away, copied rather than shown.
 */
export function Endpoint({ endpoint, prefix }: { endpoint: string; prefix: string }) {
  const [i, setI] = useState(0);
  const [copied, setCopied] = useState<Lang | null>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % ROTATE.length), 2200);
    return () => clearInterval(t);
  }, []);
  const [slug, name, color] = ROTATE[i];
  const key = `${prefix}_live_…`;
  const code: Record<Lang, string> = {
    curl: `curl ${endpoint}/chat/completions \\\n  -H "Authorization: Bearer ${key}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${slug}", "messages": [{"role": "user", "content": "gm"}]}'`,
    python: `from openai import OpenAI\n\nclient = OpenAI(base_url="${endpoint}", api_key="${key}")\nreply = client.chat.completions.create(model="${slug}", messages=[{"role": "user", "content": "gm"}])`,
    node: `import OpenAI from "openai";\n\nconst client = new OpenAI({ baseURL: "${endpoint}", apiKey: "${key}" });\nconst reply = await client.chat.completions.create({ model: "${slug}", messages: [{ role: "user", content: "gm" }] });`,
  };
  const grab = async (l: Lang) => { if (await copyText(code[l])) { setCopied(l); setTimeout(() => setCopied(null), 1400); } };

  return (
    <div className="iwire">
      <div className="iwire-plugs">
        <div className="iplug">
          <span className="iplug-n mono">01</span>
          <span className="iplug-k">Point it at</span>
          <code className="iplug-v">{endpoint}</code>
          <CopyBtn text={endpoint} />
        </div>
        <div className="iplug">
          <span className="iplug-n mono">02</span>
          <span className="iplug-k">Sign with</span>
          <code className="iplug-v">{key}<em>your key</em></code>
          <a className="icopy iplug-go" href="#account">Get one</a>
        </div>
        <div className="iplug iplug-model" style={{ ["--mc" as string]: color }}>
          <span className="iplug-n mono">03</span>
          <span className="iplug-k">Ask for</span>
          <code className="iplug-v" key={slug}><i />{name}<em>{slug}</em></code>
        </div>
      </div>

      <div className="iwire-map" aria-hidden="true">
        <svg viewBox="0 0 220 180" preserveAspectRatio="none">
          {[12, 38, 64, 90, 116, 142, 168].map((y, k) => (
            <path key={k} d={`M70 90 C 120 90, 130 ${y}, 200 ${y}`} className={k === i ? "on" : ""} />
          ))}
          <path d="M0 90 L70 90" className="in" />
        </svg>
        <span className="iwire-core"><img src="brand/mark.svg" alt="" width={34} height={34} /></span>
        <ul className="iwire-fam">
          {ROTATE.map(([s2, n2, c2], k) => (
            <li key={s2} className={k === i ? "on" : ""} style={{ ["--mc" as string]: c2 }}>{n2.split(" ")[0]}</li>
          ))}
        </ul>
      </div>

      <div className="iwire-foot">
        <span className="mono">Copy a ready request</span>
        {(["curl", "python", "node"] as Lang[]).map((l) => (
          <button key={l} type="button" className={`iwire-snip${copied === l ? " ok" : ""}`} onClick={() => grab(l)}>{copied === l ? "Copied" : l}</button>
        ))}
        <span className="iwire-compat mono">OpenAI-compatible · streaming</span>
      </div>
    </div>
  );
}
