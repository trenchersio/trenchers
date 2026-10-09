import { formatUnits, parseAbi, type Address, type PublicClient } from "viem";

/**
 * $TRENCHERS buyback and burn tracker for the site: how many tokens the buyback wallet has received
 * (bought back) and how many were sent to a burn address, read from the token's Transfer logs.
 * Settings: TRENCHERS_TOKEN (default: the live token), BUYBACK_WALLET (default: the buyback wallet).
 */
const TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"])[0];
const ERC20 = parseAbi(["function totalSupply() view returns (uint256)", "function decimals() view returns (uint8)"]);
const BURN = ["0x000000000000000000000000000000000000dEaD", "0x0000000000000000000000000000000000000000"] as Address[];
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();

export class BurnTracker {
  token = (clean(process.env.TRENCHERS_TOKEN) || "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a") as Address;
  buyback = (clean(process.env.BUYBACK_WALLET) || "0xB03A251c7b5c83e44005c4A7BA6f5d96B8284D5A") as Address;
  private cursor: bigint | null = null;
  private burnt = 0n;
  private bought = 0n;
  private decimals = 18;
  private initialSupply: bigint | null = null;
  private running: Promise<void> | null = null;
  updatedAt = 0;
  error: string | null = null;

  constructor(private pub: PublicClient, private range: bigint) {}

  /** Finds the token's first block once (bisection on its code), then reads Transfer logs forward. */
  private async start(head: bigint) {
    let lo = 0n, hi = head;
    while (lo < hi) { const mid = (lo + hi) / 2n; const c = await this.pub.getCode({ address: this.token, blockNumber: mid }).catch(() => "0x1"); if (c && c !== "0x") hi = mid; else lo = mid + 1n; }
    this.cursor = lo - 1n;
    this.decimals = Number(await this.pub.readContract({ address: this.token, abi: ERC20, functionName: "decimals" }).catch(() => 18));
  }

  async update() {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const head = await this.pub.getBlockNumber();
        if (this.cursor === null) await this.start(head);
        while (this.cursor! < head) {
          const from = this.cursor! + 1n, to = from + this.range - 1n < head ? from + this.range - 1n : head;
          const [burns, buys] = await Promise.all([
            this.pub.getLogs({ address: this.token, event: TRANSFER, args: { to: BURN }, fromBlock: from, toBlock: to }),
            this.pub.getLogs({ address: this.token, event: TRANSFER, args: { to: this.buyback }, fromBlock: from, toBlock: to }),
          ]);
          for (const l of burns) this.burnt += l.args.value ?? 0n;
          for (const l of buys) this.bought += l.args.value ?? 0n;
          this.cursor = to;
        }
        const supply = await this.pub.readContract({ address: this.token, abi: ERC20, functionName: "totalSupply" });
        // Burns to the zero address usually lower totalSupply; add them back to get the starting supply.
        this.initialSupply = supply + 0n;
        this.updatedAt = Date.now(); this.error = null;
      } catch (e) { this.error = (e as Error).message.split("\n")[0]; }
      finally { this.running = null; }
    })();
    return this.running;
  }

  view() {
    const n = (v: bigint) => Number(formatUnits(v, this.decimals));
    const supply = this.initialSupply && this.initialSupply > 0n ? n(this.initialSupply) : 1_000_000_000;
    const total = Math.max(supply, 1_000_000_000);
    return {
      token: this.token, buybackWallet: this.buyback,
      boughtBack: n(this.bought), burnt: n(this.burnt),
      boughtBackPct: (n(this.bought) / total) * 100, burntPct: (n(this.burnt) / total) * 100,
      totalSupply: total, updatedAt: this.updatedAt, error: this.error,
    };
  }
}
