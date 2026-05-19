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

# Server profile (no mDNS) + WebSocket relay — required on Hetzner/public VPS
./scripts/setup-kubo-relay.sh

# Auto-start on boot (systemd)
sudo ./scripts/install-ipfs-service.sh
```

Check status: `systemctl status ipfs` · logs: `journalctl -u ipfs -f`

Copy the **`/tcp/4001/ws/p2p/...`** address from `ipfs id` into `.env`:

```bash
cp .env.example .env
# edit VITE_RELAY_MULTIADDR if your peer id or IP differs
npm install
npm run dev
```

Open two tabs → **Generate new phrase** → **Join chat**.

### GitHub Pages + this relay

GitHub Pages is HTTPS, so the relay must use **Secure WebSocket** (Kubo **AutoTLS** → `*.libp2p.direct`).

```bash
./scripts/setup-kubo-relay.sh
sudo ./scripts/install-ipfs-service.sh   # includes AutoTLS logging
systemctl restart ipfs
./scripts/print-relay-multiaddr.sh       # copy /tls/ws multiaddr
```

Set GitHub variable **`VITE_RELAY_MULTIADDR`** to that value, then redeploy Pages.

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
