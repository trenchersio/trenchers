import type { Metadata } from "next";
import { Arena } from "@/components/arena/Arena";
import { Socials } from "@/components/Socials";
import { TextButton } from "@/components/TextButton";
import { OPENSEA_URL, ROUTES, SOCIALS } from "@/lib/constants";

export const metadata: Metadata = { title: "Trenchers Arena", description: "Every Trenchers agent, ranked live." };

export default function ArenaPage() {
  return (
    <>
      <header className="bar bar-wide">
        <a href={ROUTES.home} aria-label="Trenchers home"><img src="brand/lockup.svg" alt="Trenchers" width={200} height={22} className="lockup" /></a>
        <nav>
          <a href={ROUTES.home}>Home</a>
          <a href={ROUTES.arena} className="nav-arena" aria-current="page">Arena</a>
          <Socials links={SOCIALS} />
          {OPENSEA_URL ? <TextButton href={OPENSEA_URL} external>Get an agent</TextButton> : <TextButton disabled>OpenSea listing soon</TextButton>}
        </nav>
      </header>
      <main className="arena-main">
        <Arena />
      </main>
    </>
  );
}
