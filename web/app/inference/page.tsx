import type { Metadata } from "next";
import { SiteShell } from "@/components/SiteShell";
import { InferenceHeader } from "@/components/inference/InferenceHeader";
import { Inference } from "@/components/inference/Inference";
import "./inference.css";

export const metadata: Metadata = {
  title: "Trenchers Inference Markets · Every model, one $TRENCHERS balance",
  description: "Call Claude, GPT, Gemini, Grok and more from one endpoint, paid in $TRENCHERS and burned. Send inference to your Trencher and call it as its own AI model.",
  openGraph: { title: "Trenchers Inference Markets", description: "Every model, one $TRENCHERS balance.", url: "https://www.trenchers.io/inference", siteName: "Trenchers", type: "website" },
  twitter: { card: "summary_large_image", site: "@trenchersx", title: "Trenchers Inference Markets", description: "Every model, one $TRENCHERS balance." },
};

export default function InferencePage() {
  return (
    <SiteShell section="think">
      <InferenceHeader />
      <Inference />
    </SiteShell>
  );
}
