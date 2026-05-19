import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import { fromString, toString } from 'uint8arrays'
import { CHAT_TOPIC, RELAY_MULTIADDRS } from './config.js'

/** @type {Map<string, { peerId: string | null, dialError: string | null }>} */
const relayDialByAddr = new Map()

function peerIdFromRelayMultiaddr (addr) {
  const match = addr.match(/\/p2p\/([^/]+)$/i)
  return match ? match[1] : null
}

function hostFromRelayMultiaddr (addr) {
  const ip4 = addr.match(/\/ip4\/([^/]+)/)?.[1]
  if (ip4) return ip4
  const ip6 = addr.match(/\/ip6\/([^/]+)/)?.[1]
  if (ip6) return ip6
  const dns = addr.match(/\/dns4\/([^/]+)/)?.[1]
  if (dns) return dns
  return 'relay'
}

export async function createChatNode (libp2pPrivateKey) {
  relayDialByAddr.clear()

  const node = await createLibp2p({
    privateKey: libp2pPrivateKey,
    addresses: {
      listen: ['/p2p-circuit', '/webrtc']
    },
    transports: [
      webSockets(),
      webRTC(),
      circuitRelayTransport()
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionGater: {
      denyDialMultiaddr: () => false
    },
    peerDiscovery: [
      pubsubPeerDiscovery({
        interval: 10_000
      })
    ],
    services: {
      identify: identify(),
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true
      })
    }
  })

  await node.start()

  for (const addr of RELAY_MULTIADDRS) {
    const peerId = peerIdFromRelayMultiaddr(addr)
    relayDialByAddr.set(addr, { peerId, dialError: null })
    try {
      await node.dial(multiaddr(addr))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('Failed to dial relay', addr, err)
      relayDialByAddr.set(addr, { peerId, dialError: message })
    }
  }

  await node.services.pubsub.subscribe(CHAT_TOPIC)

  return node
}

export function publishChatMessage (node, data) {
  return node.services.pubsub.publish(CHAT_TOPIC, fromString(JSON.stringify(data)))
}

export function onChatMessage (node, handler) {
  node.services.pubsub.addEventListener('message', (event) => {
    if (event.detail.topic !== CHAT_TOPIC) {
      return
    }
    try {
      const data = JSON.parse(toString(event.detail.data))
      handler(data)
    } catch {
      // ignore malformed
    }
  })
}

export function getConnectedPeerCount (node) {
  return node.getPeers().length
}

export function getRelayConfigured () {
  return RELAY_MULTIADDRS.length > 0
}

/** Per-relay dial + live connection state for the UI. */
export function getRelayStatuses (node) {
  const connectedPeers = new Set(node.getPeers().map((p) => p.toString()))

  return RELAY_MULTIADDRS.map((addr) => {
    const peerId = peerIdFromRelayMultiaddr(addr)
    const dial = relayDialByAddr.get(addr)
    const connected = peerId ? connectedPeers.has(peerId) : false
    return {
      multiaddr: addr,
      host: hostFromRelayMultiaddr(addr),
      peerId,
      connected,
      dialError: dial?.dialError ?? null
    }
  })
}

export function formatRelayLabel (status) {
  const shortId = status.peerId
    ? `${status.peerId.slice(0, 12)}…`
    : 'unknown'
  return `${status.host} · ${shortId}`
}
