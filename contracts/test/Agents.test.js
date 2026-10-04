const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const E = (v) => ethers.parseEther(v);
const SALT = ethers.ZeroHash;

const MINT_PRICE = ethers.parseEther("0.02");
/** Mints n Trenchers to `signer` through the public mint (opening it if needed), 10 per transaction. */
async function mintAs(nft, signer, n) {
  if (!(await nft.mintOpen())) await nft.setMintOpen(true);
  while (n > 0) { const k = Math.min(10, n); await nft.connect(signer).mint(k, { value: MINT_PRICE * BigInt(k) }); n -= k; }
}

async function setup() {
  const [deployer, safe, dev, team, treasury, alice, bob, engine, keeper] = await ethers.getSigners();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(safe.address, dev.address, await time.latest());
  const nft = await (await ethers.getContractFactory("TrenchersNFT")).deploy(await splitter.getAddress(), team.address, "ipfs://pre.json", "ipfs://c.json", MINT_PRICE);
  await mintAs(nft, treasury, 20); // ids 6..25
  await nft.connect(treasury).transferFrom(treasury.address, alice.address, 6);
  await nft.connect(treasury).transferFrom(treasury.address, alice.address, 7);
  const registry = await (await ethers.getContractFactory("MockERC6551Registry")).deploy();
  const router = await (await ethers.getContractFactory("MockRouter")).deploy();
  const launcher = await (await ethers.getContractFactory("MockRouter")).deploy();
  const config = await (await ethers.getContractFactory("AgentConfig")).deploy(safe.address);
  const fund = await (await ethers.getContractFactory("AgentStarterFund")).deploy(safe.address, await nft.getAddress(), await registry.getAddress(), treasury.address, ethers.parseEther("0.01"));
  await config.connect(safe).propose(0, engine.address);
  await config.connect(safe).propose(1, await router.getAddress());
  await config.connect(safe).propose(2, await launcher.getAddress());
  await config.connect(safe).propose(3, await fund.getAddress());
  const impl = await (await ethers.getContractFactory("TrenchersAgentAccount")).deploy(await config.getAddress());
  await fund.connect(safe).setAccount(await impl.getAddress(), SALT);
  const { chainId } = await ethers.provider.getNetwork();
  const register = async (id) => {
    await registry.createAccount(await impl.getAddress(), SALT, chainId, await nft.getAddress(), id);
    const addr = await registry.account(await impl.getAddress(), SALT, chainId, await nft.getAddress(), id);
    return ethers.getContractAt("TrenchersAgentAccount", addr);
  };
  const swapData = router.interface.encodeFunctionData("swap");
  return { deployer, safe, team, treasury, alice, bob, engine, keeper, nft, registry, router, launcher, config, fund, impl, register, swapData, chainId };
}

