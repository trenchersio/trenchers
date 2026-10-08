import type { Address, Hex } from "viem";

/** Engine settings, all from environment variables (Railway service variables in production). */
/** Problems with the settings; the engine reports them on /health instead of crashing. */
export const PROBLEMS: string[] = [];
// Values pasted into Railway sometimes carry spaces or quotes; strip them.
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const opt = (name: string, d: string) => clean(process.env[name]) || d;
function addr(name: string): Address {
  const v = clean(process.env[name]);
  if (!v) PROBLEMS.push(`${name} is missing: copy the variables from the Trading section of the setup page`);
  else if (!/^0x[0-9a-fA-F]{40}$/.test(v)) PROBLEMS.push(`${name} is not a valid address`);
  return v as Address;
}
if (clean(process.env.TELEGRAM_BOT_TOKEN) && !clean(process.env.TELEGRAM_CHAT)) PROBLEMS.push("TELEGRAM_CHAT is missing: the channel's @username, e.g. @trencherslive");
function key(): Hex | undefined {
  let v = clean(process.env.ENGINE_KEY);
  if (!v) return undefined;
  if (!v.startsWith("0x")) v = `0x${v}`; // MetaMask shows private keys without 0x
  if (!/^0x[0-9a-fA-F]{64}$/.test(v)) { PROBLEMS.push("ENGINE_KEY doesn't look like a private key (64 letters and numbers, from MetaMask's Show private key)"); return undefined; }
  return v as Hex;
}

export const ENV = {
  RPC_URL: opt("RPC_URL", "https://rpc.testnet.chain.robinhood.com"),
  CHAIN_ID: Number(opt("CHAIN_ID", "46630")),
  /** The engine wallet's private key. It can only call trade/approveRouter on agent wallets, within each holder's caps. */
  ENGINE_KEY: key(),
  NFT: addr("NFT_ADDRESS"),
  FUND: addr("FUND_ADDRESS"),
  ADAPTER: addr("ADAPTER_ADDRESS"),
  PONS_FACTORY: opt("PONS_FACTORY", "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e") as Address,
  /** First block to read history from (the deployment block); 0 reads everything. */
  START_BLOCK: BigInt(/^\d+$/.test(opt("START_BLOCK", "0")) ? opt("START_BLOCK", "0") : "0"),
  /** Max blocks per log query, for RPCs that cap ranges. */
  LOG_RANGE: BigInt(opt("LOG_RANGE", "5000")),
  POLL_MS: Number(opt("POLL_MS", "3000")),
  /** ETH price in USD, for "volume crosses $X" rules. */
  ETH_USD: Number(opt("ETH_USD", "3000")),
  /** Pons charges a snipe tax in the first seconds after launch (99% decaying to 0 over ~5s); buys wait this long. */
  SNIPE_WAIT_SEC: Number(opt("SNIPE_WAIT_SEC", "6")),
  /** Positions without a time exit (take profit / stop loss only) are closed after this long anyway. */
  MAX_HOLD_SEC: Number(opt("MAX_HOLD_SEC", "86400")),
  MAX_POSITIONS: Number(opt("MAX_POSITIONS", "6")),
  /** Max slippage accepted on a trade, in percent. */
  SLIPPAGE_PCT: Number(opt("SLIPPAGE_PCT", "15")),
  PORT: Number(opt("PORT", "8080")),
  /** Live Telegram channel for mints and sales (optional): the bot's token and the channel (@name). */
  TELEGRAM_BOT_TOKEN: clean(process.env.TELEGRAM_BOT_TOKEN) || null,
  TELEGRAM_CHAT: clean(process.env.TELEGRAM_CHAT) || null,
  SITE_URL: opt("SITE_URL", "https://www.trenchers.io").replace(/\/$/, ""),
  EXPLORER_URL: opt("EXPLORER_URL", Number(opt("CHAIN_ID", "46630")) === 46630 ? "https://explorer.testnet.chain.robinhood.com" : "https://robin.etherscan.io").replace(/\/$/, ""),
  /** Where the Trenchers' PNG art is served: {IMAGE_BASE}{awake|dormant}/{id}.png */
  IMAGE_BASE: opt("IMAGE_BASE", "https://www.trenchers.io/testnet-meta/png/"),
  /** DRY_RUN=1 decides and logs trades without sending them. */
  DRY_RUN: opt("DRY_RUN", "0") === "1",
  /** The $TRENCHERS fee distributor: the engine enrols awake agents, closes each weekly epoch and pays the shares. */
  DIST: (opt("DIST_ADDRESS", Number(opt("CHAIN_ID", "46630")) === 4663 ? "0x3926a801b52cf28c2cb0f5199cf7ec55f45ede1a" : "") || null) as Address | null,
  FEE_KEEPER: opt("FEE_KEEPER", "1") !== "0",
};
