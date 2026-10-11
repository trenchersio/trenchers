/**
 * The HTTP surface, as a plain function.
 *
 * No framework, no server, no `node:http`. `handle()` takes a method, a path, headers and an already-parsed body,
 * and gives back a status, headers and either JSON or a stream. Mounting it means writing about twenty lines in
 * whatever the host app already uses — which is the only way a package like this travels between two codebases
 * that do not share a web framework.
 *
 * Two authorities, deliberately separate:
 *   - a **key** (`Authorization: Bearer <keyPrefix>_…`) spends credit and reads its own account
 *   - an **admin token**, if the host sets one, reads the house book and resolves unknown charges
 *
 * Owner-level actions — making an account, minting a key, crediting a deposit — are *not* here. They need the host
 * to have proved who the owner is, by a wallet signature or a session, and that proof is the host's business. The
 * host calls the `Ledger` directly for those.
 */
import type { Ledger } from "./ledger.ts";
import type { Proxy } from "./proxy.ts";
import { E, IcmError, asIcmError } from "./errors.ts";
import { formatUsd, parseUsd } from "./money.ts";
import { rateCard } from "./pricing.ts";
import type { Account, ApiKey, Charge } from "./types.ts";

export interface IcmRequest {
  method: string;
  /** The path **after** whatever prefix the host mounted this at: "/v1/chat/completions", not "/icm/v1/…". */
  path: string;
  /** The bearer token as presented, or null. */
  bearer: string | null;
  /** Already parsed. The host enforces `config.maxRequestBytes` before parsing. */
  body?: unknown;
  query?: URLSearchParams;
  signal?: AbortSignal;
}

export interface IcmResponse {
  status: number;
  headers: Record<string, string>;
  json?: unknown;
  stream?: ReadableStream<Uint8Array>;
}

