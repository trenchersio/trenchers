import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { Launcher } from "@/components/Launcher";

export const metadata: Metadata = {
  title: "Coin launcher · Trenchers",
  description: "Make your Trencher launch: its own coin on Pons or Programmable, or a Uniswap v4 hook coin with your own rules in the Trenchers V4 Builder.",
};

export default function LauncherPage() {
  return (
    <>
      <SiteHeader page="launcher" wide />
      <Launcher />
    </>
  );
}
