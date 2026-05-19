# Nunchi Chat

Decentralized browser chat over [libp2p](https://libp2p.io/). Everyone who opens the app joins the same room. Identity is a **12-word BIP39 seed phrase**; every message is **cryptographically signed** with the Ed25519 key derived from that phrase.

Live site (after setup): **https://nunchi-trade.github.io/chat/**

## How it works

1. **Identity** — A BIP39 mnemonic is hashed to a 32-byte seed, which derives an Ed25519 libp2p keypair and peer ID.
2. **Network** — Browsers connect to a public **circuit relay** over WebSocket, discover each other via gossipsub peer discovery, then chat over WebRTC.
3. **Room** — All clients subscribe to the gossipsub topic `nunchi-trade.chat.v1`.
4. **Messages** — Payloads are signed with your private key; recipients verify signatures before display.

## Quick start (local)

```bash
# Terminal 1 — relay
cd relay && npm install && PORT=8787 node relay.mjs
# Copy the printed /ws/p2p/... multiaddr

# Terminal 2 — web app
cd ..
npm install
echo "VITE_RELAY_MULTIADDR=/ip4/127.0.0.1/tcp/8787/ws/p2p/YOUR_PEER_ID" > .env
npm run dev
```

Open two browser tabs, generate or paste seed phrases, join chat, and send messages.

## Deploy

### GitHub Pages (app)

1. Push this repo to `nunchi-trade/chat` on GitHub.
2. Enable **GitHub Pages** → Source: **GitHub Actions**.
3. Deploy the relay (below) and set repository variable **`VITE_RELAY_MULTIADDR`** to the relay’s WebSocket multiaddr (Settings → Secrets and variables → Actions → Variables).
4. Push to `main` — the workflow builds and deploys the static site.

### Relay (required for browsers)

Browsers cannot accept inbound connections; they need a public circuit relay.

**Option A — [Render](https://render.com)** (Blueprint):

- Use `render.yaml` in this repo (root directory `relay`).
- After deploy, note the public URL and build the multiaddr:
  `/dns4/<your-service>.onrender.com/tcp/443/wss/p2p/<peerId>`
- Set `VITE_RELAY_MULTIADDR` in GitHub repo variables before the next Pages build.

**Option B — any host**

```bash
cd relay && npm install && HOST=0.0.0.0 PORT=8787 node relay.mjs
```

Expose port 8787 (or 443 with TLS) and set `VITE_RELAY_MULTIADDR` accordingly.

## Security notes

- **Seed phrase = full control** of your identity. Never share it.
- Messages are signed but the relay is a trusted bootstrap point for connectivity (not for reading message content on the pubsub mesh).
- This is a demo chat app, not audited for production use.

## License

MIT
