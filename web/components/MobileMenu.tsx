"use client";
import { useEffect, useState } from "react";
import { CopyCA } from "@/components/CopyCA";
import { CHAT_OPEN, GITHUB_URL, OPENSEA_URL, ROUTES, SOCIALS, TELEGRAM_FEED } from "@/lib/constants";
import { useChatUnread } from "@/lib/chat-unread";
import { short, useWallet } from "@/lib/wallet";
import { HUB, STEPS, stepOf, type PageKey } from "@/lib/steps";

type Page = PageKey;

/** Small screens: one [Menu] button that opens every link and the wallet control. */
export function MobileMenu({ page }: { page: Page }) {
  const [open, setOpen] = useState(false);
  const w = useWallet();
  const chatUnread = useChatUnread(CHAT_OPEN);
  useEffect(() => {
    document.documentElement.classList.toggle("menu-open", open);
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  const inference = page === "inference";
  const builder = page === "builder";
  const where = stepOf(page);
  const st = STEPS.find((x) => x.key === where);
  // Pages with their own sections list those; every other page lists its step's pages, then the hub.
  const own: [string, string, string][] = builder ? [
    ["b-top", "Overview", "?#top"], ["b-launch", "Launch a coin", "?#launch"], ["b-explore", "Explore coins", "?#explore"], ["b-modules", "Modules", "?#modules"],
    ["b-how", "How it works", "?#how"],
  ] : inference ? [
    ["inf-top", "Overview", "#top"], ["inf-buy", "Buy credit", "#buy"], ["inf-trencher", "Inference for a Trencher", "#trencher"], ["inf-models", "Models", "#models"], ["inf-p2p", "P2P Marketplace", "#p2p"],
    ["inf-account", "Account and keys", "#account"],
  ] : [];
  const links: [string, string, string][] = [
    ...own,
    ...(st ? st.pages.filter((p) => !own.length || p.key !== page).map((p) => [p.key, p.label, p.href] as [string, string, string]) : []),
    ["home", "Home", ROUTES.home],
    ...HUB.pages.map((p) => [p.key, p.label, p.href] as [string, string, string]),
    ...HUB.external.map((x) => [x.href, `${x.label} ↗`, x.href] as [string, string, string]),
    ["docs", "Docs", ROUTES.docs],
  ];
  return (
    <div className="mm">
      <button type="button" className={`tbtn${open ? " tbtn-on" : ""}`} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
        {open ? "Close" : "Menu"}{!open && chatUnread && <span className="nd-dot" aria-label="new messages" />}
      </button>
      {open && (
        <div id="mobile-menu" className="mm-panel">
          <p className="mm-make mono">Make your Trencher</p>
          <div className="mm-switch" role="group" aria-label="Make your Trencher">
            {STEPS.map((x) => (
              <a key={x.key} href={x.home} className={`tone-${x.tone}${where === x.key ? " on" : ""}`}><i>{x.n}</i>{x.name.toLowerCase()}</a>
            ))}
          </div>
          <nav aria-label="Pages">
            {links.map(([k, label, href]) => (
              <a key={k} href={href} className={page === k ? "on" : undefined} onClick={() => setOpen(false)}>
                <span className="mono">{label}{k === "chat" && chatUnread && <span className="nd-new mono">new</span>}</span><span aria-hidden="true">→</span>
              </a>
            ))}
          </nav>
          {!CHAT_OPEN && where === "hub" && <p className="mm-soon mono">Holders&apos; chat · opens after the $TRENCHERS launch</p>}
          <div className="mm-row">
            {OPENSEA_URL && <a className="tbtn" href={OPENSEA_URL} target="_blank" rel="noreferrer">OpenSea</a>}
            <CopyCA />
            {TELEGRAM_FEED && <a className="tbtn" href={TELEGRAM_FEED} target="_blank" rel="noreferrer">Telegram</a>}
            <a className="tbtn" href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
            {SOCIALS.x && <a className="tbtn" href={SOCIALS.x} target="_blank" rel="noreferrer">X</a>}
            {SOCIALS.discord && <a className="tbtn" href={SOCIALS.discord} target="_blank" rel="noreferrer">Discord</a>}
            {SOCIALS.telegram && <a className="tbtn" href={SOCIALS.telegram} target="_blank" rel="noreferrer">Telegram</a>}
          </div>
          <div className="mm-wallet">
            {w.address ? (<>
              <span className="mono mm-addr"><span className={`dot ${w.kind === "demo" ? "dot-demo" : ""}`} />{short(w.address)}</span>
              <button type="button" className="tbtn" onClick={() => { w.disconnect(); setOpen(false); }}>Disconnect</button>
            </>) : (
              <button type="button" className="tbtn tbtn-lg" onClick={() => { setOpen(false); w.openModal(); }}>Connect wallet</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
