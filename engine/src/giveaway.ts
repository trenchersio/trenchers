import { formatEther, getAddress, isAddress, type Address, type PublicClient } from "viem";
import { FACTORY } from "./prizes";

/**
 * The giveaway prize pool shown on trenchers.io/trenchies: the ETH in the wallet that deployed $TRENCHERS, plus a
 * number of Trencher NFTs. The deployer is read once from the Pons factory (or GIVEAWAY_WALLET), then its balance
 * every 10 minutes: one small read each time.
 *
 * Settings: GIVEAWAY_WALLET (default: the token's deployer on Pons), GIVEAWAY_NFTS (default 10).
 */
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

export class Giveaway {
  wallet: Address | null = null;
  wei: bigint | null = null;
  updatedAt = 0;
  error: string | null = null;
  readonly nfts = Math.max(0, Math.floor(Number(clean(process.env.GIVEAWAY_NFTS) || 10)));

  constructor(private pub: PublicClient, private token: Address, private factory: Address, private log: (m: string) => void) {
    const w = clean(process.env.GIVEAWAY_WALLET);
    if (w && isAddress(w)) this.wallet = getAddress(w);
  }
  async update() {
    try {
      if (!this.wallet) {
        const t = await this.pub.readContract({ address: this.factory, abi: FACTORY, functionName: "getLaunchedToken", args: [this.token] }) as { deployer: Address };
        if (!t.deployer || /^0x0{40}$/i.test(t.deployer)) throw new Error("the factory has no deployer for this token");
        this.wallet = getAddress(t.deployer);
      }
      this.wei = await this.pub.getBalance({ address: this.wallet });
      this.updatedAt = Math.floor(Date.now() / 1000); this.error = null;
    } catch (e) { this.error = (e as Error).message.split("\n")[0].slice(0, 160); this.log(`giveaway: ${this.error}`); }
  }
  view() { return { wallet: this.wallet, eth: this.wei === null ? null : formatEther(this.wei), nfts: this.nfts, updatedAt: this.updatedAt, error: this.error }; }
}
