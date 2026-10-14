import { WalletMenu } from "@/components/WalletMenu";
import { ConnectModal } from "@/components/ConnectModal";
import { MobileMenu } from "@/components/MobileMenu";
import { CopyCA } from "@/components/CopyCA";
import { SectionSwitch } from "@/components/SectionSwitch";
import { FlywheelBand } from "@/components/FlywheelBand";
import { NavDropdown } from "@/components/NavDropdown";
import { ROUTES } from "@/lib/constants";

/** Trenchers Credit's own top bar, under the same section strip as every other part. */
export function CreditHeader() {
  return (
    <>
      <SectionSwitch on="borrow" wide />
      <header className="bar bar-wide cr-topbar">
        <a href="?" className="inf-brand" aria-label="Trenchers Credit">
          <img src="brand/lockup.svg" alt="Trenchers" width={200} height={22} className="lockup" />
          <span className="inf-brand-tag cr-brand-tag mono">Make it<br />borrow</span>
        </a>
        <nav>
          <a href="?#lend" className="nav-mint cr-cta">Lend ETH</a>
          <a href="?#borrow" className="tbtn">Open a line</a>
          <a href="?#record" className="tbtn">Check an agent</a>
          <NavDropdown label="More" items={[
            { label: "How it works", href: "?#how", hint: "Where the ETH goes, and why lenders are safe" },
            { label: "Terms", href: "?#terms", hint: "Fees, sizes, terms, what a default costs" },
            { label: "Loans", href: "?#loans", hint: "Every recent loan" },
            { label: "Docs", href: `${ROUTES.docs}#trenchers-credit`, hint: "The full technical write-up" },
            { label: "Home", href: ROUTES.home, hint: "Back to trenchers.io" },
          ]} />
          <CopyCA />
          <span className="nav-sep" aria-hidden="true" />
          <WalletMenu />
        </nav>
        <MobileMenu page="credit" />
      </header>
      <FlywheelBand on="borrow" wide />
      <ConnectModal />
    </>
  );
}
