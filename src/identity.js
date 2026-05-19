import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic as validateBip39Mnemonic
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { generateKeyPairFromSeed, publicKeyFromRaw } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey } from '@libp2p/peer-id'
import { fromString, toString } from 'uint8arrays'

const MNEMONIC_STORAGE_KEY = 'nunchi-chat-mnemonic'

export function generateMnemonicPhrase () {
  return generateMnemonic(wordlist, 128)
}

export function normalizeMnemonic (phrase) {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function validateMnemonic (phrase) {
  return validateBip39Mnemonic(normalizeMnemonic(phrase), wordlist)
}

export function loadStoredMnemonic () {
  return sessionStorage.getItem(MNEMONIC_STORAGE_KEY) ?? ''
}

export function storeMnemonic (phrase) {
  sessionStorage.setItem(MNEMONIC_STORAGE_KEY, normalizeMnemonic(phrase))
}

export function clearStoredMnemonic () {
  sessionStorage.removeItem(MNEMONIC_STORAGE_KEY)
}

/** Derive Ed25519 keys and libp2p peer id from a BIP39 mnemonic. */
export async function identityFromMnemonic (phrase) {
  const mnemonic = normalizeMnemonic(phrase)
  if (!validateBip39Mnemonic(mnemonic, wordlist)) {
    throw new Error('Invalid seed phrase — expected 12 valid BIP39 words.')
  }

  const seed = mnemonicToSeedSync(mnemonic)
  const libp2pPrivateKey = await generateKeyPairFromSeed('Ed25519', seed.subarray(0, 32))
  const peerId = await peerIdFromPrivateKey(libp2pPrivateKey)
  const publicKeyBytes = libp2pPrivateKey.publicKey.raw
  const displayName = toString(publicKeyBytes.subarray(0, 8), 'base64url')

  return {
    mnemonic,
    peerId,
    libp2pPrivateKey,
    displayName
  }
}

/** Canonical payload bytes for signing (excludes signature). */
export function messageBytes (payload) {
  const canonical = {
    type: payload.type ?? 'chat',
    text: payload.text ?? '',
    timestamp: payload.timestamp,
    peerId: payload.peerId,
    displayName: payload.displayName
  }
  return fromString(JSON.stringify(canonical))
}

export async function signMessage (identity, payload) {
  const bytes = messageBytes(payload)
  const signature = await identity.libp2pPrivateKey.sign(bytes)
  return {
    ...payload,
    publicKey: toString(identity.libp2pPrivateKey.publicKey.raw, 'base64'),
    signature: toString(signature, 'base64')
  }
}

export async function verifyMessage (envelope) {
  if (!envelope.signature || !envelope.publicKey) {
    return false
  }

  let publicKeyBytes
  let signature
  try {
    publicKeyBytes = fromString(envelope.publicKey, 'base64')
    signature = fromString(envelope.signature, 'base64')
  } catch {
    return false
  }

  if (publicKeyBytes.length !== 32) {
    return false
  }

  const payload = {
    type: envelope.type ?? 'chat',
    text: envelope.text ?? '',
    timestamp: envelope.timestamp,
    peerId: envelope.peerId,
    displayName: envelope.displayName
  }

  try {
    const publicKey = publicKeyFromRaw(publicKeyBytes)
    return publicKey.verify(messageBytes(payload), signature)
  } catch {
    return false
  }
}
