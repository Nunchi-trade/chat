import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import { ChatRelay } from './chat-relay.js'
import {
  BRIDGE_PEER_ID,
  CHAT_TOPIC,
  PRESENCE_TOPIC,
  PRESENCE_TTL_MS,
  RELAY_MULTIADDRS
} from './config.js'

/** @type {Map<string, { peerId: string | null, dialError: string | null }>} */
const relayDialByAddr = new Map()
let bridgeDialError = null
let relayConnectError = null

/** @type {ChatRelay | null} */
let chatRelay = null

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

async function dialBridge (node) {
  if (!BRIDGE_PEER_ID) {
    return
  }
  bridgeDialError = null
  relayConnectError = null

  const kuboPeerId = RELAY_MULTIADDRS.map(peerIdFromRelayMultiaddr).find(Boolean)
  if (kuboPeerId) {
    try {
      await waitForRelayPeer(node, kuboPeerId)
      await waitMs(1500)
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
        bridgeDialError = null
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

async function connectChatRelay (node) {
  if (!BRIDGE_PEER_ID || !chatRelay) {
    return
  }
  try {
    await chatRelay.waitForStream({ timeoutMs: 45_000 })
    relayConnectError = null
    console.log('[nunchi] chat relay stream open')
  } catch (err) {
    relayConnectError = err instanceof Error ? err.message : String(err)
    console.warn('[nunchi] chat relay stream failed', err)
    void retryChatRelay(node)
  }
}

async function retryChatRelay (node) {
  if (!chatRelay || !BRIDGE_PEER_ID) {
    return
  }
  for (let i = 0; i < 12; i++) {
    await waitMs(5000)
    if (chatRelay?.connected) {
      return
    }
    if (!isBridgeConnected(node)) {
      continue
    }
    try {
      await chatRelay.waitForStream({ timeoutMs: 15_000 })
      relayConnectError = null
      console.log('[nunchi] chat relay stream open (retry)')
      return
    } catch (err) {
      relayConnectError = err instanceof Error ? err.message : String(err)
    }
  }
}

export async function createChatNode (libp2pPrivateKey) {
  relayDialByAddr.clear()
  bridgeDialError = null
  relayConnectError = null
  roomMembers.clear()
  chatRelay = new ChatRelay()

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
    services: {
      identify: identify()
    }
  })

  await node.start()

  if (BRIDGE_PEER_ID) {
    await chatRelay.installInboundHandler(node, BRIDGE_PEER_ID)
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

  await dialBridge(node)
  await connectChatRelay(node)

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

function publishViaRelay (topic, data) {
  if (!chatRelay?.connected) {
    console.warn(
      `[nunchi] cannot publish on ${topic} — relay stream not open`,
      getPubsubDebug()
    )
    throw new Error('Chat relay not connected')
  }
  chatRelay.publish(topic, data)
}

export function publishChatMessage (node, data) {
  publishViaRelay(CHAT_TOPIC, data)
}

export function publishPresenceMessage (node, data) {
  publishViaRelay(PRESENCE_TOPIC, data)
}

export function getPubsubDebug (node) {
  return {
    libp2pPeers: node ? node.getPeers().map((p) => p.toString()) : [],
    relayStreamOpen: chatRelay?.connected ?? false,
    bridgeConnected: node ? isBridgeConnected(node) : false,
    relayConnectError,
    bridgeDialError
  }
}

export function onPubsubMessage (_node, handler) {
  if (!chatRelay) {
    console.warn('[nunchi] onPubsubMessage called before relay ready')
    return
  }
  chatRelay.on(CHAT_TOPIC, (payload) => handler(CHAT_TOPIC, payload))
  chatRelay.on(PRESENCE_TOPIC, (payload) => handler(PRESENCE_TOPIC, payload))
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

export function isRelayStreamOpen () {
  return chatRelay?.connected ?? false
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
  const libp2pUp = isBridgeConnected(node)
  const streamUp = isRelayStreamOpen()
  const connected = libp2pUp && streamUp
  let dialError = null
  if (!libp2pUp) {
    dialError = bridgeDialError
  } else if (!streamUp) {
    dialError = relayConnectError ?? 'Chat relay stream not open'
  }
  return [{
    peerId: BRIDGE_PEER_ID,
    host: 'chat relay',
    connected,
    dialError
  }]
}

export function formatRelayLabel (status) {
  const shortId = status.peerId
    ? `${status.peerId.slice(0, 12)}…`
    : 'unknown'
  return `${status.host} · ${shortId}`
}
