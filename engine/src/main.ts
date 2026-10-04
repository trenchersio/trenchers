import { createServer } from "node:http";
import { Engine } from "./engine";
import { ENV, PROBLEMS } from "./env";
import { liveCheck } from "./selfcheck";

/** Runs the engine loop and serves the live Arena data the website reads. */
/** The last lines of the engine's log, shown on /health so problems are visible without opening Railway. */
const recent: string[] = [];
const log = (m: string) => { const line = `${new Date().toISOString().slice(11, 19)} ${m}`; console.log(line); recent.push(line); if (recent.length > 25) recent.shift(); };
const engine = PROBLEMS.length ? null : new Engine(log);
let status = PROBLEMS.length ? "settings need fixing" : "starting: reading the chain's history";
let lastTick = 0;
let lastLive: { t: number; body: string } | null = null;
let lastError: string | null = null;

async function loop() {
  if (!engine) return;
  try { await engine.tick(); lastTick = Date.now(); lastError = null; }
  catch (e) { lastError = (e as Error).message.split("\n")[0]; engine.log(`tick failed: ${lastError}`); }
  setTimeout(loop, ENV.POLL_MS);
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const path = (req.url ?? "/").split("?")[0];
  try {
    if (path === "/health" || path === "/") {
      // Always 200 while the process is up, so Railway keeps it running and you can read what's wrong here.
      if (!engine) { res.end(JSON.stringify({ ok: false, status, problems: PROBLEMS }, null, 2)); return; }
      const healthy = Date.now() - lastTick < Math.max(30_000, ENV.POLL_MS * 10);
      res.end(JSON.stringify({ ok: healthy, status: !healthy ? status : engine.paused ? "emergency stop: trading paused by the team" : "running", block: engine.cursor.toString(), agents: engine.agents.size, coins: engine.tokens.size, lastError, tradingWallet: engine.engineAddress ?? "none: ENGINE_KEY not set, watching only", dryRun: ENV.DRY_RUN, telegram: engine.telegram ? { posted: engine.telegram.posted, lastError: engine.telegram.lastError } : "off (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT)", recent }, null, 2));
    } else if (path === "/livecheck") {
      // Read-only proof against Robinhood Chain mainnet (see selfcheck.ts); cached for 5 minutes.
      if (!lastLive || Date.now() - lastLive.t > 300_000) lastLive = { t: Date.now(), body: JSON.stringify(await liveCheck(process.env.MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com").catch((e) => ({ ok: false, error: (e as Error).message })), null, 2) };
      res.end(lastLive.body);
    } else if (path === "/arena") {
      if (!engine || !lastTick) { res.statusCode = 503; res.end(JSON.stringify({ error: status })); return; }
      res.end(JSON.stringify(await engine.arena()));
    } else { res.statusCode = 404; res.end(JSON.stringify({ error: "not found" })); }
  } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: (e as Error).message })); }
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
