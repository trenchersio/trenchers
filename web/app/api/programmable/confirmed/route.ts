import { isAddress } from "viem";
import { limited, relay } from "@/lib/programmable-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tells Programmable about a confirmed launch so the coin shows up on programmable.market straight away. */
export async function POST(req: Request) {
  if (limited(req, 10)) return Response.json({ error: "Too many requests." }, { status: 429 });
  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "Bad request." }, { status: 400 }); }
  if (!isAddress(b?.token ?? "") || !/^0x[0-9a-fA-F]{64}$/.test(b?.transactionHash ?? "")) return Response.json({ error: "Bad request." }, { status: 400 });
  return relay("/api/module-foundation/confirmed", { chainId: 4663, token: b.token, transactionHash: b.transactionHash }, 30_000);
}
