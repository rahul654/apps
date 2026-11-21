#!/usr/bin/env bash
# One-time setup (Linux) so the API Client's "Start proxy" / "Stop proxy" buttons work.
#
# A web page can't start programs. Instead, this registers an `apiclient-proxy://` link type with
# the desktop (like zoommtg:// for Zoom). The Start button opens apiclient-proxy://start; the
# browser asks once whether to open it ("Open xdg-open?", tick "Always allow"), and this machine
# starts the proxy in the background. Stop uses the proxy's own /shutdown endpoint, or
# apiclient-proxy://stop.
#
#   bash install-launcher.sh               install or update (port 4399)
#   bash install-launcher.sh --port 4400   use another port (set the same URL on the Proxy page)
#   bash install-launcher.sh --uninstall   stop the proxy and remove everything this installed
#   curl -fsSL <app>/install-launcher.sh | APICLIENT_URL=<app> bash    without downloading first
#
# Installs into ~/.local/share/apiclient-proxy/ (proxy script, launcher, logs/) and
# ~/.local/share/applications/apiclient-proxy-launcher.desktop. Nothing needs sudo.
set -euo pipefail

APP_URL="${APICLIENT_URL:-https://rahul654.github.io/apps/apiclient}"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DIR="$DATA/apiclient-proxy"
APPS="$DATA/applications"
DESKTOP_NAME="apiclient-proxy-launcher.desktop"
SCHEME="x-scheme-handler/apiclient-proxy"
PORT=4399
MODE=install

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="${2:-}"; shift 2 ;;
    --uninstall) MODE=uninstall; shift ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$PORT" in ''|*[!0-9]*) echo "--port needs a number" >&2; exit 2 ;; esac

if [ "$(uname -s)" != "Linux" ]; then
  echo "This launcher is for Linux desktops. On macOS/Windows run the proxy in a terminal: node apiclient-proxy.mjs" >&2
  exit 1
fi

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Node.js 18+ is needed (https://nodejs.org). Install it and run this again." >&2
  exit 1
fi
NODE="$(readlink -f "$NODE")" # the browser launches us without your shell's PATH (nvm etc.)
if ! "$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'; then
  echo "Node.js 18+ is needed; found $("$NODE" --version)." >&2
  exit 1
fi

stop_running() {
  local port="$1"
  "$NODE" -e "fetch('http://127.0.0.1:$port/shutdown',{method:'POST',headers:{origin:'http://localhost'}}).then(()=>{},()=>{})" || true
}

if [ "$MODE" = uninstall ]; then
  if [ -f "$DIR/port" ]; then stop_running "$(cat "$DIR/port")"; fi
  rm -f "$APPS/$DESKTOP_NAME"
  rm -rf "$DIR"
  command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true
  echo "Removed the API Client proxy launcher."
  exit 0
fi

mkdir -p "$DIR/logs" "$APPS"

# The proxy script: next to this installer (repo checkout or downloaded together), else from the
# app's site. When piped (curl … | bash) there is no script file, so always download.
SELF="${BASH_SOURCE[0]:-}"
HERE=""
if [ -n "$SELF" ] && [ -f "$SELF" ]; then HERE="$(cd "$(dirname "$SELF")" && pwd)"; fi
if [ -n "$HERE" ] && [ -f "$HERE/apiclient-proxy.mjs" ]; then
  cp "$HERE/apiclient-proxy.mjs" "$DIR/apiclient-proxy.mjs"
elif command -v curl >/dev/null; then
  curl -fsSL "$APP_URL/apiclient-proxy.mjs" -o "$DIR/apiclient-proxy.mjs"
elif command -v wget >/dev/null; then
  wget -qO "$DIR/apiclient-proxy.mjs" "$APP_URL/apiclient-proxy.mjs"
else
  echo "Couldn't find apiclient-proxy.mjs next to this script, and neither curl nor wget is installed." >&2
  exit 1
fi
"$NODE" --check "$DIR/apiclient-proxy.mjs"
echo "$PORT" > "$DIR/port"

# The handler the desktop runs for apiclient-proxy:// links. It accepts exactly "start" and "stop";
# anything else in the link is ignored, so a link can never pass arguments to a shell.
cat > "$DIR/launch.sh" <<LAUNCH
#!/usr/bin/env bash
set -u
NODE='$NODE'
DIR='$DIR'
PORT='$PORT'
LAUNCH
cat >> "$DIR/launch.sh" <<'LAUNCH'
LOG="$DIR/logs/launcher.log"
link="${1:-}"
cmd="${link#apiclient-proxy://}"
cmd="${cmd%%[/?#]*}"
running() {
  "$NODE" -e "fetch('http://127.0.0.1:$PORT/ping',{headers:{origin:'http://localhost'}}).then(r=>r.json()).then(j=>process.exit(j.name==='apiclient-proxy'?0:1),()=>process.exit(1))"
}
case "$cmd" in
  start)
    if running; then
      echo "$(date -Is) start: already running" >> "$LOG"
    else
      setsid "$NODE" "$DIR/apiclient-proxy.mjs" --port "$PORT" >> "$DIR/logs/proxy.log" 2>&1 < /dev/null &
      echo "$(date -Is) start: pid $!" >> "$LOG"
    fi
    ;;
  stop)
    "$NODE" -e "fetch('http://127.0.0.1:$PORT/shutdown',{method:'POST',headers:{origin:'http://localhost'}}).then(()=>{},()=>{})"
    echo "$(date -Is) stop" >> "$LOG"
    ;;
  *)
    echo "$(date -Is) ignored link: $link" >> "$LOG"
    ;;
esac
LAUNCH
chmod +x "$DIR/launch.sh"

cat > "$APPS/$DESKTOP_NAME" <<DESKTOP
[Desktop Entry]
Type=Application
Name=API Client proxy launcher
Comment=Starts and stops the API Client local proxy for apiclient-proxy:// links
Exec="$DIR/launch.sh" %u
Terminal=false
NoDisplay=true
MimeType=$SCHEME;
DESKTOP

command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true
if command -v xdg-mime >/dev/null; then
  xdg-mime default "$DESKTOP_NAME" "$SCHEME"
else
  echo "xdg-mime not found; the browser may not know about apiclient-proxy:// links." >&2
fi

echo "Installed the API Client proxy launcher (port $PORT)."
echo "  Proxy script: $DIR/apiclient-proxy.mjs"
echo "  Logs:         $DIR/logs/"
echo "Now click \"Start proxy\" on the API Client's Proxy page. The first time, the browser asks"
echo "to open xdg-open: tick \"Always allow\" and click Open."
