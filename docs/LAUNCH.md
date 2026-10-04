# Mainnet launch runbook

Everything is signed in the team's own wallets; no key ever leaves them.

## Before
- Team Safe on Robinhood Chain (2 signatures): `0xF928e1A70d0CBf092193D4E3FE4F68edfffe4b10`.
- Deployer `0x447D…8210` holds ~0.01 ETH on Robinhood Chain (deployment fees). It also receives house agents #1–5.
- Guardian `0xb5aF…E9DD` and Engine `0xe15f…9f2F` created (no funds needed yet; the engine gets a little ETH for gas at launch).

## Deploy (about 15 minutes)
1. Open **trenchers.io/launch**, connect the **Deployer** in the site header, switch to Robinhood Chain.
2. Check the list is green (Safe found with its signers, ERC-6551 registry, Pons launchpad).
3. Click **Deploy to mainnet** and confirm each step in the wallet (23 steps). It's resumable.
4. At the end the page checks that every contract is owned by the Safe.

What gets deployed and wired: revenue splitter (dev share → Safe; 51% of each mint → starter fund),
the NFT (0.02 ETH, metadata at trenchers.io/meta/, house agents → Deployer), Agent Starter Fund
(owned by the Safe, 48 h safety net), agent settings (engine, trading route, guardian), the agent
wallet code (original version), the fee distributor and the trading route (Pons curve + Uniswap v4).
The settings are then **sealed**: every later change takes the public 48-hour notice. The coin
launcher (agent coins) is left off; it can be added later with the same notice.

## Open it (in the Safe app)
The page shows two transactions to make in the Safe (Transaction Builder, custom data, value 0), each
signed by both signers:
1. **Open awakening**: `AgentStarterFund.setAccount(agentWallet, 0x0…0)`.
2. **Open the mint**: `TrenchersNFT.setMintOpen(true)`.

## Switch the site and engine to mainnet
Send the team the deployment code from the page. Then: the site is pointed at mainnet
(`NEXT_PUBLIC_CHAIN=robinhood` plus the addresses), and the engine's Railway variables are updated
(new addresses, `CHAIN_ID=4663`, `RPC_URL`, and the mainnet `ENGINE_KEY`, pasted by the team only).

This flow was rehearsed end to end on a local copy of mainnet (chain 4663) with the real addresses:
deploy, ownership check, both Safe transactions, a mint of 3, a claim, and the metadata and art.
