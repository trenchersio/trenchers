import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ENGINE_URL } from "@/lib/constants";
import { PublicLand, type Showcase } from "@/components/trenchies/game/PublicLand";
import "../../play/game.css";

type P = { params: Promise<{ name: string }> };
async function load(name: string): Promise<Showcase | null> {
  try { const r = await fetch(`${ENGINE_URL}/trenchies/public?name=${encodeURIComponent(name)}`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(5000) }); if (!r.ok) return null; return ((await r.json()) as { player: Showcase }).player; } catch { return null; }
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const name = decodeURIComponent((await params).name);
  const p = await load(name);
  const title = p ? `${p.name}'s land · Trenchies` : "Trenchies";
  const description = p ? `A level ${p.level} Trenchie with a land worth ${p.landValue.toLocaleString("en-US")} bricks. Pick coins, build your land, catch butterflies. Come build next to them.` : "Pick coins, build your land, catch butterflies.";
  return { title, description, robots: { index: false, follow: false }, openGraph: { title, description, siteName: "Trenchers", type: "website" }, twitter: { card: "summary_large_image", site: "@trenchersio", title, description } };
}

/** A Trenchie's land, public: the share link players post (and the invite link: it carries their name as the referrer). */
export default async function PublicLandPage({ params }: P) {
  const p = await load(decodeURIComponent((await params).name));
  if (!p) notFound();
  return <PublicLand p={p} />;
}
