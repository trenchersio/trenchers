/**
 * Server side of Programmable launches: reads Programmable's live launch release and module catalog, and relays the
 * compose and confirm calls (Programmable's API doesn't accept browser calls from other sites, so our server makes them).
 * Nothing here signs or holds keys: the holder's wallet signs the launch in the browser.
 */
import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { FieldKind, ModuleField, ProgrammableCatalog, ProgrammableModule } from "./programmable";

export const UPSTREAM = process.env.PROGRAMMABLE_API_URL || "https://programmable.market";
const HEX32 = /^0x[0-9a-fA-F]{64}$/;

/** Modules Programmable itself holds back from new launches (they need separate keeper/payout transactions). */
const COMING_SOON = new Set(["buyback-burn", "dip-buyback", "lp-rewards", "full-range-lp", "buyer-rewards", "nth-buy-pot", "king-of-the-hill"]
  .map((family) => keccak256(toHex(`programmable.foundation.${family}.v1`))));

type Node = { type: string; label?: string; help?: string; unit?: string; min?: string; max?: string; binding?: { mode: string }; fields?: Record<string, Node>; required?: string[] };
type Entry = {
  manifest: { packageId: Hex; sourceDescriptor: { name: string; version: string; configuration: Node; management?: { summary?: string }; extensions: Record<string, any> } };
  review: { manifestHash: Hex } | null;
  release: { chainId: number; manifestHash: Hex; hostAdapterId: string } | null;
};

function fieldsOf(schema: Node, defaults: Record<string, unknown> | undefined): ModuleField[] {
  const out: ModuleField[] = [];
  const visit = (node: Node, path: string[], dflt: unknown, required: boolean) => {
    if (node.binding?.mode === "fixed") return;
    if (node.type === "record") {
      for (const [name, child] of Object.entries(node.fields ?? {}))
        visit(child, [...path, name], dflt && typeof dflt === "object" ? (dflt as Record<string, unknown>)[name] : undefined, required && (node.required ?? []).includes(name));
      return;
    }
    let kind: FieldKind;
    if (node.type === "uint") kind = node.unit === "programmable.percent-bps" ? "percent" : node.unit === "programmable.quote-amount" ? "quote" : node.unit === "programmable.token-amount" ? "token" : "integer";
    else if (["address", "account", "component", "asset"].includes(node.type)) kind = "address";
    else return; // structured inputs (lists, variants, bytes) aren't offered on our page
    const d = typeof dflt === "string" || typeof dflt === "number" ? String(dflt) : undefined;
    out.push({ key: `/${path.join("/")}`, label: node.label ?? path.join(" / "), help: node.help, kind, unit: node.unit, min: node.min, max: node.max, default: d, required });
  };
  visit(schema, [], defaults, true);
  return out;
}

let cache: { at: number; catalog: ProgrammableCatalog } | null = null;

/** Programmable's live release and catalog for Robinhood Chain, as display-safe data (cached 60 s). */
export async function readCatalog(): Promise<ProgrammableCatalog> {
  if (cache && Date.now() - cache.at < 60_000) return cache.catalog;
  const r = await fetch(`${UPSTREAM}/api/module-foundation?chainId=4663`, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`Programmable is unavailable right now (${r.status}).`);
  const j = await r.json();
  const b = j.binding;
  if (!b || !HEX32.test(b.releaseDigest)) throw new Error("Programmable didn't return a launch release.");
  const modules: ProgrammableModule[] = (j.catalog?.document?.entries ?? []).flatMap((e: Entry) => {
    const sd = e.manifest?.sourceDescriptor, x = sd?.extensions?.["programmable.module-foundation@1"];
    if (!sd || !x || !e.release || !e.review) return [];
    // Only exact, released, reviewed versions for this chain (the same manifest hash in both records).
    if (e.release.chainId !== 4663 || e.release.manifestHash !== e.review.manifestHash || !HEX32.test(e.release.manifestHash)) return [];
    const soon = COMING_SOON.has(String(x.descriptor?.moduleId ?? "").toLowerCase() as Hex);
    const fields = fieldsOf(sd.configuration, x.defaults);
    return [{
      id: e.manifest.packageId, version: sd.version, digest: e.release.manifestHash, name: sd.name,
      summary: sd.management?.summary ?? "", category: sd.extensions?.["programmable.module-studio@1"]?.category ?? "trading",
      available: !soon, comingSoon: soon, fields,
    }];
  });
  const catalog: ProgrammableCatalog = {
    available: !!j.available, reason: j.reason ?? null, releaseDigest: b.releaseDigest, factoryVersion: b.factoryVersion === "v3" ? "v3" : "v2",
    factory: getAddress(b.factory.address) as Address, hookDeployer: getAddress(b.hookDeployer.address) as Address,
    modules: modules.sort((a, z) => Number(z.available) - Number(a.available) || a.name.localeCompare(z.name)),
  };
  cache = { at: Date.now(), catalog };
  return catalog;
}

/** Relays a JSON POST to Programmable (server to server, no browser origin). */
export async function relay(path: string, body: unknown, timeoutMs = 90_000): Promise<Response> {
  const r = await fetch(`${UPSTREAM}${path}`, {
    method: "POST", cache: "no-store", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await r.text();
  return new Response(text, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/** A tiny per-IP limiter for the relay routes. */
const hits = new Map<string, number[]>();
export function limited(req: Request, perMinute: number): boolean {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local", now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= perMinute) return true;
  hits.set(ip, [...recent, now]);
  if (hits.size > 5000) hits.clear();
  return false;
}
