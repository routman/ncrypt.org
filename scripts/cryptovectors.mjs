import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createDecipheriv, createHmac } from 'node:crypto'
import { roomTopic, roomKey, encryptMsg, decryptMsg, nickSuffix, deleteToken } from '../src/crypto.js'

const TOPIC = 'test'
const ID = 'b965b2ee4da54939a284ea2c5764b14bc53856f245d987a0fe470cdf2a4e9a4b'
const KEY_HEX = '18100963b6f6663298f4259bc681211bf39c1a24f3edf54c93525b725313d236'

function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex')
}

test('roomTopic: fixed topic → fixed id (known answer)', async () => {
  assert.equal(await roomTopic(TOPIC), ID)
  assert.equal(await roomTopic(TOPIC), sha256Hex('ncrypt-chat:' + TOPIC))
})

test('roomKey: key material is exactly SHA-256("ncrypt-chat-key:"+topic)', async () => {
  const key = await roomKey(TOPIC)
  assert.equal(key.algorithm.name, 'AES-GCM')
  assert.equal(key.algorithm.length, 256)
  const payload = { nick: 'n', text: 't', ts: 42 }
  const raw = Buffer.from(await encryptMsg(key, payload), 'base64')
  const iv = raw.subarray(0, 12)
  const ct = raw.subarray(12)
  const keyBytes = Buffer.from(KEY_HEX, 'hex')
  assert.equal(keyBytes.toString('hex'), sha256Hex('ncrypt-chat-key:' + TOPIC))
  const d = createDecipheriv('aes-256-gcm', keyBytes, iv)
  d.setAuthTag(ct.subarray(ct.length - 16))
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
  assert.deepEqual(JSON.parse(pt.toString('utf8')), payload)
})

test('encrypt/decrypt round-trip + wire format', async () => {
  const key = await roomKey('someroom')
  const payload = { nick: 'alice', text: 'hello wörld', ts: 1724000000000 }
  const b64 = await encryptMsg(key, payload)
  assert.equal(typeof b64, 'string')
  const raw = Buffer.from(b64, 'base64')
  const ptLen = Buffer.byteLength(JSON.stringify(payload))
  assert.equal(raw.length, 12 + ptLen + 16)
  assert.deepEqual(await decryptMsg(key, b64), payload)
})

test('wrong topic → decrypt fails', async () => {
  const keyA = await roomKey('room-a')
  const keyB = await roomKey('room-b')
  const b64 = await encryptMsg(keyA, { nick: 'x', text: 'y', ts: 1 })
  await assert.rejects(decryptMsg(keyB, b64))
})

test('domain separation: room id is not key material', async () => {
  const id = await roomTopic(TOPIC)
  assert.notEqual(id, KEY_HEX)
  const key = await roomKey(TOPIC)
  const b64 = await encryptMsg(key, { nick: 'x', text: 'y', ts: 1 })
  const idAsKey = await crypto.subtle.importKey(
    'raw',
    Buffer.from(id, 'hex'),
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )
  await assert.rejects(decryptMsg(idAsKey, b64))
})

test('nickSuffix: fixed (id, channel, nick) → fixed 12-char base36 suffix', async () => {
  assert.equal(await nickSuffix(ID, 'test', 'Bob'), 'vzd4hhnew54i')
})

test('nickSuffix: different channel → different suffix', async () => {
  const a = await nickSuffix(ID, 'test', 'Bob')
  const b = await nickSuffix(ID, 'chan2', 'Bob')
  assert.notEqual(a, b)
  assert.equal(b, '66cswtz89oc9')
})

test('nickSuffix: different nick → different suffix', async () => {
  const a = await nickSuffix(ID, 'test', 'Bob')
  const b = await nickSuffix(ID, 'test', 'Ann')
  assert.notEqual(a, b)
  assert.equal(b, '5cu3e9vceuex')
})

test('nickSuffix: different id → different suffix', async () => {
  const a = await nickSuffix(ID, 'test', 'Bob')
  const b = await nickSuffix(
    '0000000000000000000000000000000000000000000000000000000000000001',
    'test',
    'Bob'
  )
  assert.notEqual(a, b)
  assert.equal(b, '5q7c208p4417')
})

test('nickSuffix: matches /^[0-9a-z]{12}$/', async () => {
  assert.match(await nickSuffix(ID, 'test', 'Bob'), /^[0-9a-z]{12}$/)
})

test('deleteToken: fixed (id, roomId, ts, text) → fixed 64-hex HMAC', async () => {
  const ts = 1724000000000
  const text = 'hello'
  const token = await deleteToken(ID, 'roomid', ts, text)
  assert.match(token, /^[0-9a-f]{64}$/)
  const expected = createHmac('sha256', ID)
    .update('roomid' + '\x00' + ts + '\x00' + text)
    .digest('hex')
  assert.equal(token, expected)
})

test('deleteToken: different text → different token', async () => {
  const a = await deleteToken(ID, 'roomid', 1, 'a')
  const b = await deleteToken(ID, 'roomid', 1, 'b')
  assert.notEqual(a, b)
})

test('deleteToken: different id → different token', async () => {
  const a = await deleteToken(ID, 'roomid', 1, 'x')
  const b = await deleteToken(
    '0000000000000000000000000000000000000000000000000000000000000001',
    'roomid',
    1,
    'x'
  )
  assert.notEqual(a, b)
})
