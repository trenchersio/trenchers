import { createServer } from "node:http";
import { explain, mainnetRpcs, rpcStats, scrub } from "./rpc";
import { Engine } from "./engine";
import { Chat } from "./chat";
import { Waitlist } from "./waitlist";
import { ENV, PROBLEMS } from "./env";
import { liveCheck } from "./selfcheck";
import { verifyDeployment } from "./verify";
import { InferenceDesk, trencherPersona } from "./inference";
import { FUND_ABI, NFT_OWNER_ABI } from "./abis";
import { BuilderIndex } from "./builder";
import { Recaps } from "./recap";
import { Backtest } from "./backtest";
import { Market } from "./market";
import { Trenchies } from "./trenchies";
import { XPoints } from "./xpoints";
import { BtcFeed } from "./btc";
import { PrizePot } from "./prizes";

/** Runs the engine loop and serves the live Arena data the website reads. */
/** The last lines of the engine's log, shown on /health so problems are visible without opening Railway. */
const recent: string[] = [];
const log = (m: string) => { const line = scrub(`${new Date().toISOString().slice(11, 19)} ${m}`); console.log(line); recent.push(line); if (recent.length > 25) recent.shift(); };
const engine = PROBLEMS.length ? null : new Engine(log);
let status = PROBLEMS.length ? "settings need fixing" : "starting: reading the chain's history";
let lastTick = 0;
let lastLive: { t: number; body: string } | null = null;
let liveRunning = false;
function runLiveCheck() {
  liveRunning = true;
  liveCheck(mainnetRpcs().join(","))
    .catch((e) => ({ ok: false, error: explain(e) }))
    .then((r) => { lastLive = { t: Date.now(), body: scrub(JSON.stringify(r, null, 2)) }; })
    .finally(() => { liveRunning = false; });
}
let lastVerify: { t: number; body: string } | null = null;
let verifyRunning = false;
let verifyLauncher: `0x${string}` | null = null;
let verifyStarted = 0;
function runVerify() {
  verifyRunning = true; verifyStarted = Date.now();
  // Never let one slow RPC answer keep the report from appearing: give up after 2 minutes and say so.
  const limit = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The check took longer than 2 minutes (the RPC is slow or rate-limiting). Refresh to run it again.")), 120_000));
  Promise.race([verifyDeployment(mainnetRpcs().join(","), undefined, undefined, undefined, verifyLauncher ? { walletV2: verifyLauncher } : {}), limit])
    .catch((e) => ({ ok: false, error: explain(e) }))
    .then((r) => { lastVerify = { t: Date.now(), body: scrub(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2)) }; })
    .finally(() => { verifyRunning = false; });
}
let lastError: string | null = null;

/** One answer shared by every visitor for `ms` (and one computation in flight at a time): each page polls every few
 *  seconds, and without this every open tab made its own round of chain reads for every agent. */
const cache = new Map<string, { at: number; body: string; pending?: Promise<string> }>();
async function shared(key: string, ms: number, make: () => Promise<string>): Promise<string> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ms) return c.body;
  if (c?.pending) return c.pending;
  const pending = make().then((body) => { cache.set(key, { at: Date.now(), body }); return body; })
    .catch((e) => { const old = cache.get(key); if (old) { delete old.pending; if (old.body) return old.body; } throw e; });
  cache.set(key, { at: c?.at ?? 0, body: c?.body ?? "", pending });
  return pending;
}

