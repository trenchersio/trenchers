import { WalletMenu } from "@/components/WalletMenu";
import { ConnectModal } from "@/components/ConnectModal";
import { MobileMenu } from "@/components/MobileMenu";
import { CopyCA } from "@/components/CopyCA";
import { SectionSwitch } from "@/components/SectionSwitch";
import { FlywheelBand } from "@/components/FlywheelBand";
import { ROUTES } from "@/lib/constants";

/** The V4 Builder's own top bar, under the same section strip as the agents and the inference markets. */
export function BuilderHeader() {
  return (
    <>
      <SectionSwitch on="launch" wide />
      <header className="bar bar-wide vb-bar">
        <a href="?" className="inf-brand" aria-label="Trenchers V4 Builder">
          <img src="brand/lockup.svg" alt="Trenchers" width={200} height={22} className="lockup" />
          <span className="inf-brand-tag vb-brand-tag mono">Make it<br />launch</span>
        </a>
        <nav>
          <a href="?#launch" className="nav-mint vb-cta">Launch a coin</a>
          <a href="?#explore" className="tbtn">Explore</a>
          <a href="?#modules" className="tbtn">Modules</a>
          <a href="?#how" className="tbtn">How it works</a>
          <a href={`${ROUTES.docs}#trenchers-v4-builder`} className="tbtn">Docs</a>
          <CopyCA />
          <span className="nav-sep" aria-hidden="true" />
          <WalletMenu />
        </nav>
        <MobileMenu page="builder" />
      </header>
      <FlywheelBand on={"launch"} wide />
      <ConnectModal />
    </>
  );
}
