/**
 * Trenchers Inference Markets, end to end on a local Hardhat node (npx hardhat node in contracts/):
 * deploys a mock Pons with $TRENCHERS on it, the InferenceDesk, InferenceRouter and TrenchersOTC, pays the desk
 * three ways, then runs the real desk (watcher, burn keeper, P2P index, HTTP surface) and checks every credit
 * lands on the right wallet, every token is burned, and nothing the copy rules forbid is served.
 */
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, parseEther, parseEventLogs, type Abi, type Address, type Hex } from "viem";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { InferenceDesk, inferenceSettings, FileStore } from "../src/inference";

const RPC = "http://127.0.0.1:8545";
const chain = defineChain({ id: 31337, name: "local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const MNEMONIC = "test test test test test test test test test test test junk";
const [deployer, alice, bob, carol] = [0, 4, 5, 6].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }));
const KEY = generatePrivateKey();
const keeper = privateKeyToAccount(KEY);
const pub = createPublicClient({ chain, transport: http(RPC) });
const wal = (acct: typeof deployer = deployer) => createWalletClient({ account: acct, chain, transport: http(RPC) });
const ART = join(import.meta.dirname, "../../contracts/artifacts/contracts");
function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const walk = (d: string): string | null => {
    for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { const r = walk(p); if (r) return r; } else if (f === `${name}.json`) return p; }
    return null;
  };
  const j = JSON.parse(readFileSync(walk(ART)!, "utf8")); return { abi: j.abi, bytecode: j.bytecode };
}
async function deploy(name: string, args: unknown[] = [], value = 0n) {
  const a = artifact(name);
  const hash = await wal().deployContract({ abi: a.abi, bytecode: a.bytecode, args, value });
  return (await pub.waitForTransactionReceipt({ hash })).contractAddress!;
}
async function call(address: Address, name: string, fn: string, args: unknown[] = [], value = 0n, acct = deployer) {
  const hash = await wal(acct).writeContract({ address, abi: artifact(name).abi, functionName: fn, args, value, chain, account: acct });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${name}.${fn} reverted`);
  return r;
}
const read = <T,>(address: Address, name: string, fn: string, args: unknown[] = []) => pub.readContract({ address, abi: artifact(name).abi, functionName: fn, args }) as Promise<T>;
const mine = (n: number) => fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "hardhat_mine", params: [`0x${n.toString(16)}`] }) });
let failures = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "  ✓" : "  ✗"} ${msg}`); if (!ok) failures++; };
const E18 = 10n ** 18n;

