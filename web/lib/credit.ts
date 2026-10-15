/**
 * Trenchers Credit on the site: where the contracts are, what they say, and the wallet actions.
 *
 *   Pool          TrenchersCreditPool: lenders' ETH, lines, loans, fees, defaults
 *   Record        CreditRecord: an agent's record and score, the pool's figures
 *   Stake lines   TrenchersStakeLines: stake $TRENCHERS, get an ETH line. Its ETH backing is a shared vault: anyone
 *                 can back the lines for shares, earn the backers' 25% of fees, carry defaults pro rata, and leave
 *                 with a 7-day notice. Nobody else, the owner included, can move that backing.
 *
 * Until the contracts are deployed (addresses empty) the page shows a preview with sample figures.
 */
import { createWalletClient, custom, parseAbi, type Abi, type Address, type Hash } from "viem";
import { reader, sendCall, walletProvider } from "@/lib/chain";
import { chain, TRENCHERS_TOKEN } from "@/lib/constants";
import art from "@/lib/credit/artifacts.json";

/** Mainnet addresses, filled in after the launch page deploys Trenchers Credit. */
export const CREDIT_MAINNET = {
  pool: "0xde33e4d977d56ba7133e8dae7b30844183c46570" as Address | "",
  record: "0xf2f4d3611923828b8c65d41f53c285b3d1c90314" as Address | "",
  lines: "0xa39651667bae1809f903e9a22b8f42c7d88e7c2e" as Address | "",
  timelock: "0x4fec868c7848bc6dfe00a9556e710240e7344a79" as Address | "",
  block: 89420119,
};

/** What the launch page deploys with. The owner of every setting is a 48-hour timelock run by the team Safe. */
export const CREDIT_LAUNCH = {
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as Address,
  buyback: "0xB03A251c7b5c83e44005c4A7BA6f5d96B8284D5A" as Address, // the Trenchers buyback wallet
  seed: 10n ** 14n, // 0.0001 ETH of dead shares
  params: {
    minLoan: 10n ** 15n, maxLoan: 25n * 10n ** 16n, minTerm: 86400n, maxTerm: 30n * 86400n, grace: 3n * 86400n, minScoreTerm: 7n * 86400n,
    feeBps: 200n, backerFeeBps: 2500n, reserveFeeBps: 2500n, minBacking: 10n ** 16n, maxUtilizationBps: 10_000n, keeperBounty: 0n,
  },
  lines: { maxLine: 5n * 10n ** 16n, maxTerm: 14n * 86400n, weeklyCap: 10n ** 18n, uri: "https://www.trenchers.io/credit/agent.json" },
};

/** The consent an agent's owner signs so a backer can open its line (EIP-712, checked by the pool). */
export function consentTypedData(pool: Address, chainId: number, message: { agentId: bigint; backerId: bigint; owner: Address; maxPremiumBps: bigint; nonce: bigint; deadline: bigint }) {
  return {
    domain: { name: "Trenchers Credit", version: "1", chainId, verifyingContract: pool },
    types: { Consent: [
      { name: "agentId", type: "uint256" }, { name: "backerId", type: "uint256" }, { name: "owner", type: "address" },
      { name: "maxPremiumBps", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    primaryType: "Consent" as const,
    message,
  };
}

export type CreditAddrs = { pool: Address; record: Address; lines: Address; timelock?: Address; block?: number };
const LS = "trenchers:credit";

/** The live addresses: mainnet's once set, else what this browser's launch page deployed (for testing). */
export function creditAddrs(): CreditAddrs | null {
  if (CREDIT_MAINNET.pool && CREDIT_MAINNET.record && CREDIT_MAINNET.lines) return CREDIT_MAINNET as CreditAddrs;
  try { const v = JSON.parse(localStorage.getItem(LS) ?? "null"); if (v?.pool && v?.record && v?.lines) return v; } catch { /* */ }
  return null;
}
export function saveCreditAddrs(v: Partial<CreditAddrs>) { try { localStorage.setItem(LS, JSON.stringify(v)); } catch { /* */ } }

type Art = { abi: Abi; bytecode: `0x${string}`; linkReferences: Record<string, Record<string, { start: number; length: number }[]>> };
export const CREDIT_ART = art as unknown as Record<"TrenchersCreditPool" | "CreditCalls" | "CreditRecord" | "TrenchersStakeLines" | "CreditTimelock", Art>;
export const POOL_ABI = CREDIT_ART.TrenchersCreditPool.abi;
export const RECORD_ABI = CREDIT_ART.CreditRecord.abi;
export const LINES_ABI = CREDIT_ART.TrenchersStakeLines.abi;
export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)", "function symbol() view returns (string)",
]);
export const REGISTRY_ABI = parseAbi(["function ownerOf(uint256) view returns (address)", "function register(string agentURI) returns (uint256)"]);
/** The ERC-8004 identity registry on Robinhood Chain. */
export const AGENT_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address;

