const { expect } = require("chai");
const { ethers } = require("hardhat");

const E = (v) => ethers.parseEther(v);
const SALT = ethers.ZeroHash;

// An agent wallet trading Pons coins through the adapter, driven by the engine, within the holder's caps.
async function setup() {
  const [deployer, safe, dev, team, alice, engine, stranger] = await ethers.getSigners();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(safe.address, dev.address, Math.floor(Date.now() / 1000));
  const nft = await (await ethers.getContractFactory("TrenchersNFT")).deploy(await splitter.getAddress(), team.address, "", "", E("0.02"));
  await nft.setMintOpen(true);
  await nft.connect(alice).mint(1, { value: E("0.02") }); // #6
  const registry = await (await ethers.getContractFactory("MockERC6551Registry")).deploy();
  const pons = await (await ethers.getContractFactory("MockPonsFactory")).deploy();
  const adapter = await (await ethers.getContractFactory("PonsAdapter")).deploy(await pons.getAddress(), safe.address);
  const config = await (await ethers.getContractFactory("AgentConfig")).deploy(safe.address);
  await config.connect(safe).propose(0, engine.address);
  await config.connect(safe).propose(1, await adapter.getAddress());
  const logic = await (await ethers.getContractFactory("TrenchersAgentAccount")).deploy(await config.getAddress(), safe.address);
  await config.connect(safe).propose(4, await logic.getAddress());
  const impl = await (await ethers.getContractFactory("TrenchersAgentWallet")).deploy(await config.getAddress());
  const { chainId } = await ethers.provider.getNetwork();
  await registry.createAccount(await impl.getAddress(), SALT, chainId, await nft.getAddress(), 6);
  const acct = await ethers.getContractAt("TrenchersAgentAccount", await registry.account(await impl.getAddress(), SALT, chainId, await nft.getAddress(), 6));
  await alice.sendTransaction({ to: await acct.getAddress(), value: E("1") });
  await acct.connect(alice).setPolicy(E("0.1"), E("0.25"), true, ethers.id("rule"), "test rule");
  const launch = async (name, maxSpend = E("100")) => {
    const tx = await pons.launch(name, maxSpend, { value: E("5") });
    const log = (await tx.wait()).logs.map((l) => { try { return pons.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "TokenLaunched");
    return { token: await ethers.getContractAt("MockPonsToken", log.args.token), curve: log.args.curve };
  };
  const buyData = (token, minOut = 0n) => adapter.interface.encodeFunctionData("buy", [token, minOut]);
  const sellData = (token, amount, minOut = 0n) => adapter.interface.encodeFunctionData("sell", [token, amount, minOut]);
  return { alice, engine, stranger, acct, adapter, pons, launch, buyData, sellData };
}

describe("PonsAdapter", () => {
  it("lets the engine buy a Pons coin for the agent and sell it back, all value staying in the agent wallet", async () => {
    const { engine, acct, launch, buyData, sellData } = await setup();
    const { token } = await launch("MOON");
    const w = await acct.getAddress();
    await expect(acct.connect(engine).trade(E("0.05"), buyData(await token.getAddress()))).to.changeEtherBalance(w, -E("0.05"));
    const bal = await token.balanceOf(w);
    expect(bal).to.be.gt(0n);
    await acct.connect(engine).approveRouter(await token.getAddress(), bal);
    const before = await ethers.provider.getBalance(w);
    await acct.connect(engine).trade(0, sellData(await token.getAddress(), bal));
    expect(await token.balanceOf(w)).to.equal(0n);
    const back = (await ethers.provider.getBalance(w)) - before;
    expect(back).to.be.gt(E("0.048")).and.lt(E("0.05")); // two 1% fees
  });

  it("forwards a partial-fill refund to the agent wallet", async () => {
    const { engine, acct, adapter, launch, buyData } = await setup();
    const { token } = await launch("NEAR", E("0.02"));
    const w = await acct.getAddress();
    await expect(acct.connect(engine).trade(E("0.05"), buyData(await token.getAddress()))).to.changeEtherBalance(w, -E("0.02"));
    expect(await ethers.provider.getBalance(await adapter.getAddress())).to.equal(0n);
  });

  it("refuses coins that are not genuine Pons launches, or not paired with ETH", async () => {
    const { engine, acct, adapter, pons, buyData } = await setup();
    const fake = await (await ethers.getContractFactory("MockPonsToken")).deploy("FAKE", engine.address, 1000n);
    await expect(acct.connect(engine).trade(E("0.01"), buyData(await fake.getAddress()))).to.be.revertedWithCustomError(acct, "CallFailed");
    await expect(adapter.buy(await fake.getAddress(), 0, { value: 1 })).to.be.revertedWithCustomError(adapter, "NotPonsToken");
    await pons.registerNonEth(await fake.getAddress(), engine.address, engine.address);
    await expect(adapter.buy(await fake.getAddress(), 0, { value: 1 })).to.be.revertedWithCustomError(adapter, "NotEthPaired");
  });

  it("never lets an agent trade its own coin", async () => {
    const { alice, engine, acct, adapter, launch, buyData } = await setup();
    const { token } = await launch("OWN");
    const t = await token.getAddress();
    // the holder launches the agent's coin through the configured launcher, which records it on the agent
    const [, safe] = await ethers.getSigners();
    const launcher = await (await ethers.getContractFactory("MockRouter")).deploy();
    const cfg = await ethers.getContractAt("AgentConfig", await acct.config());
    await cfg.connect(safe).propose(2, await launcher.getAddress());
    await acct.connect(alice).launchCoin(launcher.interface.encodeFunctionData("launch"), 0, t);
    expect(await acct.coin()).to.equal(t);
    const err = adapter.interface.encodeErrorResult("OwnCoin", []);
    await expect(acct.connect(engine).trade(E("0.01"), buyData(t))).to.be.revertedWithCustomError(acct, "CallFailed").withArgs(err);
    await expect(acct.connect(engine).approveRouter(t, 1)).to.be.revertedWithCustomError(acct, "NotAllowed");
  });

  it("keeps the holder's caps: per trade and per day, and nobody but the engine can trade", async () => {
    const { engine, stranger, acct, launch, buyData } = await setup();
    const { token } = await launch("CAPS");
    const t = await token.getAddress();
    await expect(acct.connect(stranger).trade(E("0.01"), buyData(t))).to.be.revertedWithCustomError(acct, "NotEngine");
    await expect(acct.connect(engine).trade(E("0.11"), buyData(t))).to.be.revertedWithCustomError(acct, "OverPerTrade");
    await acct.connect(engine).trade(E("0.1"), buyData(t));
    await acct.connect(engine).trade(E("0.1"), buyData(t));
    await expect(acct.connect(engine).trade(E("0.1"), buyData(t))).to.be.revertedWithCustomError(acct, "OverDailyCap");
  });

  it("after a coin graduates, trades it on its Uniswap v4 pool instead of the curve", async () => {
    const { engine, acct, adapter, pons, launch, buyData, sellData } = await setup();
    const { token } = await launch("GRAD");
    const t = await token.getAddress(), w = await acct.getAddress();
    // the agent holds some from before graduation
    await acct.connect(engine).trade(E("0.05"), buyData(t));
    const held = await token.balanceOf(w);
    await pons.graduate(t);
    expect(await adapter.venue(t)).to.equal(2n);
    expect(await adapter.poolPrice(t)).to.be.gt(0n);
    // it can still sell what it held: ETH comes back to the agent
    await acct.connect(engine).approveRouter(t, held);
    const before = await ethers.provider.getBalance(w);
    await acct.connect(engine).trade(0, sellData(t, held));
    expect(await token.balanceOf(w)).to.equal(0n);
    expect((await ethers.provider.getBalance(w)) - before).to.be.gt(E("0.045"));
    // and buy again, on the pool
    await expect(acct.connect(engine).trade(E("0.02"), buyData(t))).to.changeEtherBalance(w, -E("0.02"));
    expect(await token.balanceOf(w)).to.be.gt(0n);
    expect(await ethers.provider.getBalance(await adapter.getAddress())).to.equal(0n);
    expect(await token.balanceOf(await adapter.getAddress())).to.equal(0n);
  });

  it("enforces slippage on graduated coins, and nobody can call its pool callback from outside", async () => {
    const { engine, acct, adapter, pons, launch, buyData } = await setup();
    const { token } = await launch("SLIP");
    const t = await token.getAddress();
    await pons.graduate(t);
    const err = adapter.interface.encodeErrorResult("Slippage", []);
    await expect(acct.connect(engine).trade(E("0.01"), buyData(t, E("1000000000")))).to.be.revertedWithCustomError(acct, "CallFailed").withArgs(err);
    await expect(adapter.unlockCallback("0x")).to.be.revertedWithCustomError(adapter, "NotPoolManager");
  });
});
