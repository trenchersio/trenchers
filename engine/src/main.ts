import { createServer } from "node:http";
import { Engine } from "./engine";
import { ENV } from "./env";

/** Runs the engine loop and serves the live Arena data the website reads. */
const engine = new Engine();
let lastTick = 0;
let lastError: string | null = null;

async function loop() {
  try { await engine.tick(); lastTick = Date.now(); lastError = null; }
  catch (e) { lastError = (e as Error).message.split("\n")[0]; engine.log(`tick failed: ${lastError}`); }
  setTimeout(loop, ENV.POLL_MS);
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  try {
    if (req.url === "/health") {
      const healthy = Date.now() - lastTick < Math.max(30_000, ENV.POLL_MS * 10);
      res.statusCode = healthy ? 200 : 503;
      res.end(JSON.stringify({ ok: healthy, block: engine.cursor.toString(), agents: engine.agents.size, coins: engine.tokens.size, lastError, engine: engine.engineAddress, dryRun: ENV.DRY_RUN }));
    } else if (req.url === "/arena") {
      res.end(JSON.stringify(await engine.arena()));
    } else { res.statusCode = 404; res.end(JSON.stringify({ error: "not found" })); }
  } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: (e as Error).message })); }
});

engine.start().then(() => {
  server.listen(ENV.PORT, () => engine.log(`API on :${ENV.PORT} (/health, /arena)`));
  loop();
}).catch((e) => { console.error(e); process.exit(1); });
