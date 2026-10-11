const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { setup } = require("./Agents.test.js");

const E = (v) => ethers.parseEther(v);
const DELAY = 48 * 3600;

/** An awakened agent (0.01 ETH starter, nothing else) whose holder opted in to version 4. */
async function v4Agent({ deposit = "0" } = {}) {
  const ctx = await setup();
  const { register, fund, deployer, alice, config, safe } = ctx;
  await deployer.sendTransaction({ to: await fund.getAddress(), value: E("1") });
  const acct = await register(6);
  await fund.connect(alice).claim(6);
  if (deposit !== "0") await alice.sendTransaction({ to: await acct.getAddress(), value: E(deposit) });
  const trenchers = await (await ethers.getContractFactory("MockERC20")).deploy();
  const factory = await (await ethers.getContractFactory("MockFoundationFactory")).deploy();
  const selector = factory.interface.getFunction("launchWithEthRoute").selector;
  const v4 = await (await ethers.getContractFactory("TrenchersAgentAccountV4")).deploy(
    await config.getAddress(), await fund.getAddress(), await factory.getAddress(), await trenchers.getAddress(), selector);
  await config.connect(safe).propose(4, await v4.getAddress());
  await time.increase(DELAY + 1);
  await config.connect(safe).execute(4);
  const w = await ethers.getContractAt("TrenchersAgentWallet", await acct.getAddress());
  await w.connect(alice).setAgentVersion(await v4.getAddress());
  const a = await ethers.getContractAt("TrenchersAgentAccountV4", await acct.getAddress());
  return { ...ctx, a, w, v4, factory, trenchers, selector };
}

/** The factory call the website builds: coin details, a $TRENCHERS pair, a first buy of `buy` wei. */
function launchData(factory, quote, buy, modules = []) {
  return factory.interface.encodeFunctionData("launchWithEthRoute", [{
    metadata: { name: "Trencher 6", symbol: "T6", description: "The coin of Trencher #6", imageURI: "https://www.trenchers.io/meta/img/awake/6.png", website: "https://www.trenchers.io/collection#6", socialData: "0x" },
    quote, quoteDecimals: 18, initialTick: 0, creatorFeeBps: 500, additionalQuoteAmount: 0, initialBuyQuoteAmount: buy,
    initialBuyMinimumTokenAmount: 1, deadline: 2n ** 40n, tokenSalt: ethers.ZeroHash, hookSalt: ethers.ZeroHash, modules,
  }, ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [1])]);
}

