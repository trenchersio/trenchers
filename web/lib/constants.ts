import { robinhood, robinhoodTestnet } from "viem/chains";
import type { Address } from "viem";

export const chain = process.env.NEXT_PUBLIC_CHAIN === "robinhood" ? robinhood : robinhoodTestnet;
export const NFT_ADDRESS = (process.env.NEXT_PUBLIC_NFT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;
export const OPENSEA_URL = process.env.NEXT_PUBLIC_OPENSEA_URL || "https://opensea.io";
export const EXPLORER = chain.blockExplorers?.default.url ?? "";

// Social links: leave a variable empty to hide that link.
export const SOCIALS = {
  x: process.env.NEXT_PUBLIC_X_URL || "",
  discord: process.env.NEXT_PUBLIC_DISCORD_URL || "",
  telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL || "",
};
/** Set NEXT_PUBLIC_MINT_LIVE=true at launch to show the mint panel instead of "coming soon". */
export const MINT_LIVE = process.env.NEXT_PUBLIC_MINT_LIVE === "true";
