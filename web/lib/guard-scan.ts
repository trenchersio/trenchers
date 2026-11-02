// Copied from engine/src/guard-scan.ts (the single source; the extension bundles it from there too). Keep in sync: cp engine/src/guard-scan.ts web/lib/guard-scan.ts
/**
 * Trenchers Guard: reads a wallet request (a transaction, a signature, a call bundle) and says in plain English what
 * it would let happen, and how risky that is. Pure functions, no network: the browser extension bundles this same
 * file, so a check never has to leave the person's computer, and the engine serves it as /guard/scan for wallets and
 * apps that want it as an API.
 *
 * What it can't know offline (a contract's age, whether a spender is a known drainer) comes in through `ctx`.
 */

export type Level = "ok" | "info" | "warn" | "danger";
export type Finding = { level: Level; title: string; lines: string[]; kind: string; spender?: string; token?: string };
export type Request = { method: string; params?: unknown[]; origin?: string; chainId?: number | string };
export type Ctx = {
  /** Addresses we know are fine to approve (routers, our own contracts), lowercase. */
  trusted?: Set<string>;
  /** Addresses or contracts known to belong to drainers, lowercase. */
  flagged?: Set<string>;
  /** Hostnames known to be phishing sites (e.g. MetaMask's eth-phishing-detect list), lowercase. */
  phishing?: Set<string>;
  /** Hostnames people mean to visit; a near miss of one of these is a look-alike. */
  brands?: string[];
  /** Names for addresses (token symbols, contract names), lowercase keys. */
  names?: Record<string, string>;
};

