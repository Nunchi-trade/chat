import {
  clearStoredMnemonic,
  generateMnemonicPhrase,
  identityFromMnemonic,
  loadStoredMnemonic,
  signMessage,
  storeMnemonic,
  validateMnemonic,
  verifyMessage
} from './identity.js'
import {
  createChatNode,
  formatRelayLabel,
  getBridgeStatuses,
  getRoomOccupancy,
  getRelayConfigured,
  getRelayStatuses,
  isBridgeConnected,
  onPubsubMessage,
  publishChatMessage,
  publishPresenceMessage,
  recordPresence,
  setOnRoomChange,
  startPresenceLoop,
  stopPresenceLoop
} from './libp2p-node.js'

const $ = (id) => document.getElementById(id)

const identityScreen = $('identity-screen')
const chatScreen = $('chat-screen')
const mnemonicInput = $('mnemonic-input')
const identityError = $('identity-error')
const messagesEl = $('messages')
const messageForm = $('message-form')
const messageInput = $('message-input')
const statusText = $('status-text')
const peerCount = $('peer-count')
const displayName = $('display-name')
const relayList = $('relay-list')
const roomCountEl = $('room-count')

let identity = null
let node = null
let statusTimer = null
const seenMessageIds = new Set()

function showError (msg) {
  identityError.textContent = msg
  identityError.hidden = !msg
}

function formatTime (ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function messageId (envelope) {
  return `${envelope.peerId}:${envelope.timestamp}:${envelope.signature ?? envelope.type}`
}

function appendMessage (envelope, { verified, own }) {
  const li = document.createElement('li')
  li.className = [
    'message',
    own ? 'own' : 'peer',
    verified ? 'verified' : 'unverified'
  ].join(' ')

  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.innerHTML = `
    <span class="author">${escapeHtml(envelope.displayName)}</span>
    <span class="time">${formatTime(envelope.timestamp)}</span>
    <span class="badge">${verified ? '✓ signed' : '⚠ unverified'}</span>
  `

  const body = document.createElement('p')
  body.className = 'text'
  body.textContent = envelope.text

  li.append(meta, body)
  messagesEl.appendChild(li)
  messagesEl.scrollTop = messagesEl.scrollHeight
}

function escapeHtml (s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[c])
}

function updateRoomUI () {
  if (!identity || !roomCountEl) {
    return
  }
  const { count, others } = getRoomOccupancy(identity.peerId.toString())
  const bridgeOk = node && isBridgeConnected(node)

  if (!bridgeOk) {
    roomCountEl.textContent = 'Room: waiting for pubsub bridge…'
    roomCountEl.className = 'room-count warn'
    return
  }

  if (count <= 1) {
    roomCountEl.textContent = 'Room: only you (waiting for others…)'
    roomCountEl.className = 'room-count warn'
    return
  }

  const names = others.map((o) => o.displayName).join(', ')
  roomCountEl.textContent = `${count} people in room — ${names}`
  roomCountEl.className = 'room-count'
}

async function handleIncoming (topic, envelope) {
  if (envelope.type === 'presence') {
    const verified = await verifyMessage(envelope)
    if (verified) {
      recordPresence(envelope)
    }
    return
  }

  const id = messageId(envelope)
  if (seenMessageIds.has(id)) {
    return
  }
  seenMessageIds.add(id)

  const verified = await verifyMessage(envelope)
  const own = envelope.peerId === identity.peerId.toString()
  appendMessage(envelope, { verified, own })
}

function updateRelayList () {
  if (!node || !relayList) {
    return
  }

  if (!getRelayConfigured()) {
    relayList.replaceChildren()
    const li = document.createElement('li')
    li.className = 'relay-item warn'
    li.textContent = 'No relay configured in build'
    relayList.appendChild(li)
    return
  }

  const statuses = [...getRelayStatuses(node), ...getBridgeStatuses(node)]
  relayList.replaceChildren(
    ...statuses.map((status) => {
      const li = document.createElement('li')
      let state = 'disconnected'
      let detail = status.dialError ?? 'Not connected'

      if (status.connected) {
        state = 'connected'
        detail = 'Connected'
      } else if (status.dialError) {
        state = 'error'
        detail = status.dialError
      }

      li.className = `relay-item ${state}`
      li.title = status.multiaddr ?? ''
      li.innerHTML = `
        <span class="relay-dot" aria-hidden="true"></span>
        <span class="relay-label">${escapeHtml(formatRelayLabel(status))}</span>
        <span class="relay-detail">${escapeHtml(detail)}</span>
      `
      return li
    })
  )
}

