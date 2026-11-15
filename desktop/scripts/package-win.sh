#!/usr/bin/env bash
# Builds dist/Srot-windows-x64.zip: a folder you unzip anywhere and run Srot.exe from. Works on Linux, macOS and Windows (Git Bash).
set -euo pipefail
cd "$(dirname "$0")/.."
ARCH="${1:-x64}"
rm -rf "dist/Srot-win32-$ARCH" "dist/Srot-windows-$ARCH.zip"
npx @electron/packager . Srot --platform=win32 --arch="$ARCH" --out=dist --overwrite \
  --icon=build/icon.ico \
  --app-copyright="Developed by Joy Sarkar and Dhrubo Das" \
  --win32metadata.CompanyName="Joy Sarkar and Dhrubo Das" \
  --win32metadata.FileDescription="Srot Download Manager" \
  --win32metadata.ProductName="Srot" \
  --prune=true --no-asar ${ELECTRON_ZIP_DIR:+--electron-zip-dir="$ELECTRON_ZIP_DIR"} \
  --ignore='^/(test|docs|scripts|dist|build)($|/)' --ignore='^/\.gitignore$'
rm -rf "dist/Srot" && mv "dist/Srot-win32-$ARCH" "dist/Srot"
(cd dist && zip -qr "Srot-windows-$ARCH.zip" Srot)
mv "dist/Srot" "dist/Srot-win32-$ARCH"
ls -lh "dist/Srot-windows-$ARCH.zip"
