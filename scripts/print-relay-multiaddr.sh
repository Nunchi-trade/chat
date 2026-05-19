#!/usr/bin/env bash
# Print Kubo Secure WebSocket multiaddr(s) for the chat app build.
set -euo pipefail

if ! command -v ipfs >/dev/null; then
  echo "ipfs not found" >&2
  exit 1
fi

mapfile -t TLS < <(ipfs id 2>/dev/null | jq -r '.Addresses[]' | grep '/tls/ws' || true)

if [[ ${#TLS[@]} -eq 0 ]]; then
  echo "No /tls/ws address yet. Ensure AutoTLS is on and plain /ws is not in Addresses.Swarm." >&2
  echo "  ipfs config AutoTLS.Enabled" >&2
  echo "  systemctl restart ipfs && sleep 30 && $0" >&2
  exit 1
fi

# Prefer dns4 for browsers
PRIMARY=""
for a in "${TLS[@]}"; do
  if [[ "$a" == /dns4/* ]]; then
    PRIMARY="$a"
    break
  fi
done
PRIMARY="${PRIMARY:-${TLS[0]}}"

echo "$PRIMARY"
echo ""
echo "Set in GitHub → Settings → Variables → VITE_RELAY_MULTIADDR"
echo "Or in .env:"
echo "VITE_RELAY_MULTIADDR=$PRIMARY"
