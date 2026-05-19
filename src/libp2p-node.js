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

export async function createChatNode (libp2pPrivateKey) {
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
    try {
      await node.dial(multiaddr(addr))
    } catch (err) {
      console.warn('Failed to dial relay', addr, err)
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
