/**
 * Getting paid.
 *
 * The package does not read a chain. It takes **confirmed payments** from a source the host implements, and turns
 * each one into credit exactly once. Everything chain-shaped — an RPC, a log filter, a reorg depth — lives in the
 * host's adapter, which is what lets the same ledger sell credit for a token on any chain, or for something that
 * is not a chain at all.
 *
 * The arrangement worth knowing about: **when the address people pay to is the burn address, the payment and the
 * burn are the same transaction.** The gateway never holds the token, so there is nothing to misplace, nothing to
 * steal, and no second transaction that can fail halfway. The watcher reads transfers into `0x…dEaD` and credits
 * whoever sent them. That is the whole mechanism.
 *
 * It also means the gateway takes in no money it can spend, while owing real dollars to a model provider for
 * every credit it sold. That is a deliberate choice of the operator's, and `ledger.book()` states the size of it
 * rather than leaving it to be discovered.
 */
import type { Ledger } from "./ledger.ts";
import type { Deposit } from "./types.ts";
import { IcmError } from "./errors.ts";
import { formatUnits } from "./money.ts";

/** One payment, already confirmed to the host's satisfaction. */
export interface ConfirmedPayment {
  /** What makes it unique and replay-proof. A transaction hash plus a log index, because one transaction can
   *  carry two transfers. */
  ref: string;
  /** Who paid. Becomes the account owner, lowercased. */
  from: string;
  /** Base units of the token. */
  tokenUnits: bigint;
  /** When the chain saw it, ISO. */
  at: string;
  /** Where it landed. The watcher checks this against the configured address rather than trusting the source. */
  to: string;
  blockNumber?: number;
}

export interface PaymentSource {
  /** Payments after `cursor`, oldest first, and the cursor to resume from. A cursor is opaque to the package:
   *  a block number, a log id, a timestamp, whatever the host's chain client needs. */
  since(cursor: string | null): Promise<{ payments: ConfirmedPayment[]; cursor: string }>;
}

export interface WatcherOptions {
  ledger: Ledger;
  source: PaymentSource;
  /** The address payers send to. A transfer anywhere else is ignored, however the source reports it. Set this to
   *  the burn address and a payment is its own burn. */
  depositAddress: string;
  /** Where the cursor is kept between runs. The host owns durability; the watcher just calls these. */
  cursor: { read(): Promise<string | null> | string | null; write(value: string): Promise<void> | void };
  /** Called for every payment that was credited. For a notification, a log line, a metric. */
  onCredited?: (deposit: Deposit, payment: ConfirmedPayment) => void;
  /** Called for every payment that was refused, with the reason. A dust payment lands here, not in an exception. */
  onSkipped?: (payment: ConfirmedPayment, reason: string) => void;
}

export interface PollResult {
  seen: number;
  credited: Deposit[];
  skipped: { ref: string; reason: string }[];
  cursor: string | null;
}

export class DepositWatcher {
  private readonly ledger: Ledger;
  private readonly source: PaymentSource;
  private readonly depositAddress: string;
  private readonly cursorStore: WatcherOptions["cursor"];
  private readonly onCredited?: WatcherOptions["onCredited"];
  private readonly onSkipped?: WatcherOptions["onSkipped"];

