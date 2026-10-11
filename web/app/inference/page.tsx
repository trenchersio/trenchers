import type { Metadata } from "next";
import { SiteShell } from "@/components/SiteShell";
import { InferenceHeader } from "@/components/inference/InferenceHeader";
import { Inference } from "@/components/inference/Inference";
import "./inference.css";

export const metadata: Metadata = {
  title: "Trenchers Inference Markets · Every frontier model, one key, paid in $TRENCHERS",
  description: "Every frontier model through one endpoint and one API key, paid in $TRENCHERS. Every token spent is burned. Plus a P2P market for $TRENCHERS and agent coins.",
  openGraph: { title: "Trenchers Inference Markets", description: "Every frontier model, one key, paid in $TRENCHERS. Every token spent is burned.", url: "https://www.trenchers.io/inference", siteName: "Trenchers", type: "website" },
  twitter: { card: "summary_large_image", site: "@trenchersio", title: "Trenchers Inference Markets", description: "Every frontier model, one key, paid in $TRENCHERS. Every token spent is burned." },
};

export default function InferencePage() {
  return (
    <SiteShell section="inference">
      <InferenceHeader />
      <Inference />
    </SiteShell>
  );
}
