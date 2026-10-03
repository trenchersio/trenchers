import { robinhood, robinhoodTestnet } from "viem/chains";
import type { Address } from "viem";

export const chain = process.env.NEXT_PUBLIC_CHAIN === "robinhood" ? robinhood : robinhoodTestnet;
export const NFT_ADDRESS = (process.env.NEXT_PUBLIC_NFT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;
export const EXPLORER = chain.blockExplorers?.default.url ?? "";

/** OpenSea collection page. Empty until the collection is listed: buttons then read "listing soon". */
export const OPENSEA_URL = process.env.NEXT_PUBLIC_OPENSEA_URL || "";
export const LIST_PRICE_ETH = "0.01";

// Social links: leave a variable empty to hide that link.
export const SOCIALS = {
  x: process.env.NEXT_PUBLIC_X_URL || "https://x.com/trenchersio",
  discord: process.env.NEXT_PUBLIC_DISCORD_URL || "",
  telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL || "",
};

// Page links. The static preview serves pages as .html files next to each other.
const PREVIEW = process.env.NEXT_PUBLIC_PREVIEW === "1";
export const ROUTES = {
  home: PREVIEW ? "site.html" : "/",
  arena: PREVIEW ? "arena.html" : "/arena",
  agents: PREVIEW ? "agents.html" : "/agents",
};
/** True until the NFT contract is deployed: ownership and transactions are simulated. */
export const SAMPLE_MODE = NFT_ADDRESS === "0x0000000000000000000000000000000000000000";
