#!/usr/bin/env bash
# Configure Kubo (IPFS) as a libp2p circuit relay with Secure WebSocket (AutoTLS).
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

# TCP only — do NOT add plain /ws here or AutoTLS will not enable Secure WebSocket.
ipfs config --json Addresses.Swarm '[
  "/ip4/0.0.0.0/tcp/4001",
  "/ip6/::/tcp/4001",
  "/ip4/0.0.0.0/udp/4001/quic-v1",
  "/ip4/0.0.0.0/udp/4001/quic-v1/webtransport",
  "/ip6/::/udp/4001/quic-v1",
  "/ip6/::/udp/4001/quic-v1/webtransport"
]'

ipfs config AutoTLS.Enabled --json true
ipfs config AutoTLS.AutoWSS --json true
ipfs config Swarm.RelayService.Enabled --json true
ipfs config Swarm.Transports.Network.Websocket --json true
ipfs config --json Swarm.AddrFilters '[]'

echo ""
echo "Discovery.MDNS.Enabled=$(ipfs config Discovery.MDNS.Enabled)"
echo ""
echo "After 'systemctl restart ipfs', wait ~1 min for AutoTLS, then run:"
echo "  ./scripts/print-relay-multiaddr.sh"
echo ""
echo "Use the /tls/ws multiaddr for VITE_RELAY_MULTIADDR (required for GitHub Pages)."

if systemctl is-enabled ipfs.service &>/dev/null; then
  echo ""
  echo "systemd: ipfs.service is enabled (starts on boot)."
fi
