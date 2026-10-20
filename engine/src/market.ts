import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Trenchers listed for sale on OpenSea, for the site's Market page (which puts each price next to what the agent
 * holds and how it trades). Read from OpenSea's API every 10 minutes; no chain reads.
 *
 * Needs OPENSEA_API_KEY (a free key from OpenSea, kept in Railway). OPENSEA_SLUG is the collection (default trenchersio).
 */
type Listing = { id: number; price: number; currency: string; seller: string; url: string };
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

export class Market {
  private listings: Listing[] = [];
  updatedAt = 0;
  status = "off (set OPENSEA_API_KEY)";
  private key = clean(process.env.OPENSEA_API_KEY);
  private slug = clean(process.env.OPENSEA_SLUG) || "trenchersio";
  private chain = clean(process.env.OPENSEA_CHAIN) || "robinhood";

  constructor(private nft: string) {
    if (this.key) { this.status = "starting"; void this.update(); setInterval(() => void this.update(), 600_000); }
  }

  private async update() {
    try {
      const out: Listing[] = []; let next: string | undefined; let pages = 0;
      do {
        const u = new URL(`https://api.opensea.io/api/v2/listings/collection/${this.slug}/best`);
        u.searchParams.set("limit", "100"); if (next) u.searchParams.set("next", next);
        const r = await fetch(u, { headers: { accept: "application/json", "x-api-key": this.key }, signal: AbortSignal.timeout(20_000) });
        if (!r.ok) throw new Error(`OpenSea answered ${r.status}${r.status === 401 ? " (check OPENSEA_API_KEY)" : ""}`);
        const j = (await r.json()) as { listings?: { price?: { current?: { currency?: string; decimals?: number; value?: string } }; protocol_data?: { parameters?: { offerer?: string; offer?: { identifierOrCriteria?: string }[] } } }[]; next?: string };
        for (const l of j.listings ?? []) {
          const id = Number(l.protocol_data?.parameters?.offer?.[0]?.identifierOrCriteria);
          const c = l.price?.current;
          if (!Number.isInteger(id) || id < 1 || id > 2000 || !c?.value) continue;
          const price = Number(c.value) / 10 ** (c.decimals ?? 18);
          if (!(price > 0)) continue;
          out.push({ id, price, currency: c.currency ?? "ETH", seller: (l.protocol_data?.parameters?.offerer ?? "").toLowerCase(), url: `https://opensea.io/item/${this.chain}/${this.nft}/${id}` });
        }
        next = j.next; pages++;
      } while (next && pages < 20);
      // The cheapest listing per Trencher.
      const best = new Map<number, Listing>();
      for (const l of out) { const b = best.get(l.id); if (!b || l.price < b.price) best.set(l.id, l); }
      this.listings = [...best.values()].sort((a, b) => a.price - b.price);
      this.updatedAt = Date.now(); this.status = `ok: ${this.listings.length} listed`;
    } catch (e) { this.status = `update failed: ${(e as Error).message.split("\n")[0].slice(0, 120)}`; }
  }

  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    if (path !== "/market") return false;
    res.setHeader("cache-control", "public, max-age=60");
    res.end(JSON.stringify({ ready: !!this.key, updatedAt: this.updatedAt, listings: this.listings }));
    return true;
  }
}
