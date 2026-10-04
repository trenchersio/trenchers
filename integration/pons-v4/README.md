# Trenchers × Pons V2 × Uniswap v4: integration tests

These tests check the Trenchers trading path (agent wallet → `PonsAdapter` → Pons V2 bonding curve or
the coin's Uniswap v4 pool) against the real Pons V2 contracts and real Uniswap v4. Nothing is mocked
on the trading path.

## Run

```bash
./setup-solc.sh          # once: puts solc 0.8.17 / 0.8.24 / 0.8.26 in ~/.svm (GitHub release binaries)
./run.sh -vvv            # builds trenchers-build/ (0.8.24 + OZ 4.8.3), then `forge test -vvv`
```

`./run.sh` is `(cd trenchers-build && forge build) && forge test "$@"`. Once `trenchers-build/out`
exists, plain `forge test -vvv` works too, and so do filters (`--mt`, `--mc`).
`FORGE=/path/to/forge ./run.sh` picks the forge binary (default: the one on PATH). The config is `offline = true`, so forge never tries to download a compiler.

### Against the live chain (Robinhood Chain 4663, fork)

```bash
RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com ./run.sh --mc LiveRobinhoodForkTest -vvv
# optional, also round-trips an already graduated coin:
LIVE_GRADUATED_TOKEN=0x... RH_RPC_URL=... ./run.sh --mc LiveRobinhoodForkTest -vvv
```

This runs the same agent flow against the deployed factory `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`.
It pranks the factory owner to whitelist a test creator, launches a fresh ETH coin, and prints the
live snipe-tax profile against the engine's quote and timing. It checks that the live
`TokenLaunched`, `CurveBuy` and `CurveSell` layouts match `engine/src/abis.ts`. It then trades on the
curve, graduates the coin, and trades on the live v4 pool. **This is the only way to test the code
that is actually deployed** (see "Source caveat" below). It could not be run from the machine that
built this project, because the chain RPC and the block explorers were blocked there. Without
`RH_RPC_URL` the same file runs against the local stack, as a self-test.

## What gets deployed (local suite)

| Piece | Source | Compiler |
|---|---|---|
| `PoolManager` | Uniswap v4-core (`lib/v4-core`) | 0.8.26, via-IR, 44,444,444 runs (as Uniswap builds it) |
| `PositionManager` | v4-periphery (`lib/v4-periphery`) | 0.8.26, via-IR |
| `Permit2`, at its canonical address | `lib/permit2` | 0.8.17, via-IR |
| ERC-6551 registry, at `0x000000006551c194…5758` | the reference registry (`lib/erc6551`) | 0.8.17 |
| Pons V2: factory, curve and token (via the launch deployer), meme hook, locker, buyback vault, graduation executor, graduation guard | `src/pons` (pons-labs `contractsV2/src/v2`, see below) with Pons's own vendored OZ 5.5 (`lib/oz5-pons`) | 0.8.26, via-IR |
| `PonsV2FeeEscrow` | **not published by Pons**; `test/helpers/PonsV2FeeEscrowLite.sol` implements `IPonsV2FeeEscrow` | 0.8.26 |
| Trenchers: RevenueSplitter, TrenchersNFT (ERC721-C), AgentStarterFund, AgentConfig, TrenchersAgentAccount, TrenchersAgentWallet, PonsAdapter | `trenchers-build/src`, byte-identical copies of `contracts/contracts` | 0.8.24, 500 runs, no IR, OZ 4.8.3 |

The meme hook is deployed at the **live hook address** `0xE5e7…E044`. Its low 14 bits (`0x2044`:
beforeInitialize, afterSwap, afterSwapReturnDelta) match `getHookPermissions()`, so v4 accepts it
there. The deployed Trenchers bytecode matches the Hardhat artifacts in this repository once
the metadata hash is stripped. Everything is wired the way `scripts/deploy.js` and the Pons
constructors/setters require: `setGraduationExecutor`, `setLaunchDeployer`, `hook.setFactory`,
`hook.setBuybackVault`, `vault.setFactory`, `locker.setFactory`, and the `AgentConfig` keys, after
which the config is sealed. A Trencher is minted through the real mint flow, and its agent wallet is
created by `AgentStarterFund.claim` through the canonical ERC-6551 registry. The engine is an EOA
calling `trade`/`approveRouter`, with the minOut values computed exactly as `engine/src/engine.ts` does.

Pons launch config used here (the live values are not public): 1B supply, curve fee 100 bps,
phantom quote 1.5 ETH, graduation threshold 4 ETH, tick spacing 200, pool fee 0, creator tax 2%,
buyback on.

## Source caveat (important)

`pons-labs` HEAD **does not compile.** `PonsV2LaunchFactory.sol` (rewritten on 2026-08-11) calls
`PonsV2BondingCurve.exemptFromSnipeTax` and passes a `salt` to `LaunchDeployment`, but neither exists
in the published curve or deployer. The rest of the published set matches the commit labelled
"add verified contracts for PonsV2" (`72925bd`), so `src/pons` uses that self-consistent snapshot. The
only file that differs is the factory, which is taken from `72925bd`. The HEAD factory is kept in
`upstream-head/` for reference. The live system (according to pons-beta.md: a 99%→0 snipe tax, CREATE2
launches, a launch-and-buy router) therefore runs a curve and deployer whose source is not public.
Everything the adapter and engine touch has the same layout in `72925bd` and HEAD: the
`getLaunchedToken` struct, `GraduationPhase`, `poolManager()`, `memeHook()`, `graduate`,
`createGraduatedPool`, `TokenLaunched` and `PoolGraduated`. The curve's `buy`/`sell`/`getReserves`
and `CurveBuy`/`CurveSell` can only be confirmed against the live chain, which is what
`LiveFork.t.sol` is for.

## Layout

```
src/pons/                     Pons V2 (verified snapshot 72925bd)
upstream-head/                pons-labs HEAD factory (does not compile against the published curve) + testing/
test/Harness.sol              local ABIs, deployment of the whole stack, engine-equivalent helpers
test/PonsTrenchers.t.sol      local suite (13 tests)
test/LiveFork.t.sol           live-chain fork suite (self-tests locally without RH_RPC_URL)
test/helpers/                 fee escrow (unpublished by Pons), an ERC-20 used as a non-ETH pair
test/deps/                    imports only, so forge builds PoolManager/PositionManager/Permit2/registry
trenchers-build/              Trenchers sub-project (0.8.24, OZ 4.8.3, Limit Break libs)
trenchers-build/src/proposed/ PonsAdapterPatched.sol + PonsAdapter.patch (proposed fix, tested)
```

## Tests

| Test | What it proves |
|---|---|
| `test_FullLifecycle_CurveToV4` | Launch. Agent buys in the launch second and after the window, with engine minOut, through `trade()` to the adapter to the curve. `approveRouter` + sell on the curve. A whale pushes the coin to the edge, then the agent's 1 ETH buy crosses: partial fill, refund through the adapter, and auto-graduation to `Swept` inside the buy. While `Swept`, buys and sells revert `NotTradable`. Permissionless `createGraduatedPool` gives `PoolCreated`, with the LP NFT locked and the pool registered with the hook. The adapter's PoolKey hashes to the PoolId in v4's `Initialize` event, and the pool opens at the curve's terminal price. On v4: sell pre-graduation tokens, buy, sell everything. `poolPrice()` equals `slot0` and the price in the `Swap` event. v4 slippage reverts with `Slippage()` on both sides. The adapter never keeps ETH or tokens. Engine event layouts (TokenLaunched, CurveBuy/Sell, PoolGraduated, Bought/Sold, Claimed) match `abis.ts`. |
| `test_EngineMinOut_PartialFill` | The engine's full-size quote passes on a partially filled crossing buy, because the curve treats minOut as a price bound. |
| `test_EngineSlippage_MaxCreatorTax` | A coin with the maximum 10% creator tax plus a 1% fee: curve buys come out about 10.4% under the engine's fee-less quote, which still passes its 15% slippage. |
| `test_EngineQuote_PoolIgnoresPriceImpact` | **Engine bug:** after graduation, its spot-price quote makes a large exit revert `Slippage()`. A quote from simulating the trade fixes it. |
| `test_StuckReadyToGraduate_NeedsPermissionlessGraduate` | If the crossing buy's auto-graduation fails, the curve refuses both sides and the adapter reverts until someone calls `graduate` + `createGraduatedPool`. |
| `test_Patched_*` (3) | The proposed adapter patch, switched in through AgentConfig's real 48h router timelock, finishes a pending graduation itself and trades on the pool. If seeding fails, the adapter still reverts `NotTradable`, as before. |
| `test_Reject_NonEthPair` / `_NotPonsToken` / `_OwnCoin` | An approved ERC-20 pair, a random token, and the agent's own coin (launched with `launchCoin` through the real factory) are all rejected. |
| `test_StarterOnlyAgent_CanTrade` | A wallet holding only the 0.01 ETH starter can complete a round trip. |
| `test_UnlockCallback_NotCallableFromOutside` | `unlockCallback` can't be called from outside, not even by the PoolManager, unless it is inside the adapter's own unlock. |

## Notes on the build

* Forge's import pre-scan ignores context remappings, which kept the cache from ever settling. To
  avoid that, Trenchers (OZ 4) is a separate sub-project, and the tests load its artifacts by path
  (`trenchers-build/out/...json`). The same applies to Pons and Uniswap (`out/...json`), so filtered
  runs work.
* The tests talk to every contract through small local interfaces in `test/Harness.sol` and deploy it
  with `vm.deployCode`. Nothing is compiled together across compiler versions.
