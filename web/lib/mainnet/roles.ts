import type { Address } from "viem";

/** Robinhood Chain mainnet team wallets (public addresses; the team holds every key). */
export const MAINNET_ROLES = {
  chainId: 4663,
  safe: "0xF928e1A70d0CBf092193D4E3FE4F68edfffe4b10" as Address,       // owns everything, receives the dev share
  deployer: "0x447D8F97c39df3d6FCAB8a02A54986283e818210" as Address,   // deploys once; holds house agents #1-5
  guardian: "0xb5aF3f28393dCC2611671fcCB5AD3B6e57cEE9DD" as Address,   // emergency stop only
  engine: "0xe15fa7c18a86Df13A4C57224b02C0e639d709f2F" as Address,     // trading engine
};

/** Fixed launch settings. */
export const MAINNET_LAUNCH = {
  mintPriceEth: "0.02",
  starterEth: "0.01",
  rescueDelay: 48 * 3600,
  baseUri: "https://trenchers.io/meta/",
  contractUri: "https://trenchers.io/meta/contract.json",
  registry: "0x000000006551c19487814612e58FE06813775758" as Address,
  ponsFactory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address,
  lbValidator: "0x721C008fdff27BF06E7E123956E2Fe03B63342e3" as Address,
};
