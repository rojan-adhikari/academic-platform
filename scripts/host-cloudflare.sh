#!/usr/bin/env bash
# Put nerd online through a Cloudflare Tunnel. It is free and needs no router or firewall changes.
#   bash scripts/host-cloudflare.sh                    a random https://....trycloudflare.com link, no account needed
#   bash scripts/host-cloudflare.sh nerd.example.com   your own domain (free Cloudflare account; the domain's DNS must be on Cloudflare)
# nerd runs on this computer, so the site is online only while this window is open and the computer is awake.
# Ctrl+C stops it. Another port: PORT=3001 bash scripts/host-cloudflare.sh
# Windows: run it in Git Bash (Start menu > Git Bash). From PowerShell:
#   & "C:\Program Files\Git\bin\bash.exe" scripts/host-cloudflare.sh
if [ -z "${BASH_VERSION:-}" ]; then echo "Run this with bash: bash scripts/host-cloudflare.sh"; exit 1; fi
set -euo pipefail
cd "$(dirname -- "${BASH_SOURCE[0]:-$0}")"
[ -f server/index.js ] || cd ..
if [ ! -f server/index.js ] || [ ! -f package.json ]; then
  echo "Run this file from inside the nerd folder: bash scripts/host-cloudflare.sh"
  exit 1
fi
PORT="${PORT:-3000}"
HOST_NAME="${1:-}"; HOST_NAME="${HOST_NAME#*://}"; HOST_NAME="${HOST_NAME%%/*}"
TUNNEL_NAME="${TUNNEL_NAME:-nerd}"

# 1. Node.js 22.5 or newer (nerd uses Node's built-in SQLite)
if ! command -v node >/dev/null 2>&1; then
  if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "This is WSL (Linux inside Windows), which cannot use the Node.js installed in Windows. Run this from Git Bash instead, or install Node 22 inside WSL."
  else
    echo "Node.js is not found. Install Node 22 LTS from https://nodejs.org, then open a new terminal window and run this again."
  fi
  exit 1
fi
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 5) ? 0 : 1)'; then
  echo "nerd needs Node.js 22.5 or newer, and this computer has $(node -v). Install Node 22 LTS from https://nodejs.org."
  exit 1
fi

# 2. cloudflared, Cloudflare's tunnel program (downloaded once into your home folder; no admin rights needed)
find_cloudflared() {
  command -v cloudflared 2>/dev/null && return
  for f in "$HOME/.local/bin/cloudflared" "$HOME/bin/cloudflared.exe" /opt/homebrew/bin/cloudflared /usr/local/bin/cloudflared; do
    if [ -x "$f" ]; then echo "$f"; return; fi
  done
  return 1
}
download() {
  if command -v curl >/dev/null 2>&1; then curl -fSL --progress-bar -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -O "$2" "$1"
  else echo "Neither curl nor wget is installed. On Ubuntu or Debian run: sudo apt install curl"; return 1
  fi
}
CF="$(find_cloudflared || true)"
if [ -z "$CF" ]; then
  echo "Downloading cloudflared, Cloudflare's tunnel program..."
  RELEASES="https://github.com/cloudflare/cloudflared/releases/latest/download"
  DIR="$HOME/.local/bin"; DEST="$DIR/cloudflared"
  case "$(uname -s)" in
    Darwin) case "$(uname -m)" in arm64) FILE=cloudflared-darwin-arm64.tgz ;; *) FILE=cloudflared-darwin-amd64.tgz ;; esac ;;
    Linux)
      case "$(uname -m)" in
        x86_64|amd64) FILE=cloudflared-linux-amd64 ;; aarch64|arm64) FILE=cloudflared-linux-arm64 ;;
        armv7l|armv6l) FILE=cloudflared-linux-arm ;; i386|i686) FILE=cloudflared-linux-386 ;;
        *) echo "Unknown processor $(uname -m). Install cloudflared yourself: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; exit 1 ;;
      esac ;;
    MINGW*|MSYS*|CYGWIN*) FILE=cloudflared-windows-amd64.exe; DIR="$HOME/bin"; DEST="$DIR/cloudflared.exe" ;;
    *) echo "Install cloudflared yourself: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"; exit 1 ;;
  esac
  mkdir -p "$DIR"
  # Download under a temporary name, so a broken download is never mistaken for the program next time.
  if ! download "$RELEASES/$FILE" "$DEST.part"; then
    rm -f "$DEST.part"
    echo "Could not download cloudflared. Check the internet connection and run this again."
    exit 1
  fi
  case "$FILE" in
    *.tgz) tar -xzf "$DEST.part" -C "$DIR" cloudflared; rm -f "$DEST.part" ;;
    *) mv -f "$DEST.part" "$DEST" ;;
  esac
  chmod +x "$DEST"
  CF="$DEST"
fi

