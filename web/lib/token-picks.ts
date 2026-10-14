import { TRENCHERS_TOKEN } from "./constants";

/** Pons coins holders can point a "Specific token" strategy at in one tap. Any other Pons coin works too (paste its address). */
/** `soon`: shown, but not pickable yet (e.g. a coin that trades outside Pons until agents can trade there). */
export const TOKEN_PICKS: { symbol: string; address: string; note?: string; logo?: string; soon?: boolean }[] = [
  ...(TRENCHERS_TOKEN ? [{ symbol: "TRENCHERS", address: TRENCHERS_TOKEN.toLowerCase(), note: "ours", logo: "/brand/mark.svg" }] : []),
  { symbol: "PONS", logo: "/tokens/pons.png", address: "0x39dbed3a2bd333467115de45665cc57f813c4571" },
  { symbol: "COMD", logo: "/tokens/comd.png", address: "0xbfdac6235dbe77c0cd6edb01c810c7da858c6c41" },
  { symbol: "BUN", logo: "/tokens/bun.png", address: "0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3" },
  { symbol: "PRIORS", logo: "/tokens/priors.png", address: "0xedbf91223639800bcd5756815caf908df3b890be" },
  { symbol: "AI", logo: "/tokens/ai.png", address: "0x2e8c31162b855a2ffa90f6f8634643ad6f111e18" },
  { symbol: "BONER", logo: "/tokens/boner.png", address: "0x98096d17e191b3da1d5f99a6d7b3584351b11e18" },
  // Programmable's V4 trades in its own Uniswap v4 pool, not on Pons: pickable once agents can trade Programmable coins.
  { symbol: "V4", logo: "/tokens/v4.png", address: "0xc60ba256b44334a0cd2c7242e98b88f031abb006", note: "soon", soon: true },
];
export const pickOf = (address?: string | null) => (address ? TOKEN_PICKS.find((p) => p.address === address.toLowerCase()) ?? null : null);
