#!/usr/bin/env bash
# Configure and start Kubo (IPFS) as a libp2p circuit relay with WebSocket for the chat app.
set -euo pipefail

if ! command -v ipfs >/dev/null; then
  echo "Install Kubo: pacman -S kubo"
  exit 1
fi

if [[ ! -d "${IPFS_PATH:-$HOME/.ipfs}" ]]; then
  ipfs init --profile=server
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
echo "Relay multiaddrs (use /ws for the chat app):"
ipfs id -f '<addrs>\n' 2>/dev/null | tr ',' '\n' | grep '/ws/' || true

if pgrep -x ipfs >/dev/null; then
  echo ""
  echo "ipfs daemon already running."
else
  echo ""
  echo "Start with: ipfs daemon"
fi