/** The pool's bytecode with the CreditCalls library's address linked in (deploy order: library, then pool). */
export function linkedPoolBytecode(calls: Address): `0x${string}` {
  let hex = CREDIT_ART.TrenchersCreditPool.bytecode.slice(2);
  const addr = calls.toLowerCase().slice(2);
  for (const refs of Object.values(CREDIT_ART.TrenchersCreditPool.linkReferences)) for (const list of Object.values(refs)) for (const r of list) {
    hex = hex.slice(0, r.start * 2) + addr + hex.slice((r.start + r.length) * 2);
  }
  return `0x${hex}`;
}

// ------------------------------------------------------------------ what the page shows

export type PoolStats = { totalAssets: bigint; liquidity: bigint; lent: bigint; lendersEarned: bigint; sharePrice: bigint; loans: number; toBuyback: bigint; reserve: bigint };
export type Params = { minLoan: bigint; maxLoan: bigint; minTerm: number; maxTerm: number; grace: number; minScoreTerm: number; feeBps: number; backerFeeBps: number; reserveFeeBps: number };
export type LinesInfo = { tokensPerEth: bigint; maxLine: bigint; maxTerm: number; weeklyRoom: bigint; backing: bigint; backingUsed: bigint; backingFree: bigint; feesWaiting: bigint; backingValue: bigint; totalShares: bigint; exitDelay: number; totalStaked: bigint; totalBurnt: bigint; linesOpened: number; backerId: bigint; paused: boolean };
export type LoanRow = { id: number; agentId: bigint; principal: bigint; fee: bigint; issuedAt: number; dueAt: number; defaultableAt: number; status: "active" | "repaid" | "defaulted"; backerId: bigint };
export type Report = { enrolled: boolean; isBacker: boolean; defaulted: boolean; frozen: boolean; backer: bigint; line: bigint; available: bigint; principalOut: bigint; activeLoans: number; loansRepaid: number; volumeRepaid: bigint; feesPaid: bigint; seasonedRepaid: number; ethSecondsRepaid: bigint; enrolledAt: number; score: number };
export type Overview = { stats: PoolStats; params: Params; lines: LinesInfo; recent: LoanRow[]; preview: boolean };

const STATUS = ["none", "active", "repaid", "defaulted"] as const;
const n = (x: unknown) => Number(x as bigint);

