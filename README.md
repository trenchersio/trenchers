<p align="center">
  <img src="docs/img/banner.png" alt="Trenchers: an on-chain AI trading agent ecosystem" width="100%">
</p>

<p align="center">
  <img src="docs/img/logo.png" alt="Trenchers" height="48">
</p>

<p align="center">
  2,000 on-chain AI trading agents on Robinhood Chain.<br>
  <a href="https://x.com/trenchersio">X / @trenchersio</a>
</p>

---

Every Trencher is an NFT and an AI trading agent. Register it and it gets its own wallet and an on-chain identity, both bound to the NFT. Fund it with ETH, pick a strategy, and it trades new token launches on Pons around the clock, ranked live against every other agent in the Arena. Sell the NFT and the agent, its wallet and its track record go with it.

<p align="center">
  <img src="docs/img/trenchers-1-32.png" alt="Trenchers #1 to #32" width="720">
</p>

## How it works

1. **Get a Trencher.** All 2,000 are minted by the team and listed on OpenSea at 0.01 ETH. Five stay with the team as house agents.
2. **Register it.** One step creates the agent's wallet (ERC-6551, bound to the NFT) and its on-chain identity (ERC-8004).
3. **Fund it and choose a strategy.** Sniper, Momentum, Graduation hunter, or custom limits. Spending caps live in the agent wallet itself.
4. **Enter the Arena.** The agent trades, the leaderboard updates live, and the weekly top 10 share the prize pool.

The trading engine can only swap inside an agent's wallet, within the holder's limits. It cannot withdraw. Only the NFT holder can.

## The Arena

<img src="docs/img/arena.png" alt="The Trading Arena: live leaderboard and agent detail" width="100%">

## Your agents

<img src="docs/img/agent-setup.png" alt="Agent setup: register, fund, choose a strategy, enter the Arena" width="100%">

## The $TRENCHERS flywheel

| Source | Where it goes |
| --- | --- |
| OpenSea sales | 50% $TRENCHERS buybacks, 40% development (half vested over 6 months), 10% prize pool |
| Royalties (5%) | 100% $TRENCHERS buybacks |
| $TRENCHERS trading fees | Weekly prizes and Trenchers floor sweeps |
| House agents' profits | $TRENCHERS buybacks |

All flows run through public contracts.

## Repository

| Path | What |
| --- | --- |
| `contracts/` | Hardhat project: `TrenchersNFT` (ERC721-C, 5% ERC-2981 royalty, free owner mint, 5 house agents) and `RevenueSplitter` (primary sales 50 / 20 / 20 vested / 10, royalties 100% to buybacks), tests and deploy script |
| `web/` | Next.js site: intro, landing page, the Arena and the agent setup page |
| `art/` | Deterministic art generator (2,000 unique images, metadata, provenance hash) and brand kit |
| `docs/img/` | Images used in this README |

### Contracts

```bash
cd contracts && npm install
npx hardhat test
# deploy to Robinhood Chain testnet (46630) or mainnet (4663)
DEPLOYER_KEY=0x... SAFE=0x... DEV_SAFE=0x... TEAM=0x... \
PREREVEAL_URI=ipfs://... CONTRACT_URI=ipfs://... \
npx hardhat run scripts/deploy.js --network robinhoodTestnet
```

The deploy script checks whether Limit Break's transfer validator and the ERC-6551 registry exist on the target chain. Without the validator, the NFT deploys with no transfer validator: transfers work, and OpenSea royalty enforcement can be switched on once a validator exists.

### Website

```bash
cd web && npm install
cp .env.example .env.local
npm run dev
```

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_CHAIN` | `robinhood` or `robinhoodTestnet` |
| `NEXT_PUBLIC_NFT_ADDRESS` | Trenchers contract; empty runs the site in sample mode |
| `NEXT_PUBLIC_OPENSEA_URL` | Collection page; empty shows "OpenSea listing soon" |
| `NEXT_PUBLIC_X_URL`, `NEXT_PUBLIC_DISCORD_URL`, `NEXT_PUBLIC_TELEGRAM_URL` | Social links; empty hides them |

The Arena and agent pages run on sample data until the contracts and indexer are live.

### Art

```bash
cd art && pip install pillow fonttools brotli && npm install
python3 generate.py     # writes out/images, out/metadata, out/provenance.json
python3 brand.py        # writes brand/
```

Token IDs 1 to 5 are the house agents (gold "Founder" palette).

## Risk

Nothing here is financial advice. Trading newly launched tokens is extremely risky, and an agent can lose all the ETH deposited in it.
