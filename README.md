# Nunchi Chat

Decentralized browser chat over [libp2p](https://libp2p.io/). Everyone who opens the app joins the same room. Identity is a **12-word BIP39 seed phrase**; every message is **cryptographically signed** with the Ed25519 key derived from that phrase.

Live site: **https://nunchi-trade.github.io/chat/**

## How it works

1. **Identity** — A BIP39 mnemonic derives an Ed25519 libp2p keypair and peer ID.
2. **Network** — Browsers dial a **Kubo (IPFS)** node over WebSocket as a circuit relay, discover peers via gossipsub, then connect over WebRTC.
3. **Room** — All clients use gossipsub topic `nunchi-trade.chat.v1`.
4. **Messages** — Signed locally; other clients verify before showing as trusted.

## Relay on this machine (Kubo)

```bash
# Install (Arch)
sudo pacman -S kubo

# Configure WebSocket + circuit relay v2
./scripts/setup-kubo-relay.sh

# Run the node
ipfs daemon
```

Copy the **`/tcp/4001/ws/p2p/...`** address from `ipfs id` into `.env`:

```bash
cp .env.example .env
# edit VITE_RELAY_MULTIADDR if your peer id or IP differs
npm install
npm run dev
```

Open two tabs → **Generate new phrase** → **Join chat**.

### GitHub Pages + this relay

Set repo variable **`VITE_RELAY_MULTIADDR`** to your public `/ws/p2p/...` multiaddr (from `ipfs id`), then redeploy Pages.

**HTTPS caveat:** GitHub Pages is served over HTTPS. Browsers block `ws://` from HTTPS pages (mixed content). Options:

- Develop with `npm run dev` (HTTP) and `127.0.0.1` in `VITE_RELAY_MULTIADDR`, or
- Expose Kubo with **WSS** (TLS on port 4001, reverse proxy, or Kubo AutoTLS), and use a `wss://` multiaddr in `VITE_RELAY_MULTIADDR`.

## Fallback: Node relay

The small `relay/` server still works if you prefer not to run Kubo:

```bash
cd relay && npm install && PORT=8787 node relay.mjs
```

## Security notes

- **Seed phrase = full control** of your identity. Never share it.
- The IPFS node is a connectivity relay, not a message store.
- Demo software — not audited for production.

## License

MIT
