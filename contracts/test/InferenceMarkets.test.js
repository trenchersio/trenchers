const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const E = (v) => ethers.parseEther(v);
const T = (v) => ethers.parseUnits(v, 18);

describe("Inference Markets: InferenceRouter", () => {
  async function setup() {
    const [deployer, safe, alice, desk, stranger] = await ethers.getSigners();
    const pons = await (await ethers.getContractFactory("MockPonsFactory")).deploy();
    const adapter = await (await ethers.getContractFactory("PonsAdapter")).deploy(await pons.getAddress(), safe.address);
    const launch = async (name, maxSpend = E("100")) => {
      const tx = await pons.launch(name, maxSpend, { value: E("5") });
      const log = (await tx.wait()).logs.map((l) => { try { return pons.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "TokenLaunched");
      return ethers.getContractAt("MockPonsToken", log.args.token);
    };
    const token = await launch("TRENCHERS");
    const router = await (await ethers.getContractFactory("InferenceRouter")).deploy(await adapter.getAddress(), await token.getAddress(), desk.address);
    return { deployer, alice, desk, stranger, pons, adapter, token, router, launch };
  }

  it("turns ETH into $TRENCHERS at the desk in one transaction and names the buyer", async () => {
    const { alice, desk, token, router } = await setup();
    const out = await router.connect(alice).buyCredit.staticCall(0, ethers.ZeroAddress, { value: E("0.05") });
    expect(out).to.be.gt(0n);
    await expect(router.connect(alice).buyCredit(out - 1n, ethers.ZeroAddress, { value: E("0.05") }))
      .to.emit(router, "CreditBought").withArgs(alice.address, E("0.05"), out);
    expect(await token.balanceOf(desk.address)).to.equal(out);
    expect(await token.balanceOf(await router.getAddress())).to.equal(0n);
    expect(await token.balanceOf(alice.address)).to.equal(0n);
    expect(await ethers.provider.getBalance(await router.getAddress())).to.equal(0n);
  });

  it("refunds ETH a curve could not use, and reports only what was spent", async () => {
    const { alice, desk, launch, adapter } = await setup();
    const small = await launch("SMALL", E("0.02"));
    const router = await (await ethers.getContractFactory("InferenceRouter")).deploy(await adapter.getAddress(), await small.getAddress(), desk.address);
    await expect(router.connect(alice).buyCredit(0, ethers.ZeroAddress, { value: E("0.05") })).to.changeEtherBalance(alice, -E("0.02"));
    expect(await small.balanceOf(desk.address)).to.be.gt(0n);
    expect(await ethers.provider.getBalance(await router.getAddress())).to.equal(0n);
  });

  it("credits a named beneficiary when one is given", async () => {
    const { alice, stranger, router } = await setup();
    await expect(router.connect(alice).buyCredit(0, stranger.address, { value: E("0.01") })).to.emit(router, "CreditBought").withArgs(stranger.address, E("0.01"), (v) => v > 0n);
  });

  it("reverts below the minimum, on zero ETH, and refuses stray ETH", async () => {
    const { alice, router } = await setup();
    const out = await router.connect(alice).buyCredit.staticCall(0, ethers.ZeroAddress, { value: E("0.05") });
    await expect(router.connect(alice).buyCredit(out + 1n, ethers.ZeroAddress, { value: E("0.05") })).to.be.reverted;
    await expect(router.connect(alice).buyCredit(0, ethers.ZeroAddress)).to.be.revertedWithCustomError(router, "ZeroAmount");
    await expect(alice.sendTransaction({ to: await router.getAddress(), value: 1n })).to.be.revertedWithCustomError(router, "NotAdapter");
  });
});

describe("Inference Markets: TrenchersOTC", () => {
  async function setup() {
    const [deployer, maker, buyer, other, desk] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy();
    const otc = await (await ethers.getContractFactory("TrenchersOTC")).deploy();
    const o = await otc.getAddress();
    for (const s of [maker, buyer, other]) { await token.mint(s.address, T("10000000")); await token.connect(s).approve(o, ethers.MaxUint256); }
    const placeAsk = async (tokens, eth, expiry = 0, taker = ethers.ZeroAddress, from = maker) => {
      const tx = await otc.connect(from).ask(await token.getAddress(), T(tokens), E(eth), expiry, taker);
      return (await tx.wait()).logs.map((l) => { try { return otc.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "Placed").args.id;
    };
    const placeBid = async (tokens, eth, expiry = 0, taker = ethers.ZeroAddress, from = buyer) => {
      const tx = await otc.connect(from).bid(await token.getAddress(), T(tokens), expiry, taker, { value: E(eth) });
      return (await tx.wait()).logs.map((l) => { try { return otc.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "Placed").args.id;
    };
    return { maker, buyer, other, desk, token, otc, placeAsk, placeBid };
  }

  it("escrows an ask and fills it in parts at its price, paying the maker and refunding change", async () => {
    const { maker, buyer, token, otc, placeAsk } = await setup();
    const id = await placeAsk("1000000", "0.1");
    expect(await token.balanceOf(await otc.getAddress())).to.equal(T("1000000"));
    const q = await otc.quote(id, T("250000"));
    expect(q).to.equal(E("0.025"));
    await expect(otc.connect(buyer).buy([id], [T("250000")], ethers.ZeroAddress, { value: E("0.03") }))
      .to.changeEtherBalances([maker, buyer], [E("0.025"), -E("0.025")]);
    expect(await token.balanceOf(buyer.address)).to.equal(T("10250000"));
    // the rest takes exactly what is left of the ETH
    await otc.connect(buyer).buy([id], [T("750000")], ethers.ZeroAddress, { value: E("0.075") });
    const o = await otc.orders(id);
    expect(o.tokenLeft).to.equal(0n);
    expect(o.ethLeft).to.equal(0n);
    await expect(otc.connect(buyer).buy([id], [1n], ethers.ZeroAddress, { value: E("1") })).to.be.revertedWithCustomError(otc, "NotOpen");
  });

  it("fills several asks in one call and can deliver to the inference desk", async () => {
    const { buyer, other, desk, token, otc, placeAsk } = await setup();
    const a = await placeAsk("100000", "0.01");
    const b = await placeAsk("100000", "0.012", 0, ethers.ZeroAddress, other);
    await expect(otc.connect(buyer).buy([a, b], [T("100000"), T("50000")], desk.address, { value: E("0.016") }))
      .to.emit(otc, "Filled").withArgs(b, buyer.address, desk.address, T("50000"), E("0.006"));
    expect(await token.balanceOf(desk.address)).to.equal(T("150000"));
  });

  it("refuses too little ETH, wrong side, too much, private orders for others, and expired orders", async () => {
    const { buyer, other, otc, placeAsk, placeBid } = await setup();
    const id = await placeAsk("100000", "0.01");
    await expect(otc.connect(buyer).buy([id], [T("100000")], ethers.ZeroAddress, { value: E("0.009") })).to.be.revertedWithCustomError(otc, "NotEnoughEth");
    await expect(otc.connect(buyer).buy([id], [T("100001")], ethers.ZeroAddress, { value: E("1") })).to.be.revertedWithCustomError(otc, "TooMuch");
    const bidId = await placeBid("100", "0.001");
    await expect(otc.connect(buyer).buy([bidId], [T("1")], ethers.ZeroAddress, { value: E("1") })).to.be.revertedWithCustomError(otc, "WrongSide");
    const priv = await placeAsk("1000", "0.001", 0, other.address);
    await expect(otc.connect(buyer).buy([priv], [T("1000")], ethers.ZeroAddress, { value: E("0.001") })).to.be.revertedWithCustomError(otc, "NotTaker");
    await otc.connect(other).buy([priv], [T("1000")], ethers.ZeroAddress, { value: E("0.001") });
    const soon = (await time.latest()) + 60;
    const exp = await placeAsk("1000", "0.001", soon);
    await time.increase(120);
    await expect(otc.connect(buyer).buy([exp], [T("1000")], ethers.ZeroAddress, { value: E("0.001") })).to.be.revertedWithCustomError(otc, "Expired");
  });

  it("sells into a bid: tokens to the bidder, escrowed ETH to the seller, rounding never overpays", async () => {
    const { buyer, other, token, otc, placeBid } = await setup();
    const id = await placeBid("300000", "0.03");
    const q = await otc.quote(id, T("100000"));
    expect(q).to.equal(E("0.01"));
    await expect(otc.connect(other).sell(id, T("100000"), q)).to.changeEtherBalance(other, q);
    expect(await token.balanceOf(buyer.address)).to.equal(T("10100000"));
    await expect(otc.connect(other).sell(id, T("100000"), q + 1n)).to.be.revertedWithCustomError(otc, "Slippage");
    // odd amounts: the sum of every fill is exactly the escrow, never more
    await expect(otc.connect(other).sell(id, 7n, 0)).to.be.revertedWithCustomError(otc, "Slippage"); // rounds to 0 ETH
    await otc.connect(other).sell(id, T("33333.333"), 0);
    const left = (await otc.orders(id)).tokenLeft;
    await otc.connect(other).sell(id, left, 0);
    const o = await otc.orders(id);
    expect(o.ethLeft).to.equal(0n);
    expect(await ethers.provider.getBalance(await otc.getAddress())).to.equal(0n);
  });

  it("lets the maker cancel any time, anyone close an expired order, and returns escrow only to the maker", async () => {
    const { maker, buyer, other, token, otc, placeAsk, placeBid } = await setup();
    const a = await placeAsk("5000", "0.001");
    await expect(otc.connect(other).cancel(a)).to.be.revertedWithCustomError(otc, "NotMaker");
    await otc.connect(maker).cancel(a);
    expect(await token.balanceOf(maker.address)).to.equal(T("10000000"));
    await expect(otc.connect(maker).cancel(a)).to.be.revertedWithCustomError(otc, "NotOpen");
    const soon = (await time.latest()) + 60;
    const b = await placeBid("5000", "0.5", soon);
    await time.increase(120);
    await expect(otc.connect(other).cancel(b)).to.changeEtherBalances([buyer, other], [E("0.5"), 0]);
  });

  it("refuses zero amounts, past expiries and fee-on-transfer tokens", async () => {
    const { maker, token, otc } = await setup();
    const t = await token.getAddress();
    await expect(otc.connect(maker).ask(t, 0, E("1"), 0, ethers.ZeroAddress)).to.be.revertedWithCustomError(otc, "ZeroAmount");
    await expect(otc.connect(maker).ask(t, T("1"), 0, 0, ethers.ZeroAddress)).to.be.revertedWithCustomError(otc, "ZeroAmount");
    await expect(otc.connect(maker).ask(t, T("1"), E("1"), 1, ethers.ZeroAddress)).to.be.revertedWithCustomError(otc, "BadExpiry");
    await expect(otc.connect(maker).bid(t, T("1"), 0, ethers.ZeroAddress)).to.be.revertedWithCustomError(otc, "ZeroAmount");
    const taxed = await (await ethers.getContractFactory("MockTaxedToken")).deploy();
    await taxed.mint(maker.address, T("100"));
    await taxed.connect(maker).approve(await otc.getAddress(), ethers.MaxUint256);
    await expect(otc.connect(maker).ask(await taxed.getAddress(), T("100"), E("1"), 0, ethers.ZeroAddress)).to.be.revertedWithCustomError(otc, "TaxedToken");
  });

  it("cannot be re-entered by a hostile maker", async () => {
    const { buyer, token, otc } = await setup();
    const evil = await (await ethers.getContractFactory("MockReentrantMaker")).deploy(await otc.getAddress(), await token.getAddress());
    await token.mint(await evil.getAddress(), T("1000"));
    await evil.place(T("1000"), E("0.01"));
    // the maker's receive() tries to re-enter buy(); the fill must revert as a whole rather than double-spend
    await expect(otc.connect(buyer).buy([1], [T("500")], ethers.ZeroAddress, { value: E("0.005") })).to.be.revertedWithCustomError(otc, "EthTransferFailed");
    expect((await otc.orders(1)).tokenLeft).to.equal(T("1000"));
  });
});

describe("Inference Markets: InferenceDesk", () => {
  it("can only ever send what it holds to the dead address, and anyone can make it", async () => {
    const [, alice, stranger] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy();
    const desk = await (await ethers.getContractFactory("InferenceDesk")).deploy(await token.getAddress());
    await token.mint(alice.address, T("500"));
    await token.connect(alice).transfer(await desk.getAddress(), T("300"));
    await expect(desk.connect(stranger).burn()).to.emit(desk, "Burned").withArgs(T("300"), T("300"));
    expect(await token.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(T("300"));
    expect(await token.balanceOf(await desk.getAddress())).to.equal(0n);
    expect(await desk.burn.staticCall()).to.equal(0n);
    await expect(alice.sendTransaction({ to: await desk.getAddress(), value: 1n })).to.be.reverted;
  });
});
