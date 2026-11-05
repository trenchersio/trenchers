import type { Metadata } from "next";
import { TrenchiesGame } from "@/components/trenchies/game/TrenchiesGame";
import "./game.css";

const DESC = "Trenchies is live: spawn your Trenchie, call Bitcoin up or down, pick tomorrow's top 3 Pons coins and build your land. Free to play, no Trencher needed.";
export const metadata: Metadata = {
  title: "Trenchies · Play now",
  description: DESC,
  alternates: { canonical: "https://www.trenchers.io/trenchies/play" },
  openGraph: { title: "Trenchies is live", description: DESC, url: "https://www.trenchers.io/trenchies/play", siteName: "Trenchers", type: "website" },
  twitter: { card: "summary_large_image", site: "@trenchersx", title: "Trenchies is live", description: DESC },
};

export default function TrenchiesPlay() {
  return <TrenchiesGame />;
}
