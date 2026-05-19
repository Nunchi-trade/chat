#!/usr/bin/env bash
# Configure Kubo (IPFS) as a libp2p circuit relay with WebSocket for the chat app.
# Applies the server profile (disables mDNS) — recommended on Hetzner/public VPS.
set -euo pipefail

if ! command -v ipfs >/dev/null; then
  echo "Install Kubo: pacman -S kubo"
  exit 1
fi

export IPFS_PATH="${IPFS_PATH:-$HOME/.ipfs}"

if [[ ! -d "$IPFS_PATH" ]]; then
  ipfs init --profile=server
else
  echo "Applying server profile (disables local mDNS discovery)…"
  ipfs config profile apply server
fi

ipfs config --json Addresses.Swarm '[
  "/ip4/0.0.0.0/tcp/4001",
  "/ip4/0.0.0.0/tcp/4001/ws",
  "/ip6/::/tcp/4001",
  "/ip6/::/tcp/4001/ws",
  "/ip4/0.0.0.0/udp/4001/quic-v1",
  "/ip4/0.0.0.0/udp/4001/quic-v1/webtransport",
  "/ip6/::/udp/4001/quic-v1",
  "/ip6/::/udp/4001/quic-v1/webtransport"
]'

ipfs config Swarm.RelayService.Enabled --json true
ipfs config Swarm.Transports.Network.Websocket --json true
ipfs config --json Swarm.AddrFilters '[]'

echo ""
echo "Discovery.MDNS.Enabled=$(ipfs config Discovery.MDNS.Enabled)"
echo ""
echo "Relay multiaddrs (use /ws for the chat app):"
ipfs id -f '<addrs>\n' 2>/dev/null | tr ',' '\n' | grep '/ws/' || echo "  (start daemon first: systemctl start ipfs)"

if systemctl is-enabled ipfs.service &>/dev/null; then
  echo ""
  echo "systemd: ipfs.service is enabled (starts on boot)."
elif [[ -f /etc/systemd/system/ipfs.service ]]; then
  echo ""
  echo "Enable on boot: sudo systemctl enable --now ipfs"
else
  echo ""
  echo "Install systemd unit: sudo ./scripts/install-ipfs-service.sh"
fi