export interface SurfaceOptions {
  ledger: Ledger;
  proxy: Proxy;
  /** When set, the admin routes exist and require exactly this bearer. When not, they answer 404 — an admin
   *  surface that is off should not announce itself. */
  adminToken?: string | null;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
/** Used for a path that does not exist and for an admin path the caller may not know exists. */
const noRoute = () => new IcmError("No such route on this gateway.", { code: "not_found", status: 404 });
const ok = (json: unknown, headers: Record<string, string> = {}): IcmResponse => ({ status: 200, headers: { ...JSON_HEADERS, ...headers }, json });

/** What a key sees about itself. Shaped like a balance statement, with both the integer and the string, because
 *  anything deciding whether to top up should read the integer and anything shown to a person should read the
 *  string, and neither should be derived from the other. */
function keyView(ledger: Ledger, key: ApiKey, account: Account) {
  const spendable = ledger.spendable(key, account);
  return {
    object: "key" as const,
    key: { id: key.id, display: key.display, label: key.label, createdAt: key.createdAt, lastUsedAt: key.lastUsedAt, models: key.models },
    balance: {
      currency: "USD",
      available: formatUsd(BigInt(account.balanceMicroUsd)),
      available_micro_usd: account.balanceMicroUsd,
      held: formatUsd(BigInt(account.heldMicroUsd)),
      held_micro_usd: account.heldMicroUsd,
      spendable: formatUsd(spendable),
      spendable_micro_usd: spendable.toString(),
      spent: formatUsd(BigInt(account.spentMicroUsd)),
      spent_micro_usd: account.spentMicroUsd,
    },
    limit: key.spendLimitMicroUsd === null ? null : {
      limit: formatUsd(BigInt(key.spendLimitMicroUsd)),
      limit_micro_usd: key.spendLimitMicroUsd,
      used: formatUsd(BigInt(key.spentMicroUsd)),
      used_micro_usd: key.spentMicroUsd,
    },
  };
}

/** A charge as the customer sees it: what it cost them, never what it cost us. The upstream figure is the
 *  house's own business and does not leave through a key-authenticated route. */
function chargeView(c: Charge) {
  return {
    id: c.id, at: c.createdAt, model: c.model, state: c.state,
    cost: formatUsd(BigInt(c.retailMicroUsd)), cost_micro_usd: c.retailMicroUsd,
    tokens: { in: c.tokensIn, out: c.tokensOut, reasoning: c.reasoningTokens, cached: c.cachedTokens },
    streamed: c.streamed, latency_ms: c.latencyMs,
  };
}

export function createSurface(o: SurfaceOptions) {
  const { ledger, proxy } = o;
  const adminToken = o.adminToken ?? null;

  const requireAdmin = (req: IcmRequest) => {
    if (!adminToken) throw E.notFound("route");
    // Length-independent comparison is not needed here the way it is for a key: this token is not enumerable
    // through a public endpoint, and a mismatch is a flat 404 rather than a hint.
    if (req.bearer !== adminToken) throw noRoute();
  };

  async function route(req: IcmRequest): Promise<IcmResponse> {
    const path = req.path.replace(/\/+$/, "") || "/";
    const q = req.query ?? new URLSearchParams();
    const limit = Math.max(1, Math.min(500, Number(q.get("limit") ?? 50) || 50));

    // -------------------------------------------------------------------------------- public
    if (req.method === "GET" && (path === "/v1/rate" || path === "/rate")) {
      return ok({ object: "rate", ...rateCard(ledger.config), environment: ledger.config.environment });
    }

    // -------------------------------------------------------------------------------- the key's own
    if (req.method === "POST" && path === "/v1/chat/completions") {
      const res = await proxy.chat({ secret: req.bearer, body: req.body, signal: req.signal });
      return res.stream ? { status: res.status, headers: res.headers, stream: res.stream } : { status: res.status, headers: res.headers, json: res.json };
    }

    if (req.method === "GET" && path === "/v1/models") {
      // Answerable without a key: a client listing models before it has one is a reasonable thing to do.
      if (req.bearer) ledger.authenticate(req.bearer);
      return ok(await proxy.modelsBody(), { "cache-control": "public, max-age=300" });
    }

    if (req.method === "GET" && path === "/v1/key") {
      const { key, account } = ledger.authenticate(req.bearer);
      return ok(keyView(ledger, key, account));
    }

    if (req.method === "GET" && path === "/v1/usage") {
      const { account } = ledger.authenticate(req.bearer);
      const charges = ledger.chargesOf(account.id, limit);
      const spent = charges.filter((c) => c.state === "settled").reduce((a, c) => a + BigInt(c.retailMicroUsd), 0n);
      return ok({
        object: "list",
        data: charges.map(chargeView),
        summary: { count: charges.length, spent: formatUsd(spent), spent_micro_usd: spent.toString() },
      });
    }

    // -------------------------------------------------------------------------------- the house
    if (path.startsWith("/admin/")) {
      requireAdmin(req);

      if (req.method === "GET" && path === "/admin/book") {
        return ok({ ...ledger.book(), drift: ledger.check() });
      }

      if (req.method === "GET" && path === "/admin/charges") {
        const state = (q.get("state") ?? undefined) as Charge["state"] | undefined;
        const rows = ledger.charges({ state, accountId: q.get("account") ?? undefined, limit });
        // the admin view does carry the upstream cost: this is the house's own book
        return ok({
          object: "list",
          data: rows.map((c) => ({ ...chargeView(c), account_id: c.accountId, key_id: c.keyId, upstream_micro_usd: c.upstreamMicroUsd, held_micro_usd: c.heldMicroUsd, failure: c.failure })),
        });
      }

      if (req.method === "GET" && path === "/admin/accounts") {
        return ok({
          object: "list",
          data: ledger.accounts(limit).map((a) => ({
            id: a.id, owner: a.owner, label: a.label, createdAt: a.createdAt,
            balance: formatUsd(BigInt(a.balanceMicroUsd)), balance_micro_usd: a.balanceMicroUsd,
            held_micro_usd: a.heldMicroUsd, deposited_micro_usd: a.depositedMicroUsd, spent_micro_usd: a.spentMicroUsd,
            suspended: a.suspended, reason: a.suspendedReason,
          })),
        });
      }

      if (req.method === "POST" && /^\/admin\/charges\/[^/]+\/resolve$/.test(path)) {
        const id = path.split("/")[3];
        const b = (req.body ?? {}) as { release?: boolean; reason?: string; upstream?: string };
        const charge = b.release
          ? ledger.resolveUnknown(id, { release: true, reason: b.reason ?? "resolved by the operator" })
          : ledger.resolveUnknown(id, { settleAtUpstreamMicroUsd: usd(b.upstream, "upstream") });
        return ok({ object: "charge", ...chargeView(charge), upstream_micro_usd: charge.upstreamMicroUsd });
      }

      if (req.method === "POST" && path === "/admin/sweep") {
        const b = (req.body ?? {}) as { olderThanMs?: number };
        const swept = ledger.sweepStaleHolds(typeof b.olderThanMs === "number" ? b.olderThanMs : undefined);
        return ok({ object: "list", swept: swept.length, data: swept.map((c) => ({ id: c.id, account_id: c.accountId, returned: formatUsd(BigInt(c.heldMicroUsd)) })) });
      }

      if (req.method === "POST" && path === "/admin/grant") {
        const b = (req.body ?? {}) as { owner?: string; amount?: string; ref?: string; note?: string };
        if (!b.owner) throw E.invalid("owner is required");
        if (!b.ref) throw E.invalid("ref is required, so a grant cannot be made twice by accident");
        const account = ledger.account(b.owner);
        const deposit = ledger.deposit({ accountId: account.id, source: "grant", ref: b.ref, creditedMicroUsd: usd(b.amount, "amount"), note: b.note });
        return { status: 201, headers: JSON_HEADERS, json: { object: "deposit", id: deposit.id, credited: formatUsd(BigInt(deposit.creditedMicroUsd)), account_id: account.id } };
      }

      if (req.method === "POST" && path === "/admin/suspend") {
        const b = (req.body ?? {}) as { owner?: string; reason?: string; undo?: boolean };
        if (!b.owner) throw E.invalid("owner is required");
        const existing = ledger.accountFor(b.owner);
        if (!existing) throw E.notFound("account");
        const account = b.undo ? ledger.unsuspend(existing.id) : ledger.suspend(existing.id, b.reason ?? "no reason given");
        return ok({ object: "account", id: account.id, owner: account.owner, suspended: account.suspended, reason: account.suspendedReason });
      }
    }

    throw noRoute();
  }

  /** The entry point. Every throw becomes a response, in OpenAI's error envelope, so a caller never sees a stack. */
  return async function handle(req: IcmRequest): Promise<IcmResponse> {
    try {
      return await route(req);
    } catch (e) {
      const err = asIcmError(e);
      const headers: Record<string, string> = { ...JSON_HEADERS };
      if (err.retryAfter !== null) headers["retry-after"] = String(err.retryAfter);
      return { status: err.status >= 400 && err.status < 600 ? err.status : 500, headers, json: err.toBody() };
    }
  };
}

const usd = (v: unknown, field: string): bigint => {
  if (v === undefined || v === null) throw E.invalid(`${field} is required`);
  try { return parseUsd(v as string); } catch (e) { throw E.invalid(`${field}: ${(e as Error).message}`); }
};

export { IcmError };
