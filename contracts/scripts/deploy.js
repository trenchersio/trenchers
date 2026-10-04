// Deploys RevenueSplitter + TrenchersNFT + AgentStarterFund and the agent contracts. The 5 house agents
// go to the team at deploy; the other 1,995 are minted by anyone on trenchers.io at MINT_PRICE (0.02 ETH).
// Every mint is a primary sale: 51% goes to the starter fund (0.01 ETH claimable per agent), the rest to
// the ecosystem. Resales happen on OpenSea. Ownership of everything goes to the Safe; the Safe opens the mint.
// Usage:
//   DEPLOYER_KEY=0x... SAFE=0x... DEV_SAFE=0x... TEAM=0x... \
//   PREREVEAL_URI=ipfs://... CONTRACT_URI=ipfs://... \
//   npx hardhat run scripts/deploy.js --network robinhoodTestnet
const { ethers, network } = require("hardhat");

const LB_VALIDATOR = "0x721C008fdff27BF06E7E123956E2Fe03B63342e3";
const ERC6551_REGISTRY = "0x000000006551c19487814612e58FE06813775758";
const NICK_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
// Robinhood Chain mainnet (4663) addresses from public sources; checked for code before use.
const ERC8004_IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const PONS_ROUTER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
// Safety net: the Safe can move pooled ETH out of the starter fund / fee distributor only after this
// public delay (see TimelockedRescue). 48 hours on mainnet.
const RESCUE_DELAY = Number(process.env.RESCUE_DELAY || 48 * 3600);

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
  const mintPrice = ethers.parseEther(process.env.MINT_PRICE || "0.02");
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
  // The Safe owns everything from the end of this script; a wrong address would lock the project out for good.
  if (!(await hasCode(safe))) {
    if (Number(chainId) === 4663) throw new Error(`SAFE ${safe} has no code on Robinhood Chain mainnet: deploy the Safe first`);
    console.warn("  WARNING: SAFE has no code on this chain. Is it a deployed Safe?");
  }

  const vestStart = Number(process.env.VEST_START || Math.floor(Date.now() / 1000));
  const splitter = await (await ethers.getContractFactory("RevenueSplitter")).deploy(deployer.address, devSafe, vestStart);
  await splitter.waitForDeployment();
  console.log(`RevenueSplitter ${await splitter.getAddress()}`);

  const nft = await (await ethers.getContractFactory("TrenchersNFT")).deploy(
    await splitter.getAddress(), team, prereveal, contractUri, mintPrice
  );
  await nft.waitForDeployment();
  console.log(`TrenchersNFT    ${await nft.getAddress()}`);
  console.log(`  transfer validator: ${await nft.getTransferValidator()}`);

  const fund = await (await ethers.getContractFactory("AgentStarterFund")).deploy(
    safe, await nft.getAddress(), ERC6551_REGISTRY, mintPrice / 2n, RESCUE_DELAY
  );
  await fund.waitForDeployment();
  console.log(`AgentStarterFund ${await fund.getAddress()}`);

  // Agent infrastructure: shared config (timelocked), the agent wallet implementation, and the
  // distributor for the agents' 10% share of $TRENCHERS fees.
  const config = await (await ethers.getContractFactory("AgentConfig")).deploy(deployer.address);
  await config.waitForDeployment();
  // Agent wallets run the original wallet code forever, unless a holder opts in to a fixed version
  // the team offers later (see TrenchersAgentWallet). The original is recorded first, then fixed in the wallet.
  const logic = await (await ethers.getContractFactory("TrenchersAgentAccount")).deploy(await config.getAddress(), await fund.getAddress());
  await logic.waitForDeployment();
  await (await config.propose(4 /* AccountLogic */, await logic.getAddress())).wait();
  const impl = await (await ethers.getContractFactory("TrenchersAgentWallet")).deploy(await config.getAddress());
  await impl.waitForDeployment();
  const dist = await (await ethers.getContractFactory("AgentFeeDistributor")).deploy(deployer.address, ERC6551_REGISTRY, await nft.getAddress(), RESCUE_DELAY);
  await dist.waitForDeployment();
  console.log(`AgentConfig      ${await config.getAddress()}`);
  console.log(`AgentAccount code ${await logic.getAddress()}`);
  console.log(`AgentWallet impl ${await impl.getAddress()}`);
  console.log(`AgentFeeDistributor ${await dist.getAddress()}`);
  await (await config.propose(3 /* StarterFund */, await fund.getAddress())).wait();
  // Metadata follows each Trencher: dormant (grey, 0.01 ETH claimable) until claimed, then awake.
  await (await nft.setStarterFund(await fund.getAddress())).wait();
  if (process.env.ENGINE) await (await config.propose(0, process.env.ENGINE)).wait();
  // Emergency stop: a guardian (e.g. a team member's own wallet) can pause all engine trading instantly.
  if (process.env.GUARDIAN) await (await config.setGuardian(process.env.GUARDIAN)).wait();
  // Agents trade Pons coins through the PonsAdapter (only genuine Pons launches, never their own coin).
  if (await hasCode(PONS_FACTORY)) {
    const adapter = await (await ethers.getContractFactory("PonsAdapter")).deploy(PONS_FACTORY, safe);
    await adapter.waitForDeployment();
    console.log(`PonsAdapter      ${await adapter.getAddress()}`);
    await (await config.propose(1, await adapter.getAddress())).wait();
  } else console.warn("  Pons V2 factory not found on this chain: no PonsAdapter deployed");
  // The coin launcher (agent coins) is left unset: it can be added later, behind the 48-hour timelock.
  await (await dist.setAccount(await impl.getAddress(), ethers.ZeroHash)).wait();

  await (await splitter.setPrimarySeller(await nft.getAddress())).wait(); // mint proceeds count as primary sales
  await (await splitter.proposeDestination(3 /* Starter */, await fund.getAddress())).wait();
  // End of the deployment phase: from here on every AgentConfig change takes 48 hours, first settings included.
  await (await config.seal()).wait();
  await (await splitter.transferOwnership(safe)).wait();
  await (await nft.transferOwnership(safe)).wait();
  await (await config.transferOwnership(safe)).wait();
  await (await dist.transferOwnership(safe)).wait();
  // Read every owner back: nothing may be left with the deployer.
  for (const [name, c] of [["RevenueSplitter", splitter], ["TrenchersNFT", nft], ["AgentConfig", config], ["AgentFeeDistributor", dist], ["AgentStarterFund", fund]]) {
    const o = await c.owner();
    if (o.toLowerCase() !== safe.toLowerCase()) throw new Error(`${name} is owned by ${o}, not the Safe`);
  }
  console.log(`Ownership of all contracts transferred to ${safe} (checked)`);
  console.log("Next: the Safe calls TrenchersNFT.setMintOpen(true) to open the mint on trenchers.io.");
  console.log(`To open starter claims, the Safe calls AgentStarterFund.setAccount(${await impl.getAddress()}, 0x00…00).`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
