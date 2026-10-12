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
echo "preview in web/out"
