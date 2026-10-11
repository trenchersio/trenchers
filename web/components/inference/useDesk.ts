"use client";
import { useEffect, useState } from "react";
import { deskApi, type Model, type Rate, type Stats } from "@/lib/inference";
import type { Fill, Order } from "@/lib/inference-contracts";

export type Desk = {
  rate: Rate | null;
  rateFailed: boolean;
  stats: Stats | null;
  models: Model[] | null;
  modelsFailed: boolean;
  orders: Order[] | null;
  fills: Fill[];
  reloadOrders: () => void;
  mock: boolean;
};

/** Everything public the page shows, read once on load (the book again every 20 seconds). */
export function useDesk(): Desk {
  const [rate, setRate] = useState<Rate | null>(null);
  const [rateFailed, setRateFailed] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [models, setModels] = useState<Model[] | null>(null);
  const [modelsFailed, setModelsFailed] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [fills, setFills] = useState<Fill[]>([]);
  const [tick, setTick] = useState(0);
  const [mock, setMock] = useState(false);

  useEffect(() => {
    deskApi<Rate & { mock?: boolean }>("").then((r) => { setRate(r); setMock(r.mock === true); }).catch(() => setRateFailed(true));
    deskApi<Stats>("/stats").then(setStats).catch(() => setStats(null));
    deskApi<{ data?: Model[] }>("/v1/models").then((j) => setModels(Array.isArray(j.data) ? j.data : [])).catch(() => setModelsFailed(true));
    const t = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    deskApi<{ orders: Order[]; fills?: Fill[] }>("/otc/orders").then((j) => { setOrders(j.orders ?? []); setFills(j.fills ?? []); }).catch(() => setOrders((o) => o ?? []));
  }, [tick]);

  return { rate, rateFailed, stats, models, modelsFailed, orders, fills, reloadOrders: () => setTick((n) => n + 1), mock };
}
