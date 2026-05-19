/** Shared gossipsub topic — everyone on this topic is in the same room. */
export const CHAT_TOPIC = 'nunchi-trade.chat.v1'

/**
 * Kubo circuit-relay via Secure WebSocket (AutoTLS / libp2p.direct).
 * Override with VITE_RELAY_MULTIADDR (comma-separated) at build time.
 */
const DEFAULT_RELAY =
  '/dns4/65-109-61-210.k51qzi5uqu5dkwksb8xnr82xwgj3dkcamvv8j326fjh3nww1y88ka7rx2lh407.libp2p.direct/tcp/4001/tls/ws/p2p/12D3KooWNZubK6JHJiPmMFXPKXqTax9g9fv7WvrFJ6mgVvhrufpS'

function parseRelayList (raw) {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Prefer TLS/WSS relays when the page is served over HTTPS (e.g. GitHub Pages). */
function selectRelays (addrs) {
  if (typeof location !== 'undefined' && location.protocol === 'https:') {
    const secure = addrs.filter((a) => a.includes('/tls/') || a.includes('/wss'))
    if (secure.length > 0) {
      return secure
    }
  }
  return addrs
}

const configured = parseRelayList(
  import.meta.env.VITE_RELAY_MULTIADDR || DEFAULT_RELAY
)

export const RELAY_MULTIADDRS = selectRelays(configured)
