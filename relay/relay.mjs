/* eslint-disable no-console */
/**
 * Public circuit-relay server for browser libp2p clients.
 * Deploy this (e.g. Render/Fly) and set VITE_RELAY_MULTIADDR at build time.
 */
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { webSockets } from '@libp2p/websockets'
import { createLibp2p } from 'libp2p'

const host = process.env.HOST ?? '0.0.0.0'
const port = Number(process.env.PORT ?? 8787)

const server = await createLibp2p({
  addresses: {
    listen: [`/ip4/${host}/tcp/${port}/ws`]
  },
  transports: [webSockets()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    identify: identify(),
    relay: circuitRelayServer({
      reservations: {
        maxReservations: Infinity
      }
    })
  }
})

await server.start()

const addrs = server.getMultiaddrs().map((ma) => ma.toString())
console.log('Relay peer id:', server.peerId.toString())
console.log('Relay listening on:')
for (const a of addrs) {
  console.log(' ', a)
}
console.log('\nSet VITE_RELAY_MULTIADDR to the /ws multiaddr (use wss + public host in production).')