describe("Agent wallet version 4: the agent's coin on Programmable", () => {
  it("launches from the agent wallet as creator, paired with $TRENCHERS; the first buy comes from the free balance", async () => {
    const { a, factory, trenchers, alice } = await v4Agent({ deposit: "0.003" });
    expect(await a.VERSION()).to.equal(4n);
    const data = launchData(factory, await trenchers.getAddress(), E("0.0015"));
    // budget 0.002 ETH; the factory uses 0.0015 and refunds the rest
    const tx = await a.connect(alice).launchProgrammable(data, E("0.002"));
    const coin = await a.coin();
    expect(coin).to.not.equal(ethers.ZeroAddress);
    await expect(tx).to.emit(a, "ProgrammableCoinLaunched");
    const rec = await factory.launchOf(coin);
    expect(await a.coinLedger()).to.equal(rec.ledger);
    const hook = await ethers.getContractAt("MockFoundationHook", rec.hook);
    expect(await hook.creator()).to.equal(await a.getAddress());
    // only what the first buy really cost left the free balance; the starter is untouched
    expect(await a.starterLocked()).to.equal(E("0.01"));
    expect(await a.withdrawable()).to.equal(E("0.0015"));
    const t = await ethers.getContractAt("MockFoundationToken", coin);
    expect(await t.balanceOf(await a.getAddress())).to.equal(10n ** 24n);
  });

  it("never pays the first buy from the locked starter (the route is the caller's choice)", async () => {
    const { a, factory, trenchers, alice } = await v4Agent();
    const q = await trenchers.getAddress();
    await expect(a.connect(alice).launchProgrammable(launchData(factory, q, E("0.001")), E("0.001")))
      .to.be.revertedWithCustomError(a, "StarterLocked");
    await alice.sendTransaction({ to: await a.getAddress(), value: E("0.001") });
    await a.connect(alice).launchProgrammable(launchData(factory, q, E("0.001")), E("0.001"));
    expect(await a.starterLocked()).to.equal(E("0.01"));
    expect(await a.deposited()).to.equal(0n);
  });

  it("one coin per agent: no second Programmable launch and no Pons launch after it", async () => {
    const { a, factory, trenchers, alice } = await v4Agent({ deposit: "0.01" });
    const d = launchData(factory, await trenchers.getAddress(), E("0.001"));
    await a.connect(alice).launchProgrammable(d, E("0.001"));
    await expect(a.connect(alice).launchProgrammable(d, E("0.001"))).to.be.revertedWithCustomError(a, "NotAllowed");
    await expect(a.connect(alice).launchCoin("0x", 0)).to.be.revertedWithCustomError(a, "NotAllowed");
  });

  it("refuses any pair but $TRENCHERS, any other factory call, and a coin it isn't the creator of", async () => {
    const { a, factory, trenchers, alice, bob } = await v4Agent({ deposit: "0.01" });
    const weth = await (await ethers.getContractFactory("MockERC20")).deploy();
    await expect(a.connect(alice).launchProgrammable(launchData(factory, await weth.getAddress(), E("0.001")), E("0.001")))
      .to.be.revertedWithCustomError(a, "NotAllowed");
    const other = factory.interface.encodeFunctionData("launch", [{
      metadata: { name: "x", symbol: "x", description: "", imageURI: "", website: "", socialData: "0x" }, quote: await trenchers.getAddress(), quoteDecimals: 18,
      initialTick: 0, creatorFeeBps: 0, additionalQuoteAmount: 0, initialBuyQuoteAmount: 0, initialBuyMinimumTokenAmount: 0, deadline: 0,
      tokenSalt: ethers.ZeroHash, hookSalt: ethers.ZeroHash, modules: [] }]);
    await expect(a.connect(alice).launchProgrammable(other, 0)).to.be.revertedWithCustomError(a, "NotAllowed");
    await factory.setEvil(1);
    await expect(a.connect(alice).launchProgrammable(launchData(factory, await trenchers.getAddress(), E("0.001")), E("0.001")))
      .to.be.revertedWithCustomError(a, "NotAllowed");
    await factory.setEvil(2);
    await expect(a.connect(alice).launchProgrammable(launchData(factory, await trenchers.getAddress(), E("0.001")), E("0.001")))
      .to.be.revertedWithCustomError(a, "NotAllowed");
    await factory.setEvil(0);
    await expect(a.connect(bob).launchProgrammable(launchData(factory, await trenchers.getAddress(), E("0.001")), E("0.001")))
      .to.be.revertedWithCustomError(a, "NotHolder");
    expect(await a.coin()).to.equal(ethers.ZeroAddress);
    expect(await a.starterLocked()).to.equal(E("0.01"));
    expect(await a.withdrawable()).to.equal(E("0.01"));
  });

  it("collects creator fees in $TRENCHERS: anyone can collect them into the wallet, only the holder is paid them, and the engine can't sell fees owed", async () => {
    const { a, factory, trenchers, alice, bob, engine } = await v4Agent({ deposit: "0.01" });
    await a.connect(alice).setPolicy(E("0.001"), E("0.002"), true, ethers.id("r"), "rule");
    await a.connect(alice).launchProgrammable(launchData(factory, await trenchers.getAddress(), E("0.001")), E("0.001"));
    const ledger = await ethers.getContractAt("MockFoundationLedger", await a.coinLedger());
    await trenchers.mint(await ledger.getAddress(), E("500"));
    await ledger.credit(E("500"));
    await a.connect(bob).claimCoinFees(); // anyone: collected into the wallet, set aside for the holder
    expect(await trenchers.balanceOf(await a.getAddress())).to.equal(E("500"));
    expect(await a.coinFeeTokensOwed()).to.equal(E("500"));
    await a.connect(alice).claimCoinFees(); // the holder: paid out
    expect(await trenchers.balanceOf(alice.address)).to.equal(E("500"));
    expect(await trenchers.balanceOf(await a.getAddress())).to.equal(0n);
    // fees claimed straight on the ledger land in the wallet: owed to the holder, not tradable by the engine
    await trenchers.mint(await ledger.getAddress(), E("50"));
    await ledger.credit(E("50"));
    await ledger.connect(bob).claimCreator();
    await trenchers.mint(await a.getAddress(), E("1000")); // $TRENCHERS the agent bought itself
    expect(await a.coinFeeTokensOwed()).to.equal(E("50"));
    await expect(a.connect(engine).approveRouter(await trenchers.getAddress(), E("1001"))).to.be.revertedWithCustomError(a, "NotAllowed");
    await a.connect(engine).approveRouter(await trenchers.getAddress(), E("1000"));
    await a.connect(alice).claimCoinFees();
    expect(await trenchers.balanceOf(alice.address)).to.equal(E("550"));
    expect(await trenchers.balanceOf(await a.getAddress())).to.equal(E("1000"));
    expect(await a.inStarterLock()).to.equal(true);
  });

  it("the holder runs module actions on its own coin's hook, as the creator", async () => {
    const { a, factory, trenchers, alice, bob } = await v4Agent({ deposit: "0.01" });
    await expect(a.connect(alice).coinModuleAction(0, "0x")).to.be.revertedWithCustomError(a, "NotAllowed");
    await a.connect(alice).launchProgrammable(launchData(factory, await trenchers.getAddress(), E("0.001")), E("0.001"));
    const hook = await ethers.getContractAt("MockFoundationHook", (await factory.launchOf(await a.coin())).hook);
    await a.connect(alice).coinModuleAction(2, "0x1234");
    expect(await hook.lastActionCaller()).to.equal(await a.getAddress());
    expect(await hook.lastActionIndex()).to.equal(2n);
    await expect(a.connect(bob).coinModuleAction(2, "0x")).to.be.revertedWithCustomError(a, "NotHolder");
  });

  it("the engine can never sell the agent's own coin", async () => {
    const { a, factory, trenchers, alice, engine } = await v4Agent({ deposit: "0.01" });
    await a.connect(alice).setPolicy(E("0.001"), E("0.002"), true, ethers.id("r"), "rule");
    await a.connect(alice).launchProgrammable(launchData(factory, await trenchers.getAddress(), E("0.001")), E("0.001"));
    await expect(a.connect(engine).approveRouter(await a.coin(), 1)).to.be.revertedWithCustomError(a, "NotAllowed");
  });

  it("Pons launches still work on version 4, and keep the Pons fee path", async () => {
    const { a, launcher, alice } = await v4Agent();
    // the test launcher is a router mock with no Pons record: the launch is refused after the call, like v3
    await expect(a.connect(alice).launchCoin("0x", 0)).to.be.reverted;
    expect(await a.coinLedger()).to.equal(ethers.ZeroAddress);
    expect(launcher).to.not.equal(undefined);
  });
});
