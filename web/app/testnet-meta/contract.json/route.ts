import { SITE } from "@/lib/testnet/meta";

export async function GET() {
  return Response.json({
    name: "Trenchers (testnet)",
    description: "Self-funding trading agents with an identity. Testnet collection on Robinhood Chain.",
    image: `${SITE}/icon.png`,
    external_link: SITE,
    seller_fee_basis_points: 500,
  }, { headers: { "Access-Control-Allow-Origin": "*" } });
}
