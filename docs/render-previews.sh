#!/bin/sh
# Renders the README preview images with headless Chrome (macOS path by default).
# Usage from the repo root:  sh docs/render-previews.sh
set -e
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROFILE="$(mktemp -d)"
PORT=8774
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER; rm -rf "$PROFILE"' EXIT
sleep 1

shot() { # <output> <width,height> <query>
  "$CHROME" --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size="$2" \
    --virtual-time-budget=5000 --user-data-dir="$PROFILE" --screenshot="$1" \
    "http://127.0.0.1:$PORT/docs/preview.html?$3" 2>/dev/null
}

shot docs/preview.png    1064,560 "lang=en"
shot docs/preview-de.png 1064,560 "lang=de"
