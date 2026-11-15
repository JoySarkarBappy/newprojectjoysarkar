#!/usr/bin/env bash
# Builds dist/Srot-mac-arm64.zip (Apple Silicon). Works on Linux and on a Mac.
set -euo pipefail
cd "$(dirname "$0")/.."
ARCH="${1:-arm64}"
rm -rf dist
npx @electron/packager . Srot --platform=darwin --arch="$ARCH" --out=dist --overwrite \
  --icon=build/icon.icns \
  --app-bundle-id=app.srot.downloadmanager \
  --app-category-type=public.app-category.utilities \
  --app-copyright="Developed by Joy Sarkar and Dhrubo Das" \
  --prune=true --no-asar \
  --ignore='^/(test|docs|scripts|dist|build)($|/)' --ignore='^/\.gitignore$'
APP="dist/Srot-darwin-$ARCH/Srot.app"

# Apple Silicon refuses to start code without at least an ad-hoc signature.
if [ "$(uname)" = "Darwin" ]; then
  codesign --force --deep --sign - "$APP"
elif command -v "${RCODESIGN:-rcodesign}" >/dev/null 2>&1; then
  "${RCODESIGN:-rcodesign}" sign "$APP"
else
  echo "WARNING: no signing tool found; the app will need 'codesign --force --deep --sign -' on the Mac" >&2
fi

(cd "dist/Srot-darwin-$ARCH" && zip -qry "../Srot-mac-$ARCH.zip" Srot.app)
ls -lh "dist/Srot-mac-$ARCH.zip"
