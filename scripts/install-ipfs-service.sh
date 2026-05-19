#!/usr/bin/env bash
# Install and enable systemd service for Kubo (runs as root, IPFS_PATH=/root/.ipfs).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_SRC="$ROOT/systemd/ipfs.service"
UNIT_DST="/etc/systemd/system/ipfs.service"
AUTOTLS_SRC="$ROOT/systemd/ipfs.service.d/autotls.conf"
AUTOTLS_DST="/etc/systemd/system/ipfs.service.d/autotls.conf"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0"
  exit 1
fi

if ! command -v ipfs >/dev/null; then
  echo "Install Kubo first: pacman -S kubo"
  exit 1
fi

install -Dm644 "$UNIT_SRC" "$UNIT_DST"
systemctl daemon-reload
systemctl enable ipfs.service
systemctl restart ipfs.service

echo ""
systemctl --no-pager status ipfs.service
echo ""
echo "Kubo will start automatically on boot."
echo "Logs: journalctl -u ipfs -f"
