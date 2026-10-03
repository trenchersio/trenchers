#!/usr/bin/env bash
# Builds a static copy of the site for a shareable preview link (artifact host).
# Output: $1 (default ../preview-site) with index.html -> site.html redirect, arena.html, assets in nx/.
set -euo pipefail
OUT="${1:-../preview-site}"
rm -rf out && PREVIEW_EXPORT=1 NEXT_PUBLIC_PREVIEW=1 NEXT_TELEMETRY_DISABLED=1 npx next build >/dev/null
rm -rf "$OUT" && mkdir -p "$OUT"
cp -r out/_next "$OUT/nx" && cp -r out/brand out/nft out/icon.png out/opengraph-image.png "$OUT/"
cp out/index.html "$OUT/site.html" && cp out/arena.html "$OUT/arena.html"
cd "$OUT"
grep -rl "_next/" --include=*.js --include=*.css --include=*.html . | xargs sed -i 's#_next/#nx/#g'
sed -i 's#url(nx/static/media/#url(../media/#g' nx/static/css/*.css
python3 - <<'PY'
import glob, re
bad = re.compile(rb'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
for f in glob.glob('**/*.js', recursive=True) + glob.glob('**/*.css', recursive=True) + glob.glob('*.html'):
    b = open(f, 'rb').read()
    b = bad.sub(lambda m: ('\\u%04x' % m.group()[0]).encode(), b)
    b = b.replace('�'.encode(), b'\\ufffd')
    open(f, 'wb').write(b)
PY
cat > index.html <<'HTML'
<title>Trenchers</title>
<meta name="color-scheme" content="dark">
<style>
  :root { color-scheme: dark; --bg: #000; --fg: #E8ECE9; --accent: #39FF88; }
  html, body { height: 100%; }
  body { background: var(--bg); color: var(--fg); font: 15px/1.5 ui-monospace, Menlo, monospace; display: grid; place-items: center; padding-inline: 16px; }
  a { color: var(--accent); }
</style>
<p>Loading Trenchers… <a href="site.html">Open the site</a></p>
<script>location.replace("site.html");</script>
HTML
echo "preview files: $(find . -type f | wc -l)"
