"use client";
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import { chain } from "./constants";

export const wagmiConfig = getDefaultConfig({
  appName: "Trenchers",
  // Injected wallets (MetaMask, Rabby, browser-extension wallets) work without a real id.
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || "trenchers-local",
  chains: [chain],
  transports: { [chain.id]: http() },
  ssr: true,
});
