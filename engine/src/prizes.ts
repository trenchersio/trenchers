import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { formatEther, getAddress, isAddress, parseAbi, type Address, type PublicClient } from "viem";
import { PRIZE_BPS, weekOf, weekStart } from "./trenchies-catalog";

/**
 * The Trenchies weekly prize pot: 5% of the $TRENCHERS creator fees that came in during the week.
 *
 * It watches the creator wallet (the token's creatorFeeRecipient on the Pons factory, or PRIZE_WALLET), plus any
 * creator tax still waiting to be claimed on the token's bonding curve. Every hour it reads both (2 to 3 reads) and
 * adds any increase to this week's fees. Spending from the wallet is ignored, and claiming the curve tax just moves
 * it from one to the other, so neither counts twice. Payouts are sent by the team from that wallet; the engine only
 * works out who won and how much.
 *
 * Settings: PRIZE_WALLET (default: read from Pons), PRIZE_BPS_OVERRIDE (default 500 = 5%), TRENCHERS_TOKEN, PONS_FACTORY.
 */
const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const FILE = clean(process.env.PRIZES_FILE) || `${dirname(clean(process.env.CHAT_FILE) || "./chat.json")}/prizes.json`;
const FACTORY = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
]);
const CURVE = parseAbi(["function creatorTaxBalance() view returns (uint256)"]);

type State = { wallet: Address | null; curve: Address | null; last: string | null; weeks: Record<string, string>; updatedAt: number; since: number };

export class PrizePot {
  private s: State = { wallet: null, curve: null, last: null, weeks: {}, updatedAt: 0, since: 0 };
  readonly bps = Number(clean(process.env.PRIZE_BPS_OVERRIDE)) || PRIZE_BPS;
  error: string | null = null;
  private running = false;

  constructor(private pub: PublicClient, private token: Address, private factory: Address, private log: (m: string) => void) {
    try { if (existsSync(FILE)) this.s = { ...this.s, ...JSON.parse(readFileSync(FILE, "utf8")) }; } catch { /* start fresh */ }
    const w = clean(process.env.PRIZE_WALLET);
    if (w && isAddress(w)) this.s.wallet = getAddress(w);
  }
  private save() { try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(`${FILE}.tmp`, JSON.stringify(this.s)); renameSync(`${FILE}.tmp`, FILE); } catch { /* memory only */ } }

  get wallet() { return this.s.wallet; }
  /** Fees in (wei) during week w, and the pot that makes. */
  feesIn(w: number) { return BigInt(this.s.weeks[w] ?? "0"); }
  potWei(w: number) { return (this.feesIn(w) * BigInt(this.bps)) / 10_000n; }
  view(now = Date.now() / 1000) {
    const w = weekOf(now);
    return { wallet: this.s.wallet, bps: this.bps, week: w, start: weekStart(w), end: weekStart(w + 1), feesEth: formatEther(this.feesIn(w)), potEth: formatEther(this.potWei(w)), potWei: this.potWei(w).toString(), updatedAt: this.s.updatedAt, trackingSince: this.s.since, error: this.error };
  }

  /** Hourly: read the wallet (and the curve's unclaimed tax) and book any increase to this week. */
  async update() {
    if (this.running) return; this.running = true;
    try {
      if (!this.s.wallet || this.s.curve === null) {
        const t = await this.pub.readContract({ address: this.factory, abi: FACTORY, functionName: "getLaunchedToken", args: [this.token] }) as { curve: Address; creatorFeeRecipient: Address; phase: number };
        if (!this.s.wallet) this.s.wallet = getAddress(t.creatorFeeRecipient);
        this.s.curve = t.curve && !/^0x0{40}$/i.test(t.curve) ? getAddress(t.curve) : ("0x0000000000000000000000000000000000000000" as Address);
      }
      const bal = await this.pub.getBalance({ address: this.s.wallet! });
      const tax = this.s.curve && !/^0x0{40}$/i.test(this.s.curve) ? await this.pub.readContract({ address: this.s.curve, abi: CURVE, functionName: "creatorTaxBalance" }).catch(() => 0n) as bigint : 0n;
      const v = bal + tax, w = weekOf(Date.now() / 1000);
      if (this.s.last !== null && v > BigInt(this.s.last)) this.s.weeks[w] = (this.feesIn(w) + (v - BigInt(this.s.last))).toString();
      if (this.s.last === null) this.s.since = Math.floor(Date.now() / 1000);
      this.s.last = v.toString(); this.s.updatedAt = Math.floor(Date.now() / 1000); this.error = null;
      const keep = Object.keys(this.s.weeks).map(Number).sort((a, b) => b - a).slice(0, 26); this.s.weeks = Object.fromEntries(keep.map((k) => [k, this.s.weeks[k]]));
      this.save();
    } catch (e) { this.error = (e as Error).message.split("\n")[0].slice(0, 160); this.log(`prizes: ${this.error}`); }
    finally { this.running = false; }
  }
}
