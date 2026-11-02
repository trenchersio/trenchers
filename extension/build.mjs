// Builds the Chrome extension into dist/ and zips it (extension/trenchers-guard-extension.zip). At launch, copy the zip
// to web/public/guard/ so the /protect page's download link works.
// Run: node extension/build.mjs   (uses the engine's esbuild; no extra installs)
import { build } from "../engine/node_modules/esbuild/lib/main.js";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
rmSync(dist, { recursive: true, force: true }); mkdirSync(dist, { recursive: true });
await build({ entryPoints: ["inject", "bridge", "background", "popup"].map((n) => join(here, "src", `${n}.ts`)), outdir: dist, bundle: true, format: "iife", target: "chrome110", minify: false, legalComments: "none", logLevel: "warning" });
cpSync(join(here, "static"), dist, { recursive: true });
const out = here;
mkdirSync(out, { recursive: true });
const zip = join(out, "trenchers-guard-extension.zip");
if (existsSync(zip)) rmSync(zip);
execSync(`cd "${dist}" && zip -qr "${zip}" .`);
console.log(`built ${dist} and ${zip}`);
