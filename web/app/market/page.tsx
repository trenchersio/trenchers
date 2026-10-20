import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { MarketView } from "@/components/market/MarketView";

export const metadata: Metadata = { title: "Trenchers Market", description: "Every Trencher for sale, next to what its agent holds and how it trades: wallet value, weekly return, win rate and rank." };

export default function MarketPage() {
  return (<><SiteHeader page="market" wide /><main className="arena-main"><MarketView /></main></>);
}
