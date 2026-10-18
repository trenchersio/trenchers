/**
 * Trenchers Inference Markets: the inference desk, hosted by the engine.
 *
 * This file is the only place Trenchers and the generic core in ./icm meet. It supplies what the core deliberately
 * does not have: a config ($TRENCHERS on Robinhood Chain), a durable store (an append-only file), a way to see
 * payments (Transfer logs into the InferenceDesk contract), a way to prove who a wallet's owner is (a signed
 * message), the burn keeper, and the public read-outs the website shows (stats and the P2P book).
 *
 * How a person uses it:
 *   1. pay $TRENCHERS into the InferenceDesk contract: directly, through the InferenceRouter (ETH in, one
 *      transaction) or by filling asks on the TrenchersOTC book with the desk as the recipient
 *   2. the watcher sees the transfer and credits the buyer; the desk contract can only ever burn what it holds,
 *      and the keeper here calls its burn() on a schedule
 *   3. sign a message to prove the wallet, mint an API key
 *   4. point any OpenAI-compatible client at {ICM_PUBLIC_URL}/icm/v1 with that key
 *
 * Never published: the margin, per-model prices, the upstream cost of a call, the house book (admin token only).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { RAETO_MODEL, raetoPick } from "./raeto";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createPublicClient, createWalletClient, decodeEventLog, defineChain, getAddress, pad, parseAbi, parseAbiItem, verifyMessage,
  type Address, type Hex, type PublicClient, type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DepositWatcher, IcmError, Ledger, MemoryStore, OpenRouterUpstream, Proxy, createSurface, makeConfig, usdFromInput,
  type CollectionName, type ConfirmedPayment, type IcmConfig, type IcmRequest, type IcmResponse, type PaymentSource, type Row,
  type Upstream, type UpstreamModel,
} from "./icm/index.ts";
import { transport, urls, Span } from "./rpc";

// ------------------------------------------------------------------------------------------------ settings

const clean = (v: string | undefined) => (v ?? "").trim().replace(/^["']|["']$/g, "").trim();
const isAddr = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v);
const list = (v: string | undefined) => clean(v).split(",").map((x) => x.trim()).filter(Boolean);
const int = (v: string | undefined, d: number) => (/^\d+$/.test(clean(v)) ? Number(clean(v)) : d);

export function inferenceSettings(env: Record<string, string | undefined> = process.env) {
  return {
    openRouterKey: clean(env.OPENROUTER_API_KEY) || null,
    token: clean(env.TRENCHERS_TOKEN) || "0xc65a7c91591a2dd4d5624e75e814b1bbe88b984a",
    /** The InferenceDesk contract: where payments land, and the only place they can go from there is the dead address. */
    desk: clean(env.ICM_DESK) || null,
    router: clean(env.ICM_ROUTER) || null,
    otc: clean(env.ICM_OTC) || null,
    /** Whole $TRENCHERS per $1 of credit. Set by hand, changed by hand: never a live price feed. */
    tokensPerUsd: clean(env.ICM_TOKENS_PER_USD) || null,
    marginBps: int(env.ICM_MARGIN_BPS, -1),
    minDepositUsd: clean(env.ICM_MIN_DEPOSIT_USD) || "1",
    maxHoldUsd: clean(env.ICM_MAX_HOLD_USD) || "5",
    confirmations: int(env.ICM_CONFIRMATIONS, 5),
    startBlock: int(env.ICM_START_BLOCK, 0),
    /** Where the ledger lives. Must be on a persistent volume, or every balance is lost on the next deploy. */
    file: clean(env.ICM_FILE) || null,
    adminToken: clean(env.ICM_ADMIN_TOKEN) || null,
    /** The site people sign in on; wallets compare it with the page asking for the signature. */
    signinDomain: clean(env.ICM_SIGNIN_DOMAIN) || "www.trenchers.io",
    /** Pays the gas for InferenceDesk.burn(). Defaults to the engine's key; a separate one keeps its nonces apart. */
    burnKey: clean(env.ICM_BURN_KEY) || null,
    publicUrl: (clean(env.ICM_PUBLIC_URL) || "https://mainnet-production-c38a.up.railway.app").replace(/\/$/, ""),
    environment: clean(env.ICM_ENVIRONMENT) === "test" ? "test" as const : "live" as const,
    allowModels: list(env.ICM_ALLOW_MODELS),
    /** The model a Trencher thinks with when called as trencher-<id>. */
    trencherModel: clean(env.ICM_TRENCHER_MODEL) || "anthropic/claude-sonnet-4.5",
    denyModels: list(env.ICM_DENY_MODELS),
    rpc: clean(env.RPC_URL),
    chainId: int(env.CHAIN_ID, 4663),
    engineKey: clean(env.ENGINE_KEY) || null,
    logRange: int(env.LOG_RANGE, 5000),
  };
}
export type InferenceSettings = ReturnType<typeof inferenceSettings>;

// ------------------------------------------------------------------------------------------------ store

/**
 * The core's synchronous Store, made durable: everything in memory, and every save appended to a file as one
 * JSON line before the call returns. On boot the file is replayed (the last line for an id wins) and, if it has
 * grown well past the live rows, rewritten compactly through a temporary file and a rename.
 */
export class FileStore extends MemoryStore {
  private readonly file: string;
  constructor(file: string) {
    super();
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
    let lines = 0;
    if (existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        lines++;
        try {
          const j = JSON.parse(line) as { c: CollectionName; r?: Row; d?: string };
          if (j.r) super.save(j.c, j.r); else if (j.d) super.delete(j.c, j.d);
        } catch { /* a torn last line from a crash mid-write: everything before it stands */ }
      }
    }
    const live = (["icm_accounts", "icm_keys", "icm_deposits", "icm_charges"] as CollectionName[]).reduce((a, c) => a + this.count(c), 0);
    if (lines > 1000 && lines > live * 3) this.compact();
  }
  override save<T extends Row>(collection: CollectionName, rec: T): T {
    super.save(collection, rec);
    appendFileSync(this.file, `${JSON.stringify({ c: collection, r: rec })}\n`);
    return rec;
  }
  override delete(collection: CollectionName, id: string): void {
    super.delete(collection, id);
    appendFileSync(this.file, `${JSON.stringify({ c: collection, d: id })}\n`);
  }
  private compact() {
    const tmp = `${this.file}.tmp`;
    const out: string[] = [];
    for (const c of ["icm_accounts", "icm_keys", "icm_deposits", "icm_charges"] as CollectionName[]) for (const r of this.all(c)) out.push(JSON.stringify({ c, r }));
    writeFileSync(tmp, out.join("\n") + "\n");
    renameSync(tmp, this.file);
  }
}

