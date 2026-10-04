// Deploys RevenueSplitter + TrenchersNFT + AgentStarterFund, mints all 2,000 for free (5 to the team,
// 1,995 to the treasury that lists them on OpenSea at 0.02 ETH), routes 51% of primary sales to the
// starter fund (0.01 ETH claimable per agent, funded by the first sale only), then hands ownership to the Safe.
// Usage:
//   DEPLOYER_KEY=0x... SAFE=0x... DEV_SAFE=0x... TEAM=0x... TREASURY=0x... \
//   PREREVEAL_URI=ipfs://... CONTRACT_URI=ipfs://... \
//   npx hardhat run scripts/deploy.js --network robinhoodTestnet
const { ethers, network } = require("hardhat");

const LB_VALIDATOR = "0x721C008fdff27BF06E7E123956E2Fe03B63342e3";
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const NICK_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
// Robinhood Chain mainnet (4663) addresses from public sources; checked for code before use.
const ERC8004_IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const PONS_ROUTER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";

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
  const safe = need("SAFE"), devSafe = need("DEV_SAFE"), team = need("TEAM"), treasury = need("TREASURY");
  const prereveal = need("PREREVEAL_URI"), contractUri = need("CONTRACT_URI");
  const { chainId } = await ethers.provider.getNetwork();

  console.log(`Network ${network.name} (chain ${chainId}), deployer ${deployer.address}`);
  console.log(`Balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // Preflight: facts the plan lists as unverified.
  const checks = {
    "Limit Break transfer validator": await hasCode(LB_VALIDATOR),
    "ERC-6551 registry": await hasCode(ERC6551_REGISTRY),
    "Nick's CREATE2 factory": await hasCode(NICK_FACTORY),
    "ERC-8004 identity registry": await hasCode(ERC8004_IDENTITY),
    "Pons router": await hasCode(PONS_ROUTER),
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

  const fund = await (await ethers.getContractFactory("AgentStarterFund")).deploy(
    safe, await nft.getAddress(), ERC6551_REGISTRY, treasury, ethers.parseEther(process.env.CLAIM_ETH || "0.01")
  );
  await fund.waitForDeployment();
  console.log(`AgentStarterFund ${await fund.getAddress()}`);

  // Agent infrastructure: shared config (timelocked), the agent wallet implementation, and the
  // distributor for the agents' 10% share of $TRENCHERS fees.
  const config = await (await ethers.getContractFactory("AgentConfig")).deploy(deployer.address);
  await config.waitForDeployment();
  const impl = await (await ethers.getContractFactory("TrenchersAgentAccount")).deploy(await config.getAddress());
  await impl.waitForDeployment();
  const dist = await (await ethers.getContractFactory("AgentFeeDistributor")).deploy(deployer.address, ERC6551_REGISTRY, await nft.getAddress());
  await dist.waitForDeployment();
  console.log(`AgentConfig      ${await config.getAddress()}`);
  console.log(`AgentAccount impl ${await impl.getAddress()}`);
  console.log(`AgentFeeDistributor ${await dist.getAddress()}`);
  await (await config.propose(3 /* StarterFund */, await fund.getAddress())).wait();
  // Metadata follows each Trencher: dormant (grey, 0.01 ETH claimable) until claimed, then awake.
  await (await nft.setStarterFund(await fund.getAddress())).wait();
  if (process.env.ENGINE) await (await config.propose(0, process.env.ENGINE)).wait();
  if (process.env.SWAP_ADAPTER) await (await config.propose(1, process.env.SWAP_ADAPTER)).wait();
  if (await hasCode(PONS_ROUTER)) await (await config.propose(2, PONS_ROUTER)).wait();
  await (await dist.setAccount(await impl.getAddress(), ethers.ZeroHash)).wait();

  await (await splitter.setPrimarySeller(treasury)).wait();
  await (await splitter.proposeDestination(3 /* Starter */, await fund.getAddress())).wait();
  // Free mint of the remaining 1,995 to the treasury, in batches to stay well under the block gas limit.
  const BATCH = Number(process.env.MINT_BATCH || 200);
  for (let left = 1995; left > 0; left -= BATCH) {
    const n = Math.min(BATCH, left);
    await (await nft.ownerMint(treasury, n)).wait();
    console.log(`  minted ${n} to treasury (supply ${await nft.totalSupply()})`);
  }
  await (await splitter.transferOwnership(safe)).wait();
  await (await nft.transferOwnership(safe)).wait();
  await (await config.transferOwnership(safe)).wait();
  await (await dist.transferOwnership(safe)).wait();
  console.log(`Ownership of all contracts transferred to ${safe}`);
  console.log("Next: list the treasury's 1,995 Trenchers on OpenSea at 0.02 ETH; forward sale proceeds to the splitter.");
  console.log(`To open starter claims, the Safe calls AgentStarterFund.setAccount(${await impl.getAddress()}, 0x00…00).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
