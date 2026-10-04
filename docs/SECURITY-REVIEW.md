# Internal security review (pre-mainnet)

An independent internal review of every contract in `contracts/contracts`, done before mainnet and
before the external audit. Findings and what was done about each. All fixes are covered by tests
(`npx hardhat test`, 65 passing) and the engine's end-to-end test (`npm run test:local` in `engine/`).

No way was found for an outsider to take ETH from holders, agent wallets or the pooled contracts.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| H-1 | High | `launchCoin` could spend the locked starter balance and, depending on the launcher's calldata, send what it bought elsewhere: a way to cash out the starter early. | **Fixed.** A coin launch is paid only from the free balance (it reverts if it would touch the starter) and can happen once. The coin launcher is also left unset at deployment; adding it later takes the 48-hour timelock. |
| M-1 | Medium | The "no tokens out during the lock" rule was a blocklist: approvals made before awakening, ERC-1271 signatures (Permit2-style orders) or unlisted token functions could move coins bought with the starter. | **Fixed.** During the lock `execute` only sends plain ETH from the free balance (no contract calls), `isValidSignature` refuses all signatures, and the Agent Starter Fund only awakens a wallet that hasn't been used yet (`state() == 0`), so no approval can predate the lock. |
| M-2 | Medium | The engine's limits cap ETH spent on buys, not sells; a leaked engine key could sell agents' open positions at a bad price, or spend up to each daily limit on a coin it launched. | **Partly fixed, rest accepted.** A per-trade limit of 0 now disables the engine entirely for that agent. Remaining risk is limited to open positions and one day's limit, and is covered by the emergency stop (guardian wallet, instant) and swapping the engine key (48 h). Keep the engine key only in Railway. |
| M-3 | Medium | Deploying with a wrong `SAFE` address would lock the project out (claims never open, pooled ETH stuck). | **Fixed.** The deploy script refuses to run on mainnet if the Safe has no code, and reads every contract's owner back at the end. |
| L-1 | Low | Whether incoming ETH counts as "starter" depended on a config setting that could change. | **Fixed.** The starter fund is fixed in the wallet code at deployment. |
| L-2 | Low | The lock is an amount, not specific coins: after trading losses, the holder's next deposit tops the locked amount back up. | Accepted, documented: the lock never exceeds the starter amount and ends after 180 days. |
| L-3 | Low | A Trencher sent into its own agent wallet would be frozen forever. | **Fixed** for safe transfers (the wallet refuses its own NFT). A plain `transferFrom` into the wallet can't be refused by the contract: never send a Trencher to an agent wallet. |
| L-4 | Low | An offered wallet version could never be withdrawn. | **Fixed.** `revokeAccountLogic` (the original can't be revoked; wallets on a revoked version can still switch back). |
| L-5 | Low | A key left unset at deployment could later be set instantly, without the 48-hour notice. | **Fixed.** `AgentConfig.seal()` at the end of deployment: every later change waits 48 hours, first settings included. |
| L-6 | Low | A coin whose curve is full but not yet moved to its Uniswap pool can't be sold until someone completes the graduation. | Accepted: temporary; the engine retries, and positions become tradable once the pool exists. |
| Info | — | Native-ETH settlement in the Uniswap v4 route didn't `sync` first. | **Fixed.** |
| Info | — | Receiving ETH needs more than 2,300 gas (splitter, agent wallets): senders using `transfer`/`send` fail. | Accepted: Pons, the mint and the fee distributor use `call`. |

Checked and fine: the agent wallet proxy chain (storage slots, immutables through delegatecall,
reentrancy guard), trading-policy staleness after a sale, the global pause, the Uniswap v4 delta
handling and refunds, revenue split rounding and vesting, mint gas guard, starter fund solvency and
claim order, fee distributor accounting, the timelocked rescue, and every owner/holder-only check.

Next: an external audit of `TrenchersAgentAccount` and `TrenchersAgentWallet` (the code that only
changes if holders opt in), then mainnet.
