const { expect } = require("chai");
const { ethers } = require("hardhat");

// The same sequence the testnet setup page runs, end to end, at testnet prices.
describe("Testnet setup flow", () => {
  it("deploys, sells, funds the starter fund and awakens a Trencher", async () => {
    const [owner, buyer] = await ethers.getSigners();
    const E = ethers.parseEther;
    const registry = await (await ethers.getContractFactory("MockERC6551Registry")).deploy();
    const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(owner.address, owner.address, Math.floor(Date.now() / 1000));
    const nft = await (await ethers.getContractFactory("TrenchersNFT")).deploy(await splitter.getAddress(), owner.address, "", "");
    const sale = await (await ethers.getContractFactory("TestnetSale")).deploy(await nft.getAddress(), await splitter.getAddress(), E("0.002"));
    const fund = await (await ethers.getContractFactory("AgentStarterFund")).deploy(owner.address, await nft.getAddress(), await registry.getAddress(), await sale.getAddress(), E("0.001"));
    const config = await (await ethers.getContractFactory("AgentConfig")).deploy(owner.address);
    const impl = await (await ethers.getContractFactory("TrenchersAgentAccount")).deploy(await config.getAddress());
    await config.propose(3, await fund.getAddress());
    await nft.setStarterFund(await fund.getAddress());
    await fund.setAccount(await impl.getAddress(), ethers.ZeroHash);
    await splitter.setPrimarySeller(await sale.getAddress());
    await splitter.proposeDestination(3, await fund.getAddress());
    await nft.setBaseURI("https://trenchers.io/testnet-meta/");
    await nft.ownerMint(await sale.getAddress(), 20);

    expect(await sale.available()).to.equal(20n);
    await expect(sale.connect(buyer).buy({ value: E("0.001") })).to.be.revertedWithCustomError(sale, "WrongPrice");
    await sale.connect(buyer).buy({ value: E("0.002") });
    expect(await nft.ownerOf(6)).to.equal(buyer.address);
    expect(await ethers.provider.getBalance(await fund.getAddress())).to.equal(E("0.00102"));
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
    await acct.connect(buyer).setPolicy(E("0.0005"), E("0.002"), true, ethers.id("Only new launches above 3 ETH liquidity"), "");
    expect(await acct.ruleVersion()).to.equal(1n);
  });
});
