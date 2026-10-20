import type { Metadata } from "next";
import { TrenchiesGame } from "@/components/trenchies/game/TrenchiesGame";
import "./game.css";

// Invite-only while it's being built: not linked anywhere, not indexed, and the engine only lets invited wallets in.
export const metadata: Metadata = { title: "Trenchies", robots: { index: false, follow: false, nocache: true } };

export default function TrenchiesPlay() {
  return <TrenchiesGame />;
}