const RANK: Record<Level, number> = { ok: 0, info: 1, warn: 2, danger: 3 };
const HUGE = 2n ** 128n;
const short = (a: string) => (/^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const lc = (s: unknown) => String(s ?? "").toLowerCase();
const name = (ctx: Ctx, a: string) => ctx.names?.[lc(a)] ?? short(a);
const word = (data: string, i: number) => data.slice(10 + i * 64, 10 + (i + 1) * 64);
const addrAt = (data: string, i: number) => `0x${word(data, i).slice(24)}`;
const uintAt = (data: string, i: number) => { const w = word(data, i); return w.length === 64 ? BigInt(`0x${w}`) : 0n; };
const big = (v: unknown): bigint => { try { if (typeof v === "bigint") return v; if (typeof v === "number") return BigInt(Math.trunc(v)); const s = String(v ?? "0"); return BigInt(s === "" ? "0" : s); } catch { return 0n; } };
const amount = (v: bigint) => (v >= HUGE ? "an unlimited amount" : v === 0n ? "nothing" : `${v.toLocaleString("en-US")} units`);
const eth = (wei: bigint) => { const s = (Number(wei) / 1e18).toPrecision(4); return `${Number(s)} ETH`; };

/** Known function selectors. */
export const SEL = {
  approve: "0x095ea7b3", increaseAllowance: "0x39509351", setApprovalForAll: "0xa22cb465", transfer: "0xa9059cbb",
  transferFrom: "0x23b872dd", safeTransferFrom: "0x42842e0e", permit2Approve: "0x87517c45", multicall: "0xac9650d8",
};

function spenderRisk(ctx: Ctx, spender: string): { level: Level; line: string } {
  const s = lc(spender);
  if (ctx.flagged?.has(s)) return { level: "danger", line: `${short(spender)} is a known drainer address.` };
  if (ctx.trusted?.has(s)) return { level: "info", line: `${name(ctx, spender)} is a contract we recognise.` };
  return { level: "warn", line: `We don't recognise ${short(spender)}. Only approve contracts from sites you trust.` };
}

/** One transaction (eth_sendTransaction, or one call inside wallet_sendCalls). */
export function scanTx(tx: { to?: string; data?: string; input?: string; value?: unknown }, ctx: Ctx = {}): Finding {
  const to = lc(tx.to), data = lc(tx.data ?? tx.input ?? "0x"), value = big(tx.value);
  const sel = data.slice(0, 10);
  if (!to) return { level: "warn", kind: "deploy", title: "Deploys a new contract", lines: ["This creates a contract from your wallet. Only do this if you meant to."] };
  if (ctx.flagged?.has(to)) return { level: "danger", kind: "flagged", title: "This sends to a known drainer", lines: [`${short(to)} is on our list of drainer addresses. Reject it.`] };
  if (data === "0x" || data === "") {
    return value > 0n ? { level: "info", kind: "send", title: `Sends ${eth(value)}`, lines: [`To ${name(ctx, to)}. Check the address is exactly the one you meant.`] }
      : { level: "ok", kind: "empty", title: "An empty transaction", lines: ["It moves nothing."] };
  }
  if (sel === SEL.approve || sel === SEL.increaseAllowance) {
    const spender = addrAt(data, 0), amt = uintAt(data, 1);
    if (amt === 0n && sel === SEL.approve) return { level: "ok", kind: "revoke", title: "Removes an approval", lines: [`${name(ctx, to)} will no longer let ${short(spender)} spend it. This makes you safer.`], spender, token: to };
    const r = spenderRisk(ctx, spender), unlimited = amt >= HUGE;
    const level: Level = r.level === "danger" ? "danger" : unlimited && r.level !== "info" ? "danger" : unlimited || r.level === "warn" ? "warn" : "info";
    return { level, kind: "approve", spender, token: to, title: unlimited ? `Lets ${short(spender)} spend ALL your ${name(ctx, to)}, forever` : `Lets ${short(spender)} spend ${amount(amt)} of ${name(ctx, to)}`,
      lines: [r.line, unlimited ? "It never expires. If that contract is malicious, it can take every token of this kind, now or later." : "It stays until you revoke it."] };
  }
  if (sel === SEL.setApprovalForAll) {
    const op = addrAt(data, 0), on = uintAt(data, 1) !== 0n;
    if (!on) return { level: "ok", kind: "revoke", title: "Removes a collection-wide approval", lines: [`${short(op)} can no longer move your NFTs from ${name(ctx, to)}.`], spender: op, token: to };
    const r = spenderRisk(ctx, op);
    return { level: r.level === "info" ? "warn" : "danger", kind: "approve-all", spender: op, token: to, title: `Hands over EVERY NFT you hold in ${name(ctx, to)}`,
      lines: [r.line, "This is how most NFT drains start: one approval, then everything in the collection is moved."] };
  }
  if (sel === SEL.permit2Approve) {
    const token = addrAt(data, 0), spender = addrAt(data, 1), amt = uintAt(data, 2), r = spenderRisk(ctx, spender);
    return { level: amt >= HUGE / 2n ** 32n && r.level !== "info" ? "danger" : "warn", kind: "permit2", spender, token,
      title: `Permit2: lets ${short(spender)} spend ${amount(amt)} of ${name(ctx, token)}`, lines: [r.line] };
  }
  if (sel === SEL.transfer) {
    const dest = addrAt(data, 0), amt = uintAt(data, 1);
    return { level: ctx.flagged?.has(lc(dest)) ? "danger" : "info", kind: "transfer", token: to, title: `Sends ${amount(amt)} of ${name(ctx, to)}`, lines: [`To ${short(dest)}. Check the address is exactly the one you meant: look-alike addresses are a common trick.`] };
  }
  if (sel === SEL.transferFrom || sel === SEL.safeTransferFrom) {
    const from = addrAt(data, 0), dest = addrAt(data, 1);
    return { level: "info", kind: "transfer", token: to, title: `Moves a token from ${short(from)}`, lines: [`To ${short(dest)}.`] };
  }
  const r = ctx.trusted?.has(to) ? { level: "info" as Level, line: `${name(ctx, to)} is a contract we recognise.` } : { level: "info" as Level, line: `A call to ${short(to)} we can't read in detail. Make sure you trust the site.` };
  return { level: value > 0n && r.level !== "info" ? "warn" : r.level, kind: "call", title: value > 0n ? `Calls a contract and sends ${eth(value)}` : "Calls a contract", lines: [r.line] };
}

/** A typed-data signature (eth_signTypedData_v3/v4). Signatures cost no gas, which is why drainers love them. */
export function scanTyped(json: unknown, ctx: Ctx = {}): Finding {
  let t: { primaryType?: string; domain?: { name?: string; verifyingContract?: string }; message?: Record<string, unknown> };
  try { t = typeof json === "string" ? JSON.parse(json) : (json as typeof t); } catch { return { level: "warn", kind: "typed", title: "A signature we can't read", lines: ["Only sign it if you fully trust this site."] }; }
  const p = t?.primaryType ?? "", m = t?.message ?? {}, dom = t?.domain ?? {};
  const contract = lc(dom.verifyingContract);
  if (p === "Permit") {
    const spender = String(m.spender ?? ""), v = big(m.value), r = spenderRisk(ctx, spender);
    return { level: r.level === "info" && v < HUGE ? "warn" : "danger", kind: "permit", spender, token: contract,
      title: `Permit: lets ${short(spender)} spend ${amount(v)} of ${dom.name ?? name(ctx, contract)}`,
      lines: ["It costs no gas and looks like a sign-in, but it gives away your tokens. This was the biggest single way people were drained in 2025.", r.line] };
  }
  if (p === "PermitSingle" || p === "PermitBatch" || p === "PermitTransferFrom" || p === "PermitBatchTransferFrom" || p === "PermitWitnessTransferFrom") {
    const spender = String(m.spender ?? ""), r = spenderRisk(ctx, spender);
    return { level: r.level === "info" ? "warn" : "danger", kind: "permit2", spender, title: `Permit2 signature: lets ${short(spender)} move your tokens`, lines: ["A gasless signature that can move tokens you've approved for Permit2.", r.line] };
  }
  if (p === "OrderComponents" || p === "Order" || p === "BulkOrder" || p === "Root") {
    return { level: "warn", kind: "listing", title: "Lists your NFTs or tokens for sale", lines: ["Check the price and the items. Fake \"listings\" at almost zero are a common drain."] };
  }
  if (/delegat|authoriz/i.test(p)) return { level: "danger", kind: "delegation", title: "Hands control of your wallet to a contract", lines: ["This delegates your account. A malicious contract could then move everything you hold."] };
  return { level: "info", kind: "typed", title: `Signs a \"${p || "message"}\" message`, lines: [`For ${dom.name ?? "an app"}. It doesn't look like a transfer or approval.`] };
}

const hexText = (h: string) => { try { if (!/^0x[0-9a-fA-F]*$/.test(h)) return h; const b = h.slice(2).match(/../g)?.map((x) => parseInt(x, 16)) ?? []; const s = new TextDecoder().decode(new Uint8Array(b)); return /[\x00-\x08\x0e-\x1f]/.test(s) ? null : s; } catch { return null; } };

/** Distance between two short strings (for look-alike domains). */
function edits(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
export const BRANDS = ["trenchers.io", "uniswap.org", "opensea.io", "metamask.io", "pons.family", "robinhood.com", "blur.io", "aave.com", "lido.fi", "coinbase.com", "rabby.io", "phantom.app", "etherscan.io"];

/** The site asking: on a phishing list, a look-alike of a known site, or using look-alike letters. */
export function scanOrigin(origin: string | undefined, ctx: Ctx = {}): Finding | null {
  if (!origin) return null;
  let host = ""; try { host = new URL(origin).hostname.toLowerCase(); } catch { return null; }
  const bare = host.replace(/^www\./, "");
  if (ctx.phishing?.has(bare) || ctx.phishing?.has(host)) return { level: "danger", kind: "phishing", title: `${bare} is a known phishing site`, lines: ["Close this tab. Nothing it asks you to sign is safe."] };
  if (bare.split(".").some((p) => p.startsWith("xn--"))) return { level: "warn", kind: "lookalike", title: `${bare} uses look-alike letters`, lines: ["The address may imitate a real site with letters from another alphabet."] };
  for (const b of ctx.brands ?? BRANDS) {
    if (bare === b || bare.endsWith(`.${b}`)) return null;
    const [n] = b.split("."), [m] = bare.split(".");
    const typo = m !== n && n.length >= 5 && m.length >= 4 && edits(m, n) <= (n.length > 6 ? 2 : 1);
    const borrowed = !typo && n.length >= 5 && bare.includes(n);
    if (typo || borrowed) return { level: typo ? "danger" : "warn", kind: "lookalike", title: `${bare} ${typo ? "looks like" : "uses the name of"} ${b}, but isn't it`, lines: [`If you meant to visit ${b}, close this tab and type the address yourself.`] };
  }
  return null;
}

/** Anything a site asks a wallet to do. Returns every finding, the worst first. */
export function scan(req: Request, ctx: Ctx = {}): { level: Level; findings: Finding[] } {
  const out: Finding[] = [];
  const o = scanOrigin(req.origin, ctx); if (o) out.push(o);
  const p = req.params ?? [];
  switch (req.method) {
    case "eth_sendTransaction": out.push(scanTx((p[0] ?? {}) as never, ctx)); break;
    case "wallet_sendCalls": { const calls = ((p[0] as { calls?: unknown[] })?.calls ?? []) as never[]; calls.forEach((c) => out.push(scanTx(c, ctx))); if (calls.length > 1) out.push({ level: "info", kind: "batch", title: `${calls.length} actions in one go`, lines: ["Every one of them runs if you approve."] }); break; }
    case "eth_signTypedData": case "eth_signTypedData_v3": case "eth_signTypedData_v4": { const j = typeof p[0] === "string" && String(p[0]).trim().startsWith("{") ? p[0] : p[1]; out.push(scanTyped(j, ctx)); break; }
    case "eth_sign": out.push({ level: "danger", kind: "blind", title: "A blind signature", lines: ["eth_sign can sign anything, including a transaction that empties your wallet. Legitimate sites almost never ask for it."] }); break;
    case "personal_sign": {
      const raw = String((typeof p[0] === "string" && String(p[0]).startsWith("0x") && String(p[0]).length !== 42 ? p[0] : p[1]) ?? "");
      if (/^0x[0-9a-fA-F]{64}$/.test(raw)) { out.push({ level: "danger", kind: "blind", title: "Signs an unreadable hash", lines: ["You can't see what this signature approves. Only sign it if you fully trust the site."] }); break; }
      const text = hexText(raw);
      out.push(text === null ? { level: "warn", kind: "sign", title: "Signs data we can't read", lines: ["Only sign it if you fully trust this site."] }
        : { level: "ok", kind: "sign", title: "Signs a message", lines: [`\"${text.slice(0, 160)}${text.length > 160 ? "…" : ""}\"`, "A plain message can't move your funds on its own."] });
      break;
    }
    case "eth_signAuthorization": case "wallet_signAuthorization": case "eth_signAuthorizationRequest":
      out.push({ level: "danger", kind: "delegation", title: "Hands control of your wallet to a contract (EIP-7702)", lines: ["After this, the contract can act as your wallet. Only do it for a wallet upgrade you started yourself."] }); break;
    default: return { level: out[0]?.level ?? "ok", findings: out };
  }
  out.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return { level: out[0]?.level ?? "ok", findings: out };
}

/** Requests worth stopping to check (everything else passes straight through). */
export const CHECKED = new Set(["eth_sendTransaction", "wallet_sendCalls", "eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4", "eth_sign", "personal_sign", "eth_signAuthorization", "wallet_signAuthorization", "eth_signAuthorizationRequest"]);
