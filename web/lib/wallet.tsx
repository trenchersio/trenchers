"use client";
import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { BridgeApi, BridgeState } from "./wallet-bridge";

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
  connectBrowser: () => Promise<boolean>;
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
  const api = useRef<BridgeApi | null>(null);
  const waiters = useRef<((a: BridgeApi) => void)[]>([]);

  useEffect(() => {
    setDemo(read(DEMO_KEY));
    setHasBrowserWallet(typeof window !== "undefined" && "ethereum" in window);
    if (read(BROWSER_KEY)) setBridgeOn(true); // reconnect a wallet used on an earlier visit
    setReady(true);
  }, []);

  const onApi = useCallback((a: BridgeApi) => { api.current = a; waiters.current.splice(0).forEach((f) => f(a)); }, []);
  const getApi = () => api.current ? Promise.resolve(api.current) : new Promise<BridgeApi>((r) => { waiters.current.push(r); setBridgeOn(true); });

  const connectBrowser = useCallback(async () => {
    setError(null);
    try {
      const a = await getApi();
      await a.connect();
      write(BROWSER_KEY, "1"); write(DEMO_KEY, null); setDemo(null);
      setModalOpen(false);
      return true;
    } catch (e) {
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
      setError(/not found|provider/i.test(msg) ? "No browser wallet found. Install MetaMask or Rabby, or try the demo wallet." : msg);
      return false;
    }
  }, []);

  const connectDemo = useCallback(() => {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, "0")).join("");
    const addr = `0x${hex}`;
    write(DEMO_KEY, addr); setDemo(addr); setError(null); setModalOpen(false);
  }, []);

  const disconnect = useCallback(() => {
    if (bridge.address) api.current?.disconnect();
    write(BROWSER_KEY, null); write(DEMO_KEY, null); setDemo(null);
  }, [bridge.address]);

  const address = bridge.address ?? demo;
  const kind: Kind | null = bridge.address ? "wallet" : demo ? "demo" : null;

  return (
    <Ctx.Provider value={{
      ready, address: ready ? address : null, kind: ready ? kind : null, hasBrowserWallet, connecting: bridge.connecting, error,
      connectBrowser, connectDemo, disconnect, modalOpen,
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
