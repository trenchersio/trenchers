"use client";
import { useEffect, useState } from "react";
import { CopyCA } from "@/components/CopyCA";
import { CHAT_OPEN, GITHUB_URL, OPENSEA_URL, ROUTES, SOCIALS, TELEGRAM_FEED } from "@/lib/constants";
import { useChatUnread } from "@/lib/chat-unread";
import { short, useWallet } from "@/lib/wallet";

type Page = "home" | "arena" | "agents" | "docs" | "collection" | "mint" | "coins" | "chat" | "playground" | "inference" | "builder";

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
  const links: [Page | "github" | "x" | string, string, string][] = builder ? [
    ["b-top", "Overview", "?#top"], ["b-launch", "Launch a coin", "?#launch"], ["b-explore", "Explore coins", "?#explore"], ["b-modules", "Modules", "?#modules"],
    ["b-how", "How it works", "?#how"], ["docs", "Docs", `${ROUTES.docs}#trenchers-v4-builder`],
  ] : inference ? [
    ["inf-top", "Overview", "#top"], ["inf-buy", "Buy credit", "#buy"], ["inf-models", "Models", "#models"], ["inf-p2p", "P2P market", "#p2p"],
    ["inf-account", "Account and keys", "#account"], ["inf-start", "Get $TRENCHERS", "#start"], ["docs", "Docs", `${ROUTES.docs}#trenchers-inference-markets`],
  ] : [
    ["home", "Home", ROUTES.home], ["mint", "Mint", ROUTES.mint], ["arena", "Arena", ROUTES.arena], ["collection", "Collection", ROUTES.collection], ["coins", "Agent coins", ROUTES.coins],
    ["docs", "Docs", ROUTES.docs], ["agents", "NFT / Agent Profile", ROUTES.agents], ["playground", "Playground", ROUTES.playground],
    ...(CHAT_OPEN ? [["chat", "Holders' chat", ROUTES.chat] as [Page, string, string]] : []),
  ];
  return (
    <div className="mm">
      <button type="button" className={`tbtn${open ? " tbtn-on" : ""}`} aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen((o) => !o)}>
        {open ? "Close" : "Menu"}{!open && chatUnread && <span className="nd-dot" aria-label="new messages" />}
      </button>
      {open && (
        <div id="mobile-menu" className="mm-panel">
          <div className="mm-switch" role="group" aria-label="Trenchers sections">
            <a href={ROUTES.home} className={!inference && !builder ? "on" : undefined}>AI Agents</a>
            <a href={ROUTES.inference} className={inference ? "on on-i" : undefined}>Inference</a>
            <a href={ROUTES.builder} className={builder ? "on on-b" : undefined}>V4 Builder</a>
          </div>
          <nav aria-label="Pages">
            {links.map(([k, label, href]) => (
              <a key={k} href={href} className={page === k ? "on" : undefined} onClick={() => setOpen(false)}>
                <span className="mono">{label}{k === "chat" && chatUnread && <span className="nd-new mono">new</span>}</span><span aria-hidden="true">→</span>
              </a>
            ))}
          </nav>
          {!CHAT_OPEN && !inference && !builder && <p className="mm-soon mono">Holders&apos; chat · opens after the $TRENCHERS launch</p>}
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
