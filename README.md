# Trenchers

2,000-piece NFT collection on Robinhood Chain (chain ID 4663) where every NFT can be registered as an on-chain trading agent.

## Layout

| Path | What |
| --- | --- |
| `contracts/` | Hardhat project: `TrenchersNFT` (ERC721-C, ERC-2981 5%, 5 reserved, open public mint, no wallet limit), `RevenueSplitter` (mint 50/20/20 vested/10, royalties 100% buybacks), tests, deploy script |
| `art/generate.py` | Deterministic generator for all 2,000 images (pixel blocks and circles, all unique) + metadata + provenance hash |
| `art/brand.py` | Logo mark, wordmark lockup, avatar, OpenSea / X / Discord banners, OG image, palette |
| `art/out/metadata/` | Token metadata (image URLs use the `ipfs://IMAGES_CID/` placeholder) |
| `art/out/provenance.json` | Per-image SHA-256 and the collection provenance hash; publish before reveal |

## Contracts

```bash
cd contracts && npm install
npx hardhat test
# deploy (Robinhood Chain testnet 46630 or mainnet 4663)
DEPLOYER_KEY=0x... SAFE=0x... DEV_SAFE=0x... TEAM=0x... \
PREREVEAL_URI=ipfs://... CONTRACT_URI=ipfs://... \
npx hardhat run scripts/deploy.js --network robinhoodTestnet
```

The deploy script prints whether Limit Break's transfer validator, the ERC-6551 registry and Nick's CREATE2 factory exist on the target chain. If the validator is missing, the NFT deploys with no validator (transfers work, OpenSea royalties are not enforced) until one is set.

Compilation uses solc-js 0.8.24 from npm (see `hardhat.config.js`).

## Art

```bash
cd art && pip install pillow fonttools brotli && npm install
python3 generate.py            # ~3 min, writes out/images, out/metadata, out/provenance.json
python3 brand.py               # writes brand/
python3 sheet.py out/images 1 64 sheet.png
```

Token IDs 1-5 are the dev agents (gold "Founder" palette, `Role: Dev Agent`).

## Web (site: intro, landing, mint)

```bash
cd web && npm install
cp .env.example .env.local     # set NEXT_PUBLIC_CHAIN, NEXT_PUBLIC_NFT_ADDRESS, NEXT_PUBLIC_WC_PROJECT_ID
npm run dev
```

- Intro screen shows once per browser session (`components/Intro.tsx`, `components/PixelMosaic.tsx`).
- Social links: `NEXT_PUBLIC_X_URL`, `NEXT_PUBLIC_DISCORD_URL`, `NEXT_PUBLIC_TELEGRAM_URL` (empty = hidden).
- `NEXT_PUBLIC_MINT_LIVE=true` swaps "Mint coming soon" for the live mint panel.
- Railway: create a service with root directory `web/`; `railway.json` sets build and start. Set the `NEXT_PUBLIC_*` variables before the first build (they are baked in at build time).
- Chain definitions come from viem (`robinhood` 4663, `robinhoodTestnet` 46630).

## Not done yet (needs you)

- Testnet and mainnet deploys: need a funded deployer key, the Safe address and the dev Safe address. The Robinhood Chain RPCs were not reachable from the build environment, so the on-chain preflight (Limit Break validator, ERC-6551 registry) has not run against the real chain yet.
- IPFS upload of `art/out/images` and `art/out/metadata`, then `setBaseURI` at reveal. Publish the provenance hash before the mint opens.
- OpenSea creator-earnings enforcement: set in OpenSea Studio after deploy (requires the Limit Break validator on chain 4663).