/** A small JSON value next to the ledger (the watcher's cursor), written atomically. */
function kv(file: string | null) {
  const path = file ? `${file}.state.json` : null;
  let mem: Record<string, string> = {};
  if (path && existsSync(path)) { try { mem = JSON.parse(readFileSync(path, "utf8")); } catch { mem = {}; } }
  return {
    get: (k: string) => mem[k] ?? null,
    set: (k: string, v: string) => {
      mem[k] = v;
      if (!path) return;
      writeFileSync(`${path}.tmp`, JSON.stringify(mem)); renameSync(`${path}.tmp`, path);
    },
  };
}

// ------------------------------------------------------------------------------------------------ chain

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const CREDIT_BOUGHT = parseAbiItem("event CreditBought(address indexed buyer, uint256 ethIn, uint256 tokensOut)");
const OTC_EVENTS = parseAbi([
  "event Placed(uint256 indexed id, address indexed maker, address indexed token, bool isAsk, uint128 tokenAmount, uint128 ethAmount, uint40 expiry, address taker)",
  "event Filled(uint256 indexed id, address indexed taker, address recipient, uint128 tokenAmount, uint256 ethAmount)",
  "event Cancelled(uint256 indexed id)",
]);
const DESK_ABI = parseAbi(["function burn() returns (uint256)", "function totalBurned() view returns (uint256)", "function token() view returns (address)"]);
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"]);

/**
 * $TRENCHERS transfers into the desk, read straight off the chain, and who to credit for each.
 *
 * Normally the Transfer's `from` is the buyer. Two contracts pay on somebody's behalf, and for those (and only
 * those, a closed list) the buyer is named by the contract's own event in the same transaction:
 *   - InferenceRouter: CreditBought(buyer, …)
 *   - TrenchersOTC:    Filled(id, taker, recipient = desk, …), the wallet that bought from the holders
 * Anything else that sends from a contract is credited to that contract, exactly as the Transfer says.
 */
export class DeskPayments implements PaymentSource {
  constructor(
    private readonly pub: PublicClient,
    private readonly token: Address,
    private readonly desk: Address,
    private readonly router: Address | null,
    private readonly otc: Address | null,
    private readonly confirmations: number,
    private readonly startBlock: number,
    private readonly range: number,
  ) {}

  /**
   * The buyer behind a transfer from the router or the P2P contract: the event that contract emitted for this very
   * transfer, which is the first log from the same contract after the Transfer's own log index (both contracts emit
   * it straight after moving the tokens, inside a non-reentrant call). Never "any matching event in the
   * transaction": a bundle can carry several people's purchases, and each must be credited to its own buyer.
   */
  private async buyerFor(from: Address, tx: Hex, logIndex: number, amount: bigint): Promise<string> {
    const f = from.toLowerCase();
    const isRouter = this.router && f === this.router.toLowerCase();
    const isOtc = this.otc && f === this.otc.toLowerCase();
    if (!isRouter && !isOtc) return f;
    const r = await this.pub.getTransactionReceipt({ hash: tx });
    const next = r.logs.filter((l) => l.address.toLowerCase() === f && Number(l.logIndex) > logIndex).sort((a, b) => Number(a.logIndex) - Number(b.logIndex))[0];
    if (next) {
      try {
        if (isRouter) {
          const e = decodeEventLog({ abi: [CREDIT_BOUGHT], data: next.data, topics: next.topics });
          const a = e.args as { buyer: string; tokensOut: bigint };
          if (a.tokensOut === amount) return a.buyer.toLowerCase();
        } else {
          const e = decodeEventLog({ abi: OTC_EVENTS, data: next.data, topics: next.topics });
          const a = e.args as { taker: string; recipient: string; tokenAmount: bigint };
          if (e.eventName === "Filled" && a.recipient.toLowerCase() === this.desk.toLowerCase() && a.tokenAmount === amount) return a.taker.toLowerCase();
        }
      } catch { /* not the event that belongs to this transfer */ }
    }
    // No event belongs to this transfer: credit the transaction's signer rather than a contract nobody can sign for.
    return r.from.toLowerCase();
  }

  async since(cursor: string | null): Promise<{ payments: ConfirmedPayment[]; cursor: string }> {
    const head = Number(await this.pub.getBlockNumber());
    const safe = Math.max(0, head - this.confirmations);
    const from = cursor === null ? (this.startBlock || Math.max(0, safe - 2_000)) : Number(cursor) + 1;
    if (from > safe) return { payments: [], cursor: String(safe) };
    const to = Math.min(safe, from + this.range);
    const logs = await this.pub.getLogs({ address: this.token, event: TRANSFER, args: { to: this.desk }, fromBlock: BigInt(from), toBlock: BigInt(to) });
    const payments: ConfirmedPayment[] = [];
    for (const l of logs) {
      const a = l.args as { from: Address; to: Address; value: bigint };
      payments.push({
        ref: `${l.transactionHash}:${l.logIndex}`,
        from: await this.buyerFor(a.from, l.transactionHash as Hex, Number(l.logIndex), a.value),
        to: a.to.toLowerCase(),
        tokenUnits: a.value,
        at: new Date().toISOString(),
        blockNumber: Number(l.blockNumber),
      });
    }
    return { payments, cursor: String(to) };
  }
}

