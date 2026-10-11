import { createHash } from "node:crypto";
import { getAddress, isAddress } from "viem";
import { TRENCHERS_TOKEN } from "@/lib/programmable";
import { limited, readCatalog, relay } from "@/lib/programmable-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const SITE = "https://www.trenchers.io";
const imageHash = new Map<number, string>();

/**
 * Composes a Programmable agent coin launch: always paired with $TRENCHERS, the Trencher's own art as the logo and its
 * collection page as the website (that link is how the coin is tied to the Trencher). Programmable returns the coin's
 * metadata, encoded modules, a fresh starting price and the ETH → $TRENCHERS first-buy route; the browser does the rest.
 */
export async function POST(req: Request) {
  if (limited(req, 12)) return Response.json({ error: "Too many tries, wait a minute." }, { status: 429 });
  let b: any;
  try { b = await req.json(); } catch { return Response.json({ error: "Bad request." }, { status: 400 }); }
  const id = Number(b?.id);
  if (!Number.isInteger(id) || id < 1 || id > 2000) return Response.json({ error: "Unknown Trencher." }, { status: 400 });
  if (!isAddress(b?.account ?? "") || !/^0x[0-9a-fA-F]{64}$/.test(b?.tokenSalt ?? "")) return Response.json({ error: "Bad launch details." }, { status: 400 });
  const name = String(b.name ?? "").trim(), symbol = String(b.symbol ?? "").trim().toUpperCase(), description = String(b.description ?? "").trim();
  if (name.length < 2 || name.length > 32 || !/^[A-Z0-9]{2,10}$/.test(symbol) || description.length > 280) return Response.json({ error: "Check the coin name, ticker and description." }, { status: 400 });
  const fee = Number(b.creatorFeeBps);
  if (!Number.isInteger(fee) || fee < 0 || fee > 1000 || fee % 100 !== 0) return Response.json({ error: "The creator fee is 0% to 10%, in whole percents." }, { status: 400 });
  if (typeof b.initialBuy !== "string" || !/^\d+(\.\d{1,18})?$/.test(b.initialBuy)) return Response.json({ error: "Enter the first buy in ETH." }, { status: 400 });

  let catalog;
  try { catalog = await readCatalog(); } catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Programmable is unavailable." }, { status: 502 }); }
  if (!catalog.available) return Response.json({ error: "Programmable launches are paused right now. Try again later." }, { status: 503 });
  const picked = Array.isArray(b.modules) ? b.modules : [];
  if (picked.length > 8) return Response.json({ error: "Choose at most eight modules." }, { status: 400 });
  const modules = [];
  for (const m of picked) {
    const mod = catalog.modules.find((x) => x.id === m?.id);
    if (!mod || !mod.available) return Response.json({ error: "A chosen module isn't available for new launches." }, { status: 400 });
    const configuration: Record<string, string> = {};
    for (const f of mod.fields) {
      const v = m.configuration?.[f.key];
      if (v === undefined || v === "") { if (f.required && f.default === undefined) return Response.json({ error: `${mod.name}: fill in "${f.label}".` }, { status: 400 }); continue; }
      if (typeof v !== "string" || v.length > 100) return Response.json({ error: `${mod.name}: check "${f.label}".` }, { status: 400 });
      configuration[f.key] = f.kind === "address" ? (isAddress(v) ? getAddress(v) : "") : v;
      if (f.kind === "address" && !configuration[f.key]) return Response.json({ error: `${mod.name}: "${f.label}" must be an address.` }, { status: 400 });
    }
    modules.push({ id: mod.id, version: mod.version, digest: mod.digest, configuration });
  }

  // The Trencher's awake art is the coin's logo (Programmable stores its hash with the launch).
  const imageURI = `${SITE}/meta/img/awake/${id}.png`;
  let sha = imageHash.get(id);
  if (!sha) {
    try {
      const r = await fetch(imageURI, { signal: AbortSignal.timeout(15_000) });
      if (r.ok) { sha = `0x${createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex")}`; imageHash.set(id, sha); }
    } catch { /* fall through */ }
  }
  if (!sha) return Response.json({ error: "Couldn't read this Trencher's art. Try again." }, { status: 502 });

  const socialLinks: Record<string, string> = { website: `${SITE}/collection#${id}` };
  const x = String(b.x ?? "").trim(), tg = String(b.telegram ?? "").trim();
  if (x) socialLinks.twitter = x;
  if (tg) socialLinks.telegram = tg;

  return relay("/api/module-foundation/compose", {
    account: getAddress(b.account), releaseDigest: catalog.releaseDigest, tokenSalt: b.tokenSalt,
    draft: {
      name, symbol, description, image: { url: imageURI, sha256: sha }, socialLinks,
      quoteAsset: TRENCHERS_TOKEN, creatorFeeBps: fee, initialBuy: b.initialBuy, additionalLiquidity: "0", modules,
    },
    launchFlow: "single-eth-v1", chainId: 4663,
  });
}
