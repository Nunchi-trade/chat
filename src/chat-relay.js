import { peerIdFromString } from '@libp2p/peer-id'
import { fromString } from 'uint8arrays'
import {
  CHAT_RELAY_PROTOCOL,
  decodeRelayLines,
  encodeRelayLine
} from './chat-protocol.js'

export class ChatRelay {
  constructor () {
    /** @type {import('@libp2p/interface').Stream | null} */
    this.stream = null
    /** @type {Map<string, Set<(payload: object) => void>>} */
    this.listeners = new Map()
    this.buffer = ''
    this.readTask = null
  }

  get connected () {
    return this.stream != null && this.stream.status === 'open'
  }

  on (topic, handler) {
    if (!this.listeners.has(topic)) {
      this.listeners.set(topic, new Set())
    }
    this.listeners.get(topic).add(handler)
    return () => this.listeners.get(topic)?.delete(handler)
  }

  dispatch (topic, payload) {
    const handlers = this.listeners.get(topic)
    if (!handlers) {
      return
    }
    for (const fn of handlers) {
      fn(payload)
    }
  }

  async connect (node, bridgePeerIdStr, { timeoutMs = 30_000 } = {}) {
    const peerId = peerIdFromString(bridgePeerIdStr)
    const deadline = Date.now() + timeoutMs
    let lastError = null

    while (Date.now() < deadline) {
      try {
        if (!node.getPeers().some((p) => p.equals(peerId))) {
          throw new Error('libp2p not connected to bridge')
        }
        const stream = await node.dialProtocol(peerId, CHAT_RELAY_PROTOCOL)
        this.attachStream(stream)
        return
      } catch (err) {
        lastError = err
        await new Promise((r) => setTimeout(r, 1000))
      }
    }

    throw lastError ?? new Error('Chat relay stream not ready')
  }

  attachStream (stream) {
    if (this.stream) {
      try {
        this.stream.abort(new Error('replaced'))
      } catch {
        // ignore
      }
    }
    this.stream = stream
    this.buffer = ''
    this.readTask = this.readLoop(stream)
  }

  async readLoop (stream) {
    try {
      for await (const chunk of stream) {
        const text = typeof chunk === 'string'
          ? chunk
          : new TextDecoder().decode(chunk.subarray ? chunk.subarray() : chunk)
        this.buffer = decodeRelayLines(this.buffer, text, (topic, payload) => {
          this.dispatch(topic, payload)
        })
      }
    } catch (err) {
      if (this.stream === stream) {
        console.warn('[nunchi] chat relay read ended', err)
        this.stream = null
      }
    }
  }

  publish (topic, payload) {
    if (!this.stream || this.stream.status !== 'open') {
      throw new Error('Chat relay stream not open')
    }
    const line = encodeRelayLine(topic, payload)
    const ok = this.stream.send(fromString(line))
    if (!ok) {
      console.warn('[nunchi] chat relay send buffer full')
    }
  }
}
