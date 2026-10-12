#!/usr/bin/env bash
# Builds a static, server-free copy of the site with sample data, for a shareable preview.
# Server-only routes (API, metadata images, per-agent pages, the team console) are set aside for the build and put back.
set -euo pipefail
cd "$(dirname "$0")/.."
AWAY=$(mktemp -d)
restore() { for d in api agent meta testnet-meta launch; do [ -e "$AWAY/$d" ] && mv "$AWAY/$d" "app/$d"; done; rm -rf "$AWAY"; }
trap restore EXIT
for d in api agent meta testnet-meta launch; do [ -e "app/$d" ] && mv "app/$d" "$AWAY/$d"; done
rm -rf .next-preview out
PREVIEW_EXPORT=1 NEXT_PUBLIC_PREVIEW=1 npx next build
cp out/index.html out/site.html
# Fonts: the stylesheet points at ./_next/static/media from its own folder; point it at ../media instead.
sed -i 's#url(\./_next/static/media/#url(../media/#g; s#url(_next/static/media/#url(../media/#g' out/_next/static/css/*.css
# Only what the pages use: no page loads these in the preview, and RSC payloads aren't needed for plain links.
rm -rf out/video out/nft-hd; find out -name "*.txt" -delete
# Artifact hosting reserves top-level names starting with "_": serve Next's files from nx/ instead.
mv out/_next out/nx
grep -rlZ "_next/" out --include=*.html --include=*.js --include=*.css | xargs -0 sed -i 's#_next/#nx/#g'
# Artifact hosting refuses literal U+FFFD characters: write them as the \ufffd escape (they sit in JS strings).
python3 - <<'PY'
import os
for d,_,fs in os.walk('out'):
    for f in fs:
        if f.endswith(('.js','.html','.css','.json')):
            p=os.path.join(d,f); b=open(p,encoding='utf-8').read()
            if '\ufffd' in b: open(p,'w',encoding='utf-8').write(b.replace('\ufffd','\\ufffd'))
PY
find out -name "*.woff" -delete; rm -f out/index.html
echo "preview in web/out"
