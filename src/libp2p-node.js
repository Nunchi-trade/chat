import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { floodsub } from '@libp2p/floodsub'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import { fromString, toString } from 'uint8arrays'
import {
  BRIDGE_PEER_ID,
  CHAT_TOPIC,
  DISCOVERY_TOPICS,
  PRESENCE_TOPIC,
  PRESENCE_TTL_MS,
  RELAY_MULTIADDRS
} from './config.js'

/** @type {Map<string, { peerId: string | null, dialError: string | null }>} */
const relayDialByAddr = new Map()
let bridgeDialError = null

/** @type {Map<string, { displayName: string, lastSeen: number }>} */
const roomMembers = new Map()
let presenceTimer = null
let onRoomChange = null

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
  if (dns) {
    return dns.includes('.libp2p.direct') ? 'libp2p.direct (WSS)' : dns
  }
  const dns6 = addr.match(/\/dns6\/([^/]+)/)?.[1]
  if (dns6) return 'libp2p.direct (WSS)'
  return 'relay'
}

export function infrastructurePeerIds () {
  const ids = new Set(
    RELAY_MULTIADDRS.map(peerIdFromRelayMultiaddr).filter(Boolean)
  )
  if (BRIDGE_PEER_ID) {
    ids.add(BRIDGE_PEER_ID)
  }
  return ids
}

function prunePresence () {
  const now = Date.now()
  for (const [id, entry] of roomMembers) {
    if (now - entry.lastSeen > PRESENCE_TTL_MS) {
      roomMembers.delete(id)
    }
  }
}

function notifyRoomChange () {
  if (onRoomChange) {
    onRoomChange(getRoomOccupancy())
  }
}

export function recordPresence (envelope) {
  if (envelope.type !== 'presence') {
    return
  }
  const infra = infrastructurePeerIds()
  if (infra.has(envelope.peerId)) {
    return
  }
  roomMembers.set(envelope.peerId, {
    displayName: envelope.displayName ?? envelope.peerId.slice(0, 8),
    lastSeen: envelope.timestamp ?? Date.now()
  })
  prunePresence()
  notifyRoomChange()
}

export function getRoomOccupancy (selfPeerId) {
  prunePresence()
  const infra = infrastructurePeerIds()
  const members = []
  for (const [peerId, info] of roomMembers) {
    if (peerId === selfPeerId || infra.has(peerId)) {
      continue
    }
    members.push({ peerId, displayName: info.displayName })
  }
  return {
    count: members.length + 1,
    others: members
  }
}

export function setOnRoomChange (fn) {
  onRoomChange = fn
}

async function waitMs (ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForRelayPeer (node, relayPeerId, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (node.getPeers().some((p) => p.toString() === relayPeerId)) {
      return
    }
    await waitMs(500)
  }
  throw new Error('Timed out waiting for Kubo relay connection')
}

async function waitForPubsubPeer (pubsub, peerIdStr, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = [...pubsub.peers.keys()].some((p) => p.toString() === peerIdStr)
    if (found) {
      return
    }
    await waitMs(400)
  }
  throw new Error('Pubsub stream to peer not ready')
}

/** Re-announce topic subscriptions to all floodsub peers (e.g. after bridge connects). */
function resyncPubsubSubscriptions (pubsub) {
  for (const topic of pubsub.getTopics()) {
    pubsub.unsubscribe(topic)
    pubsub.subscribe(topic)
  }
}

async function dialPubsubBridge (node) {
  if (!BRIDGE_PEER_ID) {
    return
  }
  bridgeDialError = null
  const pubsub = node.services.pubsub

  const kuboPeerId = RELAY_MULTIADDRS.map(peerIdFromRelayMultiaddr).find(Boolean)
  if (kuboPeerId) {
    try {
      await waitForRelayPeer(node, kuboPeerId)
      await waitMs(2000)
    } catch (err) {
      bridgeDialError = err instanceof Error ? err.message : String(err)
      return
    }
  }

  for (const relayAddr of RELAY_MULTIADDRS) {
    const circuitAddr = `${relayAddr}/p2p-circuit/p2p/${BRIDGE_PEER_ID}`
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await node.dial(multiaddr(circuitAddr))
        try {
          await waitForPubsubPeer(pubsub, BRIDGE_PEER_ID)
          resyncPubsubSubscriptions(pubsub)
        } catch (err) {
          bridgeDialError = err instanceof Error ? err.message : String(err)
          console.warn('Bridge libp2p connected but floodsub not ready', err)
        }
        return
      } catch (err) {
        bridgeDialError = err instanceof Error ? err.message : String(err)
        console.warn(
          `Bridge dial attempt ${attempt + 1}/5 failed`,
          circuitAddr,
          err
        )
        await waitMs(2000)
      }
    }
  }
}

