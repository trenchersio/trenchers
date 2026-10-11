import { parseAbi } from "viem";

/** InferenceRouter: ETH in, $TRENCHERS bought through the Trenchers Pons adapter, delivered to the desk, in one
 *  transaction. The desk credits the buyer named in CreditBought. */
export const ROUTER_ABI = parseAbi([
  "function buyCredit(uint256 minTokensOut, address beneficiary) payable returns (uint256 tokensOut)",
  "function desk() view returns (address)",
  "event CreditBought(address indexed buyer, uint256 ethIn, uint256 tokensOut)",
]);

/** TrenchersOTC: peer-to-peer orders for $TRENCHERS and agent coins against ETH, escrowed on-chain, no fee. */
export const OTC_ABI = parseAbi([
  "function ask(address token, uint128 tokenAmount, uint128 ethAmount, uint40 expiry, address taker) returns (uint256 id)",
  "function bid(address token, uint128 tokenAmount, uint40 expiry, address taker) payable returns (uint256 id)",
  "function buy(uint256[] ids, uint128[] amounts, address recipient) payable returns (uint256 ethSpent)",
  "function sell(uint256 id, uint128 tokenAmount, uint256 minEthOut) returns (uint256 ethOut)",
  "function cancel(uint256 id)",
  "function quote(uint256 id, uint128 tokenAmount) view returns (uint256 eth)",
  "event Placed(uint256 indexed id, address indexed maker, address indexed token, bool isAsk, uint128 tokenAmount, uint128 ethAmount, uint40 expiry, address taker)",
  "event Filled(uint256 indexed id, address indexed taker, address recipient, uint128 tokenAmount, uint256 ethAmount)",
  "event Cancelled(uint256 indexed id)",
]);

export const ERC20_MIN_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export type Order = {
  id: number;
  side: "ask" | "bid";
  token: string;
  symbol: string;
  verified: boolean;
  /** The Trencher whose agent launched this coin, when it is an agent coin. */
  agent: number | null;
  maker: string;
  tokenTotal: string;
  tokenLeft: string;
  /** ETH for the whole order, in wei. The price of any part is pro rata, rounded up for the buyer to pay. */
  ethTotal: string;
  createdAt: string;
  expiresAt: string | null;
  /** A private order: only this address can fill it. */
  taker: string | null;
};
export type Fill = { id: string; side: "buy" | "sell"; symbol: string; token: string; tokenAmount: string; ethAmount: string; at: string; toDesk: boolean };

/** Wei for `amount` of an order, rounded up, exactly as the contract's quote() does. */
export function ethFor(o: Order, amount: bigint): bigint {
  const total = BigInt(o.tokenTotal), eth = BigInt(o.ethTotal);
  if (total === 0n) return 0n;
  return (amount * eth + total - 1n) / total;
}
/** ETH per one whole token, as a float for display only. */
export function priceOf(o: Order): number {
  return Number(BigInt(o.ethTotal)) / Number(BigInt(o.tokenTotal));
}
