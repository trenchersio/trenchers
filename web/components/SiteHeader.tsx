import { WalletMenu } from "./WalletMenu";
import { ConnectModal } from "./ConnectModal";
import { MobileMenu } from "./MobileMenu";
import { NavDropdown, type NavItem } from "./NavDropdown";
import { CopyCA } from "@/components/CopyCA";
import { CHAT_OPEN, GITHUB_URL, OPENSEA_URL, ROUTES, SOCIALS } from "@/lib/constants";

type Page = "home" | "arena" | "agents" | "docs" | "collection" | "mint" | "coins" | "chat";

/** Shared top bar: Arena and Collection up front, everything else in two compact dropdowns. */
export function SiteHeader({ page, wide = false }: { page: Page; wide?: boolean }) {
  const home = page === "home" ? "" : ROUTES.home;
  const learn: NavItem[] = [
    { label: "How it works", href: `${home}#how`, hint: "From NFT to self-funding agent" },
    { label: "Talk to your agent", href: `${home}#guide`, hint: "Guide it in plain English: your edge" },
    { label: "Train it, sell it", href: `${home}#resale`, hint: "A trained agent is a strategy you can sell" },
    { label: "Self-funding agents", href: `${home}#self-funding`, hint: "Starter ETH, agent coins, fee share" },
    { label: "Flywheel", href: `${home}#flywheel`, hint: "Where every ETH goes" },
    { label: "Roadmap", href: `${home}#roadmap` },
    { label: "FAQ", href: `${home}#faq` },
    { label: "Docs", href: ROUTES.docs, hint: "The full technical write-up" },
  ];
  const community: NavItem[] = [
    { label: "Chat", href: ROUTES.chat, hint: CHAT_OPEN ? "For Trenchers holders" : "Opens after the $TRENCHERS launch", disabled: !CHAT_OPEN },
    ...(SOCIALS.x ? [{ label: "X", href: SOCIALS.x, hint: "@trenchersio", external: true }] : []),
    ...(SOCIALS.discord ? [{ label: "Discord", href: SOCIALS.discord, external: true }] : []),
    ...(SOCIALS.telegram ? [{ label: "Telegram", href: SOCIALS.telegram, external: true }] : []),
    { label: "GitHub", href: GITHUB_URL, hint: "Contracts, site and docs", external: true },
  ];
  return (
    <>
      <header className={`bar${wide ? " bar-wide" : ""}`}>
        <a href={page === "home" ? "#top" : ROUTES.home} aria-label="Trenchers home">
          <img src="brand/lockup.svg" alt="Trenchers" width={200} height={22} className="lockup" />
        </a>
        <nav>
          <a href={ROUTES.mint} className={`nav-mint${page === "mint" ? " on" : ""}`} aria-current={page === "mint" ? "page" : undefined}>Mint</a>
          <a href={ROUTES.arena} className={`tbtn${page === "arena" ? " tbtn-on" : ""}`} aria-current={page === "arena" ? "page" : undefined}>Arena</a>
          <a href={ROUTES.collection} className={`tbtn${page === "collection" ? " tbtn-on" : ""}`} aria-current={page === "collection" ? "page" : undefined}>Collection</a>
          <a href={ROUTES.coins} className={`tbtn${page === "coins" ? " tbtn-on" : ""}`} aria-current={page === "coins" ? "page" : undefined}>Coins</a>
          <NavDropdown label="Learn" items={learn} active={page === "docs"} />
          <NavDropdown label="Community" items={community} active={page === "chat"} />
          {OPENSEA_URL && <a href={OPENSEA_URL} target="_blank" rel="noreferrer" className="tbtn">OpenSea ↗</a>}
          <CopyCA />
          <span className="nav-sep" aria-hidden="true" />
          <WalletMenu />
        </nav>
        <MobileMenu page={page} />
      </header>
      <ConnectModal />
    </>
  );
}
