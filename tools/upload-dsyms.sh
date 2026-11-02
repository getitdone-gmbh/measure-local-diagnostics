#!/bin/bash
#
# upload-dsyms.sh — Uploads the dSYMs of one Xcode archive to the diagnostics app.
#
# Usage: tools/upload-dsyms.sh <path/to/App.xcarchive>
# Settings: DIAGNOSTICS_API_URL, DIAGNOSTICS_UPLOAD_TOKEN, optional DIAGNOSTICS_BUNDLE_ID_PATTERN (shell pattern, default all)
#

set -euo pipefail

ARCHIVE="${1:?Usage: $0 <path/to/archive.xcarchive>}"
STATE_DIR="${HOME}/Library/Application Support/measure-local-diagnostics"
# Written by install-archive-watcher.sh; variables already set in the environment win
if [ -f "${STATE_DIR}/config" ]; then . "${STATE_DIR}/config"; fi
API_URL="${DIAGNOSTICS_API_URL:?set DIAGNOSTICS_API_URL to the API base URL}"
PATTERN="${DIAGNOSTICS_BUNDLE_ID_PATTERN:-*}"
UPLOADED="${STATE_DIR}/uploaded-archives.txt"
mkdir -p "$STATE_DIR"
touch "$UPLOADED"

INFO="${ARCHIVE}/Info.plist"
if [ ! -f "$INFO" ] || [ ! -d "${ARCHIVE}/dSYMs" ]; then
  echo "skip: ${ARCHIVE} is not a finished archive with dSYMs"
  exit 0
fi

read_plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$INFO" 2>/dev/null || true; }
BUNDLE_ID=$(read_plist ApplicationProperties:CFBundleIdentifier)
VERSION=$(read_plist ApplicationProperties:CFBundleShortVersionString)
BUILD=$(read_plist ApplicationProperties:CFBundleVersion)
CREATED=$(plutil -extract CreationDate raw -o - "$INFO" 2>/dev/null || true)
NAME=$(basename "$ARCHIVE" .xcarchive)

# shellcheck disable=SC2254
case "$BUNDLE_ID" in
  $PATTERN) ;;
  *) echo "skip: ${NAME} does not match ${PATTERN} (${BUNDLE_ID:-no bundle id})"; exit 0 ;;
esac

KEY="${BUNDLE_ID}|${VERSION}|${BUILD}|${CREATED}"
if grep -qxF "$KEY" "$UPLOADED"; then
  echo "skip: ${NAME} already uploaded"
  exit 0
fi

TOKEN="${DIAGNOSTICS_UPLOAD_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "error: no upload token (set DIAGNOSTICS_UPLOAD_TOKEN)"
  exit 1
fi

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
(cd "$ARCHIVE" && zip -qr "${WORK_DIR}/dsyms.zip" dSYMs)

RESPONSE="${WORK_DIR}/response.json"
STATUS=$(curl -sS -o "$RESPONSE" -w '%{http_code}' --max-time 600 \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "file=@${WORK_DIR}/dsyms.zip;type=application/zip" \
  -F "app_version=${VERSION}" -F "app_build=${BUILD}" -F "bundle_id=${BUNDLE_ID}" \
  -F "archived_at=${CREATED}" -F "archive_name=${NAME}" \
  "${API_URL}/api/symbols")

if [ "$STATUS" != "200" ]; then
  echo "error: upload of ${NAME} failed with HTTP ${STATUS}: $(head -c 300 "$RESPONSE")"
  exit 1
fi
echo "$KEY" >> "$UPLOADED"
echo "ok: ${NAME} (${VERSION} build ${BUILD}) uploaded, $(grep -o '"debug_id"' "$RESPONSE" | wc -l | tr -d ' ') binaries"
