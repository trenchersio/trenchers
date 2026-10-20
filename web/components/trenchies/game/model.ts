/** What the Trenchies engine sends the site. */
import type { ChestTier, Reward, Slot, Stat } from "@/lib/trenchies-catalog";
import type { ChatMsg } from "./Land";

export type Pick = { token: string; symbol: string; pct: number | null; rank: number | null };
export type Result = { round: number; picks: Pick[]; xp: number; coins?: number; parts: { label: string; xp: number }[]; at: number };
export type Wear = Partial<Record<Slot, string>>;
export type Pub = { name: string; nft: number; level: number; xp: number; streak: number; hits: number; wins: number; hatTricks: number; rounds: number; items: string[]; house: string; vehicle: string; x: string | null; wear?: Wear;
  layout?: Record<string, string>; paint?: Record<string, { wall?: number; floor?: number }>; place?: Record<string, { x: number; y: number }>; isOpen?: boolean };
export type Note = { id: number; kind: string; text: string; at: number };
export type Quest = { id: string; n: number; done: boolean; text: string; goal: number; xp: number; bricks: number };
export type Progress = {
  daily: { claimed: boolean; day: number; rewards: Reward[]; run: number };
  quests: { list: Quest[]; bonus: boolean };
  chests: Record<ChestTier, number>; bugs: Record<string, number>; achievements: string[]; achievementCount: number;
  stats: Partial<Record<Stat, number>>; wardrobe: string[]; wear: Wear; inbox: Note[]; netAt: number; landValue: number; cheers: number; cheeredToday: number;
};
export type Mini = { name: string; nft: number; level: number; x: string | null };
export type Me = Pub & Progress & {
  bricks: number; held: boolean; desk: { streak: number; best: number; paidLeft: number }; xPending: { handle: string; code: string } | null;
  requests: number; lands: Mini[]; week: { rank: number | null; xp: number; players: number };
  open: { round: number; label: string; lockAt: number; picks: { token: string; symbol: string }[] };
  live: { round: number; label: string; endsAt: number; dataAt: number; players: number; picks: { token: string; symbol: string; pct: number | null; place: number | null }[]; top: { token: string; symbol: string; pct: number | null; by: number }[] };
  last: { round: number; label: string; top: { token: string; symbol: string; pct: number | null }[]; players: number } | null;
  results: Result[]; unseen: Result | null;
};
export type LandInfo = { open?: boolean; land: Pub; role: "owner" | "member" | "pending" | "visitor"; members: Mini[]; present: Mini[]; ownerHere: boolean; chat: ChatMsg[]; requests?: (Mini & { at: number })[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Call = (op: string, body?: Record<string, unknown>, get?: Record<string, string>) => Promise<any>;

/** The trading desk: Bitcoin up or down, 5-minute rounds. */
export type DeskLog = { r: number; call: "up" | "down"; result: "win" | "loss" | "push" | "void"; open: number | null; close: number | null; xp: number; coins: number; crowd: boolean };
export type DeskView = {
  now: number; price: number | null; feed: string; series: [number, number][];
  live: { round: number; start: number; end: number; open: number | null; call: "up" | "down" | null; crowd: { up: number; down: number } };
  next: { round: number; start: number; call: "up" | "down" | null; crowd: { up: number; down: number } };
  streak: number; best: number; paidLeft: number; log: DeskLog[];
  top: (Mini & { rank: number; wins: number; calls: number; best: number })[];
};
