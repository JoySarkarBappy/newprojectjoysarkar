#!/usr/bin/env bash
# Unlocks Srot's Android signing key for this build. The key is kept encrypted in signing/srot.jks.enc;
# its password exists only in the repository secret SROT_SIGNING_PASSWORD.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${SROT_SIGNING_PASSWORD:-}" ]; then
  if [ "${REQUIRE_SIGNING:-0}" = "1" ]; then
    echo "::error::Add the SROT_SIGNING_PASSWORD secret (Settings > Secrets and variables > Actions) before making a release."
    exit 1
  fi
  echo "::warning::SROT_SIGNING_PASSWORD is not set, so this build is signed with a temporary key."
  exit 0
fi
out="${RUNNER_TEMP:-/tmp}/srot.jks"
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in signing/srot.jks.enc -out "$out" -pass env:SROT_SIGNING_PASSWORD 2>/dev/null; then
  echo "::error::SROT_SIGNING_PASSWORD does not unlock signing/srot.jks.enc. Check the secret was pasted exactly."
  exit 1
fi
echo "SROT_KEYSTORE=$out" >> "$GITHUB_ENV"
echo "Signing key unlocked."