const E = (v: number) => BigInt(Math.round(v * 1e6)) * 10n ** 12n;
/** Sample figures for the preview, before launch. */
export const PREVIEW: Overview = {
  preview: true,
  stats: { totalAssets: E(12.4), liquidity: E(9.65), lent: E(2.75), lendersEarned: E(0.0412), sharePrice: E(1.0033), loans: 64, toBuyback: E(0.0206), reserve: E(0.006) },
  params: { minLoan: E(0.001), maxLoan: E(0.25), minTerm: 86400, maxTerm: 30 * 86400, grace: 3 * 86400, minScoreTerm: 7 * 86400, feeBps: 200, backerFeeBps: 2500, reserveFeeBps: 2500 },
  lines: { tokensPerEth: E(2_000_000), maxLine: E(0.05), maxTerm: 14 * 86400, weeklyRoom: E(0.62), backing: E(3.2), backingUsed: E(1.38), backingFree: E(1.82), feesWaiting: E(0.0061), backingValue: E(3.2061), totalShares: E(3.18) * 1000n, exitDelay: 7 * 86400, totalStaked: E(2_760_000), totalBurnt: E(40_000), linesOpened: 31, backerId: 9001n, paused: false },
  recent: [
    { id: 64, agentId: 8812n, principal: E(0.05), fee: E(0.000466), issuedAt: Date.now() / 1000 - 3600, dueAt: Date.now() / 1000 + 13 * 86400, defaultableAt: 0, status: "active", backerId: 9001n },
    { id: 63, agentId: 7710n, principal: E(0.02), fee: E(0.000093), issuedAt: Date.now() / 1000 - 4 * 3600, dueAt: Date.now() / 1000 + 6 * 86400, defaultableAt: 0, status: "active", backerId: 9001n },
    { id: 62, agentId: 6243n, principal: E(0.05), fee: E(0.000466), issuedAt: Date.now() / 1000 - 9 * 86400, dueAt: Date.now() / 1000 - 86400, defaultableAt: 0, status: "repaid", backerId: 9001n },
    { id: 61, agentId: 8790n, principal: E(0.01), fee: E(0.000046), issuedAt: Date.now() / 1000 - 11 * 86400, dueAt: Date.now() / 1000 - 4 * 86400, defaultableAt: 0, status: "repaid", backerId: 9001n },
    { id: 60, agentId: 5120n, principal: E(0.03), fee: E(0.00028), issuedAt: Date.now() / 1000 - 20 * 86400, dueAt: Date.now() / 1000 - 6 * 86400, defaultableAt: 0, status: "defaulted", backerId: 9001n },
    { id: 59, agentId: 8812n, principal: E(0.04), fee: E(0.000373), issuedAt: Date.now() / 1000 - 22 * 86400, dueAt: Date.now() / 1000 - 8 * 86400, defaultableAt: 0, status: "repaid", backerId: 9001n },
  ],
};

/** A sample backer for the preview: backing worth 0.25 ETH, a third of it asked to leave, 2 days and 5 hours to go. */
export const PREVIEW_BACKER: Backer = (() => {
  const shares = E(0.248) * 1000n, value = (PREVIEW.lines.backingValue * shares) / PREVIEW.lines.totalShares;
  return { shares, value, exitShares: shares / 3n, exitValue: value / 3n, exitReadyAt: Math.floor(Date.now() / 1000) + 2 * 86400 + 5 * 3600, exitNow: shares / 3n };
})();

export async function readOverview(a: CreditAddrs): Promise<Overview> {
  const c = reader();
  const [st, reserve, p, lines] = await Promise.all([
    c.readContract({ address: a.record, abi: RECORD_ABI, functionName: "stats" }) as Promise<readonly bigint[]>,
    c.readContract({ address: a.pool, abi: POOL_ABI, functionName: "reserve" }) as Promise<bigint>,
    c.readContract({ address: a.pool, abi: POOL_ABI, functionName: "getParams" }) as Promise<Record<string, bigint>>,
    readLines(a),
  ]);
  const stats: PoolStats = { totalAssets: st[0], liquidity: st[1], lent: st[2], lendersEarned: st[3], sharePrice: st[4], loans: n(st[5]), toBuyback: st[6], reserve };
  const params: Params = { minLoan: p.minLoan, maxLoan: p.maxLoan, minTerm: n(p.minTerm), maxTerm: n(p.maxTerm), grace: n(p.grace), minScoreTerm: n(p.minScoreTerm), feeBps: n(p.feeBps), backerFeeBps: n(p.backerFeeBps), reserveFeeBps: n(p.reserveFeeBps) };
  const ids = Array.from({ length: Math.min(8, stats.loans) }, (_, i) => stats.loans - i);
  const recent = await Promise.all(ids.map((id) => readLoan(a, id)));
  return { stats, params, lines, recent, preview: false };
}

export async function readLoan(a: CreditAddrs, id: number): Promise<LoanRow> {
  const l = await reader().readContract({ address: a.pool, abi: POOL_ABI, functionName: "getLoan", args: [BigInt(id)] }) as Record<string, bigint | number | string>;
  return { id, agentId: l.agentId as bigint, principal: l.principal as bigint, fee: l.fee as bigint, issuedAt: Number(l.issuedAt), dueAt: Number(l.dueAt), defaultableAt: Number(l.defaultableAt), status: STATUS[Number(l.status)] as LoanRow["status"], backerId: l.backerId as bigint };
}