async function main() {
  const start = Number(await pub.getBlockNumber()) + 1;
  // $TRENCHERS on a mock Pons curve, bought through the real PonsAdapter
  const pons = await deploy("MockPonsFactory");
  const adapter = await deploy("PonsAdapter", [pons, deployer.address]);
  const r = await call(pons, "MockPonsFactory", "launch", ["TRENCHERS", parseEther("100")], parseEther("5"));
  const launched = parseEventLogs({ abi: artifact("MockPonsFactory").abi, logs: r.logs, eventName: "TokenLaunched" })[0] as unknown as { args: { token: Address } };
  const token = launched.args.token;
  const desk = await deploy("InferenceDesk", [token]);
  const router = await deploy("InferenceRouter", [adapter, token, desk]);
  const otc = await deploy("TrenchersOTC");
  await wal().sendTransaction({ to: keeper.address, value: parseEther("1"), account: deployer, chain });
  console.log("deployed: token", token, "desk", desk, "router", router, "otc", otc);

  // Holders get some $TRENCHERS through the adapter
  for (const who of [alice, carol]) await call(adapter, "PonsAdapter", "buy", [token, 0n], parseEther("0.2"), who);
  const aliceBal = await read<bigint>(token, "MockPonsToken", "balanceOf", [alice.address]);

  // 1. alice pays directly
  const direct = aliceBal / 4n;
  await call(token, "MockPonsToken", "transfer", [desk, direct], 0n, alice);
  // 2. bob pays in ETH through the router
  const rb = await call(router, "InferenceRouter", "buyCredit", [0n, "0x0000000000000000000000000000000000000000"], parseEther("0.05"), bob);
  const bought = (parseEventLogs({ abi: artifact("InferenceRouter").abi, logs: rb.logs, eventName: "CreditBought" })[0] as unknown as { args: { tokensOut: bigint } }).args.tokensOut;
  // 3. carol lists an ask; bob fills part of it straight into credit
  const carolBal = await read<bigint>(token, "MockPonsToken", "balanceOf", [carol.address]);
  await call(token, "MockPonsToken", "approve", [otc, carolBal], 0n, carol);
  await call(otc, "TrenchersOTC", "ask", [token, carolBal / 2n, parseEther("0.01"), 0, "0x0000000000000000000000000000000000000000"], 0n, carol);
  const part = carolBal / 8n;
  const owe = await read<bigint>(otc, "TrenchersOTC", "quote", [1n, part]);
  await call(otc, "TrenchersOTC", "buy", [[1n], [part], desk], owe, bob);
  // 4. one transaction carrying two people's purchases (a bundle): each must be credited to its own buyer
  const bundler = await deploy("MockBundler");
  const rr = await call(bundler, "MockBundler", "twoBuys", [router, carol.address, parseEther("0.001"), alice.address], parseEther("0.03"));
  const two = parseEventLogs({ abi: artifact("InferenceRouter").abi, logs: rr.logs, eventName: "CreditBought" }) as unknown as { args: { buyer: Address; tokensOut: bigint } }[];
  const carolBundle = two.find((x) => x.args.buyer.toLowerCase() === carol.address.toLowerCase())!.args.tokensOut;
  const aliceBundle = two.find((x) => x.args.buyer.toLowerCase() === alice.address.toLowerCase())!.args.tokensOut;
  await mine(10);

  const dir = mkdtempSync(join(tmpdir(), "icm-"));
  const file = join(dir, "icm.log");
  const settings = { ...inferenceSettings({}), rpc: RPC, chainId: 31337, token, desk, router, otc, tokensPerUsd: "1000", marginBps: 1000, file, engineKey: KEY, startBlock: start, confirmations: 2, minDepositUsd: "0.01", publicUrl: "https://example.test" };
  let d = new InferenceDesk(settings, () => ({ verified: false, agent: null }));
  check(d.problems.length === 0, `no settings problems (${d.problems.join("; ") || "none"})`);
  await d.poll();
  const credit = (who: string) => BigInt(d.ledger.accountFor(who.toLowerCase())?.depositedMicroUsd ?? "0");
  const usdFor = (units: bigint) => (units * 1_000_000n) / (1000n * E18);
  check(credit(alice.address) === usdFor(direct) + usdFor(aliceBundle), `alice credited for her direct payment and her part of the bundle ($${Number(credit(alice.address)) / 1e6})`);
  check(credit(carol.address) === usdFor(carolBundle), "carol credited for exactly her part of the bundle, not alice's");
  check(credit(bob.address) === usdFor(bought) + usdFor(part), `bob credited for the router buy and the P2P fill, not the router or the OTC contract`);
  check(!d.ledger.accountFor(router.toLowerCase()) && !d.ledger.accountFor(otc.toLowerCase()), "no account was opened for the router or the OTC contract");
  check(credit(carol.address) === usdFor(carolBundle), "carol, the seller on the P2P book, was not credited for the fill");
  await d.poll();
  check(BigInt(d.ledger.accountFor(bob.address.toLowerCase())!.depositedMicroUsd) === usdFor(bought) + usdFor(part), "replay is idempotent");

  // burn keeper
  const inDesk = await read<bigint>(token, "MockPonsToken", "balanceOf", [desk]);
  await d.burn();
  check(await read<bigint>(token, "MockPonsToken", "balanceOf", [desk]) === 0n, "the keeper burned everything in the desk");
  check(await read<bigint>(desk, "InferenceDesk", "totalBurned") === inDesk, "totalBurned matches what was paid in");
  check(d.ledger.depositsOf(d.ledger.accountFor(alice.address.toLowerCase())!.id).every((x) => !!x.burnTx), "deposits are marked with the burn transaction");
  const stats = await d.stats();
  check(BigInt(stats.burnedTokens) === inDesk, "stats report the burned total");

  // P2P index
  await d.updateBook();
  const book = (await (async () => { const out: { orders: { id: number; tokenLeft: string }[]; fills: { toDesk: boolean }[] } = { orders: [], fills: [] }; Object.assign(out, (d as unknown as { otc: { view(): typeof out } }).otc.view()); return out; })());
  check(book.orders.length === 1 && BigInt(book.orders[0].tokenLeft) === carolBal / 2n - part, "the P2P book shows carol's ask with the filled part taken off");
  check(book.fills.length === 1 && book.fills[0].toDesk, "the fill is on the tape, marked as going to credit");

  // durability: a new desk over the same file sees the same balances
  d = new InferenceDesk(settings, () => ({ verified: false, agent: null }));
  check(credit(bob.address) === usdFor(bought) + usdFor(part), "balances survive a restart (file store)");
  check(new FileStore(file).count("icm_deposits") === 5, "five deposits on disk");

  // HTTP: rate card, models without prices, sign-in, keys
  const srv = createServer(async (req, res) => { if (!(await d.handle(req, res, (req.url ?? "/").split("?")[0]))) { res.statusCode = 404; res.end("{}"); } });
  await new Promise<void>((ok) => srv.listen(0, ok));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  const j = async (p: string, body?: unknown) => { const x = await fetch(base + p, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}); return { status: x.status, json: await x.json() as Record<string, unknown> }; };
  const card = await j("/icm");
  const text = JSON.stringify(card.json);
  check(card.status === 200 && (card.json.deposit as { address: string }).address === desk.toLowerCase(), "/icm names the desk");
  check(!/margin/i.test(text), "/icm never mentions the margin");
  check(!/margin/i.test(JSON.stringify((await j("/icm/v1/rate")).json)), "/v1/rate never mentions the margin");
  const { message } = (await j("/icm/nonce", { address: bob.address })).json as { message: string };
  check(message.startsWith("www.trenchers.io wants you to sign in") && message.includes("Chain ID: 31337"), "the sign-in message is in the Sign-In with Ethereum form");
  await j("/icm/nonce", { address: bob.address }); // somebody else asking for a nonce in bob's name cancels nothing
  const bad = await j("/icm/account", { address: bob.address, signature: `0x${"11".repeat(65)}` });
  check(bad.status === 401, "a wrong signature is refused");
  const signature = await wal(bob).signMessage({ message, account: bob });
  const acct = await j("/icm/account", { address: bob.address, signature });
  check(acct.status === 200 && (acct.json.account as { owner: string }).owner === bob.address.toLowerCase(), "a signed message opens bob's account");
  const slash = await fetch(`${base}/icm/v1/models/`).then((x) => x.text());
  check(!/pricing|prompt|completion/.test(slash), "the model list carries no prices, however the path is spelled");
  const stranger = await j("/icm/nonce", { address: "0x000000000000000000000000000000000000beef" });
  check(stranger.status === 200, "any wallet can ask to sign in");
  const replay = await j("/icm/account", { address: bob.address, signature });
  check(replay.status === 401 || replay.status === 400, "the same signature cannot be used twice");
  const n2 = (await j("/icm/nonce", { address: bob.address })).json as { message: string };
  const minted = await j("/icm/keys", { address: bob.address, signature: await wal(bob).signMessage({ message: n2.message, account: bob }), label: "bot", spendLimitUsd: "2" });
  const secret = String(minted.json.secret ?? "");
  check(minted.status === 201 && secret.startsWith("trench_live_"), "a key is minted with the trench_ prefix");
  const me = await fetch(`${base}/icm/v1/key`, { headers: { authorization: `Bearer ${secret}` } }).then((x) => x.json()) as { limit: { limit: string } };
  check(me.limit?.limit === "2.000000" || String(me.limit?.limit).startsWith("2"), "the key reads its own balance and ceiling");
  const chat = await fetch(`${base}/icm/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ model: "x/y", messages: [{ role: "user", content: "gm" }] }) });
  check(chat.status === 503, "without a provider key, a call is refused with a reason and costs nothing");
  check(BigInt(d.ledger.accountFor(bob.address.toLowerCase())!.balanceMicroUsd) === usdFor(bought) + usdFor(part), "the refused call held nothing back");
  check(d.ledger.check().length === 0, "the ledger balances");
  srv.close();

  console.log(failures ? `\n${failures} check(s) failed` : "\nall inference checks passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
