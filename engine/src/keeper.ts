import { formatEther, parseAbi, type Address, type Hash, type PublicClient } from "viem";
import { ENV } from "./env";

/**
 * Upkeep for the $TRENCHERS fee distributor (10% of $TRENCHERS fees, shared by awake agents):
 * enrols every awake agent, closes each weekly epoch and pays every agent its share into its wallet.
 * All three calls are open to anyone; the engine does them so nobody has to remember.
 */
export const DIST_ABI = parseAbi([
  "function epoch() view returns (uint256)",
  "function epochStart() view returns (uint256)",
  "function EPOCH() view returns (uint256)",
  "function activeAgents() view returns (uint256)",
  "function joiningNext() view returns (uint256)",
  "function reserved() view returns (uint256)",
  "function enrolledFrom(uint256) view returns (uint256)",
  "function sharePerAgent(uint256) view returns (uint256)",
  "function paid(uint256, uint256) view returns (bool)",
  "function enroll(uint256 tokenId)",
  "function closeEpoch()",
  "function pay(uint256 closedEpoch, uint256[] tokenIds)",
]);

type Host = {
  pub: PublicClient;
  agents: Map<Address, { id: number }>;
  log: (m: string) => void;
  engineAddress: Address | null;
  sendTo: (address: Address, abi: readonly unknown[], fn: string, args: readonly unknown[]) => Promise<Hash | null>;
};

export class FeeKeeper {
  last = 0;
  state: { epoch: number; endsAt: number; enrolled: number; joiningNext: number; potEth: string; lastPaid: string | null } | null = null;
  private skip = new Map<number, number>(); // ids that can't be enrolled yet (not awake): retry after a while
  constructor(private host: Host) {}

  async run() {
    this.last = Date.now();
    const D = ENV.DIST!, c = this.host.pub;
    const read = <T>(fn: string, args: readonly unknown[] = []) => c.readContract({ address: D, abi: DIST_ABI, functionName: fn as never, args: args as never }) as Promise<T>;
    const canSend = !!this.host.engineAddress && !ENV.DRY_RUN;
    const ids = [...new Set([...this.host.agents.values()].map((a) => a.id))].sort((a, b) => a - b);
    // 1. enrol every awake agent not enrolled yet
    const from = await Promise.all(ids.map((id) => read<bigint>("enrolledFrom", [BigInt(id)]).then((result) => ({ status: "success" as const, result }), () => ({ status: "failure" as const, result: null }))));
    const enrolled = new Map<number, bigint>();
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], f = from[i]?.status === "success" ? (from[i].result as bigint) : null;
      if (f === null) continue;
      if (f > 0n) { enrolled.set(id, f); continue; }
      if (!canSend || (this.skip.get(id) ?? 0) > Date.now()) continue;
      try { await this.host.sendTo(D, DIST_ABI, "enroll", [BigInt(id)]); this.host.log(`Fee share: Trencher #${id} enrolled (earns from next week)`); }
      catch { this.skip.set(id, Date.now() + 3_600_000); }
    }
    // 2. close the week once it has run its 7 days
    const [epoch, start, len] = await Promise.all([read<bigint>("epoch"), read<bigint>("epochStart"), read<bigint>("EPOCH")]);
    const block = await c.getBlock();
    let cur = epoch;
    if (canSend && block.timestamp >= start + len) {
      try { await this.host.sendTo(D, DIST_ABI, "closeEpoch", []); cur = epoch + 1n; this.host.log(`Fee share: week ${epoch} closed`); }
      catch (e) { this.host.log(`Fee share: closing week ${epoch} failed: ${(e as Error).message.split("\n")[0]}`); }
    }
    // 3. pay the closed weeks' shares (looks back over the last 8 weeks)
    let lastPaid: string | null = null;
    for (let e = cur - 1n; e >= 1n && e >= cur - 8n; e--) {
      const per = await read<bigint>("sharePerAgent", [e]);
      if (per === 0n) continue;
      const due = [...enrolled.entries()].filter(([, f]) => f <= e).map(([id]) => id);
      if (!due.length || !canSend) continue;
      const done = await Promise.all(due.map((id) => read<boolean>("paid", [e, BigInt(id)]).then((result) => ({ status: "success" as const, result }), () => ({ status: "failure" as const, result: null }))));
      const unpaid = due.filter((_, i) => done[i]?.status === "success" && done[i].result === false);
      for (let k = 0; k < unpaid.length; k += 40) {
        const batch = unpaid.slice(k, k + 40).map(BigInt);
        try { await this.host.sendTo(D, DIST_ABI, "pay", [e, batch]); lastPaid = `week ${e}: ${formatEther(per)} ETH to ${batch.length} agents`; this.host.log(`Fee share: paid ${lastPaid}`); }
        catch (err) { this.host.log(`Fee share: paying week ${e} failed: ${(err as Error).message.split("\n")[0]}`); }
      }
    }
    const [epochNow, startNow, active, joining, reserved, bal] = await Promise.all([read<bigint>("epoch"), read<bigint>("epochStart"), read<bigint>("activeAgents"), read<bigint>("joiningNext"), read<bigint>("reserved"), c.getBalance({ address: D })]);
    this.state = { epoch: Number(epochNow), endsAt: Number(startNow + len), enrolled: Number(active), joiningNext: Number(joining), potEth: formatEther(bal - reserved), lastPaid: lastPaid ?? this.state?.lastPaid ?? null };
  }

  diag() {
    if (!ENV.FEE_KEEPER || !ENV.DIST) return "off";
    if (!this.state) return "starting";
    const s = this.state, left = s.endsAt - Math.floor(Date.now() / 1000);
    return { week: s.epoch, closesIn: left > 0 ? `${Math.floor(left / 86400)}d ${Math.floor((left % 86400) / 3600)}h` : "now", agentsEarningThisWeek: s.enrolled, joiningNextWeek: s.joiningNext, potThisWeek: `${s.potEth} ETH`, lastPayout: s.lastPaid ?? "none yet" };
  }
}
