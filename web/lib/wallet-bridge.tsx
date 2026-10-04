"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WagmiProvider, useAccount, useConnect, useDisconnect } from "wagmi";
import { wagmiConfig } from "./config";

/** Loaded on demand by WalletProvider: the only place wagmi runs. */
export type BridgeState = { address: string | null; connecting: boolean };
export type BridgeApi = { connect: () => Promise<void>; disconnect: () => void };

export function WalletBridge({ onState, onApi }: { onState: (s: BridgeState) => void; onApi: (a: BridgeApi) => void }) {
  const [client] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <Inner onState={onState} onApi={onApi} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function Inner({ onState, onApi }: { onState: (s: BridgeState) => void; onApi: (a: BridgeApi) => void }) {
  const account = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  useEffect(() => { onState({ address: account.address ?? null, connecting: isPending }); }, [account.address, isPending, onState]);
  useEffect(() => {
    onApi({
      connect: async () => {
        const c = connectors[0];
        if (!c) throw new Error("No browser wallet found.");
        await connectAsync({ connector: c });
      },
      disconnect: () => disconnect(),
    });
  }, [connectors, connectAsync, disconnect, onApi]);
  return null;
}
