// Deploys RevenueSplitter + TrenchersNFT, links them, hands ownership to the Safe.
// Usage:
//   DEPLOYER_KEY=0x... SAFE=0x... DEV_SAFE=0x... TEAM=0x... \
//   PREREVEAL_URI=ipfs://... CONTRACT_URI=ipfs://... \
//   npx hardhat run scripts/deploy.js --network robinhoodTestnet
const { ethers, network } = require("hardhat");

const LB_VALIDATOR = "0x721C008fdff27BF06E7E123956E2Fe03B63342e3";
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const NICK_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function hasCode(addr) {
  return (await ethers.provider.getCode(addr)) !== "0x";
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const safe = need("SAFE"), devSafe = need("DEV_SAFE"), team = need("TEAM");
  const prereveal = need("PREREVEAL_URI"), contractUri = need("CONTRACT_URI");
  const { chainId } = await ethers.provider.getNetwork();

  console.log(`Network ${network.name} (chain ${chainId}), deployer ${deployer.address}`);
  console.log(`Balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // Preflight: facts the plan lists as unverified.
  const checks = {
    "Limit Break transfer validator": await hasCode(LB_VALIDATOR),
    "ERC-6551 registry": await hasCode(ERC6551_REGISTRY),
    "Nick's CREATE2 factory": await hasCode(NICK_FACTORY),
  };
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? "present" : "MISSING"}: ${k}`);
  if (!(await hasCode(safe))) console.warn("  WARNING: SAFE has no code on this chain. Is it a deployed Safe?");

  const vestStart = Number(process.env.VEST_START || Math.floor(Date.now() / 1000));
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(deployer.address, devSafe, vestStart);
  await splitter.waitForDeployment();
  console.log(`RevenueSplitter ${await splitter.getAddress()}`);

  const nft = await (await ethers.getContractFactory("TrenchersNFT")).deploy(
    await splitter.getAddress(), team, prereveal, contractUri
  );
  await nft.waitForDeployment();
  console.log(`TrenchersNFT    ${await nft.getAddress()}`);
  console.log(`  transfer validator: ${await nft.getTransferValidator()}`);

  await (await splitter.setNft(await nft.getAddress())).wait();
  await (await splitter.transferOwnership(safe)).wait();
  await (await nft.transferOwnership(safe)).wait();
  console.log(`Ownership of both contracts transferred to ${safe}`);
  console.log("Next (from the Safe): setMintOpen(true) at launch; after mint, set OpenSea creator earnings.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
