// Trenchers Inference Markets: the browser side of the inference desk.
//
// The desk itself runs in the engine (engine/src/icm). The browser talks to it through /api/inference, a
// same-origin pass-through, so it never needs the engine's origin or a CORS exception. Money arrives as integer
// micro-dollars in strings and is only ever turned into a display string here, never into a float that is added up.

export type Deposit = {
  address: string | null;
  token?: string;
  symbol?: string;
  decimals?: number;
  chainId?: number;
  tokensPerUsd?: string;
  minimumTokens?: string;
  /** True when what is paid in is destroyed. Comes from the desk's configured sink, never from an address. */
  burns?: boolean;
  note?: string;
  problem?: string | null;
};

export type Rate = {
  enabled: boolean;
  reason: string | null;
  endpoint: string;
  keyPrefix?: string;
  rate: { tokensPerUsd: string; symbol: string };
  deposit: Deposit;
  /** Contracts the page can use. Empty until they are deployed. */
  router?: string | null;
  otc?: string | null;
  /** Pearl's open-weight models are offered as pearl/<id>. */
  pearl?: boolean;
};

export type Stats = {
  burnedTokens: string;      // base units, all time
  calls: number;             // completions served, all time
  accounts: number;          // wallets with credit
  models: number;
  /** Burned per day for the last 14 days, oldest first, base units. */
  burnedByDay?: string[];
};

export type Key = { id: string; display: string; label: string | null; disabled: boolean; createdAt: string; lastUsedAt: string | null; spentMicroUsd: string; spendLimitMicroUsd: string | null; models: string[] };
export type Charge = { id: string; at: string; model: string; state: string; costMicroUsd: string; tokensIn: number; tokensOut: number };
export type DepositRow = { id: string; createdAt: string; tokenUnits: string; creditedMicroUsd: string; burnTx: string | null; ref: string };
export type Account = { id: string; owner: string; balanceMicroUsd: string; heldMicroUsd: string; depositedMicroUsd: string; spentMicroUsd: string; suspended: boolean };
export type AccountView = { account: Account; keys: Key[]; deposits: DepositRow[]; charges: Charge[] };

export type Model = { id: string; name: string | null; context_length: number | null };

const M = 1_000_000n;

/** Micro-dollars to "$1,234.56". Truncates, like the ledger: nobody is shown money they do not have. */
export function usd(micro: string | bigint | undefined, places = 2): string {
  let v: bigint;
  try { v = typeof micro === "bigint" ? micro : BigInt(micro ?? "0"); } catch { v = 0n; }
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / M;
  const frac = (a % M).toString().padStart(6, "0").slice(0, places);
  return `${neg ? "-" : ""}$${whole.toLocaleString("en-US")}${places ? `.${frac}` : ""}`;
}

/** Whole tokens from base units, grouped: "1,250,000". */
export function tokens(units: string | bigint | undefined, decimals = 18): string {
  try {
    const v = typeof units === "bigint" ? units : BigInt(units ?? "0");
    return (v / 10n ** BigInt(decimals)).toLocaleString("en-US");
  } catch { return "0"; }
}

/** A big count as somebody says it out loud: 1.2M, 840k. */
export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}

/** A context window: 1M, 200k. */
export const ctx = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n));

export const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Model families, in the order people look for them, with the colour each one is drawn in. */
export const FAMILIES: { id: string; label: string; color: string; match: string[] }[] = [
  { id: "anthropic", label: "Anthropic", color: "#E9A27A", match: ["anthropic"] },
  { id: "openai", label: "GPT", color: "#7FE3C4", match: ["openai"] },
  { id: "google", label: "Gemini", color: "#7AA8FF", match: ["google"] },
  { id: "x-ai", label: "Grok", color: "#E8ECE9", match: ["x-ai", "xai"] },
  { id: "deepseek", label: "DeepSeek", color: "#6C8CFF", match: ["deepseek"] },
  { id: "meta", label: "Llama", color: "#5AD8FF", match: ["meta-llama", "meta"] },
  { id: "qwen", label: "Qwen", color: "#B48CFF", match: ["qwen"] },
  { id: "mistral", label: "Mistral", color: "#FFB020", match: ["mistralai"] },
  { id: "moonshot", label: "Kimi", color: "#FF7AB6", match: ["moonshotai"] },
];
export function family(slug: string) {
  const house = slug.split("/")[0];
  return FAMILIES.find((f) => f.match.includes(house)) ?? { id: house, label: house, color: "#8A938E", match: [house] };
}

/** One call to the desk, through the site. Every request has a deadline and fails with a sentence, never a hang. */
export async function deskApi<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  // The static preview has no server: it answers from the same sample data the local mock uses.
  if (process.env.NEXT_PUBLIC_PREVIEW === "1") {
    const { mockInference } = await import("@/lib/inference-mock");
    await new Promise((r) => setTimeout(r, 150));
    const r = mockInference((opts.method ?? "GET").toUpperCase(), `/icm${path}`, opts.body as Record<string, unknown> | undefined);
    const j = r.json as { error?: { message?: string } } | null;
    if (r.status >= 400) throw new Error(j?.error?.message ?? `The desk is not answering (${r.status}).`);
    return r.json as T;
  }
  const res = await fetch(`/api/inference${path}`, {
    method: opts.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  }).catch((e: Error) => {
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new Error("The desk did not answer in time. Try again in a moment.");
    throw new Error("The desk could not be reached from this browser. Check your connection and try again.");
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  const d = data as { detail?: string; error?: string | { message?: string } } | null;
  if (!res.ok) {
    const msg = typeof d?.error === "object" ? d.error.message : d?.error;
    throw new Error(d?.detail || msg || `The desk is not answering (${res.status}).`);
  }
  return data as T;
}

/** Ask the connected wallet to sign a message (a signature, not a transaction: nothing moves, no gas). */
export async function signText(address: string, message: string): Promise<string> {
  const { walletProvider } = await import("@/lib/chain");
  const p = await walletProvider();
  const hex = `0x${Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  return (await p.request({ method: "personal_sign", params: [hex as `0x${string}`, address as `0x${string}`] })) as string;
}
