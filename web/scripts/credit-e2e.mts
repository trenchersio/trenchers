/**
 * Trenchers Credit end to end, on a local chain, with the site's own code.
 *
 * Starts anvil (with the site's chain id), puts Multicall3 and an ERC-8004 registry at their real addresses, deploys
 * Trenchers Credit exactly as the launch page does (timelock, library, linked pool, seed, record, stake lines), then
 * plays it through: two wallets back the lines and get shares, a lender deposits, an agent owner stakes $TRENCHERS with
 * a signed consent and opens a line, borrows ETH, repays after a week (each backing share is worth more), anyone
 * harvests the fees; a backer asks to leave and can't leave early; a second agent defaults (the backers carry it pro
 * rata, its stake is burnt); after the 7-day notice the backer takes the ETH out; the owner has no way to take backing.
 * Every figure the page shows is read back with the page's own readers. Run from web/:  npx tsx scripts/credit-e2e.mts
 * (needs the credit contracts built: cd credit && forge build)
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, parseEther, formatEther, type Address, type Hex, type Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const multicall3Bytecode = readFileSync(new URL("../node_modules/viem/_esm/constants/contracts.js", import.meta.url), "utf8").match(/multicall3Bytecode = '(0x[0-9a-f]+)'/)![1] as Hex;
const PORT = 8551;
const RPC = `http://127.0.0.1:${PORT}`;
process.env.NEXT_PUBLIC_RPC_URL = RPC;
const CHAIN_ID = 46630; // the site's chain when NEXT_PUBLIC_CHAIN isn't "robinhood"
const OUT = new URL("../../credit/out/", import.meta.url);
const art = (file: string, name: string) => JSON.parse(readFileSync(new URL(`${file}/${name}.json`, OUT), "utf8")) as { abi: Abi; bytecode: { object: Hex }; deployedBytecode: { object: Hex } };
const local = defineChain({ id: CHAIN_ID, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // team (deployer, Safe stand-in)
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // lender
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // agent owner A
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // agent owner B
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // backer 1
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // backer 2
] as const;
const [team, lender, ownerA, ownerB, backer1, backer2] = KEYS.map((k) => privateKeyToAccount(k));
const pub = createPublicClient({ chain: local, transport: http(RPC) });
const W = (acc: typeof team) => createWalletClient({ chain: local, transport: http(RPC), account: acc });
let failures = 0;
const ok = (cond: unknown, what: string) => { console.log(`${cond ? "  ok  " : "  FAIL"} ${what}`); if (!cond) failures++; };
const rpc = (method: string, params: unknown[]) => pub.request({ method: method as never, params: params as never });
const warp = async (sec: number) => { await rpc("evm_increaseTime", [sec]); await rpc("evm_mine", []); };

async function deployRaw(data: Hex, w = W(team), value = 0n): Promise<Address> {
  const hash = await w.sendTransaction({ data, value, gas: 29_000_000n } as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (!r.contractAddress || r.status !== "success") throw new Error("deploy failed");
  return r.contractAddress;
}
async function call(w: ReturnType<typeof W>, address: Address, abi: Abi, functionName: string, args: unknown[] = [], value = 0n) {
  const { request } = await pub.simulateContract({ address, abi, functionName, args, value, account: w.account! } as never);
  const hash = await w.writeContract(request as never);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted`);
  return r;
}
const reverts = async (address: Address, abi: Abi, functionName: string, args: unknown[], from: Address) => {
  try { await pub.simulateContract({ address, abi, functionName, args, account: from } as never); return false; } catch { return true; }
};
const near = (a: bigint, b: bigint, tol = 10n ** 6n) => (a > b ? a - b : b - a) <= tol;

const anvil = spawn(`${process.env.HOME}/.foundry/bin/anvil`, ["--port", String(PORT), "--silent", "--chain-id", String(CHAIN_ID), "--gas-limit", "60000000"], { stdio: "ignore" });
const stop = () => { try { anvil.kill(); } catch {} };
process.on("exit", stop);

try {
  for (let i = 0; i < 50; i++) { try { await pub.getChainId(); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  console.log("local chain up");

  // The site batches reads through Multicall3, and the pool reads identities from the real ERC-8004 address.
  const mc = await deployRaw(multicall3Bytecode);
  await rpc("anvil_setCode", ["0xca11bde05977b3631167028862be2a173976ca11", await pub.getCode({ address: mc })]);
  const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as Address;
  await rpc("anvil_setCode", [REGISTRY, art("MockAgentRegistry.sol", "MockAgentRegistry").deployedBytecode.object]);
  const weth = await deployRaw(art("MockWETH.sol", "MockWETH").bytecode.object);
  const token = await deployRaw(art("MockToken.sol", "MockToken").bytecode.object);
  process.env.NEXT_PUBLIC_TRENCHERS_TOKEN = token;
  const REG_ABI = art("MockAgentRegistry.sol", "MockAgentRegistry").abi;
  const TOKEN_ABI = art("MockToken.sol", "MockToken").abi;
  await call(W(team), REGISTRY, REG_ABI, "register", ["burn id 0"]); // ids start at 0 on a copied registry; 0 is never an agent

  // ---------------------------------------------------------------- deploy, as the launch page does
  const C = await import("../lib/credit.ts");
  const { encodeDeployData } = await import("viem");
  const CL = C.CREDIT_LAUNCH;
  const BUYBACK = "0x000000000000000000000000000000000000b0b0" as Address;
  const timelock = await deployRaw(encodeDeployData({ abi: C.CREDIT_ART.CreditTimelock.abi, bytecode: C.CREDIT_ART.CreditTimelock.bytecode, args: [team.address] }));
  const calls = await deployRaw(C.CREDIT_ART.CreditCalls.bytecode);
  const pool = await deployRaw(encodeDeployData({ abi: C.POOL_ABI, bytecode: C.linkedPoolBytecode(calls), args: [weth, REGISTRY, BUYBACK, timelock, team.address, CL.params] }));
  await call(W(team), pool, C.POOL_ABI, "seed", [], CL.seed);
  const record = await deployRaw(encodeDeployData({ abi: C.RECORD_ABI, bytecode: C.CREDIT_ART.CreditRecord.bytecode, args: [pool] }));
  const TPE = parseEther("2000000"); // 2M $TRENCHERS per 1 ETH of line
  const lines = await deployRaw(encodeDeployData({ abi: C.LINES_ABI, bytecode: C.CREDIT_ART.TrenchersStakeLines.bytecode, args: [pool, token, timelock, team.address, TPE, CL.lines.maxLine, CL.lines.maxTerm, CL.lines.weeklyCap, CL.lines.uri] }));
  const A = { pool, record, lines, timelock };
  const LA = C.LINES_ABI;
  const sharesOf = async (who: Address) => pub.readContract({ address: lines, abi: LA, functionName: "sharesOf", args: [who] }) as Promise<bigint>;

  // ---------------------------------------------------------------- two wallets back the lines
  let ov = await C.readOverview(A);
  ok(ov.lines.totalShares === 0n && ov.lines.exitDelay === 7 * 86400, "the vault starts empty, with a 7-day exit notice");
  try { await pub.simulateContract({ address: lines, abi: LA, functionName: "fund", value: parseEther("0.005"), account: backer1.address } as never); ok(false, "a first backing under 0.01 ETH is refused"); } catch { ok(true, "a first backing under 0.01 ETH is refused"); }
  const sim1 = await pub.simulateContract({ address: lines, abi: LA, functionName: "fund", value: parseEther("0.3"), account: backer1.address } as never);
  const predicted1 = C.backingSharesFor(parseEther("0.3"), ov.lines);
  await call(W(backer1), lines, LA, "fund", [], parseEther("0.3"));
  const s1 = await sharesOf(backer1.address);
  ok(s1 > 0n && s1 === (sim1.result as bigint) && s1 === predicted1, `backer 1 put in 0.3 ETH and got ${s1} shares, as fund() returned and the page predicted`);
  ov = await C.readOverview(A);
  const predicted2 = C.backingSharesFor(parseEther("0.2"), ov.lines);
  await call(W(backer2), lines, LA, "fund", [], parseEther("0.2"));
  const s2 = await sharesOf(backer2.address);
  ok(s2 === predicted2 && near(s2 * 3n, s1 * 2n, s1 / 10n ** 6n), `backer 2 put in 0.2 ETH and got ${s2} shares (two thirds of backer 1's)`);
  let b1 = await C.readBacker(A, backer1.address), b2 = await C.readBacker(A, backer2.address);
  ok(near(b1.value, parseEther("0.3")) && near(b2.value, parseEther("0.2")), `the page reads their backing back: ${formatEther(b1.value)} and ${formatEther(b2.value)} ETH`);
  ok(String(await pub.readContract({ address: pool, abi: C.POOL_ABI, functionName: "owner" })).toLowerCase() === timelock.toLowerCase(), "pool is owned by the 48 h timelock");
  ok(Number(await pub.readContract({ address: timelock, abi: C.CREDIT_ART.CreditTimelock.abi, functionName: "getMinDelay" })) === 48 * 3600, "timelock delay is 48 hours");

  ov = await C.readOverview(A);
  ok(ov.lines.backing === parseEther("0.5") && ov.lines.totalShares === s1 + s2, `stake lines has 0.5 ETH of backing (${formatEther(ov.lines.backing)}) and ${ov.lines.totalShares} shares`);
  ok(ov.params.feeBps === 200 && ov.params.reserveFeeBps === 2500, "the page reads the launch terms (2% / 30 days, 25% buyback)");
  ok(ov.stats.totalAssets === parseEther("0.5") + CL.seed, "pool total = backing + seed");

  // ---------------------------------------------------------------- a lender
  await call(W(lender), pool, C.POOL_ABI, "deposit", [parseEther("2"), lender.address, 0n], parseEther("2"));
  const lp = await C.readLender(A, lender.address);
  ok(lp.value === parseEther("2"), `lender's 2 ETH reads back as ${formatEther(lp.value)} ETH`);

  // ---------------------------------------------------------------- agent A: stake, consent, open, borrow, repay
  await call(W(ownerA), REGISTRY, REG_ABI, "register", ["ipfs://agent-a"]);
  const idA = ov.lines.backerId + 1n; // the stake-lines contract registered its own identity first
  ok((await C.ownerOfAgent(idA))?.toLowerCase() === ownerA.address.toLowerCase(), `the page finds agent #${idA}'s owner on the registry`);
  await call(W(team), token, TOKEN_ABI, "mint", [ownerA.address, parseEther("1000000")]);
  const stake = parseEther("100000"); // 0.05 ETH line at 2M per ETH
  const expectLine = C.lineFor(stake, ov.lines);
  await call(W(ownerA), token, TOKEN_ABI, "approve", [lines, stake]);
  const nonce = await pub.readContract({ address: pool, abi: C.POOL_ABI, functionName: "nonces", args: [idA] }) as bigint;
  const consent = { agentId: idA, backerId: ov.lines.backerId, owner: ownerA.address, maxPremiumBps: 0n, nonce, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) };
  const sig = await W(ownerA).signTypedData({ account: ownerA, ...C.consentTypedData(pool, CHAIN_ID, consent) });
  await call(W(ownerA), lines, C.LINES_ABI, "open", [idA, stake, consent, sig]);
  let pos = await C.readPosition(A, idA);
  ok(pos.backedHere && pos.lineInPool === expectLine && expectLine === parseEther("0.05"), `line opened: ${formatEther(pos.lineInPool)} ETH, as the page predicted (${formatEther(expectLine)})`);

  const amt = parseEther("0.03"), term = 8 * 86400;
  const fee = C.feeFor(amt, term, ov.params);
  const to = "0x00000000000000000000000000000000000a11ce" as Address;
  await call(W(ownerA), pool, C.POOL_ABI, "borrow", [idA, amt, BigInt(term), to, fee + fee / 50n + 1n, true]);
  ok((await pub.getBalance({ address: to })) === amt, "0.03 ETH arrived at the recipient as plain ETH");
  let loans = await C.readLoansOf(A, idA);
  ok(loans.length === 1 && loans[0].status === "active" && loans[0].fee === fee, `the loan reads back as active with the fee the page quoted (${formatEther(fee)} ETH)`);

  await warp(8 * 86400);
  await call(W(ownerA), pool, C.POOL_ABI, "repay", [BigInt(loans[0].id), idA, loans[0].principal + loans[0].fee], loans[0].principal + loans[0].fee);
  const rep = await C.readReport(A, idA);
  loans = await C.readLoansOf(A, idA);
  ok(loans[0].status === "repaid" && rep.loansRepaid === 1 && rep.seasonedRepaid === 1, "repaid, and counted as a seasoned loan (held 8 days)");
  ok(rep.score > 0, `agent #${idA} now has a credit score: ${rep.score}`);
  ov = await C.readOverview(A);
  ok(ov.stats.lendersEarned > 0n && ov.stats.sharePrice > 10n ** 18n, `lenders earned ${formatEther(ov.stats.lendersEarned)} ETH; a share is worth ${formatEther(ov.stats.sharePrice)} ETH`);
  ok(ov.lines.feesWaiting > 0n, "the backers have their share of the fee waiting");
  const perShare = (l: typeof ov.lines) => (l.backingValue * 10n ** 18n) / l.totalShares;
  ok(perShare(ov.lines) > (parseEther("0.5") * 10n ** 18n) / (s1 + s2), "each backing share is worth more after the repaid loan");
  b1 = await C.readBacker(A, backer1.address);
  ok(b1.value > parseEther("0.3"), `backer 1's 0.3 ETH is now worth ${formatEther(b1.value)} ETH`);
  const before = ov.lines.backing, valueBefore = ov.lines.backingValue;
  await call(W(lender), lines, LA, "harvest");
  ov = await C.readOverview(A);
  ok(ov.lines.feesWaiting === 0n && ov.lines.backing > before && near(ov.lines.backingValue, valueBefore, 10n), "anyone can add the backers' fees to the backing (harvest); what the vault is worth stays the same");

  // close the line: the whole stake comes back
  const balBefore = await pub.readContract({ address: token, abi: TOKEN_ABI, functionName: "balanceOf", args: [ownerA.address] }) as bigint;
  await call(W(ownerA), lines, C.LINES_ABI, "close", [idA]);
  const balAfter = await pub.readContract({ address: token, abi: TOKEN_ABI, functionName: "balanceOf", args: [ownerA.address] }) as bigint;
  ok(balAfter - balBefore === stake, "closing the line gives the whole stake back");

  // ---------------------------------------------------------------- backer 2 asks to leave, and can't leave early
  await call(W(backer2), lines, LA, "requestExit", [s2]);
  b2 = await C.readBacker(A, backer2.address);
  const askedAt = Number((await pub.getBlock()).timestamp);
  ok(b2.exitShares === s2 && b2.exitReadyAt === askedAt + 7 * 86400, "backer 2 asked to leave with all its shares: ready in 7 days");
  ok(await reverts(lines, LA, "exit", [s2, backer2.address], backer2.address), "taking it out before the 7 days are up reverts");
  ok(await reverts(lines, LA, "requestExit", [1n], backer2.address), "nobody can ask to take out more shares than they have");

  // ---------------------------------------------------------------- agent B: borrows and never repays
  await call(W(ownerB), REGISTRY, REG_ABI, "register", ["ipfs://agent-b"]);
  const idB = idA + 1n;
  await call(W(team), token, TOKEN_ABI, "mint", [ownerB.address, parseEther("200000")]);
  await call(W(ownerB), token, TOKEN_ABI, "approve", [lines, parseEther("60000")]);
  const nB = await pub.readContract({ address: pool, abi: C.POOL_ABI, functionName: "nonces", args: [idB] }) as bigint;
  const cB = { agentId: idB, backerId: ov.lines.backerId, owner: ownerB.address, maxPremiumBps: 0n, nonce: nB, deadline: BigInt(Math.floor(Date.now() / 1000) + 30 * 86400) };
  await call(W(ownerB), lines, C.LINES_ABI, "open", [idB, parseEther("60000"), cB, await W(ownerB).signTypedData({ account: ownerB, ...C.consentTypedData(pool, CHAIN_ID, cB) })]);
  const priceBefore = (await C.readOverview(A)).stats.sharePrice;
  const feeB = C.feeFor(parseEther("0.03"), 7 * 86400, ov.params);
  await call(W(ownerB), pool, C.POOL_ABI, "borrow", [idB, parseEther("0.03"), BigInt(7 * 86400), ownerB.address, feeB + 1n, true]);
  ok(await reverts(lines, LA, "exit", [s2, backer2.address], backer2.address), "still too early while the loan is out");
  b1 = await C.readBacker(A, backer1.address); b2 = await C.readBacker(A, backer2.address);
  const vBefore = (await C.readOverview(A)).lines.backingValue;
  await warp(11 * 86400);
  const lB = (await C.readLoansOf(A, idB))[0];
  await call(W(lender), pool, C.POOL_ABI, "markDefault", [BigInt(lB.id)]);
  const a1 = await C.readBacker(A, backer1.address), a2 = await C.readBacker(A, backer2.address);
  const loss1 = b1.value - a1.value, loss2 = b2.value - a2.value;
  const vAfter = (await C.readOverview(A)).lines.backingValue;
  // the pool burns backing worth principal + fee; the backers get their own quarter of that fee back, and the backing (pool shares) gains with lenders
  ok(vBefore - vAfter > lB.principal && vBefore - vAfter <= lB.principal + lB.fee, `the default cost the backing about the principal and fee (${formatEther(vBefore - vAfter)} ETH)`);
  ok(loss1 > 0n && loss2 > 0n && near(loss1 * s2, loss2 * s1, (s1 * s2) / 10n ** 9n), `backers carried it pro rata: ${formatEther(loss1)} and ${formatEther(loss2)} ETH (backer 2 too, while waiting to leave)`);
  const repB = await C.readReport(A, idB);
  const posB = await C.readPosition(A, idB);
  ov = await C.readOverview(A);
  ok(repB.defaulted && repB.score === 0, `agent #${idB} is marked defaulted, score 0`);
  ok(posB.burnt && posB.tokens === 0n, "its whole $TRENCHERS stake was burnt");
  ok((await pub.readContract({ address: token, abi: TOKEN_ABI, functionName: "balanceOf", args: ["0x000000000000000000000000000000000000dEaD"] }) as bigint) === parseEther("60000"), "60,000 $TRENCHERS sit at the dead address");
  ok(ov.stats.sharePrice >= priceBefore, `lenders lost nothing: share price ${formatEther(priceBefore)} → ${formatEther(ov.stats.sharePrice)}`);
  const lp2 = await C.readLender(A, lender.address);
  ok(lp2.value > parseEther("2"), `the lender's 2 ETH is now worth ${formatEther(lp2.value)} ETH`);
  ok(ov.recent.length === 2 && ov.recent[0].status === "defaulted" && ov.recent[1].status === "repaid", "recent loans: newest first, one defaulted, one repaid");

  // ---------------------------------------------------------------- after the notice, backer 2 takes it out
  const exitTo = "0x00000000000000000000000000000000000e0170" as Address;
  b2 = await C.readBacker(A, backer2.address);
  ok(b2.exitReadyAt <= Number((await pub.getBlock()).timestamp) && b2.exitNow === s2, "the 7 days are up and all of it is free to leave");
  await call(W(backer2), lines, LA, "exit", [s2, exitTo]);
  const got = await pub.getBalance({ address: exitTo });
  ok(got > 0n && near(got, b2.value, b2.value / 200n + 1n), `backer 2 took out ${formatEther(got)} ETH as plain ETH (its share was worth ${formatEther(b2.value)})`);
  ok((await sharesOf(backer2.address)) === 0n && (await C.readBacker(A, backer2.address)).exitShares === 0n, "its shares and its request are gone");
  b1 = await C.readBacker(A, backer1.address);
  ok(near(b1.value, a1.value, 10n ** 9n), "backer 1's backing is untouched by backer 2 leaving");

  // backer 1: ask, cancel
  await call(W(backer1), lines, LA, "requestExit", [s1 / 2n]);
  await call(W(backer1), lines, LA, "cancelExit");
  ok((await C.readBacker(A, backer1.address)).exitShares === 0n, "a backer can cancel a request to leave");

  // ---------------------------------------------------------------- the owner has no way to take backing
  const names = (C.LINES_ABI as readonly { type: string; name?: string }[]).filter((x) => x.type === "function").map((x) => x.name!);
  ok(!names.some((x) => /unlock|withdraw|sweep|rescue|drain/i.test(x)), "the stake-lines contract has no owner function that moves backing");
  ok(await reverts(pool, C.POOL_ABI, "unlockBacking", [ov.lines.backerId, 1n, team.address, true], team.address), "the team can't unlock the backing from the pool directly");
  ok(await reverts(pool, C.POOL_ABI, "unlockBacking", [ov.lines.backerId, 1n, timelock, true], timelock), "neither can the timelock");
  ok(await reverts(lines, LA, "exit", [1n, team.address], team.address), "and the owner holds no shares to exit with");

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll credit checks passed");
} catch (e) {
  console.error(e);
  failures++;
} finally {
  stop();
  process.exit(failures ? 1 : 0);
}
