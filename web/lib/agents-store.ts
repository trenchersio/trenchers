"use client";
/**
 * The connected holder's Trenchers and each one's agent setup.
 *
 * SAMPLE MODE (no contract deployed yet): ownership is derived from the address, and every
 * "transaction" is simulated and saved in this browser. Once the contracts are live, these
 * functions are replaced by: an indexer query for owned token IDs, the ERC-6551 registry
 * (create the agent wallet), the ERC-8004 identity registry (register), plain ETH transfers to
 * the agent wallet (fund), an EIP-712 signature (strategy) and the account's setPolicy call
 * (enter the Arena / pause).
 */
import ids from "./nft-ids.json";

import { STRATEGIES, type StrategyName } from "./strategies";
export type Preset = StrategyName;
import type { CustomRule } from "./custom-strategy";
import type { AgentToken } from "./agent-token";
export type Strategy = { preset: Preset; perBuy: number; dailyCap: number; maxPositions: number; custom?: CustomRule };
export type AgentState = {
  id: number;
  registered: boolean;
  agentWallet: string | null;
  identityId: number | null;
  balance: number;     // ETH in the agent wallet
  strategy: Strategy | null;
  live: boolean;       // trading enabled, competing in the Arena
  registeredAt?: number | null;
  starterClaimed?: boolean;
  fundingMode?: "coin" | "self"; // option A (agent coin) or B (self-funded from fee share + profits)    // the 0.05 ETH starter balance from the Agent Starter Fund
  locked?: number;             // starter ETH still in the agent: spendable on launches and trades, not withdrawable
  token?: AgentToken | null;   // the agent's own Pons token, if launched
  log: { t: number; text: string }[];
};

export const PRESETS = Object.fromEntries(STRATEGIES.map((d) => [d.name, {
  line: d.trigger, defaults: d.defaults, rules: [d.exit], house: d.houseAgent,
}])) as Record<Preset, { line: string; defaults: Omit<Strategy, "preset">; rules: string[]; house: number | null }>;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const hexFrom = (seed: string, n: number) => {
  let out = "", h = hash(seed);
  while (out.length < n) { h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0; out += h.toString(16).padStart(8, "0"); }
  return out.slice(0, n);
};

/** Sample mode: every connected address "holds" two or three Trenchers. */
export function ownedIds(address: string): number[] {
  const pool = (ids as number[]).filter((i) => i > 5);
  const h = hash(address.toLowerCase());
  const n = 2 + (h % 2);
  const out: number[] = [];
  for (let k = 0; out.length < n; k++) {
    const id = pool[(h + k * 7919) % pool.length];
    if (!out.includes(id)) out.push(id);
  }
  return out.sort((a, b) => a - b);
}

const key = (address: string, id: number) => `trenchers-agent:${address.toLowerCase()}:${id}`;
export function loadAgent(address: string, id: number): AgentState {
  try {
    const raw = localStorage.getItem(key(address, id));
    if (raw) return JSON.parse(raw);
  } catch {}
  return { id, registered: false, agentWallet: null, identityId: null, balance: 0, strategy: null, live: false, log: [] };
}
export function saveAgent(address: string, a: AgentState) {
  try { localStorage.setItem(key(address, a.id), JSON.stringify(a)); } catch {}
  try { window.dispatchEvent(new CustomEvent("trenchers-agents-changed")); } catch {}
}
export function liveAgentIds(address: string | null): number[] {
  if (!address) return [];
  return ownedIds(address).filter((id) => loadAgent(address, id).live);
}

export const agentWalletFor = (address: string, id: number) => `0x${hexFrom(`tba:${id}:${address}`, 40)}`;
export const tokenAddressFor = (address: string, id: number) => `0x${hexFrom(`token:${id}:${address}`, 40)}`;
export const identityFor = (id: number) => 1000 + id * 7;
export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function statusOf(a: AgentState) {
  if (a.live) return { label: "In the Arena", tone: "live" as const };
  if (a.registered) return { label: "Registered", tone: "ready" as const };
  return { label: "Not registered", tone: "idle" as const };
}