function updateStatus () {
  if (!node) {
    return
  }

  updateRelayList()
  updateRoomUI()

  const relays = getRelayStatuses(node)
  const anyRelayConnected = relays.some((r) => r.connected)
  const bridgeOk = isBridgeConnected(node)
  const relay = getRelayConfigured()
  const room = getRoomOccupancy(identity.peerId.toString())

  if (!relay) {
    statusText.textContent = 'No relay configured — deploy relay and rebuild'
    statusText.className = 'status warn'
  } else if (!anyRelayConnected) {
    const onHttps = location.protocol === 'https:'
    statusText.textContent = onHttps
      ? 'Relay unreachable — need WSS (Kubo AutoTLS) or check firewall :4001'
      : 'Relay unreachable — check Kubo is running (systemctl status ipfs)'
    statusText.className = 'status warn'
  } else if (!bridgeOk) {
    statusText.textContent = 'Pubsub bridge unreachable — systemctl status chat-bridge'
    statusText.className = 'status warn'
  } else if (room.count <= 1) {
    statusText.textContent = 'Chat network ready — waiting for others to join'
    statusText.className = 'status'
  } else {
    statusText.textContent = 'Chat network ready'
    statusText.className = 'status ok'
  }

  peerCount.textContent = bridgeOk ? `${room.count} in room` : ''
}

async function publishPresence () {
  const payload = {
    type: 'presence',
    text: '',
    timestamp: Date.now(),
    peerId: identity.peerId.toString(),
    displayName: identity.displayName
  }
  const signed = await signMessage(identity, payload)
  await publishPresenceMessage(node, signed)
}

async function enterChat (mnemonic) {
  showError('')
  if (!validateMnemonic(mnemonic)) {
    showError('Enter a valid 12-word BIP39 seed phrase.')
    return
  }

  try {
    identity = await identityFromMnemonic(mnemonic)
  } catch (err) {
    showError(err.message ?? 'Could not derive identity.')
    return
  }

  storeMnemonic(mnemonic)
  identityScreen.hidden = true
  chatScreen.hidden = false
  displayName.textContent = identity.displayName

  setOnRoomChange(() => {
    updateRoomUI()
    updateStatus()
  })

  try {
    node = await createChatNode(identity.libp2pPrivateKey)
  } catch (err) {
    console.error(err)
    showError('Failed to start libp2p node.')
    leaveChat()
    identityScreen.hidden = false
    chatScreen.hidden = true
    return
  }

  onPubsubMessage(node, (topic, envelope) => {
    void handleIncoming(topic, envelope)
  })

  startPresenceLoop(node, publishPresence)

  node.addEventListener('connection:open', updateStatus)
  node.addEventListener('connection:close', updateStatus)

  messageInput.disabled = false
  messageForm.querySelector('button').disabled = false
  messageInput.focus()

  statusTimer = setInterval(updateStatus, 2000)
  updateStatus()
}

async function sendMessage (text) {
  const payload = {
    type: 'chat',
    text,
    timestamp: Date.now(),
    peerId: identity.peerId.toString(),
    displayName: identity.displayName
  }
  const signed = await signMessage(identity, payload)
  await publishChatMessage(node, signed)
  await handleIncoming('chat', signed)
}

function leaveChat () {
  clearInterval(statusTimer)
  statusTimer = null
  stopPresenceLoop()
  setOnRoomChange(null)
  if (node) {
    void node.stop()
    node = null
  }
  identity = null
  seenMessageIds.clear()
  messagesEl.replaceChildren()
  if (relayList) {
    relayList.replaceChildren()
  }
  if (roomCountEl) {
    roomCountEl.textContent = ''
  }
  messageInput.disabled = true
  messageForm.querySelector('button').disabled = true
  chatScreen.hidden = true
  identityScreen.hidden = false
}

$('generate-mnemonic').addEventListener('click', () => {
  try {
    mnemonicInput.value = generateMnemonicPhrase()
    showError('')
  } catch (err) {
    console.error(err)
    showError('Could not generate phrase. See browser console.')
  }
})

$('join-chat').addEventListener('click', () => {
  void enterChat(mnemonicInput.value)
})

$('leave-chat').addEventListener('click', () => {
  clearStoredMnemonic()
  leaveChat()
  mnemonicInput.value = ''
})

$('copy-mnemonic').addEventListener('click', async () => {
  const phrase = loadStoredMnemonic()
  if (phrase) {
    await navigator.clipboard.writeText(phrase)
    $('copy-mnemonic').textContent = 'Copied!'
    setTimeout(() => {
      $('copy-mnemonic').textContent = 'Copy seed'
    }, 1500)
  }
})

messageForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const text = messageInput.value.trim()
  if (!text || !node) {
    return
  }
  messageInput.value = ''
  void sendMessage(text).catch((err) => {
    console.error('publish failed', err)
    statusText.textContent = 'Failed to send — check connection'
    statusText.className = 'status warn'
  })
})

if (location.protocol === 'https:') {
  const relay = import.meta.env.VITE_RELAY_MULTIADDR ?? ''
  if (!relay.includes('/wss') && !relay.includes('/tls/')) {
    console.warn(
      'GitHub Pages uses HTTPS; ws:// relays are blocked. Use npm run dev locally or configure Kubo WSS.'
    )
  }
}

const stored = loadStoredMnemonic()
if (stored) {
  mnemonicInput.value = stored
}