async function readLines(a: CreditAddrs): Promise<LinesInfo> {
  const c = reader();
  const r = (fn: string) => c.readContract({ address: a.lines, abi: LINES_ABI, functionName: fn }) as Promise<unknown>;
  const [tpe, maxLine, maxTerm, room, info, value, supply, delay, staked, burnt, opened, backerId, paused] = await Promise.all([
    r("tokensPerEth"), r("maxLine"), r("maxTerm"), r("weeklyRoom"), r("backingInfo"), r("backingValue"), r("totalShares"), r("EXIT_DELAY"), r("totalStaked"), r("totalBurnt"), r("linesOpened"), r("backerId"), r("paused"),
  ]);
  const bi = info as readonly bigint[];
  return { tokensPerEth: tpe as bigint, maxLine: maxLine as bigint, maxTerm: n(maxTerm), weeklyRoom: room as bigint, backing: bi[0], backingUsed: bi[1], backingFree: bi[2], feesWaiting: bi[3], backingValue: value as bigint, totalShares: supply as bigint, exitDelay: n(delay), totalStaked: staked as bigint, totalBurnt: burnt as bigint, linesOpened: n(opened), backerId: backerId as bigint, paused: paused as boolean };
}

export async function readReport(a: CreditAddrs, agentId: bigint): Promise<Report> {
  const r = await reader().readContract({ address: a.record, abi: RECORD_ABI, functionName: "report", args: [agentId] }) as Record<string, unknown>;
  return { enrolled: r.enrolled as boolean, isBacker: r.isBacker as boolean, defaulted: r.defaulted as boolean, frozen: r.frozen as boolean, backer: r.backer as bigint, line: r.line as bigint, available: r.available as bigint, principalOut: r.principalOut as bigint, activeLoans: n(r.activeLoans), loansRepaid: n(r.loansRepaid), volumeRepaid: r.volumeRepaid as bigint, feesPaid: r.feesPaid as bigint, seasonedRepaid: n(r.seasonedRepaid), ethSecondsRepaid: r.ethSecondsRepaid as bigint, enrolledAt: n(r.enrolledAt), score: n(r.score) };
}

export async function readLoansOf(a: CreditAddrs, agentId: bigint, max = 12): Promise<LoanRow[]> {
  const ids = await reader().readContract({ address: a.pool, abi: POOL_ABI, functionName: "loansOf", args: [agentId] }) as readonly bigint[];
  return Promise.all(ids.slice(-max).reverse().map((id) => readLoan(a, Number(id))));
}

export type Position = { staker: Address; tokens: bigint; line: bigint; openedAt: number; burnt: boolean; lineInPool: bigint; drawn: bigint; activeLoans: number; backedHere: boolean };
export async function readPosition(a: CreditAddrs, agentId: bigint): Promise<Position> {
  const [s, lineInPool, drawn, activeLoans, backedHere] = await reader().readContract({ address: a.lines, abi: LINES_ABI, functionName: "position", args: [agentId] }) as [Record<string, unknown>, bigint, bigint, bigint, boolean];
  return { staker: s.staker as Address, tokens: s.tokens as bigint, line: s.line as bigint, openedAt: n(s.openedAt), burnt: s.burnt as boolean, lineInPool, drawn, activeLoans: n(activeLoans), backedHere };
}

export type Lender = { shares: bigint; value: bigint; unlocksAt: number };
export async function readLender(a: CreditAddrs, who: Address): Promise<Lender> {
  const c = reader();
  const [shares, last] = await Promise.all([
    c.readContract({ address: a.pool, abi: POOL_ABI, functionName: "shares", args: [who] }) as Promise<bigint>,
    c.readContract({ address: a.pool, abi: POOL_ABI, functionName: "lastDepositAt", args: [who] }) as Promise<bigint>,
  ]);
  const value = shares ? await c.readContract({ address: a.pool, abi: POOL_ABI, functionName: "convertToAssets", args: [shares] }) as bigint : 0n;
  return { shares, value, unlocksAt: last ? Number(last) + 7 * 86400 : 0 };
}

/** One backer's place in the shared backing vault. `exitNow` is how many of the asked-for shares can leave right
 *  now: only backing that stands behind no open line can go, so when lines are using it, part leaves now and the
 *  rest later. */
