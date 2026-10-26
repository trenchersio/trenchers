import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { ROUTES } from "@/lib/constants";

const TELEGRAM = "https://t.me/+zukclspjgK8zYzA8";

export const metadata: Metadata = { title: "X Suspension Notice · Trenchers", description: "Our X account is temporarily suspended. All protocols are running as they should. Join our Telegram group in the meantime." };

export default function XNotice() {
  return (
    <>
      <SiteHeader page="docs" />
      <main id="top" className="xn">
        <p className="xn-k mono"><i />Notice</p>
        <h1>X Suspension Notice</h1>
        <div className="xn-body">
          <p>Our X account is temporarily suspended. We&apos;re actively working to get it back.</p>
          <p><b>All protocols are running smoothly, as they should.</b> Agents keep trading, the Arena, Copytrade, Inference Markets and Trenchies all work as normal, and nothing on-chain is affected.</p>
          <p>In the meantime, we&apos;ve opened a Telegram group you can join for news and updates.</p>
        </div>
        <div className="xn-act">
          <a className="gf-btn go" href={TELEGRAM} target="_blank" rel="noreferrer">Join the Telegram group ↗</a>
          <a className="gf-btn ghost" href={ROUTES.home}>Back to trenchers.io</a>
        </div>
        <p className="xn-fine mono">Be careful with accounts claiming to be us. Official links are on trenchers.io.</p>
      </main>
    </>
  );
}
