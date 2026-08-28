const ID_PREFIX = 'ncrypt-chat:'
const KEY_PREFIX = 'ncrypt-chat-key:'
const IV_LEN = 12

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function bytesToB64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

function b64ToBytes(b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function toBase36(bytes) {
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  let s = ''
  while (n > 0n) {
    s = (n % 36n).toString(36) + s
    n /= 36n
  }
  return s
}

export async function roomTopic(topic) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(ID_PREFIX + topic)
  )
  return toHex(new Uint8Array(digest))
}

export async function roomKey(topic) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(KEY_PREFIX + topic)
  )
  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptMsg(key, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload))
  )
  const out = new Uint8Array(IV_LEN + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), IV_LEN)
  return bytesToB64(out)
}

export async function decryptMsg(key, b64) {
  const raw = b64ToBytes(b64)
  if (raw.length < IV_LEN + 16) throw new Error('ciphertext too short')
  const iv = raw.slice(0, IV_LEN)
  const ct = raw.slice(IV_LEN)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return JSON.parse(new TextDecoder().decode(pt))
}

export function getIdentityId() {
  const KEY = 'ncrypt-id'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = toHex(crypto.getRandomValues(new Uint8Array(16)))
    localStorage.setItem(KEY, id)
  }
  return id
}

export async function nickSuffix(idHex, channel, nick) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(idHex + '\x00' + channel + '\x00' + nick)
  )
  return toBase36(new Uint8Array(digest)).slice(0, 12)
}