describe("TrenchersAgentAccount", () => {
  it("is owned by whoever holds the NFT and reports its token", async () => {
    const { register, nft, alice, bob, chainId } = await setup();
    const acct = await register(6);
    const [c, tc, id] = await acct.token();
    expect(c).to.equal(chainId); expect(tc).to.equal(await nft.getAddress()); expect(id).to.equal(6n);
    expect(await acct.owner()).to.equal(alice.address);
    await nft.connect(alice).transferFrom(alice.address, bob.address, 6);
    expect(await acct.owner()).to.equal(bob.address);
  });

  it("locks the 0.01 ETH starter balance: claimable into the wallet, not withdrawable", async () => {
    const { register, fund, deployer, alice } = await setup();
    await deployer.sendTransaction({ to: await fund.getAddress(), value: E("1") });
    const acct = await register(6);
    await fund.connect(alice).claim(6);
    expect(await acct.starterLocked()).to.equal(E("0.01"));
    expect(await acct.withdrawable()).to.equal(0n);
    await expect(acct.connect(alice).withdraw(E("0.01"))).to.be.revertedWithCustomError(acct, "StarterLocked");
    // the holder's own deposits stay withdrawable
    await alice.sendTransaction({ to: await acct.getAddress(), value: E("0.2") });
    expect(await acct.withdrawable()).to.equal(E("0.2"));
    await expect(acct.connect(alice).withdraw(E("0.2"))).to.changeEtherBalance(alice, E("0.2"));
  });

  it("blocks sending the locked starter out through execute, and unlocks after 180 days", async () => {
    const { register, fund, deployer, alice, bob, router } = await setup();
    await deployer.sendTransaction({ to: await fund.getAddress(), value: E("1") });
    const acct = await register(6);
    await fund.connect(alice).claim(6);
    await expect(acct.connect(alice).execute(bob.address, E("0.005"), "0x", 0)).to.be.revertedWithCustomError(acct, "StarterLocked");
    await expect(acct.connect(alice).execute(await router.getAddress(), 0, router.interface.encodeFunctionData("swap"), 0)).to.be.revertedWithCustomError(acct, "StarterLocked");
    await time.increase(181 * 86400);
    expect(await acct.lockedNow()).to.equal(0n);
    await expect(acct.connect(alice).execute(bob.address, E("0.01"), "0x", 0)).to.changeEtherBalance(bob, E("0.01"));
  });

  it("launches the agent's coin from its wallet, paid from the starter balance, and remembers the coin", async () => {
    const { register, fund, deployer, alice, launcher, bob } = await setup();
    await deployer.sendTransaction({ to: await fund.getAddress(), value: E("1") });
    const acct = await register(6);
    await fund.connect(alice).claim(6);
    const data = launcher.interface.encodeFunctionData("launch");
    await expect(acct.connect(bob).launchCoin(data, E("0.001"), bob.address)).to.be.revertedWithCustomError(acct, "NotHolder");
    await expect(acct.connect(alice).launchCoin(data, E("0.001"), bob.address)).to.emit(acct, "CoinLaunched").withArgs(bob.address);
    expect(await launcher.lastValue()).to.equal(E("0.001"));
    expect(await acct.starterLocked()).to.equal(E("0.009"));
    expect(await acct.coin()).to.equal(bob.address);
  });

  it("lets the engine trade only through the router, within the holder's caps, while live", async () => {
    const { register, alice, engine, bob, router, swapData } = await setup();
    const acct = await register(6);
    await alice.sendTransaction({ to: await acct.getAddress(), value: E("1") });
    await expect(acct.connect(engine).trade(E("0.01"), swapData)).to.be.revertedWithCustomError(acct, "PolicyStale");
    await acct.connect(alice).setPolicy(E("0.02"), E("0.05"), true, ethers.id("rule v1"), "ipfs://rule1");
    expect(await acct.ruleVersion()).to.equal(1n);
    await expect(acct.connect(bob).trade(E("0.01"), swapData)).to.be.revertedWithCustomError(acct, "NotEngine");
    await expect(acct.connect(engine).trade(E("0.03"), swapData)).to.be.revertedWithCustomError(acct, "OverPerTrade");
    await acct.connect(engine).trade(E("0.02"), swapData);
    await acct.connect(engine).trade(E("0.02"), swapData);
    await expect(acct.connect(engine).trade(E("0.02"), swapData)).to.be.revertedWithCustomError(acct, "OverDailyCap");
    expect(await router.calls()).to.equal(2n);
    await time.increase(86400);
    await acct.connect(engine).trade(E("0.02"), swapData);
    await acct.connect(alice).pause();
    await expect(acct.connect(engine).trade(E("0.01"), swapData)).to.be.revertedWithCustomError(acct, "Paused");
  });

  it("pauses trading automatically when the NFT is sold, until the new holder sets a policy", async () => {
    const { register, nft, alice, bob, engine, swapData } = await setup();
    const acct = await register(6);
    await alice.sendTransaction({ to: await acct.getAddress(), value: E("1") });
    await acct.connect(alice).setPolicy(E("0.02"), E("0.1"), true, ethers.id("v1"), "");
    await nft.connect(alice).transferFrom(alice.address, bob.address, 6);
    await expect(acct.connect(engine).trade(E("0.01"), swapData)).to.be.revertedWithCustomError(acct, "PolicyStale");
    await acct.connect(bob).setPolicy(E("0.02"), E("0.1"), true, ethers.id("v1"), "");
    await acct.connect(engine).trade(E("0.01"), swapData);
  });

  it("withdraws instantly, and only the current holder can (no draining after a sale)", async () => {
    const { register, nft, alice, bob } = await setup();
    const acct = await register(6);
    await alice.sendTransaction({ to: await acct.getAddress(), value: E("0.5") });
    await expect(acct.connect(alice).withdraw(E("0.6"))).to.be.revertedWithCustomError(acct, "StarterLocked");
    await expect(acct.connect(alice).withdraw(E("0.1"))).to.changeEtherBalance(alice, E("0.1"));
    await nft.connect(alice).transferFrom(alice.address, bob.address, 6);
    await expect(acct.connect(alice).withdraw(E("0.1"))).to.be.revertedWithCustomError(acct, "NotHolder");
    await expect(acct.connect(bob).withdraw(E("0.4"))).to.changeEtherBalance(bob, E("0.4"));
  });

  it("never approves the router for the agent's own coin", async () => {
    const { register, fund, deployer, alice, engine, launcher } = await setup();
    const coin = await (await ethers.getContractFactory("MockERC20")).deploy();
    await deployer.sendTransaction({ to: await fund.getAddress(), value: E("1") });
    const acct = await register(6);
    await fund.connect(alice).claim(6);
    await acct.connect(alice).setPolicy(E("0.02"), E("0.1"), true, ethers.id("v1"), "");
    await acct.connect(alice).launchCoin(launcher.interface.encodeFunctionData("launch"), 0, await coin.getAddress());
    await expect(acct.connect(engine).approveRouter(await coin.getAddress(), 1)).to.be.revertedWithCustomError(acct, "NotAllowed");
  });
});

