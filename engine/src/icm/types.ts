/**
 * Every record the ledger keeps. All money is integer micro-dollars (see money.ts); all token amounts are decimal
 * strings of the token's own base units, because a bigint does not survive JSON.
 */

/** An account holds credit and owns keys. `owner` is whatever the host calls a customer — a lowercased wallet
 *  address here, an email somewhere else. The package never interprets it beyond equality. */
export interface Account {
  id: string;
  createdAt: string;
  updatedAt: string;
  owner: string;
  label: string | null;
  /** Spendable now. Holds are already subtracted from this. */
  balanceMicroUsd: string;
  /** Reserved against calls in flight. Settled or released when each one finishes. */
  heldMicroUsd: string;
  /** Face value of every deposit ever credited. */
  depositedMicroUsd: string;
  /** Retail value of every settled charge. */
  spentMicroUsd: string;
  suspended: boolean;
  suspendedReason: string | null;
}

/** A key is a secret the customer holds and we only ever store the hash of. */
export interface ApiKey {
  id: string;
  createdAt: string;
  updatedAt: string;
  accountId: string;
  /** sha256 of the secret, hex. The secret itself is shown once, at creation, and never again. */
  hash: string;
  /** What the customer sees in a list: the prefix plus the last four. Never enough to use. */
  display: string;
  label: string | null;
  disabled: boolean;
  /** ISO, or null for a key that does not expire. */
  expiresAt: string | null;
  /** A ceiling on this one key, independent of the account balance. Null for no ceiling. */
  spendLimitMicroUsd: string | null;
  spentMicroUsd: string;
  lastUsedAt: string | null;
  /** Models this key may call. Empty means whatever the gateway allows. */
  models: string[];
}

/** Where a deposit came from. `chain` is a confirmed on-chain payment; `grant` is credit given, not sold, and is
 *  tracked apart because it is a cost to the house with no token behind it. */
export type DepositSource = "chain" | "grant" | "adjustment";

export interface Deposit {
  id: string;
  createdAt: string;
  accountId: string;
  source: DepositSource;
  /** The thing that makes this deposit unique: a transaction hash, or an operator's idempotency key. A second
   *  deposit with the same ref is refused, which is what stops a reorg or a retry from crediting twice. */
  ref: string;
  /** Base units of the token paid, as a decimal string. Zero for a grant. */
  tokenUnits: string;
  tokenSymbol: string;
  tokenDecimals: number;
  /** Tokens per dollar at the moment this was credited, recorded so the rate can change later without rewriting
   *  history. A decimal string of whole tokens. */
  rateTokensPerUsd: string;
  creditedMicroUsd: string;
  /** The transaction that destroyed the tokens, when the host burns them. Null when it does not, or not yet. */
  burnTx: string | null;
  note: string | null;
}

/** A charge moves through held → settled, or held → released if nothing ran. `unknown` is the state that must
 *  never be silently resolved: we sent the request and did not learn what happened. */
export type ChargeState = "held" | "settled" | "released" | "unknown";

export interface Charge {
  id: string;
  createdAt: string;
  updatedAt: string;
  accountId: string;
  keyId: string;
  model: string;
  /** The upstream's own id for the generation, kept so a bill can be reconciled against theirs. */
  upstreamId: string | null;
  state: ChargeState;
  /** What was reserved up front. Returned in full if the call never ran. */
  heldMicroUsd: string;
  /** What the provider charged us. The number the house actually owes; zero until it is known. */
  upstreamMicroUsd: string;
  /** What the customer was charged: upstream plus margin. Zero until settled. */
  retailMicroUsd: string;
  marginBps: number;
  tokensIn: number;
  tokensOut: number;
  reasoningTokens: number;
  cachedTokens: number;
  streamed: boolean;
  latencyMs: number;
  /** Set when the charge ended badly, for the operator rather than the customer. */
  failure: string | null;
}

/** What the house books look like at a moment. Every figure is micro-dollars except the counts. */
export interface HouseBook {
  at: string;
  /** Credit sold for tokens, at face value. */
  soldMicroUsd: string;
  /** Credit given away: trials, support, goodwill. A cost with no payment behind it. */
  grantedMicroUsd: string;
  /** Retail value of everything spent. */
  revenueMicroUsd: string;
  /** What the provider charged us for all of it. This is a real bill in real money. */
  upstreamCostMicroUsd: string;
  /** revenue − upstream cost. What the margin actually earned. */
  grossMarginMicroUsd: string;
  /** Credit sold or granted and not yet spent. **The house owes this as inference it has already been paid for.**
   *  The single most important number here. */
  outstandingMicroUsd: string;
  /** Of the outstanding liability, the part that was sold. Grants are counted as spent first, which is the
   *  assumption that makes this number as large as it honestly can be. */
  outstandingSoldMicroUsd: string;
  /** The rest: credit given away and not yet used. */
  outstandingGrantedMicroUsd: string;
  /** What stands behind the outstanding liability, said plainly, because burning the token means nothing does.
   *  `coverNeededMicroUsd` is the cash the treasury must be able to find to serve every credit already sold. */
  backing: {
    sink: "burn" | "treasury" | "router";
    /** True when the tokens taken in were destroyed, so no asset is held against the liability. */
    unbacked: boolean;
    /** Upstream cost of serving all outstanding credit, at the current margin. Less than the face value, because
     *  the margin is ours — this is the real bill, not the headline. */
    coverNeededMicroUsd: string;
    note: string;
  };
  /** Tokens taken in and destroyed, by symbol, as decimal strings of whole tokens. */
  burned: { symbol: string; units: string; tokens: string }[];
  counts: { accounts: number; keys: number; deposits: number; charges: number; held: number; unknown: number };
  /** Charges that ended in an unknown state and still need a human. Each one is money that may or may not be owed. */
  unresolvedMicroUsd: string;
}
