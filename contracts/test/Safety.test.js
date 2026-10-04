const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const E = (v) => ethers.parseEther(v);
const SALT = ethers.ZeroHash;
const DELAY = 48 * 3600;

// The safety net: for every contract that can hold ETH or tokens, the owner (the team Safe) or the
// NFT holder can always get it out, and pooled money can only move after a public 48-hour delay.
async function setup() {
  const [deployer, safe, dev, team, alice, bob, engine, rescue] = await ethers.getSigners();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(safe.address, dev.address, await time.latest());
  const nft = await (await ethers.getContractFactory("TrenchersNFT")).deploy(await splitter.getAddress(), team.address, "", "", E("0.02"));
  const registry = await (await ethers.getContractFactory("MockERC6551Registry")).deploy();
  const fund = await (await ethers.getContractFactory("AgentStarterFund")).deploy(safe.address, await nft.getAddress(), await registry.getAddress(), E("0.01"), DELAY);
  const config = await (await ethers.getContractFactory("AgentConfig")).deploy(safe.address);
  await config.connect(safe).propose(0, engine.address);
  await config.connect(safe).propose(3, await fund.getAddress());
  const impl = await (await ethers.getContractFactory("TrenchersAgentAccount")).deploy(await config.getAddress());
  await fund.connect(safe).setAccount(await impl.getAddress(), SALT);
  await splitter.connect(safe).setPrimarySeller(await nft.getAddress());
  await splitter.connect(safe).proposeDestination(3, await fund.getAddress());
  await nft.setMintOpen(true);
  await nft.connect(alice).mint(3, { value: E("0.06") }); // #6 #7 #8, funds the starter fund with 0.0306
  return { deployer, safe, dev, team, alice, bob, engine, rescue, splitter, nft, registry, fund, config, impl };
}

