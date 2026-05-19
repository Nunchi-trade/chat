#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0"
  exit 1
fi

cd "$ROOT/bridge"
npm install

if [[ ! -f peer.id ]]; then
  timeout 5 node bridge.mjs || true
  pkill -f "bridge/bridge.mjs" 2>/dev/null || true
fi

if [[ ! -f peer.id ]]; then
  echo "Could not generate bridge peer.id" >&2
  exit 1
fi

BRIDGE_ID="$(cat peer.id)"
echo "Bridge peer id: $BRIDGE_ID"

sed "s|/root/chat|$ROOT|g" "$ROOT/systemd/chat-bridge.service" > /etc/systemd/system/chat-bridge.service
systemctl daemon-reload
systemctl enable --now chat-bridge.service

echo ""
echo "Add to GitHub variable VITE_BRIDGE_PEER_ID=$BRIDGE_ID"
echo "Then redeploy GitHub Pages."
