#!/usr/bin/env bash
# export/chapter-html.sh — render ONE reading unit of an adopter's LaTeX to a SELF-CONTAINED
# reflowed HTML FRAGMENT for the Footnote reviewer's reading surface. Document-agnostic:
# reuses preprocess.py (flatten \input, expand \gls, resolve \cref, rasterize figures) +
# shim.tex, then pandoc -> HTML5 with KaTeX math, embedded figure images (data URIs), and
# numbered IEEE citations. Also emits the paragraph->source map for the direct editor.
#
#   SOURCE_DIR=<latex_repo> CHAPTERS_JSON=<id>/chapters.json \
#     ./export/chapter-html.sh <unit_id> [out.html]
#
# Environment:
#   SOURCE_DIR     root of the adopter's LaTeX source (required)
#   CHAPTERS_JSON  parsed unit manifest (default: chapters.json)
#   RENDER_ENTRY   main entry .tex for numbering/order (default: main.tex)
#   BUILD_DIR      scratch dir (default: <SOURCE_DIR>/.render-build)
set -euo pipefail

EXPORT_DIR="$(cd "$(dirname "$0")" && pwd)"          # holds preprocess.py, shim.tex, ieee.csl
: "${SOURCE_DIR:?set SOURCE_DIR to the adopter LaTeX source root}"
SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"
command -v pandoc >/dev/null 2>&1 || { echo "pandoc not found"; exit 1; }

UNIT="${1:?usage: chapter-html.sh <unit_id> [out.html]}"
BUILD="${BUILD_DIR:-$SOURCE_DIR/.render-build}"; mkdir -p "$BUILD"; BUILD="$(cd "$BUILD" && pwd)"
OUT="${2:-$BUILD/$UNIT.html}"
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"   # absolute (pandoc runs from SOURCE_DIR)

export SOURCE_DIR BUILD_DIR="$BUILD"
export CHAPTERS_JSON="${CHAPTERS_JSON:-chapters.json}"
export RENDER_ENTRY="${RENDER_ENTRY:-main.tex}"

# preprocess -> cleaned .tex, then prepend the shim (+ the adopter's own math macros if present)
python3 "$EXPORT_DIR/preprocess.py" "$UNIT" > "$BUILD/$UNIT.pre.tex"
MACROS=""
for m in "$SOURCE_DIR/preamble/macros.tex" "$SOURCE_DIR/macros.tex"; do
  [ -f "$m" ] && { MACROS="$m"; break; }
done
cat "$EXPORT_DIR/shim.tex" ${MACROS:+"$MACROS"} "$BUILD/$UNIT.pre.tex" > "$BUILD/$UNIT.full.tex"

# bibliography + CSL are optional (a doc may have no references.bib)
BIB=(); [ -f "$SOURCE_DIR/references.bib" ] && BIB=(--citeproc --bibliography=references.bib)
CSL=(); [ -f "$EXPORT_DIR/ieee.csl" ] && CSL=(--csl="$EXPORT_DIR/ieee.csl")

# Emit a FRAGMENT (no --standalone): the reviewer app supplies page chrome, typography, and
# KaTeX auto-render. Math stays as \(...\); figures embed as data URIs. Run from SOURCE_DIR so
# figures / references.bib / resource-path resolve against the adopter's own tree. (Everything
# below uses absolute paths, so we do not need to cd back.)
cd "$SOURCE_DIR"
pandoc "$BUILD/$UNIT.full.tex" \
    --from=latex --to=html5 \
    --katex \
    ${BIB[@]+"${BIB[@]}"} ${CSL[@]+"${CSL[@]}"} \
    --resource-path=".:figures:$BUILD" \
    --embed-resources --section-divs \
    -o "$OUT"
SIZE="$(du -h "$OUT" | cut -f1)"
echo "wrote $OUT [$SIZE]"

# paragraph -> source map for the reviewer's in-context direct editor (best-effort alignment)
python3 "$EXPORT_DIR/srcmap.py" "$UNIT" "$BUILD/$UNIT.full.tex" "$OUT" "${OUT%.html}.srcmap.json" \
  || echo "  (srcmap skipped)"
