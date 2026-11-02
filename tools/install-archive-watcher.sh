#!/bin/bash
#
# install-archive-watcher.sh — Installs (or removes with --uninstall) the local LaunchAgent that uploads dSYMs of new Xcode archives.
#
# Nothing is added to any app repository or Xcode project; everything lives in the user's Library.
#

set -euo pipefail

LABEL="com.getitdone.measure-local-diagnostics.archive-watcher"
TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/Library/Application Support/measure-local-diagnostics"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG="${HOME}/Library/Logs/measure-local-diagnostics-archive-watcher.log"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$PLIST" "${INSTALL_DIR}/archive-watcher" "${INSTALL_DIR}/upload-dsyms.sh" "${INSTALL_DIR}/config"
  echo "removed ${LABEL}"
  exit 0
fi

: "${DIAGNOSTICS_API_URL:?set DIAGNOSTICS_API_URL to the API base URL}"
: "${DIAGNOSTICS_UPLOAD_TOKEN:?set DIAGNOSTICS_UPLOAD_TOKEN to the symbols upload token}"

mkdir -p "$INSTALL_DIR" "${HOME}/Library/LaunchAgents"
# LaunchAgents start without the shell environment, so the settings go into a file only the user can read
CONFIG="${INSTALL_DIR}/config"
(umask 077 && {
  printf '[ -n "${DIAGNOSTICS_API_URL:-}" ] || DIAGNOSTICS_API_URL=%q\n' "$DIAGNOSTICS_API_URL"
  printf '[ -n "${DIAGNOSTICS_UPLOAD_TOKEN:-}" ] || DIAGNOSTICS_UPLOAD_TOKEN=%q\n' "$DIAGNOSTICS_UPLOAD_TOKEN"
  printf '[ -n "${DIAGNOSTICS_BUNDLE_ID_PATTERN:-}" ] || DIAGNOSTICS_BUNDLE_ID_PATTERN=%q\n' "${DIAGNOSTICS_BUNDLE_ID_PATTERN:-*}"
} > "$CONFIG")
swiftc -O "${TOOLS_DIR}/archive-watcher.swift" -o "${INSTALL_DIR}/archive-watcher"
cp "${TOOLS_DIR}/upload-dsyms.sh" "${INSTALL_DIR}/upload-dsyms.sh"
chmod +x "${INSTALL_DIR}/upload-dsyms.sh"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_DIR}/archive-watcher</string>
    <string>${INSTALL_DIR}/upload-dsyms.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed ${LABEL}, log: ${LOG}"
