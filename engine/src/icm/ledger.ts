/**
 * The ledger: accounts, keys, deposits, holds and charges.
 *
 * The invariant everything here protects:
 *
 *     balance + held  ==  deposited − settled
 *
 * Every method either keeps that true or throws. `check()` asserts it across the whole book, and the tests run it
 * after every operation, because an accounting bug that only shows up at scale is the worst kind.
 *
 * Holds exist because a completion's cost is not knowable until it has been generated. `hold()` takes an upper
 * bound out of the balance before the request goes upstream; `settle()` puts back the difference between the hold
 * and what it really cost; `release()` puts back all of it. A hold that is never resolved is money the customer
 * cannot spend, so `sweepStaleHolds()` exists and the house book counts them.
 *
 * Nothing in this file knows what a token is, what chain it is on, or who the provider is.
 */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { Account, ApiKey, Charge, Deposit, DepositSource, HouseBook } from "./types.ts";
import type { CollectionName, Store } from "./store.ts";
import type { IcmConfig } from "./config.ts";
import { E, IcmError } from "./errors.ts";
import { atLeastZero, formatUnits, formatUsd, parseUsd } from "./money.ts";
import { creditForTokens, retailOf } from "./pricing.ts";

const ACCOUNTS: CollectionName = "icm_accounts";
const KEYS: CollectionName = "icm_keys";
const DEPOSITS: CollectionName = "icm_deposits";
const CHARGES: CollectionName = "icm_charges";

const big = (s: string): bigint => BigInt(s);
const str = (v: bigint): string => v.toString();

export interface LedgerOptions {
  store: Store;
  config: IcmConfig;
  /** Injected so tests can run without sleeping and so every record in one operation shares a timestamp. */
  now?: () => number;
  /** Injected for deterministic ids in tests. Must be unguessable in production. */
  randomId?: () => string;
}

/** The secret and the record. The secret is returned exactly once, here, and is not recoverable afterwards. */
export interface IssuedKey {
  key: ApiKey;
  /** The thing the customer copies. Store it or lose it. */
  secret: string;
}

export class Ledger {
  readonly config: IcmConfig;
  private readonly store: Store;
  private readonly now: () => number;
  private readonly randomId: () => string;

  constructor(o: LedgerOptions) {
    this.store = o.store;
    this.config = o.config;
    this.now = o.now ?? Date.now;
    this.randomId = o.randomId ?? (() => randomBytes(16).toString("hex"));
  }

  private iso(): string { return new Date(this.now()).toISOString(); }

  // ---------------------------------------------------------------------------------------------- accounts

  /** The account for an owner, made if it does not exist. `owner` is compared lowercased and trimmed, so a wallet
   *  address in any case finds the same account. */
  account(owner: string, label?: string): Account {
    const key = owner.trim().toLowerCase();
    if (!key) throw E.invalid("an account needs an owner");
    const found = this.store.find<Account>(ACCOUNTS, (a) => a.owner === key);
    if (found) return found;
    const at = this.iso();
    return this.store.save<Account>(ACCOUNTS, {
      id: this.randomId(), createdAt: at, updatedAt: at, owner: key, label: label ?? null,
      balanceMicroUsd: "0", heldMicroUsd: "0", depositedMicroUsd: "0", spentMicroUsd: "0",
      suspended: false, suspendedReason: null,
    });
  }

  accountById(id: string): Account {
    const a = this.store.get<Account>(ACCOUNTS, id);
    if (!a) throw E.notFound("account");
    return a;
  }

  accountFor(owner: string): Account | undefined {
    return this.store.find<Account>(ACCOUNTS, (a) => a.owner === owner.trim().toLowerCase());
  }

  suspend(accountId: string, reason: string): Account {
    const a = this.accountById(accountId);
    a.suspended = true;
    a.suspendedReason = reason.slice(0, 300);
    a.updatedAt = this.iso();
    return this.store.save(ACCOUNTS, a);
  }

  unsuspend(accountId: string): Account {
    const a = this.accountById(accountId);
    a.suspended = false;
    a.suspendedReason = null;
    a.updatedAt = this.iso();
    return this.store.save(ACCOUNTS, a);
  }

