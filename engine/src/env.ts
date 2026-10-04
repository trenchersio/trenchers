import type { Address, Hex } from "viem";

/** Engine settings, all from environment variables (Railway service variables in production). */
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}
const opt = (name: string, d: string) => process.env[name] || d;

export const ENV = {
  RPC_URL: opt("RPC_URL", "https://rpc.testnet.chain.robinhood.com"),
  CHAIN_ID: Number(opt("CHAIN_ID", "46630")),
  /** The engine wallet's private key. It can only call trade/approveRouter on agent wallets, within each holder's caps. */
  ENGINE_KEY: process.env.ENGINE_KEY as Hex | undefined,
  NFT: req("NFT_ADDRESS") as Address,
  FUND: req("FUND_ADDRESS") as Address,
  ADAPTER: req("ADAPTER_ADDRESS") as Address,
  PONS_FACTORY: opt("PONS_FACTORY", "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e") as Address,
  /** First block to read history from (the deployment block); 0 reads everything. */
  START_BLOCK: BigInt(opt("START_BLOCK", "0")),
  /** Max blocks per log query, for RPCs that cap ranges. */
  LOG_RANGE: BigInt(opt("LOG_RANGE", "5000")),
  POLL_MS: Number(opt("POLL_MS", "2000")),
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
  /** DRY_RUN=1 decides and logs trades without sending them. */
  DRY_RUN: opt("DRY_RUN", "0") === "1",
};
