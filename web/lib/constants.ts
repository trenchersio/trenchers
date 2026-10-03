import { robinhood, robinhoodTestnet } from "viem/chains";
import type { Address } from "viem";

export const chain = process.env.NEXT_PUBLIC_CHAIN === "robinhood" ? robinhood : robinhoodTestnet;
export const NFT_ADDRESS = (process.env.NEXT_PUBLIC_NFT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;
/** Block explorer for agent wallets. Robinhood Chain's official explorer is Blockscout; set
 *  NEXT_PUBLIC_EXPLORER_URL / _NAME to switch (for example to Etherscan once it indexes the chain). */
export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL || chain.blockExplorers?.default.url || "";
export const EXPLORER_NAME = process.env.NEXT_PUBLIC_EXPLORER_NAME || chain.blockExplorers?.default.name || "Explorer";
/** GMGN wallet page. {address} is replaced; set NEXT_PUBLIC_GMGN_URL if GMGN uses a different chain path. */
export const GMGN_URL = process.env.NEXT_PUBLIC_GMGN_URL || "https://gmgn.ai/robinhood/address/{address}";
/** Pons token page. Empty until confirmed: the site then shows a plain "Pons" label. {address} is replaced. */
export const PONS_TOKEN_URL = process.env.NEXT_PUBLIC_PONS_TOKEN_URL || "";
export const gmgnToken = (a: string) => GMGN_URL.replace("/address/{address}", "/token/{address}").replace("{address}", a);
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const gmgnAddress = (a: string) => GMGN_URL.replace("{address}", a);

/** OpenSea collection page. Empty until listed: the site then shows a plain, unclickable "OpenSea" label. */
export const OPENSEA_URL = process.env.NEXT_PUBLIC_OPENSEA_URL || "";
export const GITHUB_URL = "https://github.com/trenchersio/trenchers";
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
  collection: PREVIEW ? "collection.html" : "/collection",
  agents: PREVIEW ? "agents.html" : "/agents", // NFT / Agent Profile
  docs: PREVIEW ? "docs.html" : "/docs",
};
/** True until the NFT contract is deployed: ownership and transactions are simulated. */
export const SAMPLE_MODE = NFT_ADDRESS === "0x0000000000000000000000000000000000000000";
