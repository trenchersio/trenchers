import { robinhood, robinhoodTestnet } from "viem/chains";
import type { Address } from "viem";

export const chain = process.env.NEXT_PUBLIC_CHAIN === "robinhood" ? robinhood : robinhoodTestnet;
const MAINNET_NFT = "0xe4b9a60b78c90fca0dcb79d8f1cbca43ef33c83e";
/** On mainnet always the mainnet Trenchers contract; elsewhere NEXT_PUBLIC_NFT_ADDRESS (empty: sample mode). */
export const NFT_ADDRESS = (process.env.NEXT_PUBLIC_CHAIN === "robinhood" ? MAINNET_NFT : process.env.NEXT_PUBLIC_NFT_ADDRESS ||
  "0x0000000000000000000000000000000000000000") as Address;
/** Block explorer for wallets, tokens and transactions: Etherscan's Robinhood Chain explorer on mainnet,
 *  the chain's Blockscout on testnet. NEXT_PUBLIC_EXPLORER_URL / _NAME override both. */
const MAINNET = chain.id === robinhood.id;
export const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL || (MAINNET ? "https://robin.etherscan.io" : chain.blockExplorers?.default.url) || "";
export const EXPLORER_NAME = process.env.NEXT_PUBLIC_EXPLORER_NAME || (MAINNET ? "Etherscan" : chain.blockExplorers?.default.name) || "Explorer";
/** GMGN wallet page. {address} is replaced; set NEXT_PUBLIC_GMGN_URL if GMGN uses a different chain path. */
export const GMGN_URL = process.env.NEXT_PUBLIC_GMGN_URL || "https://gmgn.ai/robinhood/address/{address}";
/** Pons token page. {address} is replaced. */
export const PONS_TOKEN_URL = process.env.NEXT_PUBLIC_PONS_TOKEN_URL || "https://ponsfamily.com/launchpad/{address}";
/** The $TRENCHERS token (launched on Pons). NEXT_PUBLIC_TRENCHERS_TOKEN overrides it; on testnet it stays empty unless set. */
const TOKEN_ENV = (process.env.NEXT_PUBLIC_TRENCHERS_TOKEN || "").trim();
export const TRENCHERS_TOKEN = /^0x[0-9a-fA-F]{40}$/.test(TOKEN_ENV) ? TOKEN_ENV : (process.env.NEXT_PUBLIC_CHAIN === "robinhood" ? "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a" : "");
/** $TRENCHERS on the Pons launchpad. */
export const TRENCHERS_PONS = TRENCHERS_TOKEN ? PONS_TOKEN_URL.replace("{address}", TRENCHERS_TOKEN) : "";
export const gmgnToken = (a: string) => GMGN_URL.replace("/address/{address}", "/token/{address}").replace("{address}", a);
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;
export const gmgnAddress = (a: string) => GMGN_URL.replace("{address}", a);

/** OpenSea collection page. Empty until listed: the site then shows a plain, unclickable "OpenSea" label. */
export const OPENSEA_URL = process.env.NEXT_PUBLIC_OPENSEA_URL || (MAINNET ? "https://opensea.io/collection/trenchersio" : "");
/** One Trencher on OpenSea: opensea.io/item/{chain}/{contract}/{id}. */
export const openseaItem = (id: number) => `https://opensea.io/item/${MAINNET ? "robinhood" : "robinhood_testnet"}/${NFT_ADDRESS}/${id}`;
export const GITHUB_URL = "https://github.com/trenchersio/trenchers";
export const LIST_PRICE_ETH = "0.02";
/** Half of every primary (first) sale: claimable once per Trencher into its agent wallet (AgentStarterFund). */
export const STARTER_ETH = "0.01";
/** The starter balance can only be spent by the agent (coin launch, trades) for this long, then becomes withdrawable. */
export const STARTER_LOCK_DAYS = 180;

/** Telegram channel where every mint, awakening and sale is posted live. */
export const TELEGRAM_FEED = process.env.NEXT_PUBLIC_TELEGRAM_FEED_URL ?? "https://t.me/trenchersmints";

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
  mint: PREVIEW ? "mint.html" : "/mint",
  arena: PREVIEW ? "arena.html" : "/arena",
  collection: PREVIEW ? "collection.html" : "/collection",
  coins: PREVIEW ? "coins.html" : "/coins",
  agents: PREVIEW ? "agents.html" : "/agents", // NFT / Agent Profile
  docs: PREVIEW ? "docs.html" : "/docs",
  chat: PREVIEW ? "chat.html" : "/chat",
  playground: PREVIEW ? "playground.html" : "/playground",
};
/** The holders' chat opens to the public once NEXT_PUBLIC_CHAT_OPEN=1 (until then it's greyed out in the menu). */
export const CHAT_OPEN = (process.env.NEXT_PUBLIC_CHAT_OPEN || "").trim() === "1";
/** True until the NFT contract is deployed: ownership and transactions are simulated. */
export const SAMPLE_MODE = NFT_ADDRESS === "0x0000000000000000000000000000000000000000";

/** The trading engine's public API (Railway): the live Arena reads {ENGINE_URL}/arena. */
export const ENGINE_URL = (process.env.NEXT_PUBLIC_ENGINE_URL || (MAINNET ? "https://mainnet-production-c38a.up.railway.app" : "https://rare-reprieve-production-8399.up.railway.app")).replace(/\/$/, "");
