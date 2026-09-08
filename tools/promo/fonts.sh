#!/usr/bin/env bash
# The brand fonts ship as woff2, which PIL cannot open. Convert to ttf so the
# overlays use Luckiest Guy itself rather than a lookalike.
#   pip install fonttools brotli
set -e
OUT="${1:?usage: fonts.sh <out_dir>}"
mkdir -p "$OUT"
python3 - "$OUT" <<'PY'
import sys, pathlib
from fontTools.ttLib import TTFont
out = pathlib.Path(sys.argv[1])
for n in ['luckiest-guy-400', 'space-mono-700', 'space-mono-400']:
    f = TTFont(f'assets/fonts/{n}.woff2'); f.flavor = None
    f.save(out / f'{n}.ttf'); print(f'{n}.ttf')
PY
