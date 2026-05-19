/**
 * Gossipsub bridge on localhost — browsers reach it via Kubo circuit relay.
 * Kubo does not forward custom pubsub topics; this node keeps the chat mesh alive.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'
import { webSockets } from '@libp2p/websockets'
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { createLibp2p } from 'libp2p'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CHAT_TOPIC = 'nunchi-trade.chat.v1'
const DISCOVERY_TOPICS = [
  '_peer-discovery._p2p._pubsub',
  'nunchi-trade._peer-discovery._p2p._pubsub'
]
const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 4002)
const KEY_FILE = join(__dirname, 'peer.key')
const ID_FILE = join(__dirname, 'peer.id')

async function loadOrCreateKey () {
  if (existsSync(KEY_FILE)) {
    return privateKeyFromProtobuf(readFileSync(KEY_FILE))
  }
  const key = await generateKeyPair('Ed25519')
  writeFileSync(KEY_FILE, privateKeyToProtobuf(key))
  return key
}

const privateKey = await loadOrCreateKey()
const peerId = await peerIdFromPrivateKey(privateKey)
writeFileSync(ID_FILE, peerId.toString())

const node = await createLibp2p({
  privateKey,
  addresses: {
    listen: [`/ip4/${HOST}/tcp/${PORT}/ws`]
  },
  transports: [webSockets()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    identify: identify(),
    pubsub: gossipsub({
      allowPublishToZeroTopicPeers: true,
      emitSelf: false
    })
  }
})

await node.start()

for (const topic of [CHAT_TOPIC, ...DISCOVERY_TOPICS]) {
  await node.services.pubsub.subscribe(topic)
  console.log('subscribed:', topic)
}

node.services.pubsub.addEventListener('message', (evt) => {
  if (evt.detail.topic === CHAT_TOPIC) {
    console.log('chat message on mesh from', evt.detail.from?.toString?.() ?? '?')
  }
})

console.log('Pubsub bridge peer id:', peerId.toString())
console.log('Listening:')
for (const ma of node.getMultiaddrs()) {
  console.log(' ', ma.toString())
}
console.log('\nSet VITE_BRIDGE_PEER_ID=' + peerId.toString())
