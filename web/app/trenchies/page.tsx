import type { Metadata } from "next";
import { TrenchiesXP } from "@/components/trenchies/TrenchiesXP";
import "./trenchies.css";

export const metadata: Metadata = {
  title: "Trenchies · Earn Early XP and Win Prizes",
  description: "Trenchies is the game coming to Trenchers. Sign in with X, earn early XP and climb the leaderboard for a share of the prize pool: ETH plus 10 Trencher NFTs.",
  openGraph: { title: "Trenchies: earn early XP and win prizes", description: "Sign in with X, earn early XP and win from a prize pool of ETH plus 10 Trencher NFTs.", url: "https://www.trenchers.io/trenchies", siteName: "Trenchers", type: "website" },
  twitter: { card: "summary_large_image", site: "@trenchersio", title: "Trenchies: earn early XP and win prizes", description: "Sign in with X, earn early XP and win from a prize pool of ETH plus 10 Trencher NFTs." },
};

export default function TrenchiesPage() {
  return <TrenchiesXP />;
}
