import { mountTopicScreen, mountChatView } from './ui.js'
import {
  roomTopic,
  roomKey,
  encryptMsg,
  decryptMsg,
  getIdentityId,
  nickSuffix,
  deleteToken,
} from './crypto.js'
import { connectMqtt, mqttUrl } from './mqtt.js'
import { primeAudio, ding } from './sound.js'
import { isMeow, catRain } from './easter.js'

const RATE_MS = 2000
const BURST = 5
const MAX_LEN = 500
const MAX_REPEAT = 3
const MUTE_KEY = 'ncrypt-mute'
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

function stripToken(payload) {
  const s = String(payload)
  const dot = s.lastIndexOf('.')
  return dot === -1 ? s : s.slice(0, dot)
}

let client = null
let gen = 0
let muted = localStorage.getItem(MUTE_KEY) === '1'
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
  mountTopicScreen({ onJoin: joinRoom })
}

function joinRoom(topic, nick) {
  history.pushState({ room: { topic, nick } }, '', '/chat')
  onJoin(topic, nick)
}

function goHome() {
  history.pushState({ room: null }, '', '/')
  home()
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
  let lastText = null
  let runLen = 0

  function playDing() {
    if (!muted) ding()
  }

  function toggleMute(next) {
    muted = next
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  }

  function publishPresence() {
    if (!key || !client) return
    encryptMsg(key, { nick: displayNick, ts: Date.now() }).then((b64) => {
      if (client) client.publish(presenceTopic, b64)
    })
  }

  function refreshPresence() {
    if (!chat) return
    const now = Date.now()
    const online = [displayNick]
    for (const [n, lastSeen] of presence) {
      if (now - lastSeen < PRESENCE_TIMEOUT) online.push(n)
      else presence.delete(n)
    }
    chat.setPresence(online)
  }

  primeAudio()

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
      muted,
      onHome: goHome,
      onToggleMute: toggleMute,
      onSend(text) {
        if (!key) return false
        if (text.length > MAX_LEN) return false
        if (!canSend()) return false
        if (text === lastText) runLen++
        else {
          lastText = text
          runLen = 1
        }
        const phantom = runLen > MAX_REPEAT
        const ts = Date.now()
        chat.append({ nick: displayNick, text, ts })
        playDing()
        if (isMeow(text)) catRain()
        if (!phantom) {
          sent.push({ ts, text })
          if (sent.length > 50) sent.shift()
          deleteToken(getIdentityId(), id, ts, text).then((token) => {
            encryptMsg(key, { nick: displayNick, text, ts }).then((b64) => {
              if (client) client.publish(mqtTopic, b64 + '.' + token)
            })
          })
        }
        return true
      },
      onDelete(msg, el) {
        deleteToken(getIdentityId(), id, msg.ts, msg.text).then((token) => {
          fetch('/api/delete/' + id, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token }),
          })
            .then((res) => res.json().catch(() => ({})).then((body) => ({ ok: res.ok, body })))
            .then(({ ok, body }) => {
              if (ok && body && body.deleted > 0) {
                el.remove()
                const i = sent.findIndex((s) => s.ts === msg.ts && s.text === msg.text)
                if (i !== -1) sent.splice(i, 1)
              } else {
                const btn = el.querySelector('.msg-del')
                if (btn) {
                  btn.disabled = false
                  btn.textContent = '×'
                }
              }
            })
            .catch(() => {
              const btn = el.querySelector('.msg-del')
              if (btn) {
                btn.disabled = false
                btn.textContent = '×'
              }
            })
        })
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
        decryptMsg(key, stripToken(payload)).then((m) => {
          const i = sent.findIndex(
            (s) => s.ts === m.ts && s.text === m.text && m.nick === displayNick,
          )
          if (i !== -1) {
            sent.splice(i, 1)
            return
          }
          chat.append(m)
          playDing()
          if (isMeow(m.text)) catRain()
        }).catch(() => {})
      },
      onStatus(connected) {
        chat.setConnected(connected)
      },
    })

    publishPresence()
    refreshPresence()
    presenceTimer = setInterval(publishPresence, PRESENCE_INTERVAL)
    refreshTimer = setInterval(refreshPresence, PRESENCE_REFRESH)
  })
}

window.addEventListener('popstate', (e) => {
  const room = e.state && e.state.room
  if (room) onJoin(room.topic, room.nick)
  else home()
})

if (location.pathname !== '/') {
  history.replaceState({ room: null }, '', '/')
}
mountTopicScreen({ onJoin: joinRoom })