describe("Safety net", () => {
  it("starter fund: the owner can move everything out, but only in public, after 48 hours", async () => {
    const { safe, alice, rescue, fund } = await setup();
    const held = await ethers.provider.getBalance(await fund.getAddress());
    expect(held).to.equal(E("0.0306"));
    await expect(fund.connect(alice).proposeRescue(alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(fund.connect(safe).executeRescue([])).to.be.revertedWithCustomError(fund, "NoRescue");
    await expect(fund.connect(safe).proposeRescue(rescue.address)).to.emit(fund, "RescueProposed");
    await expect(fund.connect(safe).executeRescue([])).to.be.revertedWithCustomError(fund, "RescueTooEarly");
    await fund.connect(alice).claim(6); // claims keep working while a rescue is pending
    await time.increase(DELAY);
    await expect(fund.connect(safe).executeRescue([])).to.changeEtherBalance(rescue, held - E("0.01"));
    expect(await fund.shutdown()).to.equal(true);
    await expect(fund.connect(alice).claim(7)).to.be.revertedWithCustomError(fund, "IsShutdown");
  });

  it("starter fund: a proposed rescue can be cancelled", async () => {
    const { safe, rescue, fund } = await setup();
    await fund.connect(safe).proposeRescue(rescue.address);
    await fund.connect(safe).cancelRescue();
    await time.increase(DELAY);
    await expect(fund.connect(safe).executeRescue([])).to.be.revertedWithCustomError(fund, "NoRescue");
  });

  it("the rescue delay is public and capped at 7 days", async () => {
    const { safe, nft, registry, fund } = await setup();
    expect(await fund.rescueDelay()).to.equal(BigInt(DELAY));
    await expect((await ethers.getContractFactory("AgentStarterFund")).deploy(safe.address, await nft.getAddress(), await registry.getAddress(), E("0.01"), 8 * 86400))
      .to.be.revertedWithCustomError(fund, "RescueDelayTooLong");
  });

  it("fee distributor: same timelocked rescue, including tokens", async () => {
    const { safe, rescue, nft, registry } = await setup();
    const dist = await (await ethers.getContractFactory("AgentFeeDistributor")).deploy(safe.address, await registry.getAddress(), await nft.getAddress(), DELAY);
    await safe.sendTransaction({ to: await dist.getAddress(), value: E("1") });
    const tok = await (await ethers.getContractFactory("MockERC20")).deploy();
    await tok.mint(await dist.getAddress(), 500n);
    await dist.connect(safe).proposeRescue(rescue.address);
    await time.increase(DELAY);
    await expect(dist.connect(safe).executeRescue([await tok.getAddress()])).to.changeEtherBalance(rescue, E("1"));
    expect(await tok.balanceOf(rescue.address)).to.equal(500n);
    await expect(dist.closeEpoch()).to.be.revertedWithCustomError(dist, "IsShutdown");
  });

  it("revenue splitter: every bucket can be redirected by the owner (48h), and stray ETH swept at once", async () => {
    const { safe, alice, rescue, splitter } = await setup();
    await (await ethers.getContractFactory("ForceSend")).deploy(await splitter.getAddress(), { value: E("0.3") });
    expect(await splitter.unaccounted()).to.equal(E("0.3"));
    await expect(splitter.connect(alice).rescueUnaccounted(alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(splitter.connect(safe).rescueUnaccounted(rescue.address)).to.changeEtherBalance(rescue, E("0.3"));
    expect(await splitter.unaccounted()).to.equal(0n);
    // bucket money: buybacks have no destination yet, the owner sets one (first time: immediate) and releases
    await splitter.connect(safe).proposeDestination(0, rescue.address);
    const owed = await splitter.owed(0);
    expect(owed).to.be.gt(0n);
    await expect(splitter.release(0)).to.changeEtherBalance(rescue, owed);
  });

  it("NFT contract and Pons adapter: anything sent there by mistake can be swept by the owner", async () => {
    const { safe, alice, rescue, nft } = await setup();
    const tok = await (await ethers.getContractFactory("MockERC20")).deploy();
    await tok.mint(await nft.getAddress(), 77n);
    await expect(nft.connect(alice).sweep(await tok.getAddress(), alice.address)).to.be.revertedWithCustomError(nft, "SweepFailed");
    await nft.sweep(await tok.getAddress(), rescue.address); // deployer is the NFT owner here
    expect(await tok.balanceOf(rescue.address)).to.equal(77n);
    const pons = await (await ethers.getContractFactory("MockPonsFactory")).deploy();
    const adapter = await (await ethers.getContractFactory("PonsAdapter")).deploy(await pons.getAddress(), safe.address);
    await alice.sendTransaction({ to: await adapter.getAddress(), value: E("0.2") });
    await expect(adapter.connect(alice).sweep(ethers.ZeroAddress, alice.address)).to.be.revertedWithCustomError(adapter, "SweepFailed");
    await expect(adapter.connect(safe).sweep(ethers.ZeroAddress, rescue.address)).to.changeEtherBalance(rescue, E("0.2"));
  });

  it("agent wallet: the NFT holder always gets everything out; the starter after 6 months, tokens too", async () => {
    const { alice, bob, fund, registry, impl, nft } = await setup();
    await fund.connect(alice).claim(6);
    const w = await fund.agentWallet(6);
    const acct = await ethers.getContractAt("TrenchersAgentAccount", w);
    await alice.sendTransaction({ to: w, value: E("0.5") });
    await expect(acct.connect(bob).withdraw(E("0.1"))).to.be.revertedWithCustomError(acct, "NotHolder");
    await expect(acct.connect(alice).withdraw(E("0.5"))).to.changeEtherBalance(alice, E("0.5"));
    const tok = await (await ethers.getContractFactory("MockERC20")).deploy();
    await tok.mint(w, 1000n);
    await time.increase(181 * 86400);
    await expect(acct.connect(alice).withdraw(E("0.01"))).to.changeEtherBalance(alice, E("0.01"));
    await acct.connect(alice).execute(await tok.getAddress(), 0, tok.interface.encodeFunctionData("transfer", [alice.address, 1000n]), 0);
    expect(await tok.balanceOf(alice.address)).to.equal(1000n);
    void registry; void impl; void nft;
  });
});
