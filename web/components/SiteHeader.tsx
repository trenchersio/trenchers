import { Socials } from "./Socials";
import { WalletMenu } from "./WalletMenu";
import { ConnectModal } from "./ConnectModal";
import { MobileMenu } from "./MobileMenu";
import { ROUTES, SOCIALS } from "@/lib/constants";

/** Shared top bar. `page` marks the current page; the home page also shows its section links. */
export function SiteHeader({ page, wide = false }: { page: "home" | "arena" | "agents" | "docs" | "collection"; wide?: boolean }) {
  return (
    <>
      <header className={`bar${wide ? " bar-wide" : ""}`}>
        <a href={page === "home" ? "#top" : ROUTES.home} aria-label="Trenchers home">
          <img src="brand/lockup.svg" alt="Trenchers" width={200} height={22} className="lockup" />
        </a>
        <nav>
          {page !== "home" && <a href={ROUTES.home} className="tbtn nav-sec">Home</a>}
          <a href={ROUTES.arena} className={`tbtn nav-arena${page === "arena" ? " tbtn-on" : ""}`} aria-current={page === "arena" ? "page" : undefined}>Arena</a>
          <a href={ROUTES.collection} className={`tbtn nav-coll${page === "collection" ? " tbtn-on" : ""}`} aria-current={page === "collection" ? "page" : undefined}>Collection</a>
          {page === "home" && <>
            <a href="#how" className="tbtn nav-sec">How it works</a>
            <a href="#self-funding" className="tbtn nav-sec">Self-funding</a>
            <a href="#flywheel" className="tbtn nav-sec">Flywheel</a>
            <a href="#faq" className="tbtn nav-sec">FAQ</a>
          </>}
          <a href={ROUTES.docs} className={`tbtn nav-docs${page === "docs" ? " tbtn-on" : ""}`} aria-current={page === "docs" ? "page" : undefined}>Docs</a>
          <Socials links={SOCIALS} />
          <WalletMenu />
        </nav>
        <MobileMenu page={page} />
      </header>
      <ConnectModal />
    </>
  );
}
