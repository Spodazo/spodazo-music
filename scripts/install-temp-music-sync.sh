#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
TSX="$ROOT/node_modules/tsx/dist/cli.mjs"
HOME_DIR="${HOME:?}"
SUPPORT="$HOME_DIR/Library/Application Support/Spodazo Music"
LOG_DIR="$HOME_DIR/Library/Logs/Spodazo Music"
FOLDER="$SUPPORT/Temp Music"
DESKTOP_LINK="$HOME_DIR/Desktop/Temp Music"
CONFIG="$SUPPORT/temp-music.json"
PLIST="$HOME_DIR/Library/LaunchAgents/com.spodazo.temp-music-sync.plist"
LABEL="com.spodazo.temp-music-sync"

if [[ ! -f "$TSX" ]]; then
  echo "Install dependencies in $ROOT first (npm install)." >&2
  exit 1
fi

mkdir -p "$FOLDER" "$SUPPORT" "$LOG_DIR" "$HOME_DIR/Library/LaunchAgents"
if [[ -L "$DESKTOP_LINK" ]]; then
  ln -sfn "$FOLDER" "$DESKTOP_LINK"
elif [[ -d "$DESKTOP_LINK" ]]; then
  find "$DESKTOP_LINK" -mindepth 1 -maxdepth 1 -exec mv {} "$FOLDER" \;
  rmdir "$DESKTOP_LINK"
  ln -s "$FOLDER" "$DESKTOP_LINK"
elif [[ ! -e "$DESKTOP_LINK" ]]; then
  ln -s "$FOLDER" "$DESKTOP_LINK"
fi
TOKEN="$(cd "$ROOT" && "$NODE" "$TSX" -e 'import { tempMusicSyncToken } from "./server/tempMusic.ts"; process.stdout.write(tempMusicSyncToken())')"
API="${TEMP_MUSIC_API:-http://127.0.0.1:3000}"

"$NODE" -e '
const fs = require("fs");
const config = {
  api: process.argv[1],
  folder: process.argv[2],
  token: process.argv[3],
};
fs.writeFileSync(process.argv[4], JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(process.argv[4], 0o600);
' "$API" "$FOLDER" "$TOKEN" "$CONFIG"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>--import</string>
    <string>tsx</string>
    <string>${ROOT}/script/temp-music-sync.ts</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>TEMP_MUSIC_CONFIG</key>
    <string>${CONFIG}</string>
    <key>TEMP_MUSIC_LOG</key>
    <string>${LOG_DIR}/temp-music-sync.log</string>
    <key>HOME</key>
    <string>${HOME_DIR}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/temp-music-sync.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/temp-music-sync.log</string>
</dict>
</plist>
EOF

UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1 || true
if ! launchctl bootstrap "gui/${UID_NUM}" "$PLIST" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1 || true
fi
sleep 0.2
pgrep -f "script/temp-music-sync.ts" | while read -r pid; do
  kill -9 "$pid" >/dev/null 2>&1 || true
done
launchctl kickstart -k "gui/${UID_NUM}/${LABEL}" >/dev/null 2>&1 || true
echo "Temp Music folder: $DESKTOP_LINK"
echo "Syncing to: $API"