export type Backer = { shares: bigint; value: bigint; exitShares: bigint; exitValue: bigint; exitReadyAt: number; exitNow: bigint };
export async function readBacker(a: CreditAddrs, who: Address): Promise<Backer> {
  const c = reader();
  const [p, info] = await Promise.all([
    c.readContract({ address: a.lines, abi: LINES_ABI, functionName: "backerPosition", args: [who] }) as Promise<readonly [bigint, bigint, bigint, bigint | number]>,
    c.readContract({ address: a.lines, abi: LINES_ABI, functionName: "backingInfo" }) as Promise<readonly bigint[]>,
  ]);
  const [shares, value, exitShares] = p;
  const exitValue = shares ? (value * exitShares) / shares : 0n;
  const free = info[2] + info[3]; // free backing, plus fees the exit collects on the way
  const exitNow = exitValue <= free ? exitShares : exitValue ? (exitShares * free * 999n) / (exitValue * 1000n) : 0n; // a hair under, for rounding
  return { shares, value, exitShares, exitValue, exitReadyAt: Number(p[3]), exitNow };
}
/** The backing shares `wei` of new backing would get (the contract's own sum, with its virtual shares). */
export function backingSharesFor(wei: bigint, l: LinesInfo): bigint {
  return (wei * (l.totalShares + 1000n)) / ((l.totalShares ? l.backingValue : 0n) + 1n);
}

export async function ownerOfAgent(agentId: bigint): Promise<Address | null> {
  return reader().readContract({ address: AGENT_REGISTRY, abi: REGISTRY_ABI, functionName: "ownerOf", args: [agentId] }).then((x) => x as Address).catch(() => null);
}

// ------------------------------------------------------------------ math the page shows before anything is sent

/** The line a stake opens: stake / tokensPerEth, capped, in whole 0.001 ETH. */
export function lineFor(tokens: bigint, l: LinesInfo): bigint {
  if (l.tokensPerEth === 0n) return 0n;
  let line = (tokens * 10n ** 18n) / l.tokensPerEth;
  if (line > l.maxLine) line = l.maxLine;
  return line - (line % 10n ** 15n);
}
/** The fee on a loan: feeBps per 30 days, pro rata (no premium on stake lines). */
export function feeFor(principal: bigint, termSec: number, p: Params): bigint {
  return (principal * BigInt(p.feeBps) * BigInt(termSec)) / (10_000n * BigInt(30 * 86400));
}

// ------------------------------------------------------------------ wallet actions

type Phase = (p: "approve" | "sign" | "chain") => void;

export async function lend(a: CreditAddrs, from: Address, wei: bigint, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: a.pool, abi: POOL_ABI as unknown as readonly unknown[], functionName: "deposit", args: [wei, from, 0n], value: wei }, onPhase);
}
export async function withdraw(a: CreditAddrs, from: Address, shares: bigint, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: a.pool, abi: POOL_ABI as unknown as readonly unknown[], functionName: "withdraw", args: [shares, from, true] }, onPhase);
}

