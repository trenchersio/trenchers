/**
 * The strategy presets. The first five are the house strategies: Trenchers #1-#5 (team-owned)
 * each run one, and holders can pick any of them for their own agent. "Custom" is free-form limits.
 *
 * Signals each one needs from the indexer once agents are live:
 *  - launch:     Pons factory TokenLaunched event
 *  - graduation: Pons graduationStatus(token).graduated flips to true
 *  - volume:     cumulative swap volume per token, in USD (pool swaps x ETH/USD price)
 *  - devsell:    a swap where the seller is the token's deployer (getLaunchedToken(token).deployer)
 *  - dexupdate:  DexScreener token profile updates (off-chain API, polled)
 */
export type StrategyEvent = "launch" | "graduation" | "volume" | "devsell" | "dexupdate" | "custom";
export type StrategyName =
  | "Launch Flipper" | "Graduation Rider" | "Volume Breakout" | "Dev Dump Dip" | "DexScreener Pulse" | "Custom";

export type StrategyDef = {
  name: StrategyName;
  event: StrategyEvent;
  trigger: string;       // when it buys
  exit: string;          // when it sells
  holdSec: number | null;
  houseAgent: number | null; // the team-owned Trencher that runs it
  defaults: { perBuy: number; dailyCap: number; maxPositions: number };
};

export const VOLUME_THRESHOLD_USD = 50_000;

export const STRATEGIES: StrategyDef[] = [
  { name: "Launch Flipper", event: "launch", trigger: "Buys every new launch on Pons", exit: "Sells after 15 seconds", holdSec: 15, houseAgent: 1,
    defaults: { perBuy: 0.0005, dailyCap: 0.05, maxPositions: 10 } },
  { name: "Graduation Rider", event: "graduation", trigger: "Buys every launch that graduates on Pons", exit: "Sells after 5 minutes", holdSec: 300, houseAgent: 2,
    defaults: { perBuy: 0.004, dailyCap: 0.05, maxPositions: 5 } },
  { name: "Volume Breakout", event: "volume", trigger: "Buys a new Pons token when it crosses $50k lifetime volume", exit: "Sells after 1 minute", holdSec: 60, houseAgent: 3,
    defaults: { perBuy: 0.002, dailyCap: 0.05, maxPositions: 6 } },
  { name: "Dev Dump Dip", event: "devsell", trigger: "Buys every time a token's dev sells", exit: "Sells after 10 seconds", holdSec: 10, houseAgent: 4,
    defaults: { perBuy: 0.001, dailyCap: 0.04, maxPositions: 8 } },
  { name: "DexScreener Pulse", event: "dexupdate", trigger: "Buys every time a token's DexScreener page is updated", exit: "Sells after 1 minute", holdSec: 60, houseAgent: 5,
    defaults: { perBuy: 0.002, dailyCap: 0.05, maxPositions: 6 } },
  { name: "Custom", event: "custom", trigger: "Your own limits; plain-English rules arrive in Phase 3", exit: "Take profit and stop loss", holdSec: null, houseAgent: null,
    defaults: { perBuy: 0.001, dailyCap: 0.03, maxPositions: 6 } },
];

export const strategyByName = (n: string) => STRATEGIES.find((s) => s.name === n) ?? STRATEGIES[STRATEGIES.length - 1];
export const HOUSE_STRATEGIES = STRATEGIES.filter((s) => s.houseAgent !== null);
