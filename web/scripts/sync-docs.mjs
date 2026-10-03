// Copies the repository README into the website's docs page (content/docs.md) and its images
// into public/docs-img. Run automatically before every build. If the README isn't reachable
// (e.g. the host builds only the web/ folder), the committed copy is used as-is.
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const readme = join(root, "README.md");
const imgSrc = join(root, "docs", "img");
const REPO = "https://github.com/trenchersio/trenchers";

if (!existsSync(readme)) { console.log("sync-docs: README not found, keeping committed docs"); process.exit(0); }

let md = readFileSync(readme, "utf8");
// drop the centred banner/logo header (the site has its own) and the README's table of contents
md = md.slice(md.indexOf("## What Trenchers is"));
md = md.replace(/\n---\n/g, "\n");
// HTML image blocks -> markdown images (the page renders markdown only)
md = md.replace(/<p[^>]*>\s*(<img[^>]*>)\s*<\/p>/g, "$1");
md = md.replace(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/g, "![$2]($1)");
// images and repository links
md = md.replace(/docs\/img\//g, "docs-img/");
md = md.replace(/\]\((?!https?:|#|docs-img\/)([^)\s]+)\)/g, (_, p) => `](${REPO}/${/\.[a-z]+$/.test(p) ? "blob" : "tree"}/main/${p})`);
writeFileSync(join(here, "..", "content", "docs.md"), md);

if (existsSync(imgSrc)) {
  const out = join(here, "..", "public", "docs-img");
  mkdirSync(out, { recursive: true });
  for (const f of readdirSync(imgSrc)) copyFileSync(join(imgSrc, f), join(out, f));
}
console.log("sync-docs: content/docs.md updated");