function dialDiscoveredPeer (node, detail) {
  if (detail.id.toString() === node.peerId.toString()) {
    return
  }
  const infra = infrastructurePeerIds()
  if (infra.has(detail.id.toString())) {
    return
  }
  for (const ma of detail.multiaddrs) {
    void node.dial(ma).catch(() => {})
  }
}

async function dialChatSubscribers (node) {
  const pubsub = node.services.pubsub
  const self = node.peerId.toString()
  const infra = infrastructurePeerIds()
  for (const peerId of pubsub.getSubscribers(CHAT_TOPIC)) {
    const id = peerId.toString()
    if (id === self || infra.has(id)) {
      continue
    }
    if (node.getPeers().some((p) => p.toString() === id)) {
      continue
    }
    try {
      await node.dial(peerId)
    } catch {
      // peer may need circuit/webrtc path
    }
  }
}

export async function createChatNode (libp2pPrivateKey) {
  relayDialByAddr.clear()
  bridgeDialError = null
  roomMembers.clear()

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
        interval: 3_000,
        topics: DISCOVERY_TOPICS
      })
    ],
    services: {
      identify: identify(),
      pubsub: floodsub()
    }
  })

  node.addEventListener('peer:discovery', (evt) => {
    dialDiscoveredPeer(node, evt.detail)
  })

  await node.start()

  for (const topic of [CHAT_TOPIC, PRESENCE_TOPIC, ...DISCOVERY_TOPICS]) {
    await node.services.pubsub.subscribe(topic)
  }

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

  await dialPubsubBridge(node)

  setInterval(() => {
    void dialChatSubscribers(node)
  }, 5_000)

  return node
}

export function startPresenceLoop (node, publishPresence) {
  stopPresenceLoop()
  presenceTimer = setInterval(() => {
    void publishPresence().catch((err) => {
      console.warn('presence publish failed', err)
    })
  }, 4_000)
  void publishPresence().catch(() => {})
}

export function stopPresenceLoop () {
  if (presenceTimer) {
    clearInterval(presenceTimer)
    presenceTimer = null
  }
  roomMembers.clear()
}

async function publishWithDiagnostics (node, topic, data) {
  const pubsub = node.services.pubsub
  const bytes = fromString(JSON.stringify(data))
  const result = await pubsub.publish(topic, bytes)
  if (result.recipients.length === 0) {
    console.warn(
      `[nunchi] publish on ${topic} reached 0 floodsub peers`,
      getPubsubDebug(node)
    )
  }
  return result
}

export function publishChatMessage (node, data) {
  return publishWithDiagnostics(node, CHAT_TOPIC, data)
}

export function publishPresenceMessage (node, data) {
  return publishWithDiagnostics(node, PRESENCE_TOPIC, data)
}

export function getPubsubDebug (node) {
  const pubsub = node.services.pubsub
  const peerStr = (p) => p.toString()
  return {
    libp2pPeers: node.getPeers().map(peerStr),
    floodsubPeers: [...pubsub.peers.keys()].map(peerStr),
    topics: pubsub.getTopics(),
    chatSubscribers: pubsub.getSubscribers(CHAT_TOPIC).map(peerStr),
    presenceSubscribers: pubsub.getSubscribers(PRESENCE_TOPIC).map(peerStr),
    bridgeConnected: isBridgeConnected(node),
    bridgeInFloodsub: BRIDGE_PEER_ID
      ? [...pubsub.peers.keys()].some((p) => p.toString() === BRIDGE_PEER_ID)
      : false
  }
}

export function onPubsubMessage (node, handler) {
  node.services.pubsub.addEventListener('message', (event) => {
    const topic = event.detail.topic
    if (topic !== CHAT_TOPIC && topic !== PRESENCE_TOPIC) {
      return
    }
    try {
      const data = JSON.parse(toString(event.detail.data))
      handler(topic, data)
    } catch {
      // ignore malformed
    }
  })
}

export function getConnectedPeerCount (node) {
  return node.getPeers().length
}

export function getChatPeerCount (node) {
  const infra = infrastructurePeerIds()
  return node.getPeers().filter((p) => !infra.has(p.toString())).length
}

export function isBridgeConnected (node) {
  if (!BRIDGE_PEER_ID) {
    return false
  }
  return node.getPeers().some((p) => p.toString() === BRIDGE_PEER_ID)
}

export function getRelayConfigured () {
  return RELAY_MULTIADDRS.length > 0
}

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

export function getBridgeStatuses (node) {
  if (!BRIDGE_PEER_ID) {
    return []
  }
  const connected = isBridgeConnected(node)
  return [{
    peerId: BRIDGE_PEER_ID,
    host: 'pubsub bridge',
    connected,
    dialError: connected ? null : bridgeDialError
  }]
}

export function formatRelayLabel (status) {
  const shortId = status.peerId
    ? `${status.peerId.slice(0, 12)}…`
    : 'unknown'
  return `${status.host} · ${shortId}`
}
