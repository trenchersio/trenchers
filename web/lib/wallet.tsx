"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

/**
 * One place for "who is connected". A real browser wallet comes from wagmi; the demo wallet is a
 * made-up address so the site can be tried before contracts are deployed or without a wallet.
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

const Ctx = createContext<Wallet | null>(null);
const DEMO_KEY = "trenchers-demo-wallet";
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

export function WalletProvider({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [hasBrowserWallet, setHasBrowserWallet] = useState(false);

  useEffect(() => {
    setDemo(read(DEMO_KEY));
    setHasBrowserWallet(typeof window !== "undefined" && "ethereum" in window);
    setReady(true);
  }, []);

  const connectBrowser = useCallback(async () => {
    setError(null);
    const c = connectors[0];
    if (!c) { setError("No browser wallet found."); return false; }
    try {
      await connectAsync({ connector: c });
      write(DEMO_KEY, null); setDemo(null);
      setModalOpen(false);
      return true;
    } catch (e) {
      const msg = (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message;
      setError(/not found|provider/i.test(msg) ? "No browser wallet found. Install MetaMask or Rabby, or try the demo wallet." : msg);
      return false;
    }
  }, [connectAsync, connectors]);

  const connectDemo = useCallback(() => {
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, "0")).join("");
    const addr = `0x${hex}`;
    write(DEMO_KEY, addr); setDemo(addr); setError(null); setModalOpen(false);
  }, []);

  const disconnect = useCallback(() => {
    if (account.isConnected) wagmiDisconnect();
    write(DEMO_KEY, null); setDemo(null);
  }, [account.isConnected, wagmiDisconnect]);

  const address = account.address ?? demo;
  const kind: Kind | null = account.address ? "wallet" : demo ? "demo" : null;

  return (
    <Ctx.Provider value={{
      ready, address: ready ? address : null, kind: ready ? kind : null, hasBrowserWallet, connecting: isPending, error,
      connectBrowser, connectDemo, disconnect, modalOpen,
      openModal: () => { setError(null); setModalOpen(true); }, closeModal: () => setModalOpen(false),
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
