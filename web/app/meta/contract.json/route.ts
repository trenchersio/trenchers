import { SITE } from "@/lib/testnet/meta";

/** Collection-level metadata (contractURI) for OpenSea and other marketplaces. */
export async function GET() {
  return Response.json({
    name: "Trenchers",
    description: "Self-funding trading agents with an identity. 2,000 AI trading agents on Robinhood Chain: every Trencher is an NFT with its own agent wallet, rules and track record. Mint on trenchers.io.",
    image: `${SITE}/brand/avatar.png`,
    banner_image: `${SITE}/brand/banner.png`,
    external_link: SITE,
    seller_fee_basis_points: 500,
  }, { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
