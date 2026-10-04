"use client";
import { useEffect, useState } from "react";
import type { EIP1193Provider } from "viem";

/**
 * Finds every browser wallet installed (MetaMask, Phantom, Rabby, Coinbase, ...) through EIP-6963,
 * so people pick the wallet they want instead of whichever extension grabbed window.ethereum.
 */
export type WalletInfo = { uuid: string; name: string; icon: string; rdns: string };
export type InjectedWallet = { info: WalletInfo; provider: EIP1193Provider };

const found = new Map<string, InjectedWallet>();
const listeners = new Set<() => void>();
let started = false;

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    const d = (e as CustomEvent<InjectedWallet>).detail;
    if (!d?.info?.rdns || !d.provider) return;
    found.set(d.info.rdns, d);
    listeners.forEach((l) => l());
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  // Wallets that don't speak EIP-6963 yet still expose window.ethereum.
  setTimeout(() => {
    const legacy = (window as unknown as { ethereum?: EIP1193Provider & { isMetaMask?: boolean; isPhantom?: boolean; isRabby?: boolean } }).ethereum;
    if (legacy && found.size === 0) {
      const name = legacy.isPhantom ? "Phantom" : legacy.isRabby ? "Rabby" : legacy.isMetaMask ? "MetaMask" : "Browser wallet";
      found.set("injected", { info: { uuid: "injected", name, icon: "", rdns: "injected" }, provider: legacy });
      listeners.forEach((l) => l());
    }
  }, 400);
}

export function getWallet(rdns: string | null | undefined) {
  start();
  return rdns ? found.get(rdns) ?? null : null;
}

/** Waits briefly for a remembered wallet to announce itself after page load. */
export function waitForWallet(rdns: string, ms = 1200): Promise<InjectedWallet | null> {
  start();
  const hit = found.get(rdns);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const done = () => { const w = found.get(rdns); if (w) { listeners.delete(done); clearTimeout(t); resolve(w); } };
    const t = setTimeout(() => { listeners.delete(done); resolve(found.get(rdns) ?? null); }, ms);
    listeners.add(done);
  });
}

export function useInjectedWallets() {
  const [list, setList] = useState<InjectedWallet[]>([]);
  useEffect(() => {
    start();
    const update = () => setList([...found.values()].sort((a, b) => rank(a) - rank(b)));
    update();
    listeners.add(update);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => { listeners.delete(update); };
  }, []);
  return list;
}

const ORDER = ["io.metamask", "app.phantom", "io.rabby", "com.coinbase.wallet"];
const rank = (w: InjectedWallet) => { const i = ORDER.indexOf(w.info.rdns); return i < 0 ? 99 : i; };

/** Deep links that open this page inside a phone wallet's built-in browser. */
export function mobileLinks(href: string) {
  const u = new URL(href);
  return [
    { name: "MetaMask", url: `https://metamask.app.link/dapp/${u.host}${u.pathname}${u.search}` },
    { name: "Phantom", url: `https://phantom.app/ul/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(u.origin)}` },
  ];
}

/** Best-effort disconnect: MetaMask and others support revoking the site's account permission. */
export async function revoke(provider: EIP1193Provider) {
  try { await provider.request({ method: "wallet_revokePermissions" as never, params: [{ eth_accounts: {} }] as never }); } catch { /* not supported: forgetting it locally is enough */ }
}

/** Opens the wallet's account chooser so the person can switch or add accounts. */
export async function chooseAccount(provider: EIP1193Provider) {
  await provider.request({ method: "wallet_requestPermissions" as never, params: [{ eth_accounts: {} }] as never });
  return (await provider.request({ method: "eth_accounts" })) as `0x${string}`[];
}
