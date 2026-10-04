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
| **Engine wallet** | Only gas for the engine's transactions | The team's key, pasted into Railway by the team | Normal transfer. It can't take anyone's ETH: on agent wallets it can only trade within each holder's caps. |
| **TrenchersNFT** | Nothing (every mint forwards its ETH at once) | Owner (Safe) | `sweep(token, to)`: owner moves out anything sent there by mistake, immediately. |
| **RevenueSplitter** | Mint money waiting per bucket (buybacks, dev, prizes, starter in transit) | Owner (Safe) | `release(bucket)` sends a bucket to its destination (anyone can call). Empty destinations are set once, immediately; changing one takes a public 48-hour timelock. `rescueUnaccounted(to)` sweeps stray ETH at once. |
| **AgentStarterFund** | 0.01 ETH reserved for every Trencher not yet awakened | Owner (Safe), behind a delay | Emergency: `proposeRescue(to)` → wait the public **48-hour** delay → `executeRescue([])` sends everything to `to` and permanently stops claims. Cancel any time with `cancelRescue()`. |
| **AgentFeeDistributor** | The agents' share of $TRENCHERS fees until paid | Owner (Safe), behind a delay | Same 48-hour rescue as the starter fund, for ETH and tokens. |
| **PonsAdapter** | Nothing (each trade passes straight through) | Owner (Safe) | `sweep(token, to)`, immediately. |
| **AgentConfig** | Nothing | Owner (Safe) | — (changing engine / router / launcher takes a 48-hour timelock) |
| **Agent wallets** (one per Trencher) | The agent's ETH and coins | **Whoever holds that NFT** (for #1 to #5 and any Trencher the team buys: the team) | `withdraw(amount)`: instant, anything above the starter. The 0.01 ETH starter unlocks after 6 months; after that `execute` moves any token or ETH. The team can never take a holder's money; that is by design. |

Why the 48-hour delay on pooled money: the starter fund and fee distributor hold money that belongs
to holders. A public delay means the team can always recover it if something breaks, while holders
can see a rescue coming and nobody can drain it silently. The delay is fixed in the contract
(`rescueDelay`, capped at 7 days); testnet deployments use 10 minutes so a rescue can be practised.

## Where the buttons are

- **trenchers.io/setup → Safety net** (shown to the team wallet that deployed): balances of the
  starter fund, splitter buckets, NFT contract and fee distributor, with Rescue / Release / Sweep buttons.
- **trenchers.io/setup → Your Trenchers**: holders withdraw from their agent wallets.
- On mainnet the owner is a Safe, so the same calls are made from the Safe app (Transaction Builder),
  signed by the Safe's owners.

## Checks before mainnet

1. Every team wallet created by the team in its own wallet app; seed phrases backed up offline.
2. The Safe created with at least 2 signers; every contract's `owner()` shows the Safe.
3. A rescue practised on testnet (propose → wait → execute) from the Safe.
4. `rescueDelay()` reads 172800 (48 hours) on every mainnet contract that has one.
