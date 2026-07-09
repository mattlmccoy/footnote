#!/usr/bin/env bash
# export/export-chapter.sh — export ONE unit to .docx for offline review (generic, document-agnostic).
#
#   SOURCE_DIR=<latex_repo> CHAPTERS_JSON=<id>/chapters.json ./export/export-chapter.sh <unit_id> [out.docx]
#
# The same preprocess.py + shim.tex the HTML reader uses, but pandoc --to=docx. Master (source repo)
# stays the single source of truth; this is a one-way export. Optional citations/reference styling are
# picked up when present; nothing is hardcoded. PDF export is intentionally NOT part of this pipeline.
#
# Env:
#   SOURCE_DIR      the LaTeX source tree (required)
#   CHAPTERS_JSON   parsed unit manifest (default: chapters.json)
#   BUILD_DIR       scratch dir (default: <SOURCE_DIR>/.export-build)
#   BIB             bibliography .bib to cite against (optional)
#   REFERENCE_DOC   a pandoc reference .docx for styling (optional)
set -euo pipefail
command -v pandoc >/dev/null 2>&1 || { echo "pandoc not found" >&2; exit 1; }
UNIT="${1:?usage: export-chapter.sh <unit_id> [out.docx]}"
HERE="$(cd "$(dirname "$0")" && pwd)"
: "${SOURCE_DIR:?SOURCE_DIR required}"
BUILD="${BUILD_DIR:-$SOURCE_DIR/.export-build}"
mkdir -p "$BUILD"
OUT="${2:-$BUILD/$UNIT.docx}"
export CHAPTERS_JSON="${CHAPTERS_JSON:-chapters.json}"
cd "$SOURCE_DIR"

python3 "$HERE/preprocess.py" "$UNIT" > "$BUILD/$UNIT.pre.tex"
MACROS=""; [ -f "$SOURCE_DIR/preamble/macros.tex" ] && MACROS="$SOURCE_DIR/preamble/macros.tex"
cat "$HERE/shim.tex" ${MACROS:+"$MACROS"} "$BUILD/$UNIT.pre.tex" > "$BUILD/$UNIT.full.tex"

args=(--from=latex --to=docx --resource-path=".:figures:$BUILD")
if [ -n "${BIB:-}" ] && [ -f "$BIB" ]; then args+=(--citeproc --bibliography="$BIB"); fi
[ -f "$HERE/ieee.csl" ] && args+=(--csl="$HERE/ieee.csl")
if [ -n "${REFERENCE_DOC:-}" ] && [ -f "$REFERENCE_DOC" ]; then args+=(--reference-doc="$REFERENCE_DOC"); fi

pandoc "$BUILD/$UNIT.full.tex" "${args[@]}" -o "$OUT"
echo "$OUT"