/** Stands in for the provider until OPENROUTER_API_KEY is set: everything else keeps working, routing says why not. */
class NoUpstream implements Upstream {
  readonly name = "none";
  constructor(private readonly why: string) {}
  async models(): Promise<UpstreamModel[]> { return []; }
  async complete(): Promise<never> { throw new IcmError(this.why, { code: "not_configured", status: 503 }); }
  async stream(): Promise<never> { throw new IcmError(this.why, { code: "not_configured", status: 503 }); }
}

// ------------------------------------------------------------------------------------------------ the P2P book

type OtcOrder = {
  id: number; side: "ask" | "bid"; token: string; symbol: string; verified: boolean; agent: number | null; maker: string;
  tokenTotal: string; tokenLeft: string; ethTotal: string; ethLeft: string; createdAt: string; expiresAt: string | null; taker: string | null;
};
type OtcFill = { id: string; side: "buy" | "sell"; symbol: string; token: string; tokenAmount: string; ethAmount: string; at: string; toDesk: boolean };

/** Rebuilds the TrenchersOTC book from its events, incrementally. The contract is the truth; this is a read-out. */
class OtcIndex {
  orders = new Map<number, OtcOrder>();
  fills: OtcFill[] = [];
  cursor: number;
  private span = new Span(50_000n);
  private symbols = new Map<string, string>();
  constructor(private readonly pub: PublicClient, private readonly otc: Address, start: number, private readonly range: number,
    private readonly desk: string | null, private readonly verify: (token: string) => { verified: boolean; agent: number | null }) { this.cursor = start - 1; }

  private async symbol(t: string, verified: boolean) {
    // Unverified tokens cost an RPC call each, so only the first few hundred are named; the rest read "?".
    if (!verified && !this.symbols.has(t) && this.symbols.size > 300) return "?";
    if (!this.symbols.has(t)) this.symbols.set(t, String(await this.pub.readContract({ address: t as Address, abi: ERC20, functionName: "symbol" }).catch(() => "?")).slice(0, 16));
    return this.symbols.get(t)!;
  }

  async update() {
    const head = Number(await this.pub.getBlockNumber());
    if (this.cursor < 0) this.cursor = Math.max(0, head - 50_000);
    while (this.cursor < head) {
      const from = this.cursor + 1, to = Math.min(head, from + Number(this.span.size) - 1);
      let logs;
      try { logs = await this.pub.getLogs({ address: this.otc, events: OTC_EVENTS, fromBlock: BigInt(from), toBlock: BigInt(to) }); }
      catch (e) { this.span.fail(e); continue; }
      this.span.ok(logs.length);
      const times = new Map<bigint, number>();
      for (const l of logs) {
        if (!times.has(l.blockNumber!)) times.set(l.blockNumber!, Number((await this.pub.getBlock({ blockNumber: l.blockNumber! })).timestamp) * 1000);
        const at = new Date(times.get(l.blockNumber!)!).toISOString();
        const a = l.args as Record<string, unknown>;
        if (l.eventName === "Placed") {
          const token = String(a.token).toLowerCase();
          // Dust orders (under 0.0001 ETH) are not shown: they are free to place and would bury the book.
          if (BigInt(a.ethAmount as bigint) < 10n ** 14n) continue;
          const v = this.verify(token);
          const expiry = Number(a.expiry);
          this.orders.set(Number(a.id), {
            id: Number(a.id), side: a.isAsk ? "ask" : "bid", token, symbol: await this.symbol(token, v.verified), verified: v.verified, agent: v.agent,
            maker: String(a.maker).toLowerCase(), tokenTotal: String(a.tokenAmount), tokenLeft: String(a.tokenAmount),
            ethTotal: String(a.ethAmount), ethLeft: String(a.ethAmount), createdAt: at, expiresAt: expiry ? new Date(expiry * 1000).toISOString() : null,
            taker: /^0x0{40}$/.test(String(a.taker)) ? null : String(a.taker).toLowerCase(),
          });
        } else if (l.eventName === "Filled") {
          const o = this.orders.get(Number(a.id));
          if (!o) continue;
          o.tokenLeft = String(BigInt(o.tokenLeft) - BigInt(a.tokenAmount as bigint));
          o.ethLeft = String(BigInt(o.ethLeft) - BigInt(a.ethAmount as bigint));
          this.fills.unshift({ id: `${l.transactionHash}:${l.logIndex}`, side: o.side === "ask" ? "buy" : "sell", symbol: o.symbol, token: o.token,
            tokenAmount: String(a.tokenAmount), ethAmount: String(a.ethAmount), at, toDesk: !!this.desk && String(a.recipient).toLowerCase() === this.desk });
          if (this.fills.length > 200) this.fills.length = 200;
          if (BigInt(o.tokenLeft) === 0n) this.orders.delete(o.id);
        } else if (l.eventName === "Cancelled") {
          this.orders.delete(Number(a.id));
        }
      }
      this.cursor = to;
    }
  }

  view() {
    const now = Date.now();
    for (const [id, o] of this.orders) if (o.expiresAt && Date.parse(o.expiresAt) <= now) this.orders.delete(id);
    // $TRENCHERS and agent coins first, then everything else, at most 400 orders.
    const open = [...this.orders.values()].filter((o) => BigInt(o.tokenLeft) > 0n);
    return {
      orders: [...open.filter((o) => o.verified), ...open.filter((o) => !o.verified)].slice(0, 400),
      fills: this.fills.slice(0, 50),
    };
  }
}

// ------------------------------------------------------------------------------------------------ the desk

const SHARED_BURN = /^0x0{39}[01]$|^0x0{36}dead$/i;
const NONCE_TTL = 5 * 60_000;
const MAX_NONCES = 20_000;
const MAX_KEYS = 25;

/** A Trencher as the desk sees it: its id, its agent wallet (whose desk account is the Trencher's), who holds it now,
 *  and who it is (for the system prompt when it is called as trencher-<id>). */
