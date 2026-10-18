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
const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const path = (req.url ?? "/").split("?")[0];
  try {
    if (await chat.handle(req, res, path)) return;
    if (await waitlist.handle(req, res, path)) return;
    if (await inference.handle(req, res, path)) return;
    if (await builder.handle(req, res, path)) return;
    if (path === "/health" || path === "/") {
      // Always 200 while the process is up, so Railway keeps it running and you can read what's wrong here.
      if (!engine) { res.end(JSON.stringify({ ok: false, status, problems: PROBLEMS }, null, 2)); return; }
      const healthy = Date.now() - lastTick < Math.max(30_000, ENV.POLL_MS * 10);
      res.end(scrub(JSON.stringify({ ok: healthy, status: !healthy ? status : engine.paused ? "emergency stop: trading paused by the team" : "running", rpc: rpcStats(), block: engine.cursor.toString(), blocksBehind: engine.head > engine.cursor ? (engine.head - engine.cursor).toString() : "0", readError: engine.syncError, agents: engine.agents.size, coins: engine.tokens.size, tradingRoute: engine.adapter, lastError, tradingWallet: engine.engineAddress ?? "none: ENGINE_KEY not set, watching only", dryRun: ENV.DRY_RUN, feeShare: (() => { try { return engine.feeKeeper.diag(); } catch { return "error"; } })(), inference: inference.status(), builder: builder.status(), trading: (() => { try { return engine.diag(); } catch (e) { return { error: (e as Error).message }; } })(), telegram: engine.telegram ? { ready: engine.telegram.ready, posted: engine.telegram.posted, lastError: engine.telegram.lastError } : "off (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT)", recent }, null, 2)));
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
