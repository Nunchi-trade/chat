/**
 * Floodsub bridge — browsers reach it via Kubo circuit relay (reservation on Kubo).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { floodsub } from '@libp2p/floodsub'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { createLibp2p } from 'libp2p'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CHAT_TOPIC = 'nunchi-trade.chat.v1'
const PRESENCE_TOPIC = 'nunchi-trade.chat.presence.v1'
const DISCOVERY_TOPICS = [
  '_peer-discovery._p2p._pubsub',
  'nunchi-trade._peer-discovery._p2p._pubsub'
]
const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 4002)
const KUBO_PEER_ID =
  process.env.KUBO_PEER_ID ?? '12D3KooWNZubK6JHJiPmMFXPKXqTax9g9fv7WvrFJ6mgVvhrufpS'
const KUBO_LOCAL_ADDR =
  process.env.KUBO_LOCAL_ADDR ??
  `/ip4/127.0.0.1/tcp/4001/p2p/${KUBO_PEER_ID}`
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

const kuboCircuitListen = `${KUBO_LOCAL_ADDR}/p2p-circuit`

const node = await createLibp2p({
  privateKey,
  addresses: {
    listen: [
      `/ip4/${HOST}/tcp/${PORT}/ws`,
      kuboCircuitListen
    ]
  },
  transports: [
    webSockets(),
    tcp(),
    circuitRelayTransport()
  ],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    identify: identify(),
    pubsub: floodsub()
  }
})

await node.start()

console.log('Reserved circuit slot on Kubo via', kuboCircuitListen)

for (const topic of [CHAT_TOPIC, PRESENCE_TOPIC, ...DISCOVERY_TOPICS]) {
  await node.services.pubsub.subscribe(topic)
  console.log('subscribed:', topic)
}

node.services.pubsub.addEventListener('message', (evt) => {
  const topic = evt.detail.topic
  if (topic === CHAT_TOPIC) {
    console.log('chat via floodsub from', evt.detail.from?.toString?.() ?? '?')
  }
})

console.log('Pubsub bridge peer id:', peerId.toString())
console.log('Listening:')
for (const ma of node.getMultiaddrs()) {
  console.log(' ', ma.toString())
}
console.log('\nSet VITE_BRIDGE_PEER_ID=' + peerId.toString())
