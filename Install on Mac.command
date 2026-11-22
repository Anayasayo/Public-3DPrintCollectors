#!/bin/bash
# One-time Mac setup for 3DPrintCollectors: installs what the app needs and creates 3DPrintCollectors.app
# in your Applications folder. Run it again after moving this folder somewhere else.

cd "$(dirname "$0")" || exit 1
ROOT="$PWD"
APP_NAME="3DPrintCollectors"
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.volta/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ] && ! command -v node >/dev/null 2>&1; then . "$HOME/.nvm/nvm.sh"; fi

finish() { echo; read -r -p "Press Return to close this window." _; exit "${1:-0}"; }

echo "Setting up $APP_NAME from: $ROOT"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed yet."
  echo "Your browser will open nodejs.org: download the LTS installer (.pkg), run it,"
  echo "then double-click \"Install on Mac.command\" again."
  open "https://nodejs.org/en/download"
  finish 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js $(node -v) is too old - version 22 or newer is needed. Install the LTS version from nodejs.org, then run this again."
  open "https://nodejs.org/en/download"
  finish 1
fi
echo "Node.js $(node -v) found."

# Files unzipped from a download are flagged by macOS; clear that so the app starts without warnings.
xattr -dr com.apple.quarantine "$ROOT" 2>/dev/null
chmod +x "$ROOT/mac/launch.sh" "$ROOT/Install on Mac.command" 2>/dev/null

# node_modules copied from another computer holds that computer's native parts - start clean.
if [ -d node_modules ] && [ ! -f node_modules/.installed-on-this-mac ]; then rm -rf node_modules; fi
echo
echo "Installing (a minute or two)..."
npm install || { echo; echo "Install failed. If it mentions 'gyp' or 'xcode', run:  xcode-select --install  then try again."; finish 1; }
touch node_modules/.installed-on-this-mac
echo
echo "Building the app..."
npm run build || finish 1

# Create the .app: a small AppleScript app whose only job is to run mac/launch.sh from this folder.
# (An AppleScript app, not a bare shell script, so macOS can ask for access when this folder is in a
# protected place like Desktop or Documents - a bare script is silently refused.)
DEST="/Applications"
[ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
APP="$DEST/$APP_NAME.app"
rm -rf "$APP"
AS_ROOT="$(printf '%s' "$ROOT" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
SCRIPT_DIR="$(mktemp -d)"; SCRIPT="$SCRIPT_DIR/launcher.applescript"
cat > "$SCRIPT" <<APPLESCRIPT
on run
	set root to "$AS_ROOT"
	set launcher to root & "/mac/launch.sh"
	try
		do shell script "test -r " & quoted form of launcher
	on error
		display dialog "3DPrintCollectors can't open its folder:" & return & root & return & return & "If you moved the folder, double-click \"Install on Mac.command\" in its new location." & return & return & "If you clicked \"Don't Allow\" when asked about folder access, turn 3DPrintCollectors on in System Settings > Privacy & Security > Files & Folders." with title "3DPrintCollectors" buttons {"OK"} default button 1 with icon caution
		return
	end try
	try
		-- launch.sh shows its own message if something goes wrong.
		do shell script "/bin/bash " & quoted form of launcher
	end try
end run
APPLESCRIPT
osacompile -o "$APP" "$SCRIPT" || { echo "Could not create the app."; rm -rf "$SCRIPT_DIR"; finish 1; }
rm -rf "$SCRIPT_DIR"
touch "$APP"

echo
echo "Done! $APP_NAME is in $DEST."
echo "Open it from Launchpad/Applications (drag it to the Dock to keep it handy)."
echo "Your data is stored in: $ROOT/data"
open "$DEST"
finish 0
