#!/bin/sh
# Installs the latest Caramel desktop release into /Applications (or ~/Applications).
#
#   curl -fsSL https://raw.githubusercontent.com/KatalKavya96/CaramelAI/main/scripts/install-desktop.sh | sh
#
# Files that curl downloads carry no quarantine flag, so Gatekeeper does not block the app the way it
# blocks a .dmg opened from a browser. That also means nothing checks the app for you: you are trusting
# this script and the GitHub release it downloads, over HTTPS.
set -eu

REPO="KatalKavya96/CaramelAI"
FEED="${CARAMEL_FEED:-https://github.com/$REPO/releases/latest/download/latest.json}"

fail() { echo "caramel: $*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "the desktop app is macOS only. On Linux, run it from source: see the README."
major=$(sw_vers -productVersion | cut -d. -f1)
[ "$major" -ge 13 ] || fail "Caramel needs macOS 13 or later (this Mac has $(sw_vers -productVersion))."

# The updater feed names the current version and its app archive; reading it avoids the GitHub API's
# rate limit and needs no JSON tool. A universal build lists the same archive for both chips.
feed=$(curl -fsSL "$FEED") || fail "could not reach $FEED. Is there a published release yet?"
version=$(printf '%s' "$feed" | sed -n 's/.*"version" *: *"\([^"]*\)".*/\1/p' | head -n 1)
url=$(printf '%s' "$feed" | grep -o '"url" *: *"[^"]*"' | head -n 1 | sed 's/.*"\(https[^"]*\)"/\1/')
[ -n "$url" ] || fail "the release feed lists no download."

if [ -w /Applications ]; then target=/Applications; else target="$HOME/Applications"; mkdir -p "$target"; fi
app="$target/Caramel.app"

if pgrep -qf "$app/Contents/MacOS/"; then fail "Caramel is running. Quit it, then run this again."; fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
echo "Downloading Caramel $version..."
curl -fL --progress-bar "$url" -o "$work/Caramel.app.tar.gz" || fail "download failed: $url"
tar -xzf "$work/Caramel.app.tar.gz" -C "$work"
[ -d "$work/Caramel.app" ] || fail "the archive did not contain Caramel.app."

rm -rf "$app"
mv "$work/Caramel.app" "$app"
echo "Installed Caramel $version in $app"

# Caramel clones and patches repositories with git. On a fresh Mac, /usr/bin/git is a stub that
# asks to install the command line tools, so say so now rather than on the first run.
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Caramel needs git. Run: xcode-select --install"
fi

open "$app"
