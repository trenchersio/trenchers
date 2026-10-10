import { TRENCHERS_TOKEN } from "./constants";

/** Pons coins holders can point a "Specific token" strategy at in one tap. Any other Pons coin works too (paste its address). */
export const TOKEN_PICKS: { symbol: string; address: string; note?: string; logo?: string }[] = [
  ...(TRENCHERS_TOKEN ? [{ symbol: "TRENCHERS", address: TRENCHERS_TOKEN.toLowerCase(), note: "ours", logo: "/brand/mark.svg" }] : []),
  { symbol: "ORBIO", logo: "/tokens/orbio.png", address: "0xaa07a0e9209e16ac99708c3ec70159c6ef3128a3" },
  { symbol: "PRIORS", logo: "/tokens/priors.png", address: "0xedbf91223639800bcd5756815caf908df3b890be" },
  { symbol: "AI", logo: "/tokens/ai.png", address: "0x2e8c31162b855a2ffa90f6f8634643ad6f111e18" },
  { symbol: "BONER", logo: "/tokens/boner.png", address: "0x98096d17e191b3da1d5f99a6d7b3584351b11e18" },
];
export const pickOf = (address?: string | null) => (address ? TOKEN_PICKS.find((p) => p.address === address.toLowerCase()) ?? null : null);