describe("AgentFeeDistributor", () => {
  async function dsetup() {
    const ctx = await setup();
    const dist = await (await ethers.getContractFactory("AgentFeeDistributor")).deploy(ctx.safe.address, await ctx.registry.getAddress(), await ctx.nft.getAddress());
    await dist.connect(ctx.safe).setAccount(await ctx.impl.getAddress(), SALT);
    return { ...ctx, dist };
  }

  it("only enrols Trenchers whose agent wallet exists, once", async () => {
    const { dist, register } = await dsetup();
    await expect(dist.enroll(6)).to.be.revertedWithCustomError(dist, "NotRegistered");
    await register(6);
    await dist.enroll(6);
    await expect(dist.enroll(6)).to.be.revertedWithCustomError(dist, "AlreadyEnrolled");
    expect(await dist.enrolledFrom(6)).to.equal(2n);
  });

  it("splits each epoch's fees equally across registered agents and pays into their wallets", async () => {
    const { dist, register, deployer, keeper } = await dsetup();
    const a6 = await register(6), a7 = await register(7), a1 = await register(1);
    await dist.enroll(6); await dist.enroll(7); await dist.enroll(1);
    await time.increase(7 * 86400); await dist.closeEpoch(); // epoch 1 had no earners
    await deployer.sendTransaction({ to: await dist.getAddress(), value: E("0.3") }); // 10% of $TRENCHERS fees
    await time.increase(7 * 86400); await dist.closeEpoch();
    expect(await dist.sharePerAgent(2)).to.equal(E("0.1"));
    await dist.connect(keeper).pay(2, [6, 7, 1]);
    for (const a of [a6, a7, a1]) expect(await ethers.provider.getBalance(await a.getAddress())).to.equal(E("0.1"));
    await expect(dist.pay(2, [6])).to.be.revertedWithCustomError(dist, "AlreadyPaid");
    expect(await dist.reserved()).to.equal(0n);
  });

  it("new agents earn from the next epoch; unpaid shares stay reserved", async () => {
    const { dist, register, deployer } = await dsetup();
    await register(6); await dist.enroll(6);
    await time.increase(7 * 86400); await dist.closeEpoch();
    await register(7); await dist.enroll(7);
    await deployer.sendTransaction({ to: await dist.getAddress(), value: E("0.2") });
    await time.increase(7 * 86400); await dist.closeEpoch();
    expect(await dist.sharePerAgent(2)).to.equal(E("0.2")); // only #6 was earning in epoch 2
    await expect(dist.pay(2, [7])).to.be.revertedWithCustomError(dist, "NotEligible");
    expect(await dist.reserved()).to.equal(E("0.2"));
    await deployer.sendTransaction({ to: await dist.getAddress(), value: E("0.2") });
    await time.increase(7 * 86400); await dist.closeEpoch();
    expect(await dist.sharePerAgent(3)).to.equal(E("0.1")); // #6 and #7, the reserved 0.2 untouched
    await dist.pay(2, [6]); await dist.pay(3, [6, 7]);
    expect(await dist.reserved()).to.equal(0n);
  });

  it("can't close an epoch early", async () => {
    const { dist } = await dsetup();
    await expect(dist.closeEpoch()).to.be.revertedWithCustomError(dist, "TooEarly");
  });
});

describe("AgentConfig", () => {
  it("changes to the engine or router wait 48 hours", async () => {
    const { config, safe, bob } = await setup();
    await config.connect(safe).propose(0, bob.address);
    await expect(config.connect(safe).execute(0)).to.be.revertedWithCustomError(config, "TooEarly");
    await time.increase(48 * 3600 + 1);
    await config.connect(safe).execute(0);
    expect(await config.engine()).to.equal(bob.address);
  });
});
