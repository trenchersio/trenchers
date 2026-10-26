import { WalletMenu } from "./WalletMenu";
import { ConnectModal } from "./ConnectModal";
import { MobileMenu } from "./MobileMenu";
import { NavDropdown, type NavItem } from "./NavDropdown";
import { CopyCA } from "@/components/CopyCA";
import { WakeBanner } from "@/components/WakeBanner";
import { SectionSwitch } from "@/components/SectionSwitch";
import { FlywheelBand } from "@/components/FlywheelBand";
import { CHAT_OPEN, GITHUB_URL, ROUTES, SOCIALS, TELEGRAM_FEED } from "@/lib/constants";
import { HUB, step, stepOf, type PageKey } from "@/lib/steps";

type Page = PageKey;

/** Shared top bar. The path strip above it switches between the five steps; the bar shows the pages of the step
 *  you are in (or, on the hub pages, the way in: Mint), with Learn and Community in two compact dropdowns. */
export function SiteHeader({ page, wide = false }: { page: Page; wide?: boolean }) {
  const home = page === "home" ? "" : ROUTES.home;
  const where = stepOf(page);
  const st = where === "hub" ? null : step(where);
  const learn: NavItem[] = [
    { label: "How it all connects", href: `${home}#path`, hint: "Your Trencher at the centre: trade, think, talk, launch, borrow" },
    { label: "How it works", href: `${home}#how`, hint: "From NFT to self-funding agent" },
    { label: "Talk to your agent", href: `${home}#guide`, hint: "Guide it in plain English: your edge" },
    { label: "Self-funding agents", href: `${home}#self-funding`, hint: "Starter ETH, agent coins, fee share" },
    { label: "Flywheel", href: `${home}#flywheel`, hint: "Where every ETH goes" },
    { label: "Roadmap", href: `${home}#roadmap` },
    { label: "FAQ", href: `${home}#faq` },
    { label: "Docs", href: ROUTES.docs, hint: "The full technical write-up" },
  ];
  const collection: NavItem[] = [
    { label: "Browse all 2,000", href: ROUTES.collection, hint: "Every Trencher, its wallet and its record" },
    { label: "Market", href: ROUTES.market, hint: "Trenchers for sale, next to what their agent holds" },
    ...HUB.external.map((x) => ({ label: x.label, href: x.href, hint: "Buy or sell a Trencher", external: true })),
  ];
  const community: NavItem[] = [
    { label: "Chat", href: ROUTES.chat, hint: CHAT_OPEN ? "For Trenchers holders" : "Opens after the $TRENCHERS launch", disabled: !CHAT_OPEN, unread: "chat" },
    ...(TELEGRAM_FEED ? [{ label: "Live feed", href: TELEGRAM_FEED, hint: "Every mint, awakening and sale, on Telegram", external: true }] : []),
    ...(SOCIALS.x ? [{ label: "X", href: SOCIALS.x, hint: "@trenchersio", external: true }] : []),
    ...(SOCIALS.discord ? [{ label: "Discord", href: SOCIALS.discord, external: true }] : []),
    ...(SOCIALS.telegram ? [{ label: "Telegram", href: SOCIALS.telegram, external: true }] : []),
    { label: "GitHub", href: GITHUB_URL, hint: "Contracts, site and docs", external: true },
  ];
  return (
    <>
      <SectionSwitch on={where} wide={wide} mintOn={page === "mint"} />
      <header className={`bar${wide ? " bar-wide" : ""}`}>
        <a href={page === "home" ? "#top" : ROUTES.home} aria-label="Trenchers home" className="inf-brand">
          <img src={`${process.env.NEXT_PUBLIC_PREVIEW === "1" ? "" : "/"}brand/lockup.svg`} alt="Trenchers" width={200} height={22} className="lockup" />
          {st && <span className={`inf-brand-tag step-tag tone-${st.tone} mono`}>Make it<br />{st.name.toLowerCase()}</span>}
        </a>
        <nav>
          {st ? st.pages.map((p) => (
            <a key={p.key} href={p.href} title={p.hint} className={`tbtn${page === p.key ? " tbtn-on" : ""}`}
              aria-current={page === p.key ? "page" : undefined}>{p.label}</a>
          )) : (
            <>
              <NavDropdown label="Collection" items={collection} active={page === "collection" || page === "market"} />
              <a href={ROUTES.agents} title="Your Trencher's control room" className={`tbtn${page === "agents" ? " tbtn-on" : ""}`}
                aria-current={page === "agents" ? "page" : undefined}>My Trencher</a>
            </>
          )}
          <NavDropdown label="Learn" items={learn} active={page === "docs"} />
          <NavDropdown label="Community" items={community} />
          <CopyCA />
          <span className="nav-sep" aria-hidden="true" />
          <WalletMenu />
        </nav>
        <MobileMenu page={page} />
      </header>
      {page === "home" && (
        <div className="x-notice" role="status">
          <span className="x-notice-k mono">Notice</span>
          <span>Our X account is temporarily suspended and we&apos;re working to get it back. All protocols are running as normal. <a href="/x-notice">Read the notice</a> · <a href="https://t.me/trenchersio" target="_blank" rel="noreferrer">Join our Telegram ↗</a> · <a href="https://t.me/tunafishcannn" target="_blank" rel="noreferrer">Contact the dev ↗</a></span>
        </div>
      )}
      <FlywheelBand on={where} wide={wide} />
      <WakeBanner page={page} />
      <ConnectModal />
    </>
  );
}
