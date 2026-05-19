import { peerIdFromString } from '@libp2p/peer-id'
import { fromString } from 'uint8arrays'
import {
  CHAT_RELAY_PROTOCOL,
  decodeRelayLines,
  encodeRelayLine
} from './chat-protocol.js'

const installedHandlers = new WeakMap()

export class ChatRelay {
  constructor () {
    /** @type {import('@libp2p/interface').Stream | null} */
    this.stream = null
    /** @type {Map<string, Set<(payload: object) => void>>} */
    this.listeners = new Map()
    this.buffer = ''
    this.readTask = null
    /** @type {(() => void) | null} */
    this.onStreamReady = null
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

  /**
   * Circuit-relay connections are "limited" — browsers cannot dialProtocol.
   * Register an inbound handler; the bridge opens the stream to us.
   */
  async installInboundHandler (node, bridgePeerIdStr) {
    if (installedHandlers.get(node) === bridgePeerIdStr) {
      return
    }

    const bridgeId = peerIdFromString(bridgePeerIdStr)

    await node.handle(CHAT_RELAY_PROTOCOL, (stream, connection) => {
      if (!connection.remotePeer.equals(bridgeId)) {
        stream.abort(new Error('unexpected relay peer'))
        return
      }
      console.log('[nunchi] chat relay stream from bridge (inbound)')
      this.attachStream(stream)
      this.onStreamReady?.()
    }, {
      runOnLimitedConnection: true,
      maxInboundStreams: 4
    })

    installedHandlers.set(node, bridgePeerIdStr)
  }

  /**
   * Wait until the bridge opens a relay stream (after libp2p is connected to bridge).
   */
  async waitForStream ({ timeoutMs = 45_000 } = {}) {
    if (this.connected) {
      return
    }

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onStreamReady = null
        reject(new Error('Timed out waiting for chat relay stream from bridge'))
      }, timeoutMs)

      this.onStreamReady = () => {
        clearTimeout(timer)
        this.onStreamReady = null
        resolve()
      }

      if (this.connected) {
        clearTimeout(timer)
        this.onStreamReady = null
        resolve()
      }
    })
  }

  async connect (node, bridgePeerIdStr, options) {
    await this.installInboundHandler(node, bridgePeerIdStr)
    await this.waitForStream(options)
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
