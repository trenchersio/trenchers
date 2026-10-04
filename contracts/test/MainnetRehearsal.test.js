const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Mainnet launch rehearsal: the exact deployment the launch page (web/components/launch/MainnetLaunch.tsx)
 * performs, step by step and with the same arguments, then the three guarantees:
 *   1. minting works and awakened agents can trade (curve and Uniswap pool);
 *   2. every wei that enters the system can be recovered;
 *   3. trading can be fixed after launch without holders doing anything.
 * Run it as Robinhood Chain mainnet too: HH_CHAIN_ID=4663 npx hardhat test test/MainnetRehearsal.test.js
 */
const E = (v) => ethers.parseEther(v);
const DAY = 86400, DELAY = 48 * 3600;
const bal = (a) => ethers.provider.getBalance(a);
const addr = (c) => c.getAddress();

async function launch() {
  const [deployer, safe, engine, guardian, a, b, c, d, stranger] = await ethers.getSigners();
  // Chain fixtures that exist on mainnet: the ERC-6551 registry and the Pons V2 launchpad.
  const registry = await (await ethers.getContractFactory("MockERC6551Registry")).deploy();
  const pons = await (await ethers.getContractFactory("MockPonsFactory")).deploy();
  const D = (name, args) => ethers.getContractFactory(name).then((f) => f.connect(deployer).deploy(...args));

  // --- the launch page, step by step (same order, same arguments) ---
  const splitter = await D("RevenueSplitter", [deployer.address, safe.address, await time.latest()]);
  const nft = await D("TrenchersNFT", [await addr(splitter), deployer.address, "https://trenchers.io/meta/contract.json", "https://trenchers.io/meta/contract.json", E("0.02")]);
  const fund = await D("AgentStarterFund", [safe.address, await addr(nft), await addr(registry), E("0.01"), DELAY]);
  const config = await D("AgentConfig", [deployer.address]);
  const logic = await D("TrenchersAgentAccount", [await addr(config), await addr(fund)]);
  await config.propose(4, await addr(logic));
  const impl = await D("TrenchersAgentWallet", [await addr(config)]);
  const dist = await D("AgentFeeDistributor", [deployer.address, await addr(registry), await addr(nft), DELAY]);
  await config.propose(3, await addr(fund));
  await nft.setStarterFund(await addr(fund));
  await nft.setBaseURI("https://trenchers.io/meta/");
  await config.propose(0, engine.address);
  await config.setGuardian(guardian.address);
  const adapter = await D("PonsAdapter", [await addr(pons), safe.address]);
  await config.propose(1, await addr(adapter));
  await dist.setAccount(await addr(impl), ethers.ZeroHash);
  await splitter.setPrimarySeller(await addr(nft));
  await splitter.proposeDestination(3, await addr(fund));
  await config.seal();
  await splitter.transferOwnership(safe.address);
  await nft.transferOwnership(safe.address);
  await config.transferOwnership(safe.address);
  await dist.transferOwnership(safe.address);

  const agentOf = async (id) => ethers.getContractAt("TrenchersAgentAccount", await fund.agentWallet(id));
  const launchCoin = async (name) => {
    const r = await (await pons.launch(name, E("100"), { value: E("5") })).wait();
    const ev = r.logs.map((l) => { try { return pons.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "TokenLaunched");
    return ethers.getContractAt("MockPonsToken", ev.args.token);
  };
  const buy = (t, min = 0n) => adapter.interface.encodeFunctionData("buy", [t, min]);
  const sell = (t, n, min = 0n) => adapter.interface.encodeFunctionData("sell", [t, n, min]);
  return { deployer, safe, engine, guardian, a, b, c, d, stranger, registry, pons, splitter, nft, fund, config, logic, impl, dist, adapter, agentOf, launchCoin, buy, sell };
}

/** The Safe's two transactions after deployment: open awakening, open the mint. */
async function open(x) {
  await x.fund.connect(x.safe).setAccount(await addr(x.impl), ethers.ZeroHash);
  await x.nft.connect(x.safe).setMintOpen(true);
}

describe("Mainnet launch rehearsal", () => {
  it("deploys exactly as the launch page does: the Safe owns everything, the Deployer keeps no power", async () => {
    const x = await launch();
    for (const c of [x.splitter, x.nft, x.fund, x.config, x.dist]) expect(await c.owner()).to.equal(x.safe.address);
    expect(await x.config.engine()).to.equal(x.engine.address);
    expect(await x.config.router()).to.equal(await addr(x.adapter));
    expect(await x.config.starterFund()).to.equal(await addr(x.fund));
    expect(await x.config.accountLogic()).to.equal(await addr(x.logic));
    expect(await x.config.guardian()).to.equal(x.guardian.address);
    expect(await x.config.launcher()).to.equal(ethers.ZeroAddress);
    expect(await x.config.isSealed()).to.equal(true);
    expect(await x.config.paused()).to.equal(false);
    expect(await x.impl.ORIGINAL_VERSION()).to.equal(await addr(x.logic));
    expect(await x.logic.starterFund()).to.equal(await addr(x.fund));
    expect(await x.splitter.destination(1)).to.equal(x.safe.address); // dev share to the Safe
    expect(await x.splitter.destination(3)).to.equal(await addr(x.fund));
    expect(await x.splitter.primarySeller()).to.equal(await addr(x.nft));
    expect(await x.nft.mintPrice()).to.equal(E("0.02"));
    expect(await x.fund.CLAIM()).to.equal(E("0.01"));
    expect(await x.fund.rescueDelay()).to.equal(BigInt(DELAY));
    expect(await x.dist.rescueDelay()).to.equal(BigInt(DELAY));
    expect(await x.adapter.owner()).to.equal(x.safe.address);
    for (let id = 1; id <= 5; id++) expect(await x.nft.ownerOf(id)).to.equal(x.deployer.address); // house agents
    expect(await x.nft.totalSupply()).to.equal(5n);
    // the Deployer can't administer anything any more
    await expect(x.nft.connect(x.deployer).setMintOpen(true)).to.be.reverted;
    await expect(x.config.connect(x.deployer).propose(0, x.deployer.address)).to.be.reverted;
    await expect(x.config.connect(x.deployer).unpause()).to.be.reverted;
    await expect(x.splitter.connect(x.deployer).proposeDestination(0, x.deployer.address)).to.be.reverted;
    await expect(x.fund.connect(x.deployer).proposeRescue(x.deployer.address)).to.be.reverted;
    await expect(x.dist.connect(x.deployer).proposeRescue(x.deployer.address)).to.be.reverted;
    // closed until the Safe opens it
    await expect(x.nft.connect(x.a).mint(1, { value: E("0.02") })).to.be.reverted;
  });

  it("after the Safe opens it: mint up to 10 per transaction, 51% to the starter fund, awaken, metadata", async () => {
    const x = await launch();
    await open(x);
    await expect(x.nft.connect(x.a).mint(11, { value: E("0.22") })).to.be.reverted;
    await expect(x.nft.connect(x.a).mint(1, { value: E("0.019") })).to.be.reverted;
    await x.nft.connect(x.a).mint(10, { value: E("0.2") });   // #6-15
    await x.nft.connect(x.b).mint(10, { value: E("0.2") });   // #16-25
    await x.nft.connect(x.c).mint(1, { value: E("0.02") });   // #26
    expect(await x.nft.totalSupply()).to.equal(26n);
    expect(await x.splitter.totalPrimarySales()).to.equal(E("0.42"));
    // 51% reaches the starter fund (directly at mint, or once the waiting share is released)
    if ((await x.splitter.owed(3)) > 0n) await x.splitter.release(3);
    expect(await bal(await addr(x.fund))).to.equal(E("0.2142"));
    expect(await x.nft.tokenURI(6)).to.equal("https://trenchers.io/meta/dormant/6.json");
    await x.fund.connect(x.a).claim(6);
    expect(await x.nft.tokenURI(6)).to.equal("https://trenchers.io/meta/awake/6.json");
    const w = await x.agentOf(6);
    expect(await bal(await addr(w))).to.equal(E("0.01"));
    expect(await w.lockedNow()).to.equal(E("0.01"));
    await expect(x.fund.connect(x.b).claim(7)).to.be.revertedWithCustomError(x.fund, "NotHolder");
    await expect(x.fund.connect(x.a).claim(6)).to.be.revertedWithCustomError(x.fund, "AlreadyClaimed");
    await expect(x.fund.connect(x.deployer).claim(1)).to.be.revertedWithCustomError(x.fund, "NotEligible"); // house agents
  });

  it("an awakened agent trades with only its starter balance: buy and sell on Pons, then on the Uniswap pool after graduation", async () => {
    const x = await launch();
    await open(x);
    await x.nft.connect(x.a).mint(1, { value: E("0.02") });
    await x.fund.connect(x.a).claim(6);
    const w = await x.agentOf(6), wa = await addr(w);
    await w.connect(x.a).setPolicy(E("0.005"), E("0.02"), true, ethers.id("flip"), "Buy every new launch, sell after 15 seconds.");
    const coin = await x.launchCoin("REAL"); const t = await addr(coin);
    await w.connect(x.engine).trade(E("0.005"), x.buy(t));
    const held = await coin.balanceOf(wa);
    expect(held).to.be.gt(0n);
    await w.connect(x.engine).approveRouter(t, held / 2n);
    await w.connect(x.engine).trade(0, x.sell(t, held / 2n));
    await x.pons.graduate(t); // the curve sold out; nobody has created the pool yet
    const rest = await coin.balanceOf(wa);
    await w.connect(x.engine).approveRouter(t, rest);
    await w.connect(x.engine).trade(0, x.sell(t, rest)); // the route creates the pool, then sells on it
    expect(await coin.balanceOf(wa)).to.equal(0n);
    await w.connect(x.engine).trade(E("0.004"), x.buy(t));
    expect(await coin.balanceOf(wa)).to.be.gt(0n);
    expect(await bal(await addr(x.adapter))).to.equal(0n);
    expect(await w.lockedNow()).to.be.lte(E("0.01"));
  });

  it("house agents: the Deployer creates their wallets, funds them, they trade, and it withdraws everything", async () => {
    const x = await launch();
    await open(x);
    const { chainId } = await ethers.provider.getNetwork();
    await x.registry.createAccount(await addr(x.impl), ethers.ZeroHash, chainId, await addr(x.nft), 1);
    const w = await x.agentOf(1), wa = await addr(w);
    await x.deployer.sendTransaction({ to: wa, value: E("0.05") });
    expect(await w.lockedNow()).to.equal(0n);
    await w.connect(x.deployer).setPolicy(E("0.01"), E("0.05"), true, ethers.id("house"), "Buy every new launch, sell after 15 seconds.");
    const coin = await x.launchCoin("HOUSE"); const t = await addr(coin);
    await w.connect(x.engine).trade(E("0.01"), x.buy(t));
    const held = await coin.balanceOf(wa);
    await w.connect(x.engine).approveRouter(t, held);
    await w.connect(x.engine).trade(0, x.sell(t, held));
    const all = await bal(wa);
    await expect(w.connect(x.deployer).withdraw(all)).to.changeEtherBalance(x.deployer, all);
    expect(await bal(wa)).to.equal(0n);
  });

  it("every wei that enters the system can be recovered", async () => {
    const x = await launch();
    await open(x);
    const [, , , , a, b] = await ethers.getSigners();
    let inflow = 0n;
    const pay = async (signer, to, v) => { await signer.sendTransaction({ to, value: v }); inflow += v; };
    // money comes in every way it can
    await x.nft.connect(a).mint(10, { value: E("0.2") }); inflow += E("0.2");
    await x.nft.connect(b).mint(5, { value: E("0.1") }); inflow += E("0.1");
    await pay(b, await addr(x.splitter), E("0.03"));        // a marketplace royalty
    await (await ethers.getContractFactory("ForceSend")).deploy(await addr(x.splitter), { value: E("0.011") }); inflow += E("0.011"); // stray ETH
    await pay(b, await addr(x.dist), E("0.07"));            // 10% of $TRENCHERS fees
    await (await ethers.getContractFactory("ForceSend")).deploy(await addr(x.nft), { value: E("0.004") }); inflow += E("0.004"); // the NFT refuses ETH; forced in anyway
    await pay(b, await addr(x.adapter), E("0.006"));        // sent to the trading route by mistake
    if ((await x.splitter.owed(3)) > 0n) await x.splitter.release(3);
    await x.fund.connect(a).claim(6);
    await x.fund.connect(a).claim(7);
    const w6 = await x.agentOf(6);
    await pay(a, await addr(w6), E("0.05"));                // a holder's deposit
    const contracts = [x.splitter, x.nft, x.fund, x.dist, x.adapter, w6, await x.agentOf(7)];
    let held = 0n;
    for (const c of contracts) held += await bal(await addr(c));
    expect(held).to.equal(inflow); // nothing leaks anywhere else

    // --- recovery, by the Safe (and holders for their own agents) ---
    const safeBefore = await bal(x.safe.address);
    const gas = { safe: 0n };
    const s = async (p) => { const r = await (await p).wait(); gas.safe += r.gasUsed * r.gasPrice; };
    await s(x.splitter.connect(x.safe).proposeDestination(0, x.safe.address)); // buybacks (first time: immediate)
    await s(x.splitter.connect(x.safe).proposeDestination(2, x.safe.address)); // prize pool
    await s(x.splitter.connect(x.safe).rescueUnaccounted(x.safe.address));
    await time.increase(180 * DAY + 1); // the dev share's vested half
    for (const bucket of [0, 1, 2]) if ((await x.splitter.owed(bucket)) > 0n || bucket === 1) await s(x.splitter.connect(x.safe).release(bucket));
    if ((await x.splitter.owed(3)) > 0n) await x.splitter.release(3);
    await s(x.fund.connect(x.safe).proposeRescue(x.safe.address));
    await s(x.dist.connect(x.safe).proposeRescue(x.safe.address));
    await time.increase(DELAY);
    await s(x.fund.connect(x.safe).executeRescue([]));
    await s(x.dist.connect(x.safe).executeRescue([]));
    await s(x.nft.connect(x.safe).sweep(ethers.ZeroAddress, x.safe.address));
    await s(x.adapter.connect(x.safe).sweep(ethers.ZeroAddress, x.safe.address));
    // agent wallets: their holders withdraw everything (the starter is unlocked after 180 days)
    const aBefore = await bal(a.address);
    let aGas = 0n;
    for (const id of [6, 7]) {
      const w = await x.agentOf(id);
      const r = await (await w.connect(a).withdraw(await bal(await addr(w)))).wait(); aGas += r.gasUsed * r.gasPrice;
    }
    for (const c of contracts) expect(await bal(await addr(c)), "left in a contract").to.equal(0n);
    const toSafe = (await bal(x.safe.address)) - safeBefore + gas.safe;
    const toHolder = (await bal(a.address)) - aBefore + aGas;
    expect(toSafe + toHolder).to.equal(inflow); // every wei accounted for
  });

  it("trading can be fixed after launch: new trading route and new engine key, no action from holders", async () => {
    const x = await launch();
    await open(x);
    await x.nft.connect(x.a).mint(1, { value: E("0.02") });
    await x.fund.connect(x.a).claim(6);
    const w = await x.agentOf(6);
    await x.a.sendTransaction({ to: await addr(w), value: E("0.1") });
    await w.connect(x.a).setPolicy(E("0.01"), E("0.05"), true, ethers.id("r"), "Buy every new launch, sell after 15 seconds.");
    const coin = await x.launchCoin("FIX"); const t = await addr(coin);
    // 1. a bug in the trading route: pause everyone at once (guardian), ship a fixed route (48h notice)
    await x.config.connect(x.guardian).pause();
    await expect(w.connect(x.engine).trade(E("0.01"), x.buy(t))).to.be.revertedWithCustomError(w, "TradingPaused");
    await expect(w.connect(x.a).withdraw(E("0.1"))).to.not.be.reverted; // holders can always withdraw
    await x.a.sendTransaction({ to: await addr(w), value: E("0.1") });
    const fixed = await (await ethers.getContractFactory("PonsAdapter")).deploy(await addr(x.pons), x.safe.address);
    await x.config.connect(x.safe).propose(1, await addr(fixed));
    await expect(x.config.connect(x.safe).execute(1)).to.be.revertedWithCustomError(x.config, "TooEarly");
    await time.increase(DELAY + 1);
    await x.config.connect(x.safe).execute(1);
    await x.config.connect(x.safe).unpause();
    await w.connect(x.engine).trade(E("0.01"), fixed.interface.encodeFunctionData("buy", [t, 0n])); // same wallet, new route
    expect(await coin.balanceOf(await addr(w))).to.be.gt(0n);
    // 2. the engine key leaks: swap the engine (48h notice; pause in the meantime)
    await x.config.connect(x.safe).propose(0, x.stranger.address);
    await time.increase(DELAY + 1);
    await x.config.connect(x.safe).execute(0);
    await expect(w.connect(x.engine).trade(E("0.01"), x.buy(t))).to.be.revertedWithCustomError(w, "NotEngine");
    await w.connect(x.stranger).trade(E("0.01"), fixed.interface.encodeFunctionData("buy", [t, 0n]));
    // 3. a bug in the agent wallet itself: the Safe offers a fixed version, the holder opts in
    const v2 = await (await ethers.getContractFactory("AgentAccountV2Mock")).deploy(await addr(x.config), await addr(x.fund));
    await x.config.connect(x.safe).propose(4, await addr(v2));
    await time.increase(DELAY + 1);
    await x.config.connect(x.safe).execute(4);
    const wallet = await ethers.getContractAt("TrenchersAgentWallet", await addr(w));
    await wallet.connect(x.a).setAgentVersion(await addr(v2));
    expect(await (await ethers.getContractAt("AgentAccountV2Mock", await addr(w))).versionTwo()).to.equal(2n);
    await w.connect(x.stranger).trade(E("0.01"), fixed.interface.encodeFunctionData("buy", [t, 0n])); // still trading
  });
  it("the on-chain launch rehearsal (run against mainnet by the engine's /verify) passes, read-only, and changes nothing", async () => {
    const x = await launch();
    const curve = await addr(await x.launchCoin("CURVE"));
    const pool = await addr(await x.launchCoin("POOL"));
    await x.pons.graduateAll(pool);
    const code = async (n) => (await ethers.provider.getCode(await addr(await (await ethers.getContractFactory(n)).deploy())));
    const [reh, fwd] = [await code("LaunchRehearsal"), await code("Forwarder")];
    await ethers.provider.send("hardhat_setCode", [x.safe.address, reh]);
    for (const w of [x.engine, x.guardian, x.deployer]) await ethers.provider.send("hardhat_setCode", [w.address, fwd]);
    const r = await ethers.getContractAt("LaunchRehearsal", x.safe.address);
    const args = { nft: await addr(x.nft), fund: await addr(x.fund), splitter: await addr(x.splitter), config: await addr(x.config), impl: await addr(x.impl), adapter: await addr(x.adapter), registry: await addr(x.registry), engine: x.engine.address, guardian: x.guardian.address, deployer: x.deployer.address, curveCoin: curve, poolCoin: pool };
    const supply = await x.nft.totalSupply();
    const [n, before, after] = await r.run.staticCall(args, { value: E("1") });
    expect(n[0]).to.equal(supply + 1n);
    expect(n[1]).to.equal(E("0.01"));
    expect(n[2]).to.equal(E("0.01"));
    expect(n[13]).to.equal(E("0.0102"));
    expect(before).to.equal(`https://trenchers.io/meta/dormant/${n[0]}.json`);
    expect(after).to.equal(`https://trenchers.io/meta/awake/${n[0]}.json`);
    for (const i of [3, 5, 9]) expect(n[i]).to.be.gt(0n);
    expect(n[4]).to.be.gt(E("0.009")); expect(n[6]).to.be.gt(E("0.008"));
    expect(n[7]).to.be.gt(0n); // the top-up minus what trading lost from the locked starter
    expect(n[8]).to.equal(1n); expect(n[12]).to.equal(1n);
    expect(n[10]).to.be.gt(E("0.009"));
    expect(n[11]).to.be.gt(0n);
    // read-only: nothing changed
    expect(await x.nft.mintOpen()).to.equal(false);
    expect(await x.nft.totalSupply()).to.equal(supply);
    expect(await x.config.paused()).to.equal(false);
  });
});
