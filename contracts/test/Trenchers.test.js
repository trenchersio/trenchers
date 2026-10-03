const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const LIST_PRICE = ethers.parseEther("0.05");
const Bucket = { Buyback: 0, Dev: 1, Prize: 2 };

async function deploy() {
  const [deployer, safe, dev, team, treasury, alice, bob, buyback, prize, market] = await ethers.getSigners();
  const start = await time.latest();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(safe.address, dev.address, start);
  const nft = await (await ethers.getContractFactory("TrenchersNFT")).deploy(
    await splitter.getAddress(), team.address, "ipfs://prereveal.json", "ipfs://contract.json"
  );
  await splitter.connect(safe).setPrimarySeller(treasury.address);
  return { nft, splitter, deployer, safe, dev, team, treasury, alice, bob, buyback, prize, market, start };
}

describe("TrenchersNFT", () => {
  it("mints the 5 house agents to the team at deploy", async () => {
    const { nft, team } = await deploy();
    expect(await nft.totalSupply()).to.equal(5n);
    expect(await nft.balanceOf(team.address)).to.equal(5n);
    for (let i = 1; i <= 5; i++) expect(await nft.ownerOf(i)).to.equal(team.address);
    expect(await nft.name()).to.equal("Trenchers");
  });

  it("has no paid mint: the owner mints the rest for free, in batches, to the treasury", async () => {
    const { nft, treasury } = await deploy();
    await nft.ownerMint(treasury.address, 400);
    expect(await nft.ownerOf(6)).to.equal(treasury.address);
    expect(await nft.ownerOf(405)).to.equal(treasury.address);
    expect(nft.mint).to.equal(undefined);
  });

  it("caps supply at 2,000 (1,995 for the treasury)", async () => {
    const { nft, treasury } = await deploy();
    for (let i = 0; i < 5; i++) await nft.ownerMint(treasury.address, 399);
    expect(await nft.totalSupply()).to.equal(2000n);
    expect(await nft.balanceOf(treasury.address)).to.equal(1995n);
    await expect(nft.ownerMint(treasury.address, 1)).to.be.revertedWithCustomError(nft, "SoldOut");
  });

  it("only the owner can mint or administer", async () => {
    const { nft, alice } = await deploy();
    await expect(nft.connect(alice).ownerMint(alice.address, 1)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(nft.connect(alice).setBaseURI("x")).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(nft.ownerMint(alice.address, 0)).to.be.revertedWithCustomError(nft, "ZeroQuantity");
  });

  it("serves pre-reveal metadata, then per-token URIs, and can be frozen", async () => {
    const { nft } = await deploy();
    expect(await nft.tokenURI(1)).to.equal("ipfs://prereveal.json");
    await expect(nft.setBaseURI("ipfs://CID/")).to.emit(nft, "BatchMetadataUpdate").withArgs(1, 2000);
    expect(await nft.tokenURI(3)).to.equal("ipfs://CID/3.json");
    await nft.freezeMetadata();
    await expect(nft.setBaseURI("ipfs://other/")).to.be.revertedWithCustomError(nft, "Frozen");
    await expect(nft.tokenURI(99)).to.be.reverted;
  });

  it("reports a 5% royalty to the splitter and supports ERC-2981, ERC-721, EIP-4906", async () => {
    const { nft, splitter } = await deploy();
    const [receiver, amount] = await nft.royaltyInfo(1, LIST_PRICE);
    expect(receiver).to.equal(await splitter.getAddress());
    expect(amount).to.equal(LIST_PRICE / 20n);
    expect(await nft.supportsInterface("0x2a55205a")).to.equal(true);
    expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true);
    expect(await nft.supportsInterface("0x49064906")).to.equal(true);
  });

  it("falls back to no transfer validator when Limit Break's is not deployed, so transfers work", async () => {
    const { nft, team, alice } = await deploy();
    expect(await nft.getTransferValidator()).to.equal(ethers.ZeroAddress);
    await nft.connect(team).transferFrom(team.address, alice.address, 1);
    expect(await nft.ownerOf(1)).to.equal(alice.address);
  });
});

