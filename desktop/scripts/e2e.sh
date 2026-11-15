#!/usr/bin/env bash
# Runs the real app window under a virtual display and checks the main UI flows. Linux only (needs xvfb-run).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-$(mktemp -d)}"
DATA="$(mktemp -d)"
mkdir -p "$OUT"
mkdir -p "$DATA/home/Downloads"
HOME="$DATA/home" XDG_DOWNLOAD_DIR="$DATA/home/Downloads" SROT_TEST=1 SROT_DATA_DIR="$DATA" SROT_SHOTS="$OUT" SROT_TEST_SCRIPT="$PWD/test/e2e-driver.js" \
  xvfb-run -a -s "-screen 0 1280x800x24" node_modules/electron/dist/electron --no-sandbox "${SROT_APP_DIR:-.}" 2>&1 | grep -E "^\[e2e\]|console (error|warning)|driver:|timed out|Error" || true
cat "$OUT/result.json"
grep -q '"ok": true' "$OUT/result.json"