async function loop() {
  if (!engine) return;
  try { await engine.tick(); lastTick = Date.now(); lastError = null; }
  catch (e) {
    // Name the RPC method and the HTTP status, so a throttled or failing RPC is easy to tell apart.
    const x = e as { shortMessage?: string; message: string; status?: number; details?: string; body?: { method?: string } | { method?: string }[]; cause?: { status?: number; details?: string; body?: unknown } };
    const body = (x.body ?? x.cause?.body) as { method?: string } | { method?: string }[] | undefined;
    const method = Array.isArray(body) ? body.map((b) => b.method).join(",") : body?.method;
    const status = x.status ?? x.cause?.status;
    const details = x.details ?? x.cause?.details;
    lastError = /Just a moment|cf_chl|fetch failed/i.test(String(x.message) + String(details)) ? explain(String(x.message) + String(details)) : [(x.shortMessage ?? x.message).split("\n")[0], method && `(${method})`, status && `status ${status}`, details && String(details).slice(0, 120)].filter(Boolean).join(" ");
    // A rate-limited RPC: wait the limit out instead of retrying every few seconds (which keeps it tripped).
    if (/rate ?limit|too many requests|429/i.test(`${lastError} ${x.status ?? ""}`)) {
      engine.log(`RPC rate limit hit: pausing 65 s before the next update`);
      setTimeout(loop, 65_000);
      return;
    }
    engine.log(`tick failed: ${lastError}`);
  }
  setTimeout(loop, ENV.POLL_MS);
}

const chat = new Chat();
const waitlist = new Waitlist();

