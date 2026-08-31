import { mountTopicScreen, mountChatView } from './ui.js'
import {
  roomTopic,
  roomKey,
  encryptMsg,
  decryptMsg,
  getIdentityId,
  nickSuffix,
} from './crypto.js'
import { connectMqtt, mqttUrl } from './mqtt.js'

const RATE_MS = 2000
const BURST = 5
const MAX_LEN = 500
const PRESENCE_INTERVAL = 20000
const PRESENCE_TIMEOUT = 60000
const PRESENCE_REFRESH = 10000

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

let client = null
let gen = 0
let presenceTimer = null
let refreshTimer = null

function home() {
  gen++
  if (presenceTimer) {
    clearInterval(presenceTimer)
    presenceTimer = null
  }
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  if (client) {
    client.close()
    client = null
  }
  mountTopicScreen({ onJoin })
}

function onJoin(topic, nick) {
  const myGen = ++gen
  const canSend = makeRateLimiter()
  let key = null
  let mqtTopic = null
  let presenceTopic = null
  let chat = null
  let displayNick = nick
  const sent = []
  const presence = new Map()

  function publishPresence() {
    if (!key || !client) return
    encryptMsg(key, { nick: displayNick, ts: Date.now() }).then((b64) => {
      if (client) client.publish(presenceTopic, b64)
    })
  }

  function refreshPresence() {
    if (!chat) return
    const now = Date.now()
    const online = []
    for (const [n, lastSeen] of presence) {
      if (now - lastSeen < PRESENCE_TIMEOUT) online.push(n)
      else presence.delete(n)
    }
    chat.setPresence(online.filter((n) => n !== displayNick))
  }

  Promise.all([
    roomTopic(topic),
    roomKey(topic),
    nickSuffix(getIdentityId(), topic, nick),
  ]).then(([id, aesKey, suffix]) => {
    if (myGen !== gen) return
    key = aesKey
    mqtTopic = 'chat/' + id
    presenceTopic = 'presence/' + id
    displayNick = nick + '-' + suffix

    chat = mountChatView({
      nick: displayNick,
      topic,
      onHome: home,
      onSend(text) {
        if (!key) return false
        if (text.length > MAX_LEN) return false
        if (!canSend()) return false
        const ts = Date.now()
        chat.append({ nick: displayNick, text, ts })
        sent.push({ ts, text })
        if (sent.length > 50) sent.shift()
        encryptMsg(key, { nick: displayNick, text, ts }).then((b64) => {
          if (client) client.publish(mqtTopic, b64)
        })
        return true
      },
    })

    fetch('/api/history/' + id + '?limit=100')
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then(({ messages }) => {
        if (myGen !== gen) return
        for (const m of messages || []) {
          decryptMsg(key, m.ct).then(chat.append).catch(() => {})
        }
      })
      .catch(() => {})

    client = connectMqtt({
      url: mqttUrl(),
      topics: [mqtTopic, presenceTopic],
      onMessage(t, payload) {
        if (t === presenceTopic) {
          decryptMsg(key, payload).then((m) => {
            if (m && m.nick) {
              presence.set(m.nick, Date.now())
              refreshPresence()
            }
          }).catch(() => {})
          return
        }
        decryptMsg(key, payload).then((m) => {
          const i = sent.findIndex(
            (s) => s.ts === m.ts && s.text === m.text && m.nick === displayNick,
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

    publishPresence()
    presenceTimer = setInterval(publishPresence, PRESENCE_INTERVAL)
    refreshTimer = setInterval(refreshPresence, PRESENCE_REFRESH)
  })
}

mountTopicScreen({ onJoin })
