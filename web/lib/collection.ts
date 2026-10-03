/**
 * Collection data: traits for all 2,000 Trenchers plus their agent status.
 *
 * SAMPLE MODE: status and owners are made up (deterministic per token) so the page can be tried
 * before the contracts are live. Agents in the Arena are the same ones the Arena sample shows.
 * Once live this reads ownerOf, the ERC-6551 / ERC-8004 registries and the indexer instead.
 */
import data from "./collection.json";
import arenaIds from "./nft-ids.json";
import { STRATEGIES } from "./strategies";

export const SUPPLY = 2000;
export const TILE = data.tile;
const COLS = data.cols, ROWS = data.rows, PER = COLS * ROWS;

export type Status = "live" | "registered" | "idle";
export const STATUS_LABEL: Record<Status, string> = { live: "In the Arena", registered: "Registered", idle: "Not registered" };

export function traits(id: number): { key: string; value: string }[] {
  const row = data.tokens[id - 1];
  return data.keys.map((k, i) => ({ key: k, value: data.values[i][row[i]] }));
}
export const PALETTES = data.values[data.keys.indexOf("Palette")];
export const paletteOf = (id: number) => PALETTES[data.tokens[id - 1][data.keys.indexOf("Palette")]];

/** CSS background for token `id` taken from its sprite sheet. */
export function sprite(id: number, prefix = "") {
  const k = id - 1, sheet = Math.floor(k / PER), i = k % PER;
  const x = (i % COLS) / (COLS - 1) * 100, y = Math.floor(i / COLS) / (ROWS - 1) * 100;
  return {
    backgroundImage: `url(${prefix}collection/sheet-${sheet}.webp)`,
    backgroundSize: `${COLS * 100}% ${ROWS * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
  };
}
export const sheetOf = (id: number) => Math.floor((id - 1) / PER);

function h32(n: number, salt: number) {
  let x = (n * 2654435761 + salt * 40503) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 2246822507) >>> 0; x ^= x >>> 13; x = Math.imul(x, 3266489909) >>> 0; x ^= x >>> 16;
  return x >>> 0;
}
const hex = (n: number, salt: number, len: number) => {
  let s = ""; for (let i = 0; s.length < len; i++) s += h32(n, salt + i).toString(16).padStart(8, "0");
  return s.slice(0, len);
};

const LIVE = new Set<number>(arenaIds as number[]);
export function sampleStatus(id: number): Status {
  if (id <= 5 || LIVE.has(id)) return "live";
  return h32(id, 7) % 100 < 16 ? "registered" : "idle";
}
export type Sample = { status: Status; owner: string; listed: boolean; wallet: string | null; identity: number | null; strategy: string | null; balance: number | null };
export function sample(id: number): Sample {
  const status = sampleStatus(id);
  const house = id <= 5;
  const listed = !house && status === "idle" && h32(id, 11) % 100 < 45;
  const owner = house || listed ? "Trenchers team" : `0x${hex(id, 21, 40)}`;
  const reg = status !== "idle";
  const strat = house ? STRATEGIES.find((s) => s.houseAgent === id)!.name
    : reg ? STRATEGIES[h32(id, 31) % STRATEGIES.length].name : null;
  return {
    status, owner, listed,
    wallet: reg ? `0x${hex(id, 41, 40)}` : null,
    identity: reg ? 1000 + id * 7 : null,
    strategy: status === "registered" && h32(id, 51) % 3 === 0 ? null : strat,
    balance: reg ? +(0.05 + (h32(id, 61) % 1000) / 1000 * (house ? 3 : 1.2)).toFixed(3) : null,
  };
}