// Trenchers Inference Markets. Runs whatever state the trading engine is in: a desk with settings missing says
// which ones on /icm and /health, and keeps answering.
const inference = new InferenceDesk(undefined, (t) => {
  for (const c of engine?.agentCoins.values() ?? []) if (c.token.toLowerCase() === t) return { verified: true, agent: c.agent };
  for (const c of engine?.pgCoins.values() ?? []) if (c.token.toLowerCase() === t) return { verified: true, agent: c.agent };
  return { verified: false, agent: null };
});
// A Trencher on the desk: its agent wallet holds its inference, its holder manages it, and its rule is who it is.
inference.setTrenchers(async (id) => {
  if (!engine) return null;
  const known = [...engine.agents.values()].find((a) => a.id === id);
  const wallet = known?.wallet ?? await engine.pub.readContract({ address: ENV.FUND, abi: FUND_ABI, functionName: "agentWallet", args: [BigInt(id)] }) as `0x${string}`;
  // Awake means the agent wallet exists on-chain (awakening deploys it).
  if (!known) { const code = await engine.pub.getCode({ address: wallet }).catch(() => undefined); if (!code || code === "0x") return null; }
  const holder = await engine.pub.readContract({ address: ENV.NFT, abi: NFT_OWNER_ABI, functionName: "ownerOf", args: [BigInt(id)] }).catch(() => null) as string | null;
  const coin = [...engine.agentCoins.values(), ...engine.pgCoins.values()].find((c) => c.agent === id);
  return { id, wallet, holder, persona: trencherPersona({ id, wallet, rule: known?.ruleText ?? null, live: known?.live ?? false, coin: coin?.token ?? null }) };
});
const every = (ms: number, f: () => Promise<unknown> | unknown) => { const run = async () => { try { await f(); } catch (e) { console.warn(`[inference] ${(e as Error).message}`); } setTimeout(run, ms); }; setTimeout(run, 5_000); };
every(60_000, () => inference.poll());
every(600_000, () => inference.burn());
every(300_000, () => { const swept = inference.sweep(); if (swept.length) console.warn(`[inference] swept ${swept.length} stale hold(s)`); });
every(300_000, () => inference.updateBook()); // the P2P book: every 5 minutes
const builder = new BuilderIndex();
every(6 * 3_600_000, () => builder.update()); // the V4 Builder coin list: 4 times a day
const recaps = new Recaps(log);
if (engine) engine.honors = recaps.honors();
// Monday's report to every holder who linked Telegram or turned on phone notifications.
recaps.onSaved = (week, prev) => {
  if (!engine) return;
  engine.honors = recaps.honors();
  const of = week.ranks?.length ?? 0;
  const lines = (addr: string) => {
    const ids = engine.ownedBy(addr); if (!ids.length || !week.ranks) return null;
    const out = ids.map((id) => {
      const r = week.ranks!.find((x) => x.id === id); if (!r) return null;
      const p = prev?.ranks?.find((x) => x.id === id);
      return `<b>Trencher #${id}</b>: ${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(1)}% · rank ${p ? `${p.rank} → ` : ""}${r.rank} of ${of} · ${r.trades} trades${r.best ? ` · best +${r.best.pct.toFixed(0)}% $${r.best.symbol}` : ""}`;
    }).filter(Boolean);
    return out.length ? `📊 <b>Your week</b> (${week.week})\n${out.join("\n")}\n\nSee the full recap: ${ENV.SITE_URL}/arena#recap` : null;
  };
  engine.alerts?.weekly(lines);
  for (const addr of new Set([...engine.agents.values()].map((a) => a.owner).filter((x): x is `0x${string}` => !!x))) {
    const l = lines(addr); if (!l) continue;
    engine.push.notify(addr, { title: "Your week in the Arena", body: l.replace(/<[^>]+>/g, "").split("\n").slice(1, 4).join("\n"), url: `${ENV.SITE_URL}/arena#recap`, tag: "weekly" });
  }
};
// "Test this rule on last week": 7 days of Pons prices, read 4 times a day (a few dozen reads each time).
const backtest = engine ? new Backtest({ pub: engine.pub as never, curves: engine.curves, tokens: engine.tokens as never, log, ethUsd: ENV.ETH_USD, snipeWait: ENV.SNIPE_WAIT_SEC, maxPositions: ENV.MAX_POSITIONS, maxHold: ENV.MAX_HOLD_SEC }) : null;
// Trenchies: daily picks settled from those same prices, a few minutes after each UTC day ends.
// Weekly prize pot: 5% of the $TRENCHERS creator fees that come in each week (2 to 3 reads an hour).
const pot = engine ? new PrizePot(engine.pub as never, ENV.TRENCHERS_TOKEN, ENV.PONS_FACTORY, log) : null;
if (pot) { setTimeout(() => void pot.update(), 90_000); setInterval(() => void pot.update(), 3_600_000); }
// The Trenchies trading desk: Bitcoin's live price (public exchange feed, no key, no chain reads).
const btc = new BtcFeed(log);
const trenchies = engine && backtest ? new Trenchies({
  pub: engine.pub as never, nft: ENV.NFT as `0x${string}`, prices: backtest, symbolOf: (t) => engine.symbolOf(t), log,
  pot: pot ?? undefined, site: ENV.SITE_URL, btc,
  announce: (ids, text) => { void engine.telegram?.announce(ids, text); },
  notify: (addr, msg) => engine.push.notify(addr, msg),
}) : null;
if (trenchies) { btc.start(); setInterval(() => { try { trenchies.deskTick(); } catch (e) { log(`Trenchies desk: ${(e as Error).message}`); } }, 3000); }
if (backtest) {
  // Prices: hourly (a handful of reads each time), and right after midnight UTC so the day can be settled.
  let lastDay = Math.floor(Date.now() / 86_400_000);
  const go = () => { if (lastTick) void backtest.update(); };
  setTimeout(go, 120_000); setTimeout(go, 15 * 60_000); setInterval(go, 3_600_000);
  setInterval(() => {
    const d = Math.floor(Date.now() / 86_400_000);
    if (d !== lastDay && Date.now() % 86_400_000 > 60_000) { lastDay = d; go(); }
    try { trenchies?.tick(); } catch (e) { log(`Trenchies: ${(e as Error).message}`); }
    if (Date.now() % 600_000 < 60_000) { try { trenchies?.remind(); } catch (e) { log(`Trenchies reminders: ${(e as Error).message}`); } }
  }, 60_000);
}
// Trenchies early XP: sign in with X, follow / like / reply, and XP for using Trenchers (NFTs, trades, coins, inference).
const xpoints = new XPoints(log, {
  nftsOf: (w) => (engine ? [...engine.agents.values()].filter((a) => a.owner?.toLowerCase() === w).map((a) => a.id) : []),
  tradeDays: (nft) => { const out: Record<number, number> = {}; if (engine) for (const t of engine.trades) if (t.agent === nft) { const d = Math.floor(t.time / 86400); out[d] = (out[d] ?? 0) + 1; } return out; },
  coinsOf: (w, nfts) => [...builder.createdBy(w), ...(engine ? [...engine.agents.values()].filter((a) => nfts.includes(a.id) && a.coin && !/^0x0+$/.test(a.coin)).map((a) => a.coin as string) : [])],
  inferenceUsd: (w) => { try { return inference.boughtUsd(w); } catch { return 0; } },
});
setInterval(() => { try { xpoints.tick(); } catch (e) { log(`XP: ${(e as Error).message}`); } }, 600_000);
const market = new Market(ENV.NFT);
// Last week's recap is saved right after the week ends, from the cached Arena (no extra chain reads).
setInterval(() => { if (engine && lastTick) recaps.check(async () => JSON.parse(await shared("arena", 60_000, async () => JSON.stringify(await engine.arena())))).catch(() => {}); }, 60_000);
const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const path = (req.url ?? "/").split("?")[0];
  try {
    if (await chat.handle(req, res, path)) return;
    if (await waitlist.handle(req, res, path)) return;
    if (await xpoints.handle(req, res, path)) return;
    if (await inference.handle(req, res, path)) return;
    if (await builder.handle(req, res, path)) return;
    if (await recaps.handle(req, res, path)) return;
    if (backtest && await backtest.handle(req, res, path)) return;
    if (trenchies && await trenchies.handle(req, res, path)) return;
    if (await market.handle(req, res, path)) return;
    if (engine && await engine.push.handle(req, res, path)) return;
    if (engine?.alerts && await engine.alerts.handle(req, res, path)) return;
    if (path === "/health" || path === "/") {
      // Always 200 while the process is up, so Railway keeps it running and you can read what's wrong here.
      if (!engine) { res.end(JSON.stringify({ ok: false, status, problems: PROBLEMS }, null, 2)); return; }
      const healthy = Date.now() - lastTick < Math.max(30_000, ENV.POLL_MS * 10);
      res.end(scrub(JSON.stringify({ ok: healthy, status: !healthy ? status : engine.paused ? "emergency stop: trading paused by the team" : "running", rpc: rpcStats(), block: engine.cursor.toString(), blocksBehind: engine.head > engine.cursor ? (engine.head - engine.cursor).toString() : "0", readError: engine.syncError, agents: engine.agents.size, coins: engine.tokens.size, tradingRoute: engine.adapter, lastError, tradingWallet: engine.engineAddress ?? "none: ENGINE_KEY not set, watching only", dryRun: ENV.DRY_RUN, feeShare: (() => { try { return engine.feeKeeper.diag(); } catch { return "error"; } })(), inference: inference.status(), builder: builder.status(), ruleTest: backtest?.status ?? "off", market: market.status, push: engine.push.view(), trenchies: trenchies?.view() ?? "off", btc: btc.view(), xp: xpoints.view(), trading: (() => { try { return engine.diag(); } catch (e) { return { error: (e as Error).message }; } })(), telegram: engine.telegram ? { ready: engine.telegram.ready, posted: engine.telegram.posted, tradesSkipped: engine.telegram.tradesSkipped, lastError: engine.telegram.lastError, alerts: engine.alerts?.view() ?? "off" } : "off (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT)", recent }, null, 2)));
    } else if (path === "/livecheck") {
      // Read-only proof against Robinhood Chain mainnet (see selfcheck.ts); cached for 5 minutes.
      // Runs in the background (it scans a lot of history); this returns the latest finished result.
      if (!liveRunning && (!lastLive || Date.now() - lastLive.t > 600_000)) runLiveCheck();
      res.end(lastLive?.body ?? JSON.stringify({ status: "running, refresh in a minute" }));
    } else if (path === "/verify") {
      // Read-only check of the Trenchers mainnet deployment (see verify.ts); runs in the background, cached 5 minutes.
      const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
      const l = q.get("v2") ?? q.get("launcher");
      if (l && /^0x[0-9a-fA-F]{40}$/.test(l) && !verifyRunning) { verifyLauncher = l as `0x${string}`; runVerify(); }
      else if (!verifyRunning && (!lastVerify || Date.now() - lastVerify.t > 300_000)) runVerify();
      res.setHeader("cache-control", "no-store");
      res.end(lastVerify?.body ?? JSON.stringify({ status: "running, refresh in a minute", runningFor: verifyRunning ? `${Math.round((Date.now() - verifyStarted) / 1000)}s` : "not started" }));
    } else if (path === "/coins") {
      if (!engine || !lastTick) { res.statusCode = 503; res.end(JSON.stringify({ error: status })); return; }
      res.end(await shared("coins", 30_000, async () => JSON.stringify(await engine.coins())));
    } else if (path === "/activity") {
      if (!engine || !lastTick) { res.statusCode = 503; res.end(JSON.stringify({ error: status })); return; }
      res.end(JSON.stringify({ items: engine.activityFeed(), feeShare: (() => { try { return engine.feeKeeper.diag(); } catch { return null; } })(), now: Date.now() }));
    } else if (path === "/burns") {
      if (!engine) { res.statusCode = 503; res.end(JSON.stringify({ error: status })); return; }
      if (Date.now() - engine.burns.updatedAt > 6 * 3_600_000) { /* the burn count: at most 4 times a day */ const p = engine.burns.update(); if (!engine.burns.updatedAt) await Promise.race([p, new Promise((r) => setTimeout(r, 20_000))]); }
      res.end(JSON.stringify(engine.burns.view()));
    } else if (path === "/token") {
      // A coin for a specific-token strategy: ticker, name, logo and market cap, or why it can't be traded.
      if (!engine || !lastTick) { res.statusCode = 503; res.end(JSON.stringify({ error: status })); return; }
      const a = new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("address") ?? "";
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: "not an address" })); return; }
      const m = await engine.tokenMeta(a as `0x${string}`);
      res.setHeader("cache-control", "public, max-age=30");
      res.end(JSON.stringify(m ? { ok: true, ...m } : { ok: false, error: engine.notPons.has(a.toLowerCase() as `0x${string}`) ? "This isn't a Pons coin paired with ETH, so agents can't trade it." : "Couldn't read this coin right now. Try again in a minute." }));
    } else if (path === "/trade") {
      // One agent trade by its tx, for share links with a rich preview.
      if (!engine || !lastTick) { res.statusCode = 503; res.end(JSON.stringify({ error: status })); return; }
      const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
      const t = engine.findTrade(q.get("tx") ?? "", Number(q.get("agent")) || undefined);
      res.setHeader("cache-control", "public, max-age=60");
      if (!t) { res.statusCode = 404; res.end(JSON.stringify({ error: "not found" })); return; }
      res.end(JSON.stringify(t));
    } else if (path === "/arena") {
      if (!engine || !lastTick) { res.statusCode = 503; res.end(JSON.stringify({ error: status })); return; }
      res.end(await shared("arena", 60_000, async () => JSON.stringify(await engine.arena())));
    } else { res.statusCode = 404; res.end(JSON.stringify({ error: "not found" })); }
  } catch (e) { res.statusCode = 500; res.end(scrub(JSON.stringify({ error: (e as Error).message }))); }
});

// Serve /health straight away (history replay can take a while), then start trading.
server.listen(ENV.PORT, "0.0.0.0", () => console.log(`API on :${ENV.PORT} (/health, /arena)`));
if (!engine) console.error(`Engine not started. Fix these variables in Railway:\n- ${PROBLEMS.join("\n- ")}`);
else {
  const boot = () => engine.start().then(() => { status = "running"; loop(); }).catch((e) => {
    status = `start failed, retrying in 30s: ${(e as Error).message.split("\n")[0]}`;
    console.error(e); setTimeout(boot, 30_000);
  });
  boot();
}
