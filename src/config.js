/** Shared gossipsub topic — everyone on this topic is in the same room. */
export const CHAT_TOPIC = 'nunchi-trade.chat.v1'

/**
 * Kubo (IPFS) circuit-relay + WebSocket on this host.
 * Override with VITE_RELAY_MULTIADDR (comma-separated) at build time.
 *
 * Local:  ipfs daemon with /tcp/4001/ws (see scripts/setup-kubo-relay.sh)
 * Public: /ip4/65.109.61.210/tcp/4001/ws/p2p/12D3KooWNZubK6JHJiPmMFXPKXqTax9g9fv7WvrFJ6mgVvhrufpS
 *
 * Note: GitHub Pages is HTTPS — browsers require wss:// unless you use npm run dev.
 */
const DEFAULT_RELAY =
  '/ip4/127.0.0.1/tcp/4001/ws/p2p/12D3KooWNZubK6JHJiPmMFXPKXqTax9g9fv7WvrFJ6mgVvhrufpS'

export const RELAY_MULTIADDRS = (import.meta.env.VITE_RELAY_MULTIADDR || DEFAULT_RELAY)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
