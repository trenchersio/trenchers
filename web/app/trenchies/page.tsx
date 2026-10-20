import type { Metadata } from "next";
import { TrenchiesXP } from "@/components/trenchies/TrenchiesXP";
import "./trenchies.css";

export const metadata: Metadata = {
  title: "Trenchies · Earn XP before launch",
  description: "Trenchies is the game coming to Trenchers. Sign in with X, earn XP before it opens and climb the early leaderboard.",
  openGraph: { title: "Trenchies: earn XP before launch", description: "Sign in with X, earn XP and climb the early leaderboard.", url: "https://www.trenchers.io/trenchies", siteName: "Trenchers", type: "website" },
  twitter: { card: "summary_large_image", site: "@trenchersio", title: "Trenchies: earn XP before launch", description: "Sign in with X, earn XP and climb the early leaderboard." },
};

export default function TrenchiesPage() {
  return <TrenchiesXP />;
}
