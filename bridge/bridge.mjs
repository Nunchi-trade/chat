/**
 * Chat relay hub — browsers reach it via Kubo circuit relay.
 * Bridge opens relay streams (browser circuit connections are "limited").
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { createLibp2p } from 'libp2p'
import {
  CHAT_RELAY_PROTOCOL,
  decodeRelayLines,
  encodeRelayLine
} from './chat-relay-protocol.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CHAT_TOPIC = 'nunchi-trade.chat.v1'
const PRESENCE_TOPIC = 'nunchi-trade.chat.presence.v1'
const HOST = process.env.HOST ?? '127.0.0.1'
const PORT = Number(process.env.PORT ?? 4002)
const KUBO_PEER_ID =
  process.env.KUBO_PEER_ID ?? '12D3KooWNZubK6JHJiPmMFXPKXqTax9g9fv7WvrFJ6mgVvhrufpS'
const KUBO_LOCAL_ADDR =
  process.env.KUBO_LOCAL_ADDR ??
  `/ip4/127.0.0.1/tcp/4001/p2p/${KUBO_PEER_ID}`
const KEY_FILE = join(__dirname, 'peer.key')
const ID_FILE = join(__dirname, 'peer.id')

/** @type {Map<string, { stream: import('@libp2p/interface').Stream, buffer: string }>} */
const clients = new Map()
const opening = new Set()

async function loadOrCreateKey () {
  if (existsSync(KEY_FILE)) {
    return privateKeyFromProtobuf(readFileSync(KEY_FILE))
  }
  const key = await generateKeyPair('Ed25519')
  writeFileSync(KEY_FILE, privateKeyToProtobuf(key))
  return key
}

function broadcast (line, exceptPeerId) {
  for (const [peerId, client] of clients) {
    if (peerId === exceptPeerId) {
      continue
    }
    if (client.stream.status !== 'open') {
      continue
    }
    try {
      client.stream.send(new TextEncoder().encode(line))
    } catch (err) {
      console.warn('[bridge] send failed to', peerId, err)
    }
  }
}

async function serveRelayStream (remoteId, stream) {
  if (clients.has(remoteId)) {
    const existing = clients.get(remoteId)
    try {
      existing.stream.abort(new Error('replaced'))
    } catch {
      // ignore
    }
    clients.delete(remoteId)
  }

  console.log('[bridge] chat relay stream to', remoteId)
  clients.set(remoteId, { stream, buffer: '' })

  try {
    for await (const chunk of stream) {
      const text = new TextDecoder().decode(
        chunk.subarray ? chunk.subarray() : chunk
      )
      const client = clients.get(remoteId)
      if (!client) {
        continue
      }
      client.buffer = decodeRelayLines(client.buffer, text, (topic, payload) => {
        if (topic !== CHAT_TOPIC && topic !== PRESENCE_TOPIC) {
          return
        }
        const fromPeer = payload?.peerId ?? remoteId
        console.log(`[bridge] ${topic} from ${fromPeer}`)
        broadcast(encodeRelayLine(topic, payload), remoteId)
      })
    }
  } catch (err) {
    console.warn('[bridge] stream ended', remoteId, err)
  } finally {
    clients.delete(remoteId)
    console.log('[bridge] chat relay closed', remoteId)
  }
}

async function openRelayToPeer (remotePeer) {
  const remoteId = remotePeer.toString()
  if (remoteId === peerId.toString()) {
    return
  }
  if (remoteId === KUBO_PEER_ID) {
    return
  }
  if (clients.has(remoteId) || opening.has(remoteId)) {
    return
  }

  opening.add(remoteId)
  try {
    const stream = await node.dialProtocol(remotePeer, CHAT_RELAY_PROTOCOL, {
      runOnLimitedConnection: true
    })
    void serveRelayStream(remoteId, stream)
  } catch (err) {
    console.warn('[bridge] open relay failed', remoteId, err)
  } finally {
    opening.delete(remoteId)
  }
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
    identify: identify()
  }
})

await node.start()

node.addEventListener('peer:connect', (evt) => {
  const remote = evt.detail
  console.log('[bridge] libp2p connect', remote.toString())
  void openRelayToPeer(remote)
})

node.addEventListener('peer:disconnect', (evt) => {
  clients.delete(evt.detail.toString())
})

console.log('Chat relay bridge peer id:', peerId.toString())
console.log('Protocol:', CHAT_RELAY_PROTOCOL)
console.log('Circuit slot on Kubo via', kuboCircuitListen)
console.log('Listening:')
for (const ma of node.getMultiaddrs()) {
  console.log(' ', ma.toString())
}
console.log('\nSet VITE_BRIDGE_PEER_ID=' + peerId.toString())
