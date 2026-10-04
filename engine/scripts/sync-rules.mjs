// Copies the website's rule reader into the engine, so agents trade exactly the rule their holder saw.
// The copy is committed, so the engine also builds on its own (e.g. a Railway service rooted at engine/).
import { copyFileSync, existsSync, readFileSync } from "node:fs";
const src = new URL("../../web/lib/custom-strategy.ts", import.meta.url);
const dst = new URL("../src/custom-strategy.ts", import.meta.url);
if (existsSync(src) && (!existsSync(dst) || readFileSync(src, "utf8") !== readFileSync(dst, "utf8"))) {
  copyFileSync(src, dst);
  console.log("engine: rule reader synced from web/lib/custom-strategy.ts");
}
