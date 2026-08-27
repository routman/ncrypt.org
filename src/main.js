import { mountTopicScreen, mountChatView } from './ui.js'
import { roomTopic, roomKey, encryptMsg, decryptMsg } from './crypto.js'
import { connectMqtt, mqttUrl } from './mqtt.js'

const RATE_MS = 2000
const BURST = 5
const MAX_LEN = 500

function makeRateLimiter() {
  let tokens = BURST
  let last = Date.now()
  return () => {
    const now = Date.now()
    tokens = Math.min(BURST, tokens + (now - last) / RATE_MS)
    last = now
    if (tokens < 1) return false
    tokens -= 1
    return true
  }
}

mountTopicScreen({
  onJoin(topic, nick) {
    const canSend = makeRateLimiter()
    let key = null
    let mqtTopic = null
    let client = null
    const sent = []

    const chat = mountChatView({
      nick,
      onSend(text) {
        if (!key) return false
        if (text.length > MAX_LEN) return false
        if (!canSend()) return false
        const ts = Date.now()
        chat.append({ nick, text, ts })
        sent.push({ ts, text })
        if (sent.length > 50) sent.shift()
        encryptMsg(key, { nick, text, ts }).then((b64) => {
          if (client) client.publish(mqtTopic, b64)
        })
        return true
      },
    })

    Promise.all([roomTopic(topic), roomKey(topic)]).then(([id, aesKey]) => {
      key = aesKey
      mqtTopic = 'chat/' + id

      fetch('/api/history/' + id + '?limit=100')
        .then((res) => (res.ok ? res.json() : { messages: [] }))
        .then(({ messages }) => {
          for (const m of messages || []) {
            decryptMsg(key, m.ct).then(chat.append).catch(() => {})
          }
        })
        .catch(() => {})

      client = connectMqtt({
        url: mqttUrl(),
        topic: mqtTopic,
        onMessage(t, payload) {
          decryptMsg(key, payload).then((m) => {
            const i = sent.findIndex(
              (s) => s.ts === m.ts && s.text === m.text && m.nick === nick,
            )
            if (i !== -1) {
              sent.splice(i, 1)
              return
            }
            chat.append(m)
          }).catch(() => {})
        },
        onStatus(connected) {
          chat.setConnected(connected)
        },
      })
    })
  },
})
