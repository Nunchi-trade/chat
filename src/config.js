/** Shared gossipsub topic — everyone on this topic is in the same room. */
export const CHAT_TOPIC = 'nunchi-trade.chat.v1'

/**
 * Circuit-relay WebSocket multiaddrs (comma-separated in VITE_RELAY_MULTIADDR).
 * Browsers need a public relay; deploy relay/ and set this at build time.
 */
export const RELAY_MULTIADDRS = (import.meta.env.VITE_RELAY_MULTIADDR ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
