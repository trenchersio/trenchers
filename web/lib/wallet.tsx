"use client";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { BridgeApi, BridgeState } from "./wallet-bridge";
import { getWallet, revoke, waitForWallet } from "./eip6963";

/**
 * One place for "who is connected". A real browser wallet comes from wagmi; the demo wallet is a
 * made-up address so the site can be tried before contracts are deployed or without a wallet.
 *
 * wagmi is heavy, so it is only loaded once it is needed: when someone opens the connect dialog,
 * or when they connected a browser wallet on an earlier visit. Every other page view skips it.
 */
type Kind = "wallet" | "demo";
type Wallet = {
  ready: boolean;
  address: string | null;
  kind: Kind | null;
  hasBrowserWallet: boolean;
  connecting: boolean;
  error: string | null;
  connectBrowser: (rdns?: string) => Promise<boolean>;
  pendingWallet: string | null;
  connectDemo: () => void;
  disconnect: () => void;
  modalOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
};

const Bridge = dynamic(() => import("./wallet-bridge").then((m) => m.WalletBridge), { ssr: false });

const Ctx = createContext<Wallet | null>(null);
const DEMO_KEY = "trenchers-demo-wallet";
const BROWSER_KEY = "trenchers-browser-wallet";
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

export function WalletProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [hasBrowserWallet, setHasBrowserWallet] = useState(false);
  const [bridgeOn, setBridgeOn] = useState(false);
  const [bridge, setBridge] = useState<BridgeState>({ address: null, connecting: false });
  // A wallet connected on an earlier visit, found with a silent eth_accounts check (never a popup).
  const [quiet, setQuiet] = useState<string | null>(null);
  const api = useRef<BridgeApi | null>(null);
  const waiters = useRef<((a: BridgeApi) => void)[]>([]);

  useEffect(() => {
    setDemo(read(DEMO_KEY));
    setHasBrowserWallet(typeof window !== "undefined" && "ethereum" in window);
    const rdns = read(BROWSER_KEY);
    if (rdns && rdns !== "1") {
      waitForWallet(rdns).then(async (w) => {
        if (!w) return;
        const accs = (await w.provider.request({ method: "eth_accounts" }).catch(() => [])) as string[];
        if (accs[0]) setQuiet(accs[0]);
        w.provider.on?.("accountsChanged", ((a: string[]) => setQuiet(a[0] ?? null)) as never);
      });
    }
    setReady(true);
  }, []);

  const onApi = useCallback((a: BridgeApi) => { api.current = a; waiters.current.splice(0).forEach((f) => f(a)); }, []);
  const getApi = () => api.current ? Promise.resolve(api.current) : new Promise<BridgeApi>((r) => { waiters.current.push(r); setBridgeOn(true); });

  const [pendingWallet, setPendingWallet] = useState<string | null>(null);
  const connectBrowser = useCallback(async (rdns?: string) => {
    setError(null); setPendingWallet(rdns ?? "injected");
    try {
      const a = await getApi();
      await a.connect(rdns);
      setPendingWallet(null); setQuiet(null);
      write(BROWSER_KEY, rdns ?? "injected"); write(DEMO_KEY, null); setDemo(null);
      setModalOpen(false);
      return true;
    } catch (e) {
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
      setError(/not found|provider/i.test(msg) ? "No browser wallet found. Install MetaMask or Phantom, or try the demo wallet." : /rejected|denied/i.test(msg) ? "Connection cancelled in the wallet." : msg);
      setPendingWallet(null);
      return false;
    }
  }, []);

  const connectDemo = useCallback(() => {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, "0")).join("");
    const addr = `0x${hex}`;
    write(DEMO_KEY, addr); setDemo(addr); setError(null); setModalOpen(false);
  }, []);

  const disconnect = useCallback(() => {
    if (bridge.address || quiet) {
      api.current?.disconnect();
      const w = getWallet(read(BROWSER_KEY));
      if (w) revoke(w.provider);
    }
    setQuiet(null);
    write(BROWSER_KEY, null); write(DEMO_KEY, null); setDemo(null);
  }, [bridge.address, quiet]);

  const address = bridge.address ?? quiet ?? demo;
  const kind: Kind | null = bridge.address || quiet ? "wallet" : demo ? "demo" : null;

  return (
    <Ctx.Provider value={{
      ready, address: ready ? address : null, kind: ready ? kind : null, hasBrowserWallet, connecting: bridge.connecting, error,
      connectBrowser, connectDemo, disconnect, modalOpen, pendingWallet,
      openModal: () => { setError(null); setModalOpen(true); setBridgeOn(true); }, closeModal: () => setModalOpen(false),
    }}>
      {children}
      {bridgeOn && <Bridge onState={setBridge} onApi={onApi} />}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
