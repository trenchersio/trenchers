import { SiteHeader } from "@/components/SiteHeader";
import { ROUTES } from "@/lib/constants";

export default function NotFound() {
  return (
    <>
      <SiteHeader page="home" />
      <main style={{ padding: "96px 24px", textAlign: "center" }}>
        <p className="eyebrow">404</p>
        <h1 style={{ margin: "12px 0 16px" }}>This page doesn&apos;t exist.</h1>
        <p style={{ color: "var(--quiet)", marginBottom: 28 }}>The link may be old or mistyped.</p>
        <a href={ROUTES.home} className="tbtn">Back to trenchers.io</a>
      </main>
    </>
  );
}
