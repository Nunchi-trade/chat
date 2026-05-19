import {
  clearStoredMnemonic,
  generateMnemonic,
  identityFromMnemonic,
  loadStoredMnemonic,
  signMessage,
  storeMnemonic,
  validateMnemonic,
  verifyMessage
} from './identity.js'
import {
  createChatNode,
  getConnectedPeerCount,
  getRelayConfigured,
  onChatMessage,
  publishChatMessage
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
  return `${envelope.peerId}:${envelope.timestamp}:${envelope.signature}`
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

async function handleIncoming (envelope) {
  const id = messageId(envelope)
  if (seenMessageIds.has(id)) {
    return
  }
  seenMessageIds.add(id)

  const verified = await verifyMessage(envelope)
  const own = envelope.peerId === identity.peerId.toString()
  appendMessage(envelope, { verified, own })
}

function updateStatus () {
  if (!node) {
    return
  }
  const peers = getConnectedPeerCount(node)
  const relay = getRelayConfigured()
  if (!relay) {
    statusText.textContent = 'No relay configured — deploy relay and rebuild'
    statusText.className = 'status warn'
  } else if (peers === 0) {
    statusText.textContent = 'Connected to network — waiting for peers…'
    statusText.className = 'status'
  } else {
    statusText.textContent = 'Connected'
    statusText.className = 'status ok'
  }
  peerCount.textContent = peers > 0 ? `${peers} peer${peers === 1 ? '' : 's'}` : ''
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

  onChatMessage(node, (envelope) => {
    void handleIncoming(envelope)
  })

  messageInput.disabled = false
  messageForm.querySelector('button').disabled = false
  messageInput.focus()

  statusTimer = setInterval(updateStatus, 2000)
  updateStatus()
}

async function sendMessage (text) {
  const payload = {
    text,
    timestamp: Date.now(),
    peerId: identity.peerId.toString(),
    displayName: identity.displayName
  }
  const signed = await signMessage(identity, payload)
  await publishChatMessage(node, signed)
  await handleIncoming(signed)
}

function leaveChat () {
  clearInterval(statusTimer)
  statusTimer = null
  if (node) {
    void node.stop()
    node = null
  }
  identity = null
  seenMessageIds.clear()
  messagesEl.replaceChildren()
  messageInput.disabled = true
  messageForm.querySelector('button').disabled = true
  chatScreen.hidden = true
  identityScreen.hidden = false
}

$('generate-mnemonic').addEventListener('click', () => {
  mnemonicInput.value = generateMnemonic()
  showError('')
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

const stored = loadStoredMnemonic()
if (stored) {
  mnemonicInput.value = stored
}
