# the inference core — Inference Capital Markets

Sell LLM inference for a token. A ledger in integer micro-dollars, an OpenAI-compatible proxy that bills what the
model provider actually charged plus a margin, and a house book that states the liability rather than hiding it.

**Nothing about any particular token, chain, brand or provider is compiled in.** Pointing this at a different token
on a different chain is a config object and a funding adapter, not a fork. That is the point of the package.

```ts
import { Ledger, Proxy, MemoryStore, OpenRouterUpstream, makeConfig } from "the inference core";

const config = makeConfig({
  keyPrefix: "trench",                       // keys read trench_live_<48 hex>
  token: {
    symbol: "TRENCHERS",
    address: "0xc65a…984a",
    decimals: 18,
    chainId: 4663,
    tokensPerUsd: "1000",                  // 1,000 TRENCHERS buys $1 of credit
    sink: "burn",                          // what happens to tokens taken in
  },
  marginBps: Number(process.env.MARGIN_BPS), // the operator's own, kept private
});

const ledger = new Ledger({ store: new MemoryStore(), config });
const proxy = new Proxy({ ledger, upstream: new OpenRouterUpstream({ apiKey: process.env.OPENROUTER_API_KEY! }) });

const res = await proxy.chat({ secret: "trench_live_…", body: { model: "anthropic/claude-sonnet-4", messages: [...] } });
```

## The three rules

1. **Money is an integer of micro-dollars.** A float never touches an amount. `0.1 + 0.2` is not `0.3`, and a
   gateway that bills people cannot find that out in production.
2. **Nothing is served that has not been held for first.** A call that cannot be paid for is refused before it
   costs anybody anything, and the refusal says what the balance was and what was needed.
3. **A charge whose outcome is unknown is never resolved automatically, in either direction.** Giving the money
   back risks paying for work that was done; keeping it risks billing for an answer nobody got. A person decides.

## How a call is billed

```
  authenticate ─► hold (upper bound) ─► forward ─► settle (actual cost + margin) ─► answer
                        │                              │
                        │ refused here costs nothing   └─ the rest of the hold goes back
                        └─ a hold that is never resolved is swept back to the customer
```

The hold is an upper bound because a completion's cost is not knowable until it exists. It is sized from the
provider's published per-token price for that model, clamped by `minHoldMicroUsd` and `maxHoldMicroUsd`, and
replaced by the truth within seconds. OpenRouter reports `usage.cost` on every completion and on the last SSE
frame of a stream; that number, times `1 + marginBps/10000`, is what the customer pays.

A provider that answers **without** a cost is the case worth knowing about: the charge goes to `unknown` and waits.
Billing a guess is worse than asking an operator.

## The house book

`ledger.book()` is the operator's view, and it exists because selling credit for a token that is then destroyed
creates a **real dollar liability with no asset behind it**:

| field | what it is |
| --- | --- |
| `soldMicroUsd` | credit sold for tokens, at face value |
| `grantedMicroUsd` | credit given away — a cost with no payment behind it |
| `revenueMicroUsd` | retail value of everything spent |
| `upstreamCostMicroUsd` | what the provider charged us. A real bill, in real money |
| `grossMarginMicroUsd` | revenue − upstream cost |
| `outstandingMicroUsd` | credit sold or granted and not yet spent. **What the house owes.** |
| `backing.coverNeededMicroUsd` | the cash needed to serve all of it, at cost rather than retail |
| `backing.unbacked` | true when the tokens were burned, so nothing stands behind the liability |
| `unresolvedMicroUsd` | money sitting in charges whose outcome nobody knows |

`ledger.check()` asserts `balance + held == deposited − spent` for every account and returns the ones that do not.
It should always return `[]`. Run it in tests after every operation and on a schedule in production.

## Porting it to another token

Everything that differs is in `makeConfig`. The parts you supply:

- **a config** — symbol, address, decimals, chain id, rate, sink, margin, key prefix, model lists
- **a store adapter** — the `Store` port: a `Map` plus write-through to your database. `MemoryStore` ships
- **a funding adapter** — whatever watches for payment calls `ledger.deposit({ accountId, source: "chain", ref: txHash, tokenUnits })`.
  `ref` makes it idempotent, so a reorg replaying a block credits once
- **an HTTP surface** — mount `proxy.chat()` and `proxy.modelsBody()` wherever your app serves routes

The package imports nothing but `node:crypto`. No viem, no chain client, no framework.

### The deposit address must be yours alone

Do not point this at a shared burn address. On most tokens a buyback, a protocol fee and anyone tidying their
wallet all send to the same `0x…dEaD`, and a watcher cannot tell those from a payment — it would credit a
contract and fill the house book with credit nobody bought. Use an address nothing else pays into. Whether you
then destroy what lands there is `token.sink`, and it changes only what the book claims.

### The rate is set by hand, on purpose

`tokensPerUsd` is a number an operator owns and changes deliberately. A live price feed on a thin pool is a way to
sell a dollar of inference for a cent during a wick. The cost of setting it by hand is drift, and drift is a number
the house book shows rather than a surprise.

## One process owns the ledger

The `Store` port is synchronous so that a balance change is one JavaScript tick and cannot interleave — two calls
cannot both read the same balance and both decide it is enough. The consequence: **two processes serving the same
accounts would each hold their own copy of a balance and both would be wrong.** Shard accounts across processes, or
put the balance behind a single writer. Do not run two of these over one database.

## What is deliberately not here

- **No retries.** A library that silently retries a call that spends money is a library that spends money twice.
- **No price feed.** See above.
- **No default provider key, RPC or base URL.** A URL shipped in a package is a URL everyone shares.
- **No automatic resolution of an unknown charge.** That is the whole point of the state.

## Tests

```
npm test -w the inference core
```

47 assertions, including a three-hundred-operation run of mixed holds, settles, releases and unknown outcomes that
checks the invariant after every single step.
