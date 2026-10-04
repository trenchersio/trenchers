# Safety net: who controls what, and how to get ETH out

Rule number one: **every key belongs to the team.** Nobody else, including whoever helps build
Trenchers, ever creates or holds a private key for Trenchers. All team wallets are created by the
team in their own wallet app; contracts are deployed from a team wallet and owned by the team Safe.
Contracts and agent wallets have no private keys at all: they are controlled by an owner address
(the Safe) or by whoever holds the NFT.

## Every address, who controls it, how to get money out

| Address | Holds | Controlled by | Getting ETH out if something breaks |
| --- | --- | --- | --- |
| **Team wallets** (deployer, team / house agents, dev payouts) | Team ETH, house-agent NFTs #1 to #5 | The team's own keys (in the team's wallet app / Safe) | Normal transfers. |
| **Engine wallet** | Only gas for the engine's transactions | The team's key, held only by the team | Normal transfer. It can't take anyone's ETH: on agent wallets it can only trade within each holder's caps. |
| **TrenchersNFT** | Nothing (every mint forwards its ETH at once) | Owner (Safe) | `sweep(token, to)`: owner moves out anything sent there by mistake, immediately. |
| **RevenueSplitter** | Mint money waiting per bucket (buybacks, dev, prizes, starter in transit) | Owner (Safe) | `release(bucket)` sends a bucket to its destination (anyone can call). Empty destinations are set once, immediately; changing one takes a public 48-hour timelock. `rescueUnaccounted(to)` sweeps stray ETH at once. |
| **AgentStarterFund** | 0.01 ETH reserved for every Trencher not yet awakened | Owner (Safe), behind a delay | Emergency: `proposeRescue(to)` → wait the public **48-hour** delay → `executeRescue([])` sends everything to `to` and permanently stops claims. Cancel any time with `cancelRescue()`. |
| **AgentFeeDistributor** | The agents' share of $TRENCHERS fees until paid | Owner (Safe), behind a delay | Same 48-hour rescue as the starter fund, for ETH and tokens. |
| **PonsAdapter** | Nothing (each trade passes straight through) | Owner (Safe) | `sweep(token, to)`, immediately. |
| **AgentConfig** | Nothing | Owner (Safe); the guardian can only pause | — (changing engine / router / launcher, or offering a fixed wallet version, takes a 48-hour timelock). Holds the **emergency stop**. |
| **Agent wallets** (one per Trencher) | The agent's ETH and coins | **Whoever holds that NFT** (for #1 to #5 and any Trencher the team buys: the team) | `withdraw(amount)`: instant, anything above the starter. The 0.01 ETH starter unlocks after 6 months; after that `execute` moves any token or ETH. The team can never take a holder's money; that is by design. |

Why the 48-hour delay on pooled money: the starter fund and fee distributor hold money that belongs
to holders. A public delay means the team can always recover it if something breaks, while holders
can see a rescue coming and nobody can drain it silently. The delay is fixed in the contract
(`rescueDelay`, capped at 7 days); testnet deployments use 10 minutes so a rescue can be practised.

## Pausing and the emergency stop

- **Any holder can pause their own agent** at any time (`pause()` on the agent wallet, or *Pause trading*
  on the site). It stops buying and selling straight away; switching it back on is one click.
- **Emergency stop for everyone:** the Safe, or a guardian wallet the Safe appoints (`setGuardian`), calls
  `AgentConfig.pause()` and all engine trading stops at once, e.g. if the engine key leaks or a trading
  bug shows up. It never moves anyone's ETH and never blocks withdrawals. Only the Safe can `unpause()`.
  The engine also reads the switch and stops by itself (its health page says so).

## Fixing bugs after launch

| Where a bug could be | How it's fixed | Holders need to do |
| --- | --- | --- |
| Reading rules, deciding trades, timing, signals (the engine) | Ship a fixed engine; it's live in minutes. Rules are stored on-chain as text, so the fixed engine re-reads every agent's rule. | Nothing |
| How trades reach Pons / Uniswap (the trading route, `PonsAdapter`) | Deploy a fixed route and switch `AgentConfig` to it (public 48-hour timelock; pause meanwhile). | Nothing |
| The agent wallet code itself (limits, lock, withdrawals) | **Holder opt-in.** Wallets are not upgradeable by default: every agent wallet runs the original code, fixed in `TrenchersAgentWallet` (`ORIGINAL_VERSION`), and nobody can change that. If a real bug is found, the Safe offers a fixed version through `AgentConfig.propose(4, fixedCode)` (public 48-hour timelock). | Only if they want the fix: *Upgrade my agent wallet* on the site (`setAgentVersion`). Same address, balance, rules and track record; they can switch back any time. The option only appears once a fixed version has been offered. |

Rules for a fixed wallet version: it must keep the original storage layout (only add new variables at
the end), be tested against the upgrade tests (`test/Upgrades.test.js`) and be verified on the explorer
before it is offered.

## Where the buttons are

- **trenchers.io/setup → Safety net** (shown to the team wallet that deployed): balances of the
  starter fund, splitter buckets, NFT contract and fee distributor, with Rescue / Release / Sweep buttons.
- **trenchers.io/setup → Safety net → Emergency stop**: *Stop all trading* / *Resume trading*.
- **trenchers.io/setup → Your Trenchers**: holders withdraw, pause or resume their agent, and (only
  after a fix has been offered) upgrade their agent wallet.
- On mainnet the owner is a Safe, so the same calls are made from the Safe app (Transaction Builder),
  signed by the Safe's owners.

## Checks before mainnet

1. Every team wallet created by the team in its own wallet app; seed phrases backed up offline.
2. The Safe created with at least 2 signers; every contract's `owner()` shows the Safe.
3. A rescue practised on testnet (propose → wait → execute) from the Safe.
4. `rescueDelay()` reads 172800 (48 hours) on every mainnet contract that has one.
5. A guardian set on `AgentConfig` (a team member's own wallet, for a fast emergency stop), and the
   stop practised on testnet.
6. The agent wallet code (`TrenchersAgentAccount`) audited: it's the one piece that only changes if
   holders opt in.