  // ---------------------------------------------------------------------------------------------- keys

  /** Mint a key. The secret is `<prefix>_<env>_<48 hex>`; only its sha256 is stored. */
  issueKey(o: { accountId: string; label?: string; spendLimitMicroUsd?: bigint | null; expiresAt?: string | null; models?: string[] }): IssuedKey {
    const account = this.accountById(o.accountId);
    const secret = `${this.config.keyPrefix}_${this.config.environment}_${randomBytes(24).toString("hex")}`;
    const at = this.iso();
    const key = this.store.save<ApiKey>(KEYS, {
      id: this.randomId(), createdAt: at, updatedAt: at, accountId: account.id,
      hash: hashSecret(secret),
      display: `${secret.slice(0, this.config.keyPrefix.length + this.config.environment.length + 2 + 4)}…${secret.slice(-4)}`,
      label: o.label?.slice(0, 80) ?? null,
      disabled: false,
      expiresAt: o.expiresAt ?? null,
      spendLimitMicroUsd: o.spendLimitMicroUsd == null ? null : str(o.spendLimitMicroUsd),
      spentMicroUsd: "0",
      lastUsedAt: null,
      models: o.models ?? [],
    });
    return { key, secret };
  }

  keysOf(accountId: string): ApiKey[] {
    return this.store.filter<ApiKey>(KEYS, (k) => k.accountId === accountId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Resolve a presented secret, or throw the reason it cannot be used. Constant-time on the hash compare, so the
   *  endpoint cannot be used to learn a key one byte at a time. */
  authenticate(secret: string | null | undefined): { key: ApiKey; account: Account } {
    if (!secret) throw E.missingKey();
    const hash = hashSecret(secret);
    const want = Buffer.from(hash, "hex");
    let key: ApiKey | undefined;
    for (const k of this.store.all<ApiKey>(KEYS)) {
      const have = Buffer.from(k.hash, "hex");
      if (have.length === want.length && timingSafeEqual(have, want)) { key = k; break; }
    }
    if (!key) throw E.invalidKey();
    if (key.disabled) throw E.keyDisabled();
    if (key.expiresAt && Date.parse(key.expiresAt) <= this.now()) throw E.keyExpired();
    const account = this.store.get<Account>(ACCOUNTS, key.accountId);
    if (!account) throw E.invalidKey();
    if (account.suspended) throw E.suspended(account.suspendedReason ?? "contact the operator");
    return { key, account };
  }

  setKey(keyId: string, patch: { label?: string | null; disabled?: boolean; spendLimitMicroUsd?: bigint | null; models?: string[] }): ApiKey {
    const k = this.store.get<ApiKey>(KEYS, keyId);
    if (!k) throw E.notFound("key");
    if (patch.label !== undefined) k.label = patch.label === null ? null : patch.label.slice(0, 80);
    if (patch.disabled !== undefined) k.disabled = patch.disabled;
    if (patch.spendLimitMicroUsd !== undefined) k.spendLimitMicroUsd = patch.spendLimitMicroUsd === null ? null : str(patch.spendLimitMicroUsd);
    if (patch.models !== undefined) k.models = patch.models;
    k.updatedAt = this.iso();
    return this.store.save(KEYS, k);
  }

  /** Delete a key. Its charges stay: the money was spent and the book must still add up. */
  revokeKey(keyId: string): void {
    if (!this.store.get<ApiKey>(KEYS, keyId)) throw E.notFound("key");
    this.store.delete(KEYS, keyId);
  }

  // ---------------------------------------------------------------------------------------------- deposits

  /**
   * Credit an account for a payment. `ref` makes it idempotent: the same transaction hash credits once, however
   * many times a watcher sees it. A second call with the same ref returns the first deposit untouched rather than
   * throwing, because a reorg replaying a block is normal and should not page anybody.
   */
  deposit(o: { accountId: string; source: DepositSource; ref: string; tokenUnits?: bigint; creditedMicroUsd?: bigint; burnTx?: string | null; note?: string }): Deposit {
    const account = this.accountById(o.accountId);
    const ref = o.ref.trim();
    if (!ref) throw E.invalid("a deposit needs a ref — the transaction that paid for it, or an idempotency key");
    const existing = this.store.find<Deposit>(DEPOSITS, (d) => d.ref === ref);
    if (existing) return existing;

    const tokenUnits = o.tokenUnits ?? 0n;
    if (tokenUnits < 0n) throw E.invalid("a deposit cannot be negative");
    const credited = o.creditedMicroUsd ?? creditForTokens(this.config, tokenUnits);
    if (credited < 0n) throw E.invalid("a deposit cannot credit a negative amount");
    if (o.source === "chain" && credited < this.config.minDepositMicroUsd) {
      throw E.invalid(`that payment is worth $${formatUsd(credited)} of credit, below this gateway's minimum of $${formatUsd(this.config.minDepositMicroUsd)}`,
        { credited: formatUsd(credited), minimum: formatUsd(this.config.minDepositMicroUsd) });
    }

    const at = this.iso();
    const record = this.store.save<Deposit>(DEPOSITS, {
      id: this.randomId(), createdAt: at, accountId: account.id, source: o.source, ref,
      tokenUnits: str(tokenUnits), tokenSymbol: this.config.token.symbol, tokenDecimals: this.config.token.decimals,
      rateTokensPerUsd: this.config.token.tokensPerUsd,
      creditedMicroUsd: str(credited), burnTx: o.burnTx ?? null, note: o.note?.slice(0, 300) ?? null,
    });
    account.balanceMicroUsd = str(big(account.balanceMicroUsd) + credited);
    account.depositedMicroUsd = str(big(account.depositedMicroUsd) + credited);
    account.updatedAt = at;
    this.store.save(ACCOUNTS, account);
    return record;
  }

  /** Record the transaction that destroyed the tokens from a deposit, once it has confirmed. */
  setBurnTx(depositId: string, tx: string): Deposit {
    const d = this.store.get<Deposit>(DEPOSITS, depositId);
    if (!d) throw E.notFound("deposit");
    d.burnTx = tx;
    return this.store.save(DEPOSITS, d);
  }

  /** The deposit a reference already made, if any. A watcher asks this before crediting, so a replayed block
   *  does not fire a notification a second time. */
  depositByRef(ref: string): Deposit | undefined {
    const key = ref.trim();
    return key ? this.store.find<Deposit>(DEPOSITS, (d) => d.ref === key) : undefined;
  }

  depositsOf(accountId: string, limit = 50): Deposit[] {
    return this.store.filter<Deposit>(DEPOSITS, (d) => d.accountId === accountId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
  }

  // ---------------------------------------------------------------------------------------------- spending

  /** What this key can spend right now: the account balance, further limited by the key's own ceiling. */
  spendable(key: ApiKey, account: Account): bigint {
    const balance = big(account.balanceMicroUsd);
    if (key.spendLimitMicroUsd === null) return balance;
    const left = atLeastZero(big(key.spendLimitMicroUsd) - big(key.spentMicroUsd));
    return left < balance ? left : balance;
  }

  /**
   * Reserve `amount` against a call about to go upstream. Throws before anything is reserved if the account
   * cannot cover it, so a refused call costs nothing and says so.
   */
  hold(o: { key: ApiKey; account: Account; model: string; amountMicroUsd: bigint }): Charge {
    const { key, account } = o;
    if (o.amountMicroUsd <= 0n) throw E.invalid("a hold has to be positive");
    const balance = big(account.balanceMicroUsd);
    if (key.spendLimitMicroUsd !== null) {
      const left = atLeastZero(big(key.spendLimitMicroUsd) - big(key.spentMicroUsd));
      if (left < o.amountMicroUsd) throw E.spendLimit(formatUsd(big(key.spendLimitMicroUsd)));
    }
    if (balance < o.amountMicroUsd) throw E.insufficient(formatUsd(balance), formatUsd(o.amountMicroUsd));

    const at = this.iso();
    const charge = this.store.save<Charge>(CHARGES, {
      id: this.randomId(), createdAt: at, updatedAt: at, accountId: account.id, keyId: key.id,
      model: o.model, upstreamId: null, state: "held",
      heldMicroUsd: str(o.amountMicroUsd), upstreamMicroUsd: "0", retailMicroUsd: "0", marginBps: this.config.marginBps,
      tokensIn: 0, tokensOut: 0, reasoningTokens: 0, cachedTokens: 0, streamed: false, latencyMs: 0, failure: null,
    });
    account.balanceMicroUsd = str(balance - o.amountMicroUsd);
    account.heldMicroUsd = str(big(account.heldMicroUsd) + o.amountMicroUsd);
    account.updatedAt = at;
    this.store.save(ACCOUNTS, account);
    key.lastUsedAt = at;
    this.store.save(KEYS, key);
    return charge;
  }

  /**
   * Resolve a hold against what the provider actually charged. The retail price is the upstream cost plus margin;
   * anything held above it goes back to the balance, and the rare case where the real cost came in **above** the
   * hold is charged in full and allowed to overdraw, because the work has already been done and billing less than
   * cost would be the house paying people to use it. An overdrawn account cannot open another call.
   */
  settle(o: {
    chargeId: string;
    upstreamMicroUsd: bigint;
    upstreamId?: string | null;
    usage?: { tokensIn?: number; tokensOut?: number; reasoningTokens?: number; cachedTokens?: number };
    streamed?: boolean;
    latencyMs?: number;
  }): Charge {
    const charge = this.chargeById(o.chargeId);
    if (charge.state !== "held") throw E.invalid(`that charge is already ${charge.state}`);
    if (o.upstreamMicroUsd < 0n) throw E.invalid("an upstream cost cannot be negative");

    const held = big(charge.heldMicroUsd);
    const retail = retailOf(this.config, o.upstreamMicroUsd);
    const account = this.accountById(charge.accountId);
    const at = this.iso();

    charge.state = "settled";
    charge.upstreamMicroUsd = str(o.upstreamMicroUsd);
    charge.retailMicroUsd = str(retail);
    charge.upstreamId = o.upstreamId ?? charge.upstreamId;
    charge.tokensIn = o.usage?.tokensIn ?? 0;
    charge.tokensOut = o.usage?.tokensOut ?? 0;
    charge.reasoningTokens = o.usage?.reasoningTokens ?? 0;
    charge.cachedTokens = o.usage?.cachedTokens ?? 0;
    charge.streamed = o.streamed ?? charge.streamed;
    charge.latencyMs = o.latencyMs ?? charge.latencyMs;
    charge.updatedAt = at;
    this.store.save(CHARGES, charge);

    // the hold comes off `held`; the retail price comes out of it, and the remainder returns to the balance
    account.heldMicroUsd = str(big(account.heldMicroUsd) - held);
    account.balanceMicroUsd = str(big(account.balanceMicroUsd) + held - retail);
    account.spentMicroUsd = str(big(account.spentMicroUsd) + retail);
    account.updatedAt = at;
    this.store.save(ACCOUNTS, account);

    const key = this.store.get<ApiKey>(KEYS, charge.keyId);
    if (key) { key.spentMicroUsd = str(big(key.spentMicroUsd) + retail); key.updatedAt = at; this.store.save(KEYS, key); }
    return charge;
  }

  /** Give the whole hold back: nothing ran, or the provider refused before generating anything. */
  release(chargeId: string, reason: string): Charge {
    const charge = this.chargeById(chargeId);
    if (charge.state !== "held") throw E.invalid(`that charge is already ${charge.state}`);
    const held = big(charge.heldMicroUsd);
    const account = this.accountById(charge.accountId);
    const at = this.iso();
    charge.state = "released";
    charge.failure = reason.slice(0, 300);
    charge.updatedAt = at;
    this.store.save(CHARGES, charge);
    account.heldMicroUsd = str(big(account.heldMicroUsd) - held);
    account.balanceMicroUsd = str(big(account.balanceMicroUsd) + held);
    account.updatedAt = at;
    this.store.save(ACCOUNTS, account);
    return charge;
  }

  /**
   * We sent the request and never learned what happened. The hold stays where it is and a human decides: this is
   * the one state that must not resolve itself. Resolving it towards the customer risks the house paying for work
   * it cannot bill; resolving it towards the house risks billing for an answer nobody got.
   */
  markUnknown(chargeId: string, reason: string): Charge {
    const charge = this.chargeById(chargeId);
    if (charge.state !== "held") throw E.invalid(`that charge is already ${charge.state}`);
    charge.state = "unknown";
    charge.failure = reason.slice(0, 300);
    charge.updatedAt = this.iso();
    return this.store.save(CHARGES, charge);
  }

  /** An operator's decision on an unknown charge: settle it at a cost they have confirmed, or give it back. */
  resolveUnknown(chargeId: string, decision: { settleAtUpstreamMicroUsd: bigint } | { release: true; reason: string }): Charge {
    const charge = this.chargeById(chargeId);
    if (charge.state !== "unknown") throw E.invalid(`that charge is ${charge.state}, not unknown`);
    charge.state = "held"; // put it back where settle/release can act on it, in the same tick
    this.store.save(CHARGES, charge);
    return "release" in decision ? this.release(chargeId, decision.reason) : this.settle({ chargeId, upstreamMicroUsd: decision.settleAtUpstreamMicroUsd });
  }

  chargeById(id: string): Charge {
    const c = this.store.get<Charge>(CHARGES, id);
    if (!c) throw E.notFound("charge");
    return c;
  }

  chargesOf(accountId: string, limit = 100): Charge[] {
    return this.store.filter<Charge>(CHARGES, (c) => c.accountId === accountId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
  }

  /** Every account, newest first. For the operator's own screens; there is no customer-facing use for this. */
  accounts(limit = 500): Account[] {
    return this.store.all<Account>(ACCOUNTS).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
  }

  /** Charges across every account, newest first, optionally of one state. The operator's view: unlike
   *  `chargesOf`, what comes back carries the upstream cost, which is the house's own number. */
  charges(o: { state?: Charge["state"]; accountId?: string; limit?: number } = {}): Charge[] {
    return this.store
      .filter<Charge>(CHARGES, (c) => (!o.state || c.state === o.state) && (!o.accountId || c.accountId === o.accountId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, o.limit ?? 100);
  }

  /** Holds older than `olderThanMs` with nothing resolving them. A request whose process died leaves one of these,
   *  and the customer cannot spend the money until it is cleared. Released, not settled: we have no evidence the
   *  work was done, and the benefit of that doubt belongs to the person who paid. */
  sweepStaleHolds(olderThanMs = 15 * 60_000): Charge[] {
    const cutoff = this.now() - olderThanMs;
    const stale = this.store.filter<Charge>(CHARGES, (c) => c.state === "held" && Date.parse(c.createdAt) < cutoff);
    return stale.map((c) => this.release(c.id, "the call never reported back; the hold was swept"));
  }

  // ---------------------------------------------------------------------------------------------- the house

  /** What the operator needs to know, and the one number they must not be allowed to look away from. */
  book(): HouseBook {
    const accounts = this.store.all<Account>(ACCOUNTS);
    const deposits = this.store.all<Deposit>(DEPOSITS);
    const charges = this.store.all<Charge>(CHARGES);

    let sold = 0n, granted = 0n, burnedUnits = 0n;
    for (const d of deposits) {
      const credited = big(d.creditedMicroUsd);
      if (d.source === "grant") granted += credited; else sold += credited;
      if (d.burnTx) burnedUnits += big(d.tokenUnits);
    }
    let revenue = 0n, upstream = 0n, unresolved = 0n, heldCount = 0, unknownCount = 0;
    for (const c of charges) {
      if (c.state === "settled") { revenue += big(c.retailMicroUsd); upstream += big(c.upstreamMicroUsd); }
      if (c.state === "held") heldCount++;
      if (c.state === "unknown") { unknownCount++; unresolved += big(c.heldMicroUsd); }
    }
    // Outstanding is what customers still hold, counted from the accounts themselves rather than from the
    // difference of two totals, so a bug in one does not hide in the other.
    let outstanding = 0n;
    for (const a of accounts) outstanding += big(a.balanceMicroUsd) + big(a.heldMicroUsd);
    // Splitting it between sold and granted needs an assumption, because the ledger does not track which dollar
    // was spent. Grants are assumed spent first, which makes the sold — the money-backed — share of the
    // liability as large as it honestly can be. An operator should be shown the bigger number, not the kinder one.
    const grantedSpent = revenue < granted ? revenue : granted;
    const outstandingGranted = granted - grantedSpent;
    const outstandingSold = atLeastZero(outstanding - outstandingGranted);
    // Serving a dollar of outstanding credit costs the house what the provider charges, not the retail price:
    // the margin never has to be paid out. retail = upstream × (1 + m), so upstream = retail / (1 + m).
    const coverNeeded = (outstanding * 10_000n) / BigInt(10_000 + this.config.marginBps);
    const burned = this.config.token.sink === "burn";

    return {
      at: this.iso(),
      soldMicroUsd: str(sold),
      grantedMicroUsd: str(granted),
      revenueMicroUsd: str(revenue),
      upstreamCostMicroUsd: str(upstream),
      grossMarginMicroUsd: str(revenue - upstream),
      outstandingMicroUsd: str(outstanding),
      outstandingSoldMicroUsd: str(outstandingSold),
      outstandingGrantedMicroUsd: str(outstandingGranted),
      backing: {
        sink: this.config.token.sink,
        unbacked: burned,
        coverNeededMicroUsd: str(coverNeeded),
        note: burned
          ? `Every ${this.config.token.symbol} taken in is destroyed, so nothing is held against this. The treasury must be able to find $${formatUsd(coverNeeded)} to serve the credit already sold.`
          : `Tokens taken in are kept (${this.config.token.sink}). Serving the outstanding credit costs about $${formatUsd(coverNeeded)} upstream.`,
      },
      burned: burnedUnits > 0n
        ? [{ symbol: this.config.token.symbol, units: str(burnedUnits), tokens: formatUnits(burnedUnits, this.config.token.decimals) }]
        : [],
      counts: {
        accounts: accounts.length,
        keys: this.store.count(KEYS),
        deposits: deposits.length,
        charges: charges.length,
        held: heldCount,
        unknown: unknownCount,
      },
      unresolvedMicroUsd: str(unresolved),
    };
  }

  /**
   * Assert the book adds up, for every account: `balance + held == deposited − spent`. Returns the accounts that
   * do not. Call it in tests after every operation and on a schedule in production; an empty array is the only
   * acceptable answer, and anything else means a hold leaked.
   */
  check(): { accountId: string; owner: string; balance: string; held: string; deposited: string; spent: string; driftMicroUsd: string }[] {
    const bad: { accountId: string; owner: string; balance: string; held: string; deposited: string; spent: string; driftMicroUsd: string }[] = [];
    for (const a of this.store.all<Account>(ACCOUNTS)) {
      const drift = big(a.balanceMicroUsd) + big(a.heldMicroUsd) - (big(a.depositedMicroUsd) - big(a.spentMicroUsd));
      if (drift !== 0n) {
        bad.push({ accountId: a.id, owner: a.owner, balance: a.balanceMicroUsd, held: a.heldMicroUsd, deposited: a.depositedMicroUsd, spent: a.spentMicroUsd, driftMicroUsd: str(drift) });
      }
    }
    return bad;
  }
}

/** sha256 of a key secret, hex. The only form a secret is ever stored in. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Parse a dollar amount from untrusted input, as an `IcmError` rather than a `TypeError`. */
export function usdFromInput(value: unknown, field: string): bigint {
  if (value === null || value === undefined) throw E.invalid(`${field} is required`);
  try { return parseUsd(value as string); }
  catch (e) { throw E.invalid(`${field}: ${(e as Error).message}`); }
}

export { IcmError };