  constructor(o: WatcherOptions) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(o.depositAddress)) {
      throw new IcmError(`depositAddress must be 0x and 40 hex characters; got ${JSON.stringify(o.depositAddress)}`, { code: "not_configured", status: 503 });
    }
    this.ledger = o.ledger;
    this.source = o.source;
    this.depositAddress = o.depositAddress.toLowerCase();
    this.cursorStore = o.cursor;
    this.onCredited = o.onCredited;
    this.onSkipped = o.onSkipped;
  }

  /** True when the address people pay to is a burn address, which makes every payment its own burn. */
  get paymentIsBurn(): boolean {
    return /^0x0*dead$/i.test(this.depositAddress) || /^0x0{40}$/.test(this.depositAddress);
  }

  /**
   * True when buying credit destroys the token, by either route: the address people pay to is the fire itself,
   * or the host burns what lands there afterwards. Only the first is visible in the address, which is why this
   * reads the configured sink rather than guessing from the shape of a string. A desk that burns and does not
   * say so is throwing away the only part of the arrangement a holder cares about.
   */
  get burns(): boolean {
    return this.paymentIsBurn || this.ledger.config.token.sink === "burn";
  }

  /**
   * One pass. Reads payments since the cursor, credits each one, and advances the cursor only after the credits
   * are written — so a crash mid-pass replays the same payments, and `ledger.deposit`'s idempotency on `ref`
   * means replaying them credits nothing twice.
   */
  async poll(): Promise<PollResult> {
    const from = await this.cursorStore.read();
    const { payments, cursor } = await this.source.since(from ?? null);
    const credited: Deposit[] = [];
    const skipped: { ref: string; reason: string }[] = [];

    for (const p of payments) {
      const reason = this.refuse(p);
      if (reason) {
        skipped.push({ ref: p.ref, reason });
        this.onSkipped?.(p, reason);
        continue;
      }
      // Already credited, by an earlier pass or a replayed block. Not an error and not news: skip it silently
      // rather than firing onCredited a second time and sending somebody a duplicate notification.
      if (this.ledger.depositByRef(p.ref)) continue;
      try {
        const account = this.ledger.account(p.from);
        const deposit = this.ledger.deposit({
          accountId: account.id,
          source: "chain",
          ref: p.ref,
          tokenUnits: p.tokenUnits,
          // When the payment went to the burn address it destroyed the tokens itself, so the transaction that
          // paid is also the transaction that burned. There is no second one to wait for.
          burnTx: this.paymentIsBurn ? p.ref.split(":")[0] : null,
          note: p.blockNumber ? `block ${p.blockNumber}` : undefined,
        });
        credited.push(deposit);
        this.onCredited?.(deposit, p);
      } catch (e) {
        // A refused deposit — under the minimum, a bad amount — is not a reason to stop the pass and leave the
        // rest of the block unprocessed. It is recorded and the watcher moves on.
        const why = e instanceof Error ? e.message : "could not be credited";
        skipped.push({ ref: p.ref, reason: why });
        this.onSkipped?.(p, why);
      }
    }

    // The cursor moves last. Crashing before this replays the batch, which is safe; crashing after would lose it.
    if (cursor && cursor !== from) await this.cursorStore.write(cursor);
    return { seen: payments.length, credited, skipped, cursor: cursor ?? from ?? null };
  }

  /** Why this payment is not credit, or null if it is. */
  private refuse(p: ConfirmedPayment): string | null {
    if (p.to.toLowerCase() !== this.depositAddress) return `paid to ${p.to}, not the deposit address`;
    if (p.tokenUnits <= 0n) return "zero amount";
    if (!/^0x[0-9a-fA-F]{40}$/.test(p.from)) return `payer ${p.from} is not an address`;
    if (!p.ref.trim()) return "no reference";
    return null;
  }

  /** What a payer needs to be told, in one object: where to send, what it buys, and the floor. */
  instructions(): { address: string; token: string; symbol: string; chainId: number; decimals: number; tokensPerUsd: string; minimumTokens: string; paymentIsBurn: boolean; burns: boolean; sink: string; note: string } {
    const cfg = this.ledger.config;
    const perUsd = BigInt(10) ** BigInt(cfg.token.decimals) * BigInt(cfg.token.tokensPerUsd.split(".")[0] || "0");
    const minimum = (cfg.minDepositMicroUsd * perUsd) / 1_000_000n;
    return {
      address: this.depositAddress,
      // the token to send, so a page can offer to send it rather than only print an address to copy
      token: cfg.token.address,
      symbol: cfg.token.symbol,
      chainId: cfg.token.chainId,
      decimals: cfg.token.decimals,
      tokensPerUsd: cfg.token.tokensPerUsd,
      minimumTokens: formatUnits(minimum, cfg.token.decimals).replace(/\.?0+$/, "") || "0",
      paymentIsBurn: this.paymentIsBurn,
      burns: this.burns,
      sink: cfg.token.sink,
      note: this.burns
        ? `Send ${cfg.token.symbol} to this address and it is destroyed: credit is bought by taking the token out of supply for good. The credit lands on the wallet that sent it, so send from the wallet you want credited.`
        : `Send ${cfg.token.symbol} to this address. The credit lands on the wallet that sent it, so send from the wallet you want credited.`,
    };
  }
}