export type TrencherInfo = { id: number; wallet: string; holder: string | null; persona: string };
const TRENCHER_MODEL = /^trencher-(\d{1,4})$/;

/** Who a Trencher is, in its own system prompt. Built only from facts the engine knows about it. */
export function trencherPersona(a: { id: number; wallet: string; rule: string | null; live: boolean; coin: string | null }): string {
  return [
    `You are Trencher #${a.id}, one of 2,000 AI trading agents on Robinhood Chain. Your identity is NFT #${a.id} of the Trenchers collection and your own wallet is ${a.wallet}.`,
    a.rule ? `Your holder trains you in plain English. The trading rule you follow right now, in their words: "${a.rule.slice(0, 600)}".` : "Your holder hasn't given you a trading rule yet.",
    a.live ? "You are live: you trade memecoins on Pons and Uniswap around the clock within your limits." : "You are not trading right now.",
    a.coin ? `You launched your own coin at ${a.coin}.` : "",
    "Speak in the first person as this agent: direct, sharp, a little dry. Never invent trades, balances or numbers you were not given. Nothing you say is financial advice.",
  ].filter(Boolean).join(" ");
}
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export class InferenceDesk {
  readonly s: InferenceSettings;
  readonly config: IcmConfig;
  readonly ledger: Ledger;
  readonly proxy: Proxy;
  readonly watcher: DepositWatcher | null;
  readonly enabled: boolean;
  readonly reason: string | null;
  readonly fault: string | null;
  readonly problems: string[] = [];
  private readonly surface: (req: IcmRequest) => Promise<IcmResponse>;
  private readonly nonces = new Map<string, { address: string; message: string; at: number }>();
  private readonly hits = new Map<string, { n: number; at: number }>();
  private readonly pub: PublicClient | null;
  private readonly wallet: WalletClient | null;
  private readonly otc: OtcIndex | null;
  private readonly state: ReturnType<typeof kv>;
  private readonly store: MemoryStore;
  private burned = { total: 0n, pending: 0n, at: 0 };
  private trencherOf: ((id: number) => Promise<TrencherInfo | null>) | null = null;
  /** How the desk finds a Trencher's wallet, holder and persona (the engine knows them). */
  setTrenchers(fn: (id: number) => Promise<TrencherInfo | null>) { this.trencherOf = fn; }

  private async trencher(raw: unknown): Promise<TrencherInfo> {
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1 || id > 2000) throw new IcmError("A Trencher number is 1 to 2,000.", { code: "invalid_request", status: 400 });
    const t = this.trencherOf ? await this.trencherOf(id) : null;
    if (!t || !isAddr(t.wallet)) throw new IcmError(`Trencher #${id} isn't awake yet: it has no agent wallet to hold inference.`, { code: "not_found", status: 404 });
    return { ...t, wallet: t.wallet.toLowerCase(), holder: t.holder?.toLowerCase() ?? null };
  }

  /** The account a signed request acts on: the signer's own, or, with `trencher`, that Trencher's (holder only). */
  private async actingOwner(b: Record<string, unknown>): Promise<{ owner: string; trencher: TrencherInfo | null }> {
    const signer = await this.verify(String(b.address ?? ""), String(b.signature ?? ""));
    if (b.trencher === undefined || b.trencher === null || b.trencher === "") return { owner: signer, trencher: null };
    const t = await this.trencher(b.trencher);
    if (t.holder !== signer) throw new IcmError(`Only the wallet holding Trencher #${t.id} can manage its inference.`, { code: "forbidden", status: 403 });
    return { owner: t.wallet, trencher: t };
  }
  lastPoll: { at: number; error: string | null; credited: number } = { at: 0, error: null, credited: 0 };
  lastBurn: { at: number; tx: string | null; error: string | null } = { at: 0, tx: null, error: null };

  constructor(s: InferenceSettings = inferenceSettings(), verifyToken: (token: string) => { verified: boolean; agent: number | null } = () => ({ verified: false, agent: null }), store?: MemoryStore) {
    this.s = s;
    const P = this.problems;
    if (!s.file && !store) P.push("ICM_FILE is not set: add a Railway volume and set ICM_FILE to a path on it (for example /data/icm.log), or balances are lost on every deploy. Payments are not watched until it is set.");
    if (!s.desk) P.push("ICM_DESK is not set: deploy the InferenceDesk contract and set its address.");
    else if (!isAddr(s.desk) || SHARED_BURN.test(s.desk)) P.push("ICM_DESK must be the InferenceDesk contract's address (never a shared burn address).");
    if (!s.tokensPerUsd) P.push("ICM_TOKENS_PER_USD is not set: how many whole $TRENCHERS buy $1.00 of credit.");
    if (s.router && !isAddr(s.router)) P.push("ICM_ROUTER is not an address.");
    if (s.otc && !isAddr(s.otc)) P.push("ICM_OTC is not an address.");
    if (!s.rpc) P.push("RPC_URL is not set.");
    if (s.marginBps < 0) P.push("ICM_MARGIN_BPS is not set: what the desk adds on top of the provider's price, in basis points. Kept private.");

    let fault: string | null = null;
    let config: IcmConfig;
    try {
      config = makeConfig({
        keyPrefix: "trench",
        environment: s.environment,
        token: { symbol: "TRENCHERS", address: isAddr(s.token) ? s.token : "0x0000000000000000000000000000000000000001", decimals: 18, chainId: s.chainId, tokensPerUsd: s.tokensPerUsd ?? "1", sink: "burn" },
        marginBps: Math.max(0, s.marginBps), minDepositMicroUsd: s.minDepositUsd, maxHoldMicroUsd: s.maxHoldUsd,
        allowModels: s.allowModels, denyModels: s.denyModels,
      });
    } catch (e) {
      fault = `The inference desk is misconfigured and switched off: ${(e as Error).message}`;
      config = makeConfig({ keyPrefix: "trench", token: { symbol: "OFF", address: "0x0000000000000000000000000000000000000001", tokensPerUsd: "1" } });
    }
    this.config = config;
    this.fault = fault;

    let st: MemoryStore;
    try { st = store ?? (s.file ? new FileStore(s.file) : new MemoryStore()); }
    catch (e) { st = new MemoryStore(); this.fault ??= `The ledger file could not be opened (${(e as Error).message}), so the desk is off.`; }
    this.store = st;
    this.ledger = new Ledger({ store: st, config: this.config });
    this.state = kv(s.file);

    this.enabled = !this.fault && !!s.openRouterKey;
    this.reason = this.fault ?? (s.openRouterKey ? null : "OPENROUTER_API_KEY is not set, so credit can be bought and keys made, but calls are not routed yet.");
    this.proxy = new Proxy({
      ledger: this.ledger,
      upstream: s.openRouterKey ? new OpenRouterUpstream({ apiKey: s.openRouterKey, referer: "https://www.trenchers.io/inference", title: "Trenchers Inference Markets" }) : new NoUpstream(this.reason!),
    });
    this.surface = createSurface({ ledger: this.ledger, proxy: this.proxy, adminToken: s.adminToken });

    const chain = defineChain({ id: s.chainId, name: "Robinhood Chain", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [urls(s.rpc)[0] ?? s.rpc] } } });
    this.pub = s.rpc ? createPublicClient({ chain, transport: transport(urls(s.rpc)) }) as PublicClient : null;
    let wallet: WalletClient | null = null;
    const bk = s.burnKey ?? s.engineKey;
    if (bk && this.pub) { try { const k = (bk.startsWith("0x") ? bk : `0x${bk}`) as Hex; wallet = createWalletClient({ account: privateKeyToAccount(k), chain, transport: transport(urls(s.rpc)) }); } catch { wallet = null; } }
    this.wallet = wallet;

    const watchable = !this.fault && s.marginBps >= 0 && (s.file || store) && s.desk && isAddr(s.desk) && !SHARED_BURN.test(s.desk) && s.tokensPerUsd && this.pub;
    this.watcher = watchable ? new DepositWatcher({
      ledger: this.ledger,
      source: new DeskPayments(this.pub!, getAddress(s.token), getAddress(s.desk!), s.router && isAddr(s.router) ? getAddress(s.router) : null, s.otc && isAddr(s.otc) ? getAddress(s.otc) : null, s.confirmations, s.startBlock, s.logRange),
      depositAddress: s.desk!,
      cursor: { read: () => this.state.get("cursor"), write: (v) => this.state.set("cursor", v) },
      onCredited: (d) => console.log(`[inference] credited ${d.creditedMicroUsd} micro-USD to ${d.accountId} for ${d.ref}`),
      onSkipped: (p, why) => console.warn(`[inference] skipped ${p.ref}: ${why}`),
    }) : null;
    this.otc = s.otc && isAddr(s.otc) && this.pub ? new OtcIndex(this.pub, getAddress(s.otc), s.startBlock, s.logRange, s.desk?.toLowerCase() ?? null, (t) => (t === s.token.toLowerCase() ? { verified: true, agent: null } : verifyToken(t))) : null;
  }

  // -------------------------------------------------------------- schedule

  /** One pass of the payment watcher. */
  async poll() {
    if (!this.watcher) return;
    try { const r = await this.watcher.poll(); this.lastPoll = { at: Date.now(), error: null, credited: this.lastPoll.credited + r.credited.length }; }
    catch (e) { this.lastPoll = { ...this.lastPoll, at: Date.now(), error: (e as Error).message.split("\n")[0] }; }
  }

  /** Calls InferenceDesk.burn() when it holds anything, then marks every credited deposit as burned by that transaction. */
  async burn() {
    if (!this.pub || !this.s.desk || !isAddr(this.s.desk)) return;
    const desk = getAddress(this.s.desk);
    try {
      const [total, pending] = await Promise.all([
        this.pub.readContract({ address: desk, abi: DESK_ABI, functionName: "totalBurned" }) as Promise<bigint>,
        this.pub.readContract({ address: getAddress(this.s.token), abi: ERC20, functionName: "balanceOf", args: [desk] }) as Promise<bigint>,
      ]);
      this.burned = { total, pending, at: Date.now() };
      // Burn once a dollar's worth has gathered, or whatever is there once a day, so a stream of dust cannot make
      // the keeper spend gas every ten minutes.
      const dollar = BigInt(this.config.token.tokensPerUsd.split(".")[0] || "0") * 10n ** BigInt(this.config.token.decimals);
      const due = pending >= dollar || (pending > 0n && Date.now() - this.lastBurn.at > 86_400_000);
      if (!due || !this.wallet) return;
      const unmarked = this.store.filter<{ id: string; burnTx: string | null; source: string } & Row>("icm_deposits", (d) => d.source === "chain" && !d.burnTx);
      const hash = await this.wallet.writeContract({ address: desk, abi: DESK_ABI, functionName: "burn", chain: this.wallet.chain, account: this.wallet.account! });
      const r = await this.pub.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("burn() failed on-chain");
      for (const d of unmarked) this.ledger.setBurnTx(d.id, hash);
      this.burned = { total: total + pending, pending: 0n, at: Date.now() };
      this.lastBurn = { at: Date.now(), tx: hash, error: null };
    } catch (e) { this.lastBurn = { ...this.lastBurn, at: Date.now(), error: (e as Error).message.split("\n")[0] }; }
  }

  sweep() { return this.ledger.sweepStaleHolds(); }

  async updateBook() { if (this.otc) await this.otc.update().catch((e) => console.warn(`[inference] otc: ${(e as Error).message.split("\n")[0]}`)); }

  // -------------------------------------------------------------- owner proof

  /** The sign-in text, in the standard Sign-In with Ethereum form (EIP-4361), so a wallet can warn when the site
   *  asking for it is not trenchers.io. It names the site, the chain, a one-time nonce and a five-minute expiry. */
  message(address: string, nonce: string, issued: number) {
    const domain = this.s.signinDomain;
    return [
      `${domain} wants you to sign in with your Ethereum account:`,
      getAddress(address),
      "",
      "Sign in to Trenchers Inference Markets to manage your inference keys. This is not a transaction: it moves nothing and costs no gas.",
      "",
      `URI: https://${domain}/inference`,
      "Version: 1",
      `Chain ID: ${this.s.chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(issued).toISOString()}`,
      `Expiration Time: ${new Date(issued + NONCE_TTL).toISOString()}`,
    ].join("\n");
  }
  /** A fresh one-time message. Several can be pending for one wallet, so nobody can cancel another wallet's
   *  sign-in by asking for a nonce in its name; the oldest are dropped first when the table is full. */
  nonce(address: string) {
    const a = this.addr(address);
    const now = Date.now();
    const mine = [...this.nonces.entries()].filter(([, v]) => v.address === a);
    for (const [k] of mine.slice(0, Math.max(0, mine.length - 4))) this.nonces.delete(k);
    while (this.nonces.size >= MAX_NONCES) this.nonces.delete(this.nonces.keys().next().value!);
    const nonce = randomBytes(16).toString("hex");
    const message = this.message(a, nonce, now);
    this.nonces.set(nonce, { address: a, message, at: now });
    return { nonce, message };
  }
  /** Checks the signature against this wallet's pending messages; the one it matches is spent. A wrong signature
   *  spends nothing. Smart-contract wallets (ERC-1271) are checked on-chain. */
  async verify(address: string, signature: string) {
    const a = this.addr(address);
    const now = Date.now();
    const pending = [...this.nonces.entries()].filter(([, v]) => v.address === a && now - v.at <= NONCE_TTL);
    if (!pending.length) throw new IcmError("Ask for a fresh sign-in message first.", { code: "invalid_request", status: 400 });
    for (const [k, v] of pending) {
      let ok = false;
      try {
        ok = this.pub
          ? await this.pub.verifyMessage({ address: getAddress(a), message: v.message, signature: signature as Hex })
          : await verifyMessage({ address: getAddress(a), message: v.message, signature: signature as Hex });
      } catch { ok = false; }
      if (ok) { this.nonces.delete(k); return a; }
    }
    throw new IcmError("That signature does not match this wallet.", { code: "forbidden", status: 401 });
  }
  private addr(address: string) {
    if (!isAddr(address ?? "")) throw new IcmError("The wallet must be 0x and 40 hex characters.", { code: "invalid_request", status: 400 });
    return address.toLowerCase();
  }

  // -------------------------------------------------------------- read-outs

  instructions() {
    const card = this.watcher?.instructions();
    const problem = this.fault ?? (this.problems.length ? this.problems[0] : null);
    return {
      enabled: this.enabled,
      reason: this.reason,
      environment: this.config.environment,
      endpoint: `${this.s.publicUrl}/icm/v1`,
      keyPrefix: this.config.keyPrefix,
      // the rate a buyer needs; never the margin
      rate: { tokensPerUsd: this.config.token.tokensPerUsd, symbol: this.config.token.symbol },
      deposit: card
        ? { address: card.address, token: card.token, symbol: card.symbol, chainId: card.chainId, decimals: card.decimals, tokensPerUsd: card.tokensPerUsd, minimumTokens: card.minimumTokens, burns: true, note: card.note, problem: null }
        : { address: null, burns: true, problem, note: problem ?? "Payments are not being watched yet." },
      router: this.s.router && isAddr(this.s.router) ? this.s.router.toLowerCase() : null,
      otc: this.s.otc && isAddr(this.s.otc) ? this.s.otc.toLowerCase() : null,
    };
  }

  async stats() {
    const deposits = this.store.filter<{ source: string; createdAt: string; tokenUnits: string } & Row>("icm_deposits", (d) => d.source === "chain");
    const days: bigint[] = Array(14).fill(0n);
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    for (const d of deposits) {
      const i = 13 - Math.floor((today.getTime() - new Date(new Date(d.createdAt).toISOString().slice(0, 10)).getTime()) / 86_400_000);
      if (i >= 0 && i < 14) days[i] += BigInt(d.tokenUnits || "0");
    }
    const models = await this.proxy.models().catch(() => []);
    return {
      // Everything paid in: burned, or held by a contract that can only burn it.
      burnedTokens: (this.burned.total + this.burned.pending || deposits.reduce((a, d) => a + BigInt(d.tokenUnits || "0"), 0n)).toString(),
      calls: this.store.count("icm_charges", ((c: { state: string }) => c.state === "settled") as never),
      accounts: this.store.count("icm_accounts", ((a: { depositedMicroUsd: string }) => BigInt(a.depositedMicroUsd) > 0n) as never),
      models: models.length,
      burnedByDay: days.map(String),
    };
  }

  /** For /health: enough to see it is on and the book balances. Nothing a customer owns, and no margin. */
  status() {
    return {
      enabled: this.enabled, reason: this.reason, problems: this.problems, watching: !!this.watcher,
      lastPoll: this.lastPoll, lastBurn: this.lastBurn, burned: { total: this.burned.total.toString(), pending: this.burned.pending.toString() },
      accounts: this.store.count("icm_accounts"), drift: this.ledger.check().length, otcOrders: this.otc ? this.otc.orders.size : null,
    };
  }

  // -------------------------------------------------------------- http

  /** Serves everything under /icm. Returns false for any other path. */
  async handle(req: IncomingMessage, res: ServerResponse, rawPath: string): Promise<boolean> {
    // One spelling of every path before any comparison: "/icm/v1/models/" and "/icm//v1/models" are "/icm/v1/models".
    const path = rawPath.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    if (path !== "/icm" && !path.startsWith("/icm/")) return false;
    const method = (req.method ?? "GET").toUpperCase();
    const send = (status: number, json: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { ...JSON_HEADERS, ...headers });
      res.end(JSON.stringify(json));
    };
    if (method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" });
      res.end(); return true;
    }
    // Writes from one address are limited (sign-in, keys, completions): 60 a minute, then a polite 429.
    if (method === "POST") {
      const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
      const now = Date.now();
      const h = this.hits.get(ip);
      if (!h || now - h.at > 60_000) { this.hits.delete(ip); this.hits.set(ip, { n: 1, at: now }); }
      else if (++h.n > 60) { send(429, { error: { message: "Too many requests from this address. Try again in a minute.", code: "rate_limited" } }, { "retry-after": "60" }); return true; }
      while (this.hits.size > 50_000) this.hits.delete(this.hits.keys().next().value!);
    }
    let body: unknown;
    if (method === "POST") {
      const chunks: Buffer[] = []; let size = 0;
      for await (const c of req) { size += (c as Buffer).length; if (size > this.config.maxRequestBytes) { send(413, { error: { message: "The request body is too large.", code: "too_large" } }); return true; } chunks.push(c as Buffer); }
      const text = Buffer.concat(chunks).toString("utf8");
      try { body = text ? JSON.parse(text) : undefined; } catch { send(400, { error: { message: "The body is not JSON.", code: "invalid_request" } }); return true; }
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const fail = (e: unknown) => {
      const err = e instanceof IcmError ? e : new IcmError((e as Error).message ?? "Something went wrong.", { code: "unknown", status: 500 });
      send(err.status, err.toBody());
    };
    try {
      if (this.fault && !(method === "GET" && path === "/icm")) { send(503, { error: { message: this.fault, code: "not_configured" } }); return true; }
      if (method === "GET" && path === "/icm") { send(200, this.instructions(), { "cache-control": "public, max-age=30" }); return true; }
      if (method === "GET" && path === "/icm/stats") { send(200, await this.stats(), { "cache-control": "public, max-age=30" }); return true; }
      if (method === "GET" && path === "/icm/otc/orders") { send(200, this.otc ? this.otc.view() : { orders: [], fills: [] }, { "cache-control": "public, max-age=10" }); return true; }
      if (method === "POST" && path === "/icm/nonce") { send(200, this.nonce(String(b.address ?? ""))); return true; }
      if (method === "POST" && path === "/icm/account") {
        const { owner, trencher } = await this.actingOwner(b);
        // Reading an account never creates one: a wallet that has not paid has nothing on file.
        const a = this.ledger.accountFor(owner);
        const who = trencher ? { trencher: { id: trencher.id, wallet: trencher.wallet, model: `trencher-${trencher.id}` } } : {};
        if (!a) { send(200, { ...who, account: { id: "", owner, balanceMicroUsd: "0", heldMicroUsd: "0", depositedMicroUsd: "0", spentMicroUsd: "0", suspended: false }, keys: [], deposits: [], charges: [] }); return true; }
        send(200, {
          ...who,
          account: { id: a.id, owner: a.owner, balanceMicroUsd: a.balanceMicroUsd, heldMicroUsd: a.heldMicroUsd, depositedMicroUsd: a.depositedMicroUsd, spentMicroUsd: a.spentMicroUsd, suspended: a.suspended },
          keys: this.ledger.keysOf(a.id).map((k) => ({ id: k.id, display: k.display, label: k.label, disabled: k.disabled, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, spentMicroUsd: k.spentMicroUsd, spendLimitMicroUsd: k.spendLimitMicroUsd, models: k.models })),
          deposits: this.ledger.depositsOf(a.id, 25).map((d) => ({ id: d.id, createdAt: d.createdAt, tokenUnits: d.tokenUnits, creditedMicroUsd: d.creditedMicroUsd, burnTx: d.burnTx, ref: d.ref })),
          charges: this.ledger.chargesOf(a.id, 50).map((c) => ({ id: c.id, at: c.createdAt, model: c.model, state: c.state, costMicroUsd: c.retailMicroUsd, tokensIn: c.tokensIn, tokensOut: c.tokensOut })),
        });
        return true;
      }
      if (method === "POST" && path === "/icm/keys") {
        const { owner, trencher } = await this.actingOwner(b);
        const a = this.ledger.accountFor(owner);
        if (!a || BigInt(a.depositedMicroUsd) + BigInt(a.receivedMicroUsd ?? "0") <= 0n) {
          throw new IcmError(trencher ? `Send Trencher #${trencher.id} some inference first.` : "Buy some credit first: keys are made for wallets that have paid the desk.", { code: "invalid_request", status: 400 });
        }
        if (this.ledger.keysOf(a.id).filter((k) => !k.disabled).length >= MAX_KEYS) throw new IcmError(`A wallet can hold ${MAX_KEYS} active keys. Revoke one to make another.`, { code: "invalid_request", status: 400 });
        const issued = this.ledger.issueKey({
          accountId: a.id,
          label: typeof b.label === "string" ? b.label.slice(0, 80) : trencher ? `Trencher #${trencher.id}` : undefined,
          spendLimitMicroUsd: b.spendLimitUsd ? usdFromInput(b.spendLimitUsd, "spendLimitUsd") : null,
          models: Array.isArray(b.models) ? b.models.slice(0, 20).map(String) : undefined,
        });
        const k = issued.key;
        // A Trencher's keys belong to the holder who made them: when the Trencher changes hands they stop working.
        if (trencher) this.state.set(`tkey:${k.id}`, JSON.stringify({ id: trencher.id, holder: trencher.holder }));
        send(201, { secret: issued.secret, key: { id: k.id, display: k.display, label: k.label, disabled: k.disabled, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, spentMicroUsd: k.spentMicroUsd, spendLimitMicroUsd: k.spendLimitMicroUsd, models: k.models } });
        return true;
      }
      const revoke = path.match(/^\/icm\/keys\/([^/]+)\/revoke$/);
      if (method === "POST" && revoke) {
        const { owner } = await this.actingOwner(b);
        const a = this.ledger.accountFor(owner);
        const key = a ? this.ledger.keysOf(a.id).find((k) => k.id === revoke[1]) : undefined;
        if (!key) throw new IcmError("No such key on this wallet.", { code: "not_found", status: 404 });
        this.ledger.revokeKey(key.id);
        send(200, { revoked: key.id });
        return true;
      }
      // Send inference to a Trencher: credit moves from the signer's account to the Trencher's. Anyone can give.
      if (method === "POST" && path === "/icm/gift") {
        const from = await this.verify(String(b.address ?? ""), String(b.signature ?? ""));
        const t = await this.trencher(b.trencher);
        const amount = usdFromInput(b.amountUsd, "amountUsd");
        if (amount < 10_000n) throw new IcmError("Send at least $0.01.", { code: "invalid_request", status: 400 });
        const a = this.ledger.accountFor(from);
        if (!a) throw new IcmError("Buy some credit first, then send part of it to a Trencher.", { code: "invalid_request", status: 400 });
        if (from === t.wallet) throw new IcmError("That is this Trencher's own wallet.", { code: "invalid_request", status: 400 });
        const to = this.ledger.account(t.wallet, `Trencher #${t.id}`);
        const tr = this.ledger.transfer({ fromAccountId: a.id, toAccountId: to.id, amountMicroUsd: amount, ref: `gift:${randomBytes(12).toString("hex")}`, note: `to Trencher #${t.id}` });
        send(201, { transfer: { id: tr.id, amountMicroUsd: tr.amountMicroUsd, to: { id: t.id, wallet: t.wallet } }, balanceMicroUsd: this.ledger.accountById(a.id).balanceMicroUsd });
        return true;
      }
      const tview = path.match(/^\/icm\/trencher\/(\d{1,4})$/);
      if (method === "GET" && tview) {
        const t = await this.trencher(tview[1]);
        const a = this.ledger.accountFor(t.wallet);
        send(200, { id: t.id, wallet: t.wallet, holder: t.holder, model: `trencher-${t.id}`, balanceMicroUsd: a?.balanceMicroUsd ?? "0", spentMicroUsd: a?.spentMicroUsd ?? "0", receivedMicroUsd: String(BigInt(a?.depositedMicroUsd ?? "0") + BigInt(a?.receivedMicroUsd ?? "0")) }, { "cache-control": "no-store" });
        return true;
      }
      // Public model list: names, slugs and context windows only. Prices are not published.
      if (method === "GET" && path === "/icm/v1/models") {
        const m = await this.proxy.modelsBody();
        const data = m.data.map((x) => ({ id: x.id, object: "model", name: x.name ?? null, context_length: x.context_length ?? null }));
        send(200, { object: "list", data: [{ id: RAETO_MODEL, object: "model", name: "Raeto smart routing (picks the model per request)", context_length: null }, ...data] }, { "cache-control": "public, max-age=300" });
        return true;
      }
      if (method === "GET" && (path === "/icm/v1/rate" || path === "/icm/rate")) {
        send(200, { object: "rate", tokensPerUsd: this.config.token.tokensPerUsd, symbol: this.config.token.symbol, environment: this.config.environment });
        return true;
      }
      if (path.startsWith("/icm/v1/") || path.startsWith("/icm/admin/")) {
        const auth = String(req.headers.authorization ?? "");
        // trencher-<id>: the Trencher itself, thinking with the desk's chosen model and speaking as itself. Only
        // keys made for that Trencher (by its holder) can call it, and it is paid from the Trencher's own credit.
        if (path.startsWith("/icm/v1/") && auth.startsWith("Bearer ")) {
          let found: { key: { id: string } } | null = null;
          try { found = this.ledger.authenticate(auth.slice(7).trim()); } catch { found = null; } // the surface explains bad keys
          const tag = found ? this.state.get(`tkey:${found.key.id}`) : null;
          if (tag) {
            const { id, holder } = JSON.parse(tag) as { id: number; holder: string };
            const now = await this.trencher(id);
            if (now.holder !== holder) throw new IcmError(`Trencher #${id} has changed hands, so keys its previous holder made no longer work. The new holder can make new ones.`, { code: "forbidden", status: 403 });
          }
        }
        const tm = method === "POST" && typeof b.model === "string" ? b.model.match(TRENCHER_MODEL) : null;
        if (tm) {
          const t = await this.trencher(tm[1]);
          const secret = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
          const { account } = this.ledger.authenticate(secret);
          if (account.owner !== t.wallet) throw new IcmError(`trencher-${t.id} can only be called with a key made for Trencher #${t.id} by its holder.`, { code: "forbidden", status: 403 });
          const msgs = Array.isArray(b.messages) ? (b.messages as unknown[]) : [];
          body = { ...b, model: this.s.trencherModel, messages: [{ role: "system", content: t.persona }, ...msgs] };
        }
        // raeto/auto: Raeto picks the model, then the call runs and is billed like any other (optional, off by default)
        let routed: { model: string; via: string } | null = null;
        if (method === "POST" && body && typeof body === "object" && (body as Record<string, unknown>).model === RAETO_MODEL) {
          const rb = body as Record<string, unknown>;
          routed = await raetoPick(rb);
          const { raeto: _drop, ...rest } = rb; void _drop;
          body = { ...rest, model: routed.model };
        }
        const ac = new AbortController();
        res.on("close", () => { if (!res.writableEnded) ac.abort(); });
        const out = await this.surface({ method, path: path.slice(4), bearer: auth.startsWith("Bearer ") ? auth.slice(7).trim() : null, body, query: new URLSearchParams((req.url ?? "").split("?")[1] ?? ""), signal: ac.signal });
        if (routed) out.headers = { ...out.headers, "x-raeto-model": routed.model, "x-raeto-route": routed.via };
        if (out.stream) {
          res.writeHead(out.status, out.headers);
          const reader = out.stream.getReader();
          try { for (;;) { const { done, value } = await reader.read(); if (done) break; res.write(value); } }
          finally { res.end(); }
        } else { res.writeHead(out.status, out.headers); res.end(JSON.stringify(out.json)); }
        return true;
      }
      send(404, { error: { message: "No such route.", code: "not_found" } });
    } catch (e) { fail(e); }
    return true;
  }
}
