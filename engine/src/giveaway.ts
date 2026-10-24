import { formatEther, getAddress, isAddress, type Address, type PublicClient } from "viem";
import { FACTORY } from "./prizes";
const ERC20_BAL = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

/**
 * The giveaway prize pool shown on trenchers.io/trenchies: the $TRENCHERS in the wallet that deployed $TRENCHERS,
 * shown in USD (the live Pons price in ETH, times ETH/USD from Coinbase's public ticker), plus a number of Trencher
 * NFTs. Prices are read every 5 minutes. The deployer is read once from the Pons factory (or GIVEAWAY_WALLET), then its balance
 * every minute: one small read each time.
 *
 * Settings: GIVEAWAY_WALLET (default: the token's deployer on Pons), GIVEAWAY_NFTS (default 10).
 */
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

export class Giveaway {
  wallet: Address | null = null;
  wei: bigint | null = null;
  /** $TRENCHERS held by the wallet, and its price in ETH per token (spot). */
  tokens: bigint | null = null;
  price: number | null = null;
  private priceAt = 0;
  ethUsd: number | null = null;
  private ethUsdAt = 0;
  updatedAt = 0;
  error: string | null = null;
  readonly nfts = Math.max(0, Math.floor(Number(clean(process.env.GIVEAWAY_NFTS) || 10)));

  constructor(private pub: PublicClient, private token: Address, private factory: Address, private log: (m: string) => void, private priceOf?: (token: Address) => Promise<number | null>) {
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
      const [wei, held] = await Promise.all([
        this.pub.getBalance({ address: this.wallet }),
        this.pub.readContract({ address: this.token, abi: ERC20_BAL, functionName: "balanceOf", args: [this.wallet] }).catch(() => null) as Promise<bigint | null>,
      ]);
      this.wei = wei; if (held !== null) this.tokens = held;
      if (Date.now() - this.ethUsdAt > 300_000) {
        const j = await fetch("https://api.exchange.coinbase.com/products/ETH-USD/ticker", { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => null) as { price?: string } | null;
        const v = Number(j?.price); if (v > 0) { this.ethUsd = v; this.ethUsdAt = Date.now(); }
      }
      if (this.priceOf && Date.now() - this.priceAt > 300_000) { const p = await this.priceOf(this.token).catch(() => null); if (p !== null && p > 0) { this.price = p; this.priceAt = Date.now(); } }
      this.updatedAt = Math.floor(Date.now() / 1000); this.error = null;
    } catch (e) { this.error = (e as Error).message.split("\n")[0].slice(0, 160); this.log(`giveaway: ${this.error}`); }
  }
  view() {
    const trenchers = this.tokens === null ? null : Number(formatEther(this.tokens));
    const trenchersEth = trenchers !== null && this.price !== null ? trenchers * this.price : null;
    const eth = this.wei === null ? null : Number(formatEther(this.wei));
    return {
      wallet: this.wallet, eth: this.wei === null ? null : formatEther(this.wei), nfts: this.nfts, updatedAt: this.updatedAt, error: this.error,
      trenchers, trenchersEth, priceEth: this.price, totalEth: eth === null ? null : eth + (trenchersEth ?? 0),
      ethUsd: this.ethUsd, usd: trenchersEth !== null && this.ethUsd !== null ? trenchersEth * this.ethUsd : null,
    };
  }
}
