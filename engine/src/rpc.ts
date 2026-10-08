import { fallback, http, type Transport } from "viem";

/**
 * RPC endpoints: RPC_URL may hold several URLs separated by commas or spaces (e.g. an Alchemy URL first, the
 * public one second); requests go to the first and move to the next when one fails or rate-limits.
 */
export const urls = (v: string | undefined) => (v ?? "").split(/[\s,]+/).map((u) => u.trim().replace(/^["']|["']$/g, "")).filter((u) => /^https?:\/\//.test(u));

export function transport(list: string[], opts: { retryCount?: number; retryDelay?: number; timeout?: number } = {}): Transport {
  const ts = list.map((u) => http(u, { retryCount: opts.retryCount ?? 3, retryDelay: opts.retryDelay ?? 150, timeout: opts.timeout ?? 20_000 }));
  return ts.length === 1 ? ts[0] : fallback(ts, { rank: false, retryCount: 1 });
}

/** The mainnet endpoints for /verify and /livecheck: MAINNET_RPC_URL, else the engine's own RPC_URL when it is mainnet, else public. */
export function mainnetRpcs(): string[] {
  const own = urls(process.env.MAINNET_RPC_URL);
  if (own.length) return own;
  const eng = urls(process.env.RPC_URL).filter((u) => !/testnet/i.test(u));
  return eng.length ? eng : ["https://rpc.mainnet.chain.robinhood.com"];
}

/** Plain-English version of an RPC error (the public RPC's Cloudflare check returns a whole web page). */
export function explain(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/Just a moment|cf_chl|challenges\.cloudflare/i.test(m)) return "The public Robinhood Chain RPC (rpc.mainnet.chain.robinhood.com) is blocking this server with a Cloudflare check. Set RPC_URL in Railway to a provider URL, e.g. https://robinhood-mainnet.g.alchemy.com/v2/YOUR_KEY";
  if (/fetch failed|ENOTFOUND|EAI_AGAIN/i.test(m)) return `Couldn't reach the RPC at all (${m.match(/URL: (\S+)/)?.[1]?.replace(/\/v2\/.+/, "/v2/…") ?? "check RPC_URL"}): check the URL has no typo, space or quotes, and that Robinhood Chain Mainnet is enabled on that Alchemy app.`;
  return m.length > 600 ? `${m.slice(0, 600)}…` : m;
}

/** Hides API keys in RPC URLs (e.g. Alchemy's /v2/KEY) before anything is shown on a public page. */
export const scrub = (s: string) => s.replace(/(\/v[23]\/)[A-Za-z0-9_-]{8,}/g, "$1…").replace(/(quiknode\.pro\/)[A-Za-z0-9_-]+/g, "$1…").replace(/(chainstack\.com\/)[A-Za-z0-9_-]+/g, "$1…");
