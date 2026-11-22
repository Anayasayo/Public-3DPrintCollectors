#!/bin/bash
# 3DPrintCollectors launcher for macOS (what 3DPrintCollectors.app runs).
# Rebuilds the web app if its code changed, starts the local server in the background, opens the browser.
# The server stops by itself about 30 seconds after the last app tab closes, so every launch starts fresh.

cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
URL="http://127.0.0.1:5178"
LOG="$ROOT/data/server.log"
mkdir -p "$ROOT/data"

# Apps opened from Finder get a minimal PATH, so add the usual Node.js install locations.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.volta/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ] && ! command -v node >/dev/null 2>&1; then . "$HOME/.nvm/nvm.sh"; fi

alert() {
  /usr/bin/osascript -e "display dialog \"$1\" with title \"3DPrintCollectors\" buttons {\"OK\"} default button 1 with icon caution" >/dev/null 2>&1
}

if ! command -v node >/dev/null 2>&1; then
  alert "Node.js is not installed. Your browser will open nodejs.org — download the LTS installer, run it, then open 3DPrintCollectors again."
  open "https://nodejs.org/en/download"
  exit 1
fi

listening() { /usr/sbin/lsof -nP -iTCP:5178 -sTCP:LISTEN >/dev/null 2>&1; }

# Already running (e.g. reopened within 30 seconds of closing): just open a tab.
if listening; then open "$URL"; exit 0; fi

{
  echo "==== $(date) ===="
  if [ ! -d node_modules ]; then
    /usr/bin/osascript -e 'display notification "First start: installing, this takes a minute or two…" with title "3DPrintCollectors"'
    npm install || { alert "Installing failed. See data/server.log in the 3DPrintCollectors folder."; exit 1; }
    touch node_modules/.installed-on-this-mac
  fi
  # Rebuild when there is no build yet, or anything in web/src (or the web config) is newer than the last build.
  if [ ! -f web/dist/index.html ] || [ -n "$(find web/src web/index.html web/vite.config.* web/package.json -newer web/dist/index.html 2>/dev/null | head -1)" ]; then
    npm run build || { alert "Building the app failed. See data/server.log in the 3DPrintCollectors folder."; exit 1; }
  fi
} >>"$LOG" 2>&1 || exit 1

AUTO_SHUTDOWN=1 nohup npm run serve >>"$LOG" 2>&1 &

# Wait for the server before opening the browser (the first start also downloads the card catalog in the background).
for _ in $(seq 1 60); do
  if listening; then open "$URL"; exit 0; fi
  sleep 1
done
alert "3DPrintCollectors did not start. See data/server.log in the 3DPrintCollectors folder."
exit 1
