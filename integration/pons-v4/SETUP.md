# Recreating the workspace

These tests run the Trenchers trading path against the real Pons V2 contracts and real Uniswap v4
(see README.md). The third-party sources aren't stored in this repo; fetch them once:

```bash
cd integration/pons-v4
mkdir -p lib src
git clone https://github.com/ponsdotdev/pons-labs /tmp/pons-labs && (cd /tmp/pons-labs && git checkout 72925bd)
cp -r /tmp/pons-labs/contractsV2/src/v2 src/pons
for r in Uniswap/v4-core Uniswap/v4-periphery Uniswap/permit2 OpenZeppelin/openzeppelin-contracts transmissions11/solmate Uniswap/v4-hooks-public foundry-rs/forge-std; do git clone --depth 1 https://github.com/$r lib/$(basename $r); done
mkdir -p trenchers-build/src && cp ../../contracts/contracts/*.sol trenchers-build/src/
cp -r ../../contracts/node_modules/@openzeppelin/contracts lib/oz4/contracts  # OZ 4.8.3 for the Trenchers contracts
./setup-solc.sh && ./run.sh -vvv
```

Last run (pre-launch): 16 passed, 1 skipped (the live-fork test, which needs a Robinhood Chain RPC).
The same checks against live mainnet run from the engine: `GET /livecheck` on the engine service.
