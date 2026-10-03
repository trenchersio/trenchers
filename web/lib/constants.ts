import { robinhood, robinhoodTestnet } from "viem/chains";
import type { Address } from "viem";

export const chain = process.env.NEXT_PUBLIC_CHAIN === "robinhood" ? robinhood : robinhoodTestnet;
export const NFT_ADDRESS = (process.env.NEXT_PUBLIC_NFT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;
export const OPENSEA_URL = process.env.NEXT_PUBLIC_OPENSEA_URL || "https://opensea.io";
export const EXPLORER = chain.blockExplorers?.default.url ?? "";
