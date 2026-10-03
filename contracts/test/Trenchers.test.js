const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const PRICE = ethers.parseEther("0.1");
const Bucket = { Buyback: 0, Dev: 1, Prize: 2 };

async function deploy() {
  const [deployer, safe, dev, team, alice, bob, carol, buyback, prize, market] = await ethers.getSigners();
  const start = await time.latest();
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(safe.address, dev.address, start);
  const nft = await (await ethers.getContractFactory("TrenchersNFT")).deploy(
    await splitter.getAddress(), team.address, "ipfs://prereveal.json", "ipfs://contract.json"
  );
  await splitter.connect(safe).setNft(await nft.getAddress());
  return { nft, splitter, deployer, safe, dev, team, alice, bob, carol, buyback, prize, market, start };
}

describe("TrenchersNFT", () => {
  it("mints the 5 reserved tokens to the team and nothing else", async () => {
    const { nft, team } = await deploy();
    expect(await nft.totalSupply()).to.equal(5n);
    expect(await nft.balanceOf(team.address)).to.equal(5n);
    for (let i = 1; i <= 5; i++) expect(await nft.ownerOf(i)).to.equal(team.address);
    expect(await nft.name()).to.equal("Trenchers");
  });

  it("is closed until the owner opens the mint", async () => {
    const { nft, alice } = await deploy();
    await expect(nft.connect(alice).mint(1, { value: PRICE })).to.be.revertedWithCustomError(nft, "MintClosed");
  });

  it("public mint charges exactly 0.1 ETH each, with no per-wallet limit", async () => {
    const { nft, alice } = await deploy();
    await nft.setMintOpen(true);
    await expect(nft.connect(alice).mint(2, { value: PRICE })).to.be.revertedWithCustomError(nft, "WrongPayment");
    await nft.connect(alice).mint(3, { value: PRICE * 3n });
    expect(await nft.ownerOf(6)).to.equal(alice.address);
    expect(await nft.ownerOf(8)).to.equal(alice.address);
    await nft.connect(alice).mint(50, { value: PRICE * 50n });
    expect(await nft.balanceOf(alice.address)).to.equal(53n);
    await expect(nft.connect(alice).mint(0, { value: 0 })).to.be.revertedWithCustomError(nft, "ZeroQuantity");
  });

  it("can be closed again by the owner", async () => {
    const { nft, alice } = await deploy();
    await nft.setMintOpen(true);
    await nft.setMintOpen(false);
    await expect(nft.connect(alice).mint(1, { value: PRICE })).to.be.revertedWithCustomError(nft, "MintClosed");
  });

  it("caps total supply at 2,000 (1,995 sellable)", async () => {
    const { nft } = await deploy();
    await nft.setMintOpen(true);
    const signers = await ethers.getSigners();
    const buyer = signers[11];
    await ethers.provider.send("hardhat_setBalance", [buyer.address, "0x" + (10n ** 24n).toString(16)]);
    for (let i = 0; i < 1995; i += 285) await nft.connect(buyer).mint(285, { value: PRICE * 285n });
    expect(await nft.totalSupply()).to.equal(2000n);
    await expect(nft.connect(buyer).mint(1, { value: PRICE })).to.be.revertedWithCustomError(nft, "SoldOut");
    expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(PRICE * 1995n); // 199.5 ETH
  });

  it("only the owner can administer", async () => {
    const { nft, alice } = await deploy();
    await expect(nft.connect(alice).setMintOpen(true)).to.be.revertedWith("Ownable: caller is not the owner");
    await expect(nft.connect(alice).setBaseURI("x")).to.be.revertedWith("Ownable: caller is not the owner");
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
    const [receiver, amount] = await nft.royaltyInfo(1, ethers.parseEther("1"));
    expect(receiver).to.equal(await splitter.getAddress());
    expect(amount).to.equal(ethers.parseEther("0.05"));
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

  it("withdraw can be called by anyone but only pays the splitter", async () => {
    const { nft, splitter, alice, bob } = await deploy();
    await nft.setMintOpen(true);
    await nft.connect(alice).mint(2, { value: PRICE * 2n });
    await expect(nft.connect(bob).withdraw()).to.emit(splitter, "MintProceedsReceived").withArgs(PRICE * 2n);
    expect(await ethers.provider.getBalance(await nft.getAddress())).to.equal(0n);
  });
});

describe("RevenueSplitter", () => {
  async function minted(n) {
    const ctx = await deploy();
    await ctx.nft.setMintOpen(true);
    await ctx.nft.connect(ctx.alice).mint(n, { value: PRICE * BigInt(n) });
    await ctx.nft.withdraw();
    return ctx;
  }

  it("splits mint proceeds 50 / 20 now / 20 vested / 10", async () => {
    const { splitter } = await minted(10); // 1 ETH
    expect(await splitter.owed(Bucket.Buyback)).to.equal(ethers.parseEther("0.5"));
    expect(await splitter.owed(Bucket.Dev)).to.equal(ethers.parseEther("0.2"));
    expect(await splitter.vestedTotal()).to.equal(ethers.parseEther("0.2"));
    expect(await splitter.owed(Bucket.Prize)).to.equal(ethers.parseEther("0.1"));
    expect(await splitter.totalMintProceeds()).to.equal(ethers.parseEther("1"));
  });

  it("treats any other ETH as royalties, 100% to buybacks", async () => {
    const { splitter, market } = await deploy();
    await market.sendTransaction({ to: await splitter.getAddress(), value: ethers.parseEther("0.05") });
    expect(await splitter.owed(Bucket.Buyback)).to.equal(ethers.parseEther("0.05"));
    expect(await splitter.owed(Bucket.Dev)).to.equal(0n);
    expect(await splitter.totalRoyalties()).to.equal(ethers.parseEther("0.05"));
  });

  it("vests the dev half linearly over 180 days", async () => {
    const { splitter, dev, start } = await minted(10);
    const before = await ethers.provider.getBalance(dev.address);
    await time.increaseTo(start + 90 * 86400);
    await splitter.release(Bucket.Dev);
    const got = (await ethers.provider.getBalance(dev.address)) - before;
    // 0.2 immediate + ~0.1 vested (half of 0.2), within a block of rounding
    expect(got).to.be.closeTo(ethers.parseEther("0.3"), ethers.parseEther("0.0001"));
    await time.increaseTo(start + 200 * 86400);
    await splitter.release(Bucket.Dev);
    expect((await ethers.provider.getBalance(dev.address)) - before).to.equal(ethers.parseEther("0.4"));
  });

  it("holds buyback and prize funds until their contracts exist, then releases to them", async () => {
    const { splitter, safe, buyback, prize, alice } = await minted(10);
    await expect(splitter.release(Bucket.Buyback)).to.be.revertedWithCustomError(splitter, "NoDestination");
    await splitter.connect(safe).proposeDestination(Bucket.Buyback, buyback.address); // first set: immediate
    await splitter.connect(safe).proposeDestination(Bucket.Prize, prize.address);
    const b0 = await ethers.provider.getBalance(buyback.address);
    await splitter.connect(alice).release(Bucket.Buyback); // permissionless
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

  it("the NFT link can be set only once", async () => {
    const { splitter, safe, alice } = await deploy();
    await expect(splitter.connect(safe).setNft(alice.address)).to.be.revertedWithCustomError(splitter, "AlreadySet");
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
