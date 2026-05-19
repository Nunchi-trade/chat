export const CHAT_RELAY_PROTOCOL = '/nunchi-trade/chat-relay/1.0.0'

export function encodeRelayLine (topic, payload) {
  return JSON.stringify({ topic, payload }) + '\n'
}

export function decodeRelayLines (buffer, chunk, onMessage) {
  let buf = buffer + chunk
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx)
    buf = buf.slice(idx + 1)
    if (!line) {
      continue
    }
    try {
      const { topic, payload } = JSON.parse(line)
      if (topic && payload) {
        onMessage(topic, payload)
      }
    } catch {
      // ignore
    }
  }
  return buf
}
