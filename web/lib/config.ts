"use client";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { chain } from "./constants";

// Browser-extension wallets (MetaMask, Rabby, Robinhood Wallet extension, ...).
// WalletConnect for phone wallets gets added once a WalletConnect project id exists.
// The active chain (mainnet or testnet, from NEXT_PUBLIC_CHAIN) is listed first.
const chains = chain.id === robinhood.id ? ([robinhood, robinhoodTestnet] as const) : ([robinhoodTestnet, robinhood] as const);

export const wagmiConfig = createConfig({
  chains,
  connectors: [injected({ shimDisconnect: true })],
  transports: { [robinhood.id]: http(), [robinhoodTestnet.id]: http() },
  ssr: true,
});
