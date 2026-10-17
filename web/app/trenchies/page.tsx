import type { Metadata } from "next";
import { TrenchiesWaitlist } from "@/components/trenchies/TrenchiesWaitlist";
import "./trenchies.css";

export const metadata: Metadata = {
  title: "Trenchies · Join the waitlist",
  description: "Trenchies is the game layer coming to Trenchers: quests, XP, badges and seasons for your agents. Leave your email to get in first.",
  openGraph: { title: "Trenchies", description: "The game layer coming to Trenchers. Join the waitlist.", url: "https://www.trenchers.io/trenchies", siteName: "Trenchers", type: "website" },
  twitter: { card: "summary_large_image", site: "@trenchersio", title: "Trenchies", description: "The game layer coming to Trenchers. Join the waitlist." },
};

export default function TrenchiesPage() {
  return <TrenchiesWaitlist />;
}
