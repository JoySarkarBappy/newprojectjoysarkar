#!/usr/bin/env bash
# Installs Srot on the emulator and uses it like a person: share links, pick a quality, download.
set -u
APK="$1"
OUT="$2"
PKG=app.srot.android
mkdir -p "$OUT"
FAILED=()
WARN=()
ui() { python3 ci/ui.py "$@"; }
shot() { sleep 1; adb exec-out screencap -p > "$OUT/$1.png"; echo "[ci] screenshot $1"; }
keep_log() { adb logcat -d >> "$OUT/logcat.txt"; adb logcat -d -s Srot:V >> "$OUT/srot-log.txt"; adb logcat -c; }
back() { adb shell input keyevent KEYCODE_BACK; sleep 1; }
share() { keep_log; adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT "'$1'" -n $PKG/.MainActivity >/dev/null; }

adb logcat -c
adb install -r -g "$APK" || { echo "[ci] install failed"; exit 1; }
adb shell am start -W -n $PKG/.MainActivity
ui wait-log "engine ready" 300 "engine failed" || FAILED+=("engine did not start")
ui wait-log "engine update status" 180 "engine update failed" || WARN+=("yt-dlp self-update did not finish")
shot 01-home

# Theme switch from the home screen
ui tap "Switch to dark mode" 20 && shot 02-home-dark && ui tap "Switch to light mode" 20
keep_log

# 1. A plain file link (PDF), shared into Srot
share "https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf"
if ui tap-prefix "Download PDF" 90; then
  ui wait-log "download done" 120 "download failed" || FAILED+=("PDF download")
else
  FAILED+=("PDF link was not read")
fi
shot 03-after-pdf
back
keep_log

# 2. A YouTube video at the default (best) quality: needs QuickJS and ffmpeg to merge
share "https://www.youtube.com/watch?v=jNQXAC9IVRw"
if ui wait-log "analyze ok" 180 "analyze failed"; then
  shot 04-quality-picker
  ui tap-prefix "Download " 20
  ui wait-log "download done" 240 "download failed" || FAILED+=("YouTube video download")
  keep_log
  # 3. Same video as MP3
  share "https://www.youtube.com/watch?v=jNQXAC9IVRw"
  if ui wait-log "analyze ok" 180 "analyze failed"; then
    ui tap "MP3" 20 && ui tap "Download MP3" 20
    ui wait-log "download done" 240 "download failed" || FAILED+=("YouTube MP3 download")
  fi
else
  # GitHub's servers are often asked to sign in by YouTube; that is not something a phone sees.
  shot 04-youtube-refused
  WARN+=("YouTube refused this test server (see srot-log.txt)")
  back
  # Vimeo instead, to still exercise a real video site (video + sound joined by ffmpeg).
  share "https://vimeo.com/56015672"
  if ui wait-log "analyze ok" 120 "analyze failed"; then
    shot 04b-vimeo-picker
    ui tap-prefix "Download " 20
    ui wait-log "download done" 240 "download failed" || WARN+=("Vimeo video download")
  else
    WARN+=("Vimeo refused this test server too")
    back
  fi
fi
keep_log

# 3b. MP3 from a short video with sound (needs ffmpeg and ffprobe), hosted on GitHub so it is never blocked.
share "https://raw.githubusercontent.com/mediaelement/mediaelement-files/master/big_buck_bunny.mp4"
if ui tap "MP3" 60 && ui tap "Download MP3" 20; then
  ui wait-log "download done.*\\.mp3" 180 "download failed" || FAILED+=("MP3 from a video (ffmpeg)")
else
  FAILED+=("MP4 link offered no MP3")
fi
back

# 3c. A real video site that does not block test servers: archive.org. Srot must find the finished file itself.
share "https://archive.org/details/Cops1922"
if ui wait-log "analyze ok" 120 "analyze failed"; then
  shot 04c-archive-picker
  ui tap-prefix "Download " 20
  ui wait-log "download done.*Cops1922" 300 "download failed" || FAILED+=("archive.org video")
else
  WARN+=("archive.org could not be read")
  back
fi

# 4. Pause and resume a large file
share "https://github.com/electron/electron/releases/download/v45.3.0/electron-v45.3.0-linux-x64.zip"
if ui tap-prefix "Download ZIP" 90; then
  sleep 3
  ui tap "Downloads" 10
  if ui tap "Pause" 15; then
    sleep 2
    shot 05-paused
    ui wait-text "Resume" 15 || FAILED+=("pause did not show Resume")
    ui tap "Resume" 15
    ui wait-log "download done" 300 "download failed" || FAILED+=("resumed download")
  else
    WARN+=("large file finished before it could be paused")
  fi
else
  FAILED+=("ZIP link was not read")
fi
ui tap "Downloads" 10
shot 06-downloads
ui tap "Settings" 10
shot 07-settings
keep_log

adb shell ls -l /sdcard/Download/Srot/ | tee "$OUT/files.txt"
if adb logcat -d -b crash | grep -q "$PKG"; then FAILED+=("app crashed"); fi
adb logcat -d -b crash > "$OUT/crash.txt"

echo "---- Srot log ----"
grep -E "engine|analyze|download (start|done|failed)" "$OUT/srot-log.txt" | cut -c1-400
echo "----"
for w in "${WARN[@]+"${WARN[@]}"}"; do echo "[ci] WARNING: $w"; done
if [ ${#FAILED[@]} -gt 0 ]; then
  for f in "${FAILED[@]}"; do echo "[ci] FAILED: $f"; done
  exit 1
fi
echo "[ci] all checks passed"
