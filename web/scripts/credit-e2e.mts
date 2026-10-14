/**
 * Trenchers Credit end to end, on a local chain, with the site's own code.
 *
 * Starts anvil (with the site's chain id), puts Multicall3 and an ERC-8004 registry at their real addresses, deploys
 * Trenchers Credit exactly as the launch page does (timelock, library, linked pool, seed, record, stake lines, backing),
 * then plays it through: a lender deposits, an agent owner stakes $TRENCHERS with a signed consent and opens a line,
 * borrows ETH, repays after a week, the backing harvests its fees; a second agent defaults and its stake is burnt.
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
] as const;
const [team, lender, ownerA, ownerB] = KEYS.map((k) => privateKeyToAccount(k));
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
  await call(W(team), lines, C.LINES_ABI, "fund", [], parseEther("0.5"));
  const A = { pool, record, lines, timelock };
  ok(String(await pub.readContract({ address: pool, abi: C.POOL_ABI, functionName: "owner" })).toLowerCase() === timelock.toLowerCase(), "pool is owned by the 48 h timelock");
  ok(Number(await pub.readContract({ address: timelock, abi: C.CREDIT_ART.CreditTimelock.abi, functionName: "getMinDelay" })) === 48 * 3600, "timelock delay is 48 hours");

  let ov = await C.readOverview(A);
  ok(ov.lines.backing === parseEther("0.5"), `stake lines has 0.5 ETH of backing (${formatEther(ov.lines.backing)})`);
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
  ok(ov.lines.feesWaiting > 0n, "the backing has its share of the fee waiting");
  const before = ov.lines.backing;
  await call(W(lender), lines, C.LINES_ABI, "harvest");
  ov = await C.readOverview(A);
  ok(ov.lines.feesWaiting === 0n && ov.lines.backing > before, "anyone can add the backing's fees to the backing (harvest)");

  // close the line: the whole stake comes back
  const balBefore = await pub.readContract({ address: token, abi: TOKEN_ABI, functionName: "balanceOf", args: [ownerA.address] }) as bigint;
  await call(W(ownerA), lines, C.LINES_ABI, "close", [idA]);
  const balAfter = await pub.readContract({ address: token, abi: TOKEN_ABI, functionName: "balanceOf", args: [ownerA.address] }) as bigint;
  ok(balAfter - balBefore === stake, "closing the line gives the whole stake back");

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
  await warp(11 * 86400);
  const lB = (await C.readLoansOf(A, idB))[0];
  await call(W(lender), pool, C.POOL_ABI, "markDefault", [BigInt(lB.id)]);
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

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll credit checks passed");
} catch (e) {
  console.error(e);
  failures++;
} finally {
  stop();
  process.exit(failures ? 1 : 0);
}