/** Stake $TRENCHERS and open a line: approve the tokens, sign the consent, open. */
export async function openLine(a: CreditAddrs, from: Address, agentId: bigint, tokens: bigint, backerId: bigint, onPhase?: Phase): Promise<Hash> {
  const c = reader();
  const token = TRENCHERS_TOKEN as Address;
  const allowance = await c.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [from, a.lines] }) as bigint;
  if (allowance < tokens) { onPhase?.("approve"); await sendCall(from, { address: token, abi: ERC20_ABI as unknown as readonly unknown[], functionName: "approve", args: [a.lines, tokens] }); }
  const nonce = await c.readContract({ address: a.pool, abi: POOL_ABI, functionName: "nonces", args: [agentId] }) as bigint;
  const consent = { agentId, backerId, owner: from, maxPremiumBps: 0n, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) };
  onPhase?.("sign");
  const wallet = createWalletClient({ chain, transport: custom(await walletProvider()) });
  const sig = await wallet.signTypedData({ account: from, ...consentTypedData(a.pool, chain.id, consent) });
  return sendCall(from, { address: a.lines, abi: LINES_ABI as unknown as readonly unknown[], functionName: "open", args: [agentId, tokens, consent, sig] }, onPhase);
}
export async function addStake(a: CreditAddrs, from: Address, agentId: bigint, tokens: bigint, onPhase?: Phase): Promise<Hash> {
  const token = TRENCHERS_TOKEN as Address;
  const allowance = await reader().readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [from, a.lines] }) as bigint;
  if (allowance < tokens) { onPhase?.("approve"); await sendCall(from, { address: token, abi: ERC20_ABI as unknown as readonly unknown[], functionName: "approve", args: [a.lines, tokens] }); }
  return sendCall(from, { address: a.lines, abi: LINES_ABI as unknown as readonly unknown[], functionName: "add", args: [agentId, tokens] }, onPhase);
}
export async function closeLine(a: CreditAddrs, from: Address, agentId: bigint, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: a.lines, abi: LINES_ABI as unknown as readonly unknown[], functionName: "close", args: [agentId] }, onPhase);
}
export async function borrow(a: CreditAddrs, from: Address, agentId: bigint, wei: bigint, termSec: number, to: Address, maxFee: bigint, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: a.pool, abi: POOL_ABI as unknown as readonly unknown[], functionName: "borrow", args: [agentId, wei, BigInt(termSec), to, maxFee, true] }, onPhase);
}
export async function repay(a: CreditAddrs, from: Address, loan: LoanRow, onPhase?: Phase): Promise<Hash> {
  const due = loan.principal + loan.fee;
  return sendCall(from, { address: a.pool, abi: POOL_ABI as unknown as readonly unknown[], functionName: "repay", args: [BigInt(loan.id), loan.agentId, due], value: due }, onPhase);
}
export async function harvest(a: CreditAddrs, from: Address, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: a.lines, abi: LINES_ABI as unknown as readonly unknown[], functionName: "harvest" }, onPhase);
}
/** Back the lines: ETH in, backing shares out. */
export async function backLines(a: CreditAddrs, from: Address, wei: bigint, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: a.lines, abi: LINES_ABI as unknown as readonly unknown[], functionName: "fund", value: wei }, onPhase);
}
/** Ask to take `shares` of backing out. They can leave after the 7-day notice; asking again restarts it. */
export async function requestExit(a: CreditAddrs, from: Address, shares: bigint, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: a.lines, abi: LINES_ABI as unknown as readonly unknown[], functionName: "requestExit", args: [shares] }, onPhase);
}
/** Shares worth `bps` (of 10,000) of what this backer holds and hasn't asked to take out yet. */
export function sharesForFraction(b: Backer, bps: number): bigint {
  return ((b.shares - b.exitShares) * BigInt(Math.round(bps))) / 10_000n;
}
export async function cancelExit(a: CreditAddrs, from: Address, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: a.lines, abi: LINES_ABI as unknown as readonly unknown[], functionName: "cancelExit" }, onPhase);
}
/** Takes out `shares` of a ready request, as plain ETH to `to`. */
export async function exitBacking(a: CreditAddrs, from: Address, shares: bigint, to: Address, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: a.lines, abi: LINES_ABI as unknown as readonly unknown[], functionName: "exit", args: [shares, to] }, onPhase);
}
export async function sweepReserve(a: CreditAddrs, from: Address, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: a.pool, abi: POOL_ABI as unknown as readonly unknown[], functionName: "reserveToBuyback" }, onPhase);
}
export async function registerAgent(from: Address, uri: string, onPhase?: Phase): Promise<Hash> {
  return sendCall(from, { address: AGENT_REGISTRY, abi: REGISTRY_ABI as unknown as readonly unknown[], functionName: "register", args: [uri] }, onPhase);
}

// ------------------------------------------------------------------ formatting

export const eth = (wei: bigint, dp = 4) => {
  const v = Number(wei) / 1e18;
  if (v === 0) return "0";
  if (Math.abs(v) < 10 ** -dp) return `<${10 ** -dp}`;
  return v.toLocaleString("en-US", { maximumFractionDigits: dp });
};
export const tok = (wei: bigint) => {
  const v = Number(wei) / 1e18;
  return v >= 1e6 ? `${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })}M` : v >= 1e3 ? `${(v / 1e3).toLocaleString("en-US", { maximumFractionDigits: 1 })}K` : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
};
export const days = (sec: number) => `${Math.round(sec / 86400)} day${Math.round(sec / 86400) === 1 ? "" : "s"}`;
