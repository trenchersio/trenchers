import { WalletMenu } from "@/components/WalletMenu";
import { ConnectModal } from "@/components/ConnectModal";
import { MobileMenu } from "@/components/MobileMenu";
import { CopyCA } from "@/components/CopyCA";
import { SectionSwitch } from "@/components/SectionSwitch";
import { FlywheelBand } from "@/components/FlywheelBand";
import { NavDropdown } from "@/components/NavDropdown";
import { ROUTES } from "@/lib/constants";

/** The inference markets' own top bar, under the same two-section strip as the agents. */
export function InferenceHeader() {
  return (
    <>
      <SectionSwitch on="think" wide />
      <header className="bar bar-wide inf-bar">
        <a href="#top" className="inf-brand" aria-label="Trenchers Inference Markets">
          <img src="brand/lockup.svg" alt="Trenchers" width={200} height={22} className="lockup" />
          <span className="inf-brand-tag mono">Make it<br />think</span>
        </a>
        <nav>
          <a href="#buy" className="nav-mint inf-cta">Buy credit</a>
          <a href="#models" className="tbtn">Models</a>
          <a href="#p2p" className="tbtn">P2P</a>
          <a href="#account" className="tbtn">Account</a>
          <NavDropdown label="More" items={[
            { label: "Inference for a Trencher", href: "#trencher", hint: "Turn your Trencher into its own AI model" },
            { label: "Get $TRENCHERS", href: "#start", hint: "Where to buy the token you pay with" },
            { label: "Docs", href: `${ROUTES.docs}#trenchers-inference-markets`, hint: "The full technical write-up" },
            { label: "Home", href: ROUTES.home, hint: "Back to trenchers.io" },
          ]} />
          <CopyCA />
          <span className="nav-sep" aria-hidden="true" />
          <WalletMenu />
        </nav>
        <MobileMenu page="inference" />
      </header>
      <FlywheelBand on={"think"} wide />
      <ConnectModal />
    </>
  );
}