describe("RevenueSplitter", () => {
  async function sold(ethAmount) {
    const ctx = await deploy();
    await ctx.treasury.sendTransaction({ to: await ctx.splitter.getAddress(), value: ethers.parseEther(ethAmount) });
    return ctx;
  }

  it("splits primary-sale proceeds from the treasury 50 / 20 now / 20 vested / 10", async () => {
    const { splitter } = await sold("1");
    expect(await splitter.owed(Bucket.Buyback)).to.equal(ethers.parseEther("0.5"));
    expect(await splitter.owed(Bucket.Dev)).to.equal(ethers.parseEther("0.2"));
    expect(await splitter.vestedTotal()).to.equal(ethers.parseEther("0.2"));
    expect(await splitter.owed(Bucket.Prize)).to.equal(ethers.parseEther("0.1"));
    expect(await splitter.totalPrimarySales()).to.equal(ethers.parseEther("1"));
  });

  it("treats ETH from anyone else as royalties, 100% to buybacks", async () => {
    const { splitter, market } = await deploy();
    await market.sendTransaction({ to: await splitter.getAddress(), value: ethers.parseEther("0.05") });
    expect(await splitter.owed(Bucket.Buyback)).to.equal(ethers.parseEther("0.05"));
    expect(await splitter.owed(Bucket.Dev)).to.equal(0n);
    expect(await splitter.totalRoyalties()).to.equal(ethers.parseEther("0.05"));
  });

  it("vests the dev half linearly over 180 days", async () => {
    const { splitter, dev, start } = await sold("1");
    const before = await ethers.provider.getBalance(dev.address);
    await time.increaseTo(start + 90 * 86400);
    await splitter.release(Bucket.Dev);
    const got = (await ethers.provider.getBalance(dev.address)) - before;
    expect(got).to.be.closeTo(ethers.parseEther("0.3"), ethers.parseEther("0.0001"));
    await time.increaseTo(start + 200 * 86400);
    await splitter.release(Bucket.Dev);
    expect((await ethers.provider.getBalance(dev.address)) - before).to.equal(ethers.parseEther("0.4"));
  });

  it("holds buyback and prize funds until their contracts exist, then releases to them", async () => {
    const { splitter, safe, buyback, prize, alice } = await sold("1");
    await expect(splitter.release(Bucket.Buyback)).to.be.revertedWithCustomError(splitter, "NoDestination");
    await splitter.connect(safe).proposeDestination(Bucket.Buyback, buyback.address);
    await splitter.connect(safe).proposeDestination(Bucket.Prize, prize.address);
    const b0 = await ethers.provider.getBalance(buyback.address);
    await splitter.connect(alice).release(Bucket.Buyback);
    expect((await ethers.provider.getBalance(buyback.address)) - b0).to.equal(ethers.parseEther("0.5"));
    await expect(splitter.release(Bucket.Buyback)).to.be.revertedWithCustomError(splitter, "NothingOwed");
  });

  it("changing an existing destination needs the 48h timelock", async () => {
    const { splitter, safe, alice, bob } = await deploy();
    await expect(splitter.connect(alice).proposeDestination(Bucket.Dev, bob.address)).to.be.revertedWith("Ownable: caller is not the owner");
    await splitter.connect(safe).proposeDestination(Bucket.Dev, bob.address);
    await expect(splitter.connect(safe).executeDestination(Bucket.Dev)).to.be.revertedWithCustomError(splitter, "TooEarly");
    await time.increase(48 * 3600 + 1);
    await splitter.connect(safe).executeDestination(Bucket.Dev);
    expect(await splitter.destination(Bucket.Dev)).to.equal(bob.address);
  });

  it("the primary seller can be set only once", async () => {
    const { splitter, safe, alice } = await deploy();
    await expect(splitter.connect(safe).setPrimarySeller(alice.address)).to.be.revertedWithCustomError(splitter, "AlreadySet");
  });

  it("sends ERC-20 royalties (e.g. WETH) to the buyback destination", async () => {
    const { splitter, safe, buyback, market } = await deploy();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy();
    await token.mint(await splitter.getAddress(), 1000n);
    await expect(splitter.releaseToken(await token.getAddress())).to.be.revertedWithCustomError(splitter, "NoDestination");
    await splitter.connect(safe).proposeDestination(Bucket.Buyback, buyback.address);
    await splitter.connect(market).releaseToken(await token.getAddress());
    expect(await token.balanceOf(buyback.address)).to.equal(1000n);
  });
});
