const { expect } = require("chai");
const { ethers } = require("hardhat");

// The same sequence the testnet setup page runs, end to end, at testnet prices:
// deploy, open the mint, a buyer mints on the website, the starter fund is funded in the same
// transaction, the buyer awakens the Trencher and manages its agent wallet.
describe("Testnet setup flow (public mint)", () => {
  it("deploys, mints, funds the starter fund and awakens a Trencher", async () => {
    const [owner, buyer] = await ethers.getSigners();
    const E = ethers.parseEther;
    const registry = await (await ethers.getContractFactory("MockERC6551Registry")).deploy();
    const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(owner.address, owner.address, Math.floor(Date.now() / 1000));
    const nft = await (await ethers.getContractFactory("TrenchersNFT")).deploy(await splitter.getAddress(), owner.address, "", "", E("0.002"));
    const fund = await (await ethers.getContractFactory("AgentStarterFund")).deploy(owner.address, await nft.getAddress(), await registry.getAddress(), E("0.001"), 48 * 3600);
    const config = await (await ethers.getContractFactory("AgentConfig")).deploy(owner.address);
    const impl = await (await ethers.getContractFactory("TrenchersAgentAccount")).deploy(await config.getAddress());
    await config.propose(3, await fund.getAddress());
    await nft.setStarterFund(await fund.getAddress());
    await fund.setAccount(await impl.getAddress(), ethers.ZeroHash);
    await splitter.setPrimarySeller(await nft.getAddress());
    await splitter.proposeDestination(3, await fund.getAddress());
    await nft.setBaseURI("https://trenchers.io/testnet-meta/");
    await nft.setMintOpen(true);

    await expect(nft.connect(buyer).mint(1, { value: E("0.001") })).to.be.revertedWithCustomError(nft, "WrongPrice");
    await nft.connect(buyer).mint(2, { value: E("0.004") });
    expect(await nft.ownerOf(6)).to.equal(buyer.address);
    expect(await nft.ownerOf(7)).to.equal(buyer.address);
    expect(await splitter.totalPrimarySales()).to.equal(E("0.004"));
    expect(await ethers.provider.getBalance(await fund.getAddress())).to.equal(E("0.00204")); // 51% straight to the fund
    expect(await nft.tokenURI(6)).to.equal("https://trenchers.io/testnet-meta/dormant/6.json");

    await fund.connect(buyer).claim(6);
    const wallet = await fund.agentWallet(6);
    expect(await ethers.provider.getBalance(wallet)).to.equal(E("0.001"));
    expect(await nft.tokenURI(6)).to.equal("https://trenchers.io/testnet-meta/awake/6.json");
    const acct = await ethers.getContractAt("TrenchersAgentAccount", wallet);
    expect(await acct.owner()).to.equal(buyer.address);
    expect(await acct.lockedNow()).to.equal(E("0.001"));
    await buyer.sendTransaction({ to: wallet, value: E("0.003") });
    expect(await acct.withdrawable()).to.equal(E("0.003"));
    await expect(acct.connect(buyer).withdraw(E("0.0031"))).to.be.revertedWithCustomError(acct, "StarterLocked");
    await expect(acct.connect(buyer).withdraw(E("0.003"))).to.changeEtherBalance(buyer, E("0.003"));
    await expect(acct.connect(buyer).setPolicy(E("0.0005"), E("0.002"), true, ethers.id("rule"), "Buys every launch that graduates on Pons. Sells after 5 minutes."))
      .to.emit(acct, "RuleApplied").withArgs(1, ethers.id("rule"), "Buys every launch that graduates on Pons. Sells after 5 minutes.");
  });
});

describe("Mint gas safety", () => {
  it("a mint either releases the agent's half to the fund or reverts; it never silently skips it", async () => {
    const [owner, buyer] = await ethers.getSigners();
    const E = ethers.parseEther;
    const registry = await (await ethers.getContractFactory("MockERC6551Registry")).deploy();
    const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(owner.address, owner.address, Math.floor(Date.now() / 1000));
    const nft = await (await ethers.getContractFactory("TrenchersNFT")).deploy(await splitter.getAddress(), owner.address, "", "", E("0.0002"));
    const fund = await (await ethers.getContractFactory("AgentStarterFund")).deploy(owner.address, await nft.getAddress(), await registry.getAddress(), E("0.0001"), 48 * 3600);
    await splitter.setPrimarySeller(await nft.getAddress());
    await splitter.proposeDestination(3, await fund.getAddress());
    await nft.setMintOpen(true);
    // The gas estimate must cover the release: mint with exactly the estimated gas.
    const est = await nft.connect(buyer).mint.estimateGas(1, { value: E("0.0002") });
    await nft.connect(buyer).mint(1, { value: E("0.0002"), gasLimit: est });
    expect(await ethers.provider.getBalance(await fund.getAddress())).to.equal(E("0.000102"));
    // Starving the release reverts the whole mint instead of skipping it.
    let reverted = false, fundBefore = await ethers.provider.getBalance(await fund.getAddress());
    for (let g = est / 2n; g < est; g += 3000n) {
      try { await nft.connect(buyer).mint(1, { value: E("0.0002"), gasLimit: g }); } catch { reverted = true; continue; }
      // if a starved mint succeeds, the fund must still have received its share
      const now = await ethers.provider.getBalance(await fund.getAddress());
      expect(now - fundBefore).to.equal(E("0.000102")); fundBefore = now;
    }
    expect(reverted).to.equal(true);
  });
});
