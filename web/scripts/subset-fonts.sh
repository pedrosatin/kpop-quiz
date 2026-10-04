#!/usr/bin/env bash
# Regenerates the self-hosted Latin subsets from the upstream variable fonts.
# Requires fonttools and brotli: pip install fonttools brotli
# Usage: scripts/subset-fonts.sh <NotoSans[wdth,wght].ttf|woff2> <SpaceGrotesk[wght].ttf|woff2>
set -euo pipefail

noto_src=$1
grotesk_src=$2
out=$(dirname "$0")/../public/fonts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Google Fonts "latin" range plus Latin Extended-A for romanized names. UI
# symbols are listed too; pyftsubset keeps only the ones the upstream font has.
unicodes="U+0000-00FF,U+0100-017F,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+2229,U+22EE,U+2460-2463,U+25A0-25A1,U+2713,U+2715,U+2717,U+FEFF,U+FFFD"

# The CSS never changes font-stretch, so the width axis is pinned at 100.
fonttools varLib.instancer "$noto_src" wdth=100 -o "$tmp/noto.ttf" -q
pyftsubset "$tmp/noto.ttf" --unicodes="$unicodes" --layout-features='*' --flavor=woff2 \
  --output-file="$out/noto-sans/NotoSans-latin-wght.woff2"
pyftsubset "$grotesk_src" --unicodes="$unicodes" --layout-features='*' --flavor=woff2 \
  --output-file="$out/space-grotesk/SpaceGrotesk-latin-wght.woff2"
