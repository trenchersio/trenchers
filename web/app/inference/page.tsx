import type { Metadata } from "next";
import { SiteShell } from "@/components/SiteShell";
import { InferenceHeader } from "@/components/inference/InferenceHeader";
import { Inference } from "@/components/inference/Inference";
import "./inference.css";

export const metadata: Metadata = {
  title: "Trenchers Inference Markets · Burn $TRENCHERS, run any model",
  description: "Turn $TRENCHERS into compute: Claude, GPT, Gemini, Grok and more behind a single address. Every token paid in is burned. Plus a P2P market for $TRENCHERS and agent coins.",
  openGraph: { title: "Trenchers Inference Markets", description: "Burn $TRENCHERS, run any model.", url: "https://www.trenchers.io/inference", siteName: "Trenchers", type: "website" },
  twitter: { card: "summary_large_image", site: "@trenchersio", title: "Trenchers Inference Markets", description: "Burn $TRENCHERS, run any model." },
};

export default function InferencePage() {
  return (
    <SiteShell section="inference">
      <InferenceHeader />
      <Inference />
    </SiteShell>
  );
}
