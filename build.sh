#!/bin/sh
# Bygger två varianter av samma app till dist/:
#   homedash_<version>.ipk        ritar ovanpå TV-bilden (notiser, fäst kamera, snabbmeny). Fönstertyp "overlay".
#   homedash-store_<version>.ipk  vanligt fönster, för LG Content Store om överlagring inte godkänns där.
set -e
cd "$(dirname "$0")"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' app/appinfo.json)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p dist && rm -f dist/*.ipk

ares-package --no-minify app service -o "$tmp/full" >/dev/null
mv "$tmp"/full/*.ipk "dist/homedash_$version.ipk"

cp -r app service "$tmp/"
sed -i '/"defaultWindowType"/d; /"transparent"/d' "$tmp/app/appinfo.json"
echo 'const OVERLAY_WINDOW = false;' > "$tmp/app/variant.js"
ares-package --no-minify "$tmp/app" "$tmp/service" -o "$tmp/store" >/dev/null
mv "$tmp"/store/*.ipk "dist/homedash-store_$version.ipk"
ls -1 dist