# 3. Start nerd (the first start creates the demo database, which takes a few seconds)
answering() { node -e 'const r = require("http").get({ host: "localhost", port: +process.argv[1], path: "/", timeout: 2000 }, () => process.exit(0)); r.on("error", () => process.exit(1)); r.on("timeout", () => process.exit(1));' "$PORT"; }
if answering; then
  echo "Something is already running on port $PORT. Stop it, or pick another port: PORT=3001 bash scripts/host-cloudflare.sh"
  exit 1
fi
PORT="$PORT" node --experimental-sqlite --no-warnings server/index.js &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
trap 'exit 130' INT TERM HUP
tries=0
until answering; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "nerd stopped while starting. See the error above."; exit 1; fi
  tries=$((tries + 1))
  if [ "$tries" -gt 120 ]; then echo "nerd did not start within two minutes."; exit 1; fi
  sleep 1
done
# A Mac that falls asleep takes nerd offline, so keep it awake while this runs (closing a laptop's lid still sleeps it).
if [ "$(uname -s)" = Darwin ] && command -v caffeinate >/dev/null 2>&1; then caffeinate -i -w $$ & fi
echo
echo "nerd is running on http://localhost:$PORT."
echo "Every demo account (students, teachers and admins) uses the password 123456, and the site says so,"
echo "so anyone with the link can sign in as an admin. Share it only with people you trust, and press Ctrl+C when the demo is over."
echo

# 4. Open the tunnel
if [ -z "$HOST_NAME" ]; then
  echo "Asking Cloudflare for a link. It appears below in a few seconds."
  # http2 instead of QUIC: many college and office networks block QUIC, and quick links do not fall back by themselves.
  if ! "$CF" tunnel --no-autoupdate --protocol http2 --grace-period 2s --url "http://localhost:$PORT" 2>&1 | while IFS= read -r line; do
    url="$(printf '%s\n' "$line" | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | grep -v '^https://api\.trycloudflare\.com$' || true)"
    if [ -n "$url" ]; then
      printf '\n  nerd is online at %s\n  Share that link. Keep this window (and a laptop lid) open; Ctrl+C stops it.\n' "$url"
      printf '  Quick links cannot stream live updates, so new notifications show up within a minute instead of instantly.\n\n'
    elif ! printf '%s\n' "$line" | grep -qE '^[0-9-]+T[0-9:.]+Z (INF|WRN|DBG) '; then
      printf '%s\n' "$line"
    fi
  done; then
    echo "Cloudflare did not open the tunnel (the reason is above). Check the internet connection, wait a minute and run this again."
    exit 1
  fi
else
  CF_HOME="$HOME/.cloudflared"
  if [ ! -f "$CF_HOME/cert.pem" ]; then
    echo "A browser window opens: sign in to Cloudflare and choose the domain for $HOST_NAME."
    "$CF" tunnel login
  fi
  tunnel_id() {
    local list
    if ! list="$("$CF" tunnel list)"; then
      echo "cloudflared could not list your tunnels (the reason is above). Check the internet connection, or delete $CF_HOME/cert.pem and run this again to sign in again." >&2
      return 1
    fi
    printf '%s\n' "$list" | awk -v n="$TUNNEL_NAME" '$2 == n && id == "" { id = $1 } END { print id }'
  }
  ID="$(tunnel_id)" || exit 1
  if [ -z "$ID" ]; then "$CF" tunnel create "$TUNNEL_NAME"; ID="$(tunnel_id)" || exit 1; fi
  if [ -z "$ID" ]; then echo "Could not create the Cloudflare tunnel \"$TUNNEL_NAME\"."; exit 1; fi
  CREDS="$CF_HOME/$ID.json"
  # The tunnel was made on another computer: fetch its key for this one.
  if [ ! -f "$CREDS" ]; then "$CF" tunnel token --cred-file "$CREDS" "$TUNNEL_NAME"; fi
  if ! "$CF" tunnel route dns "$TUNNEL_NAME" "$HOST_NAME"; then
    echo "Cloudflare could not point $HOST_NAME at the tunnel (the reason is above). If $HOST_NAME already has a DNS record,"
    echo "delete it in the Cloudflare dashboard (your domain > DNS > Records) and run this again."
    exit 1
  fi
  if command -v cygpath >/dev/null 2>&1; then CREDS="$(cygpath -m "$CREDS")"; fi
  mkdir -p .cloudflared
  cat > .cloudflared/config.yml <<YAML
tunnel: $ID
credentials-file: $CREDS
ingress:
  - hostname: $HOST_NAME
    service: http://localhost:$PORT
  - service: http_status:404
YAML
  printf '\n  nerd is going online at https://%s\n  Keep this window (and a laptop lid) open; Ctrl+C stops it.\n\n' "$HOST_NAME"
  "$CF" tunnel --no-autoupdate --grace-period 2s --config .cloudflared/config.yml run "$TUNNEL_NAME"
fi
