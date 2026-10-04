const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { setup } = require("./Agents.test.js");

const E = (v) => ethers.parseEther(v);
const DELAY = 48 * 3600;

/** An awakened agent with a starter balance, a deposit and a live policy, plus a deployed fixed version. */
async function agent() {
  const ctx = await setup();
  const { register, fund, deployer, alice, config } = ctx;
  await deployer.sendTransaction({ to: await fund.getAddress(), value: E("1") });
  const acct = await register(6);
  await fund.connect(alice).claim(6);
  await alice.sendTransaction({ to: await acct.getAddress(), value: E("0.5") });
  await acct.connect(alice).setPolicy(E("0.02"), E("0.1"), true, ethers.id("rule v1"), "Buy every new launch, sell after 15 seconds.");
  const v2 = await (await ethers.getContractFactory("AgentAccountV2Mock")).deploy(await config.getAddress());
  const asV2 = await ethers.getContractAt("AgentAccountV2Mock", await acct.getAddress());
  const w = await ethers.getContractAt("TrenchersAgentWallet", await acct.getAddress());
  return { ...ctx, acct, v2, asV2, w };
}
async function offer(ctx) {
  await ctx.config.connect(ctx.safe).propose(4, await ctx.v2.getAddress());
  await time.increase(DELAY + 1);
  await ctx.config.connect(ctx.safe).execute(4);
}

describe("Agent wallets: fixed by default, holder opt-in fixes", () => {
  it("every wallet runs the original code, and a team-offered version changes nothing on its own", async () => {
    const ctx = await agent();
    const { w, asV2, logic, impl, config, safe, alice, v2 } = ctx;
    expect(await impl.ORIGINAL_VERSION()).to.equal(await logic.getAddress());
    expect(await w.agentLogic()).to.equal(await logic.getAddress());
    await expect(config.connect(alice).propose(4, await v2.getAddress())).to.be.revertedWith("Ownable: caller is not the owner");
    await config.connect(safe).propose(4, await v2.getAddress());
    await expect(config.connect(safe).execute(4)).to.be.revertedWithCustomError(config, "TooEarly");
    await time.increase(DELAY + 1);
    await config.connect(safe).execute(4);
    expect(await config.isAccountLogic(await v2.getAddress())).to.equal(true);
    // Offered, but the agent still runs the original until its holder opts in.
    expect(await w.agentLogic()).to.equal(await logic.getAddress());
    await expect(asV2.versionTwo()).to.be.reverted;
  });

  it("the holder opts in to an offered fix; address, ETH, lock, rules and trading carry over", async () => {
    const ctx = await agent();
    const { acct, w, asV2, v2, alice, engine, swapData } = ctx;
    const addr = await acct.getAddress();
    const bal = await ethers.provider.getBalance(addr);
    await expect(w.connect(alice).setAgentVersion(await v2.getAddress())).to.be.revertedWithCustomError(w, "UnknownVersion"); // not offered yet
    await offer(ctx);
    await expect(w.connect(alice).setAgentVersion(await v2.getAddress())).to.emit(w, "AgentVersionChosen").withArgs(alice.address, await v2.getAddress());
    expect(await asV2.versionTwo()).to.equal(2n);
    expect(await acct.getAddress()).to.equal(addr);
    expect(await ethers.provider.getBalance(addr)).to.equal(bal);
    expect(await acct.starterLocked()).to.equal(E("0.01"));
    expect(await acct.withdrawable()).to.equal(E("0.5"));
    expect(await acct.ruleVersion()).to.equal(1n);
    expect((await acct.policy()).live).to.equal(true);
    await acct.connect(engine).trade(E("0.02"), swapData);
    await expect(acct.connect(engine).trade(E("0.03"), swapData)).to.be.revertedWithCustomError(acct, "OverPerTrade");
  });

  it("the holder can switch back to the original at any time", async () => {
    const ctx = await agent();
    const { w, asV2, v2, alice, logic } = ctx;
    await offer(ctx);
    await w.connect(alice).setAgentVersion(await v2.getAddress());
    await w.connect(alice).setAgentVersion(await logic.getAddress());
    expect(await w.chosenAgentVersion()).to.equal(ethers.ZeroAddress);
    expect(await w.agentLogic()).to.equal(await logic.getAddress());
    await expect(asV2.versionTwo()).to.be.reverted;
  });

  it("only the current holder chooses; nobody else (team included) can switch a wallet", async () => {
    const ctx = await agent();
    const { w, v2, nft, alice, bob, safe } = ctx;
    await offer(ctx);
    await expect(w.connect(safe).setAgentVersion(await v2.getAddress())).to.be.revertedWithCustomError(w, "NotHolder");
    await expect(w.connect(bob).setAgentVersion(await v2.getAddress())).to.be.revertedWithCustomError(w, "NotHolder");
    await expect(w.connect(alice).setAgentVersion(bob.address)).to.be.revertedWithCustomError(w, "UnknownVersion");
    await nft.connect(alice).transferFrom(alice.address, bob.address, 6);
    await expect(w.connect(alice).setAgentVersion(await v2.getAddress())).to.be.revertedWithCustomError(w, "NotHolder");
    await w.connect(bob).setAgentVersion(await v2.getAddress());
  });

  it("an offer can be cancelled before it goes out, and only contracts can be offered", async () => {
    const ctx = await agent();
    const { config, safe, v2, bob } = ctx;
    await config.connect(safe).propose(4, await v2.getAddress());
    await config.connect(safe).cancel(4);
    await time.increase(DELAY + 1);
    await expect(config.connect(safe).execute(4)).to.be.revertedWithCustomError(config, "NoPending");
    expect(await config.isAccountLogic(await v2.getAddress())).to.equal(false);
    await expect(config.connect(safe).propose(4, bob.address)).to.be.revertedWithCustomError(config, "NotContract");
  });
});

describe("Pausing", () => {
  it("any holder can pause their own agent at any time", async () => {
    const { acct, alice, bob, engine, swapData } = await agent();
    await expect(acct.connect(bob).pause()).to.be.revertedWithCustomError(acct, "NotHolder");
    await acct.connect(alice).pause();
    await expect(acct.connect(engine).trade(E("0.01"), swapData)).to.be.revertedWithCustomError(acct, "Paused");
  });

  it("emergency stop: the guardian or the Safe stops all engine trading at once; holders can still withdraw", async () => {
    const { acct, config, safe, alice, bob, engine, swapData } = await agent();
    await expect(config.connect(bob).pause()).to.be.revertedWithCustomError(config, "NotAllowed");
    await config.connect(safe).setGuardian(bob.address);
    await expect(config.connect(bob).pause()).to.emit(config, "Paused");

    await expect(acct.connect(engine).trade(E("0.01"), swapData)).to.be.revertedWithCustomError(acct, "TradingPaused");
    await expect(acct.connect(engine).approveRouter(await config.getAddress(), 1n)).to.be.revertedWithCustomError(acct, "TradingPaused");
    await expect(acct.connect(alice).withdraw(E("0.5"))).to.emit(acct, "Withdrawn");

    await expect(config.connect(bob).unpause()).to.be.revertedWith("Ownable: caller is not the owner");
    await alice.sendTransaction({ to: await acct.getAddress(), value: E("0.1") });
    await config.connect(safe).unpause();
    await acct.connect(engine).trade(E("0.01"), swapData);
  });
});
