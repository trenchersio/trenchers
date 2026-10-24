/** Shared shapes for the Trenchies world. */
export type Palette = { bg: string; main: string; second: string; sig: string; eye: string };
export type Look = { name: string; house: string; vehicle: string; items: string[]; palette: Palette; trophies?: number; level?: number; x?: string | null; wear?: Partial<Record<"hat" | "eyes" | "neck" | "back" | "aura" | "outline" | "trail", string>>;
  layout?: Record<string, string>; paint?: Record<string, { wall?: number; floor?: number }>; place?: Record<string, { x: number; y: number }> };
/** When the tree and the rock are ready again (ms since epoch, 0 = ready now). */
export type Grow = { wood: number; stone: number; fish: number };
/** DOM elements the world keeps pinned to points in 3D (nameplate, speech bubble, tree and rock tags). */
export type Pins = { plate?: HTMLElement | null; bubble?: HTMLElement | null; tree?: HTMLElement | null; rock?: HTMLElement | null; pond?: HTMLElement | null; net?: HTMLElement | null; fish?: HTMLElement | null; desk?: HTMLElement | null; pop?: HTMLElement | null; layer?: HTMLElement | null };
