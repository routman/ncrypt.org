const NICK_KEY = 'ncrypt-nick'

function makeLogo() {
  const logo = document.createElement('div')
  logo.className = 'logo'
  const n = document.createElement('span')
  n.className = 'n'
  n.textContent = 'n'
  const rest = document.createElement('span')
  rest.textContent = 'crypt'
  logo.append(n, rest)
  return logo
}

function fmtTime(ts) {
  const d = new Date(ts)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return time
  let date = d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  if (d.getFullYear() !== now.getFullYear()) date += ' ' + d.getFullYear()
  return date + ', ' + time
}

function nickColor(nick) {
  let h = 0x811c9dc5
  for (let i = 0; i < nick.length; i++) {
    h ^= nick.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return 'hsl(' + ((h >>> 0) % 360) + ' 85% 65%)'
}

const SOUND_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>'
const MUTE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" stroke="none"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>'

export function mountTopicScreen({ onJoin }) {
  const app = document.getElementById('app')
  app.textContent = ''

  const screen = document.createElement('div')
  screen.className = 'screen'

  const logo = makeLogo()

  const tagline = document.createElement('div')
  tagline.className = 'tagline'
  tagline.textContent = 'encrypted chat rooms'

  const topicField = document.createElement('div')
  topicField.className = 'field'
  const topicInput = document.createElement('input')
  topicInput.type = 'text'
  topicInput.autocapitalize = 'off'
  topicInput.maxLength = 100
  topicInput.placeholder = 'channel'
  topicField.append(topicInput)

  const nickField = document.createElement('div')
  nickField.className = 'field'
  const nickInput = document.createElement('input')
  nickInput.autocapitalize = 'off'
  nickInput.maxLength = 20
  nickInput.placeholder = 'nickname'
  nickInput.value = localStorage.getItem(NICK_KEY) || ''
  nickField.append(nickInput)

  const note = document.createElement('div')
  note.className = 'note'
  note.textContent =
    'your identifier is stored in this browser; clearing its data changes it (no recovery)'

  const error = document.createElement('div')
  error.className = 'error'

  const join = document.createElement('button')
  join.textContent = 'connect'
  join.addEventListener('click', () => {
    const topic = topicInput.value.trim()
    const nick = nickInput.value.trim()
    if (topic.length < 1 || topic.length > 100) {
      error.textContent = 'channel must be 1-100 characters'
      return
    }
    if (nick.length < 1 || nick.length > 20) {
      error.textContent = 'nickname must be 1-20 characters'
      return
    }
    localStorage.setItem(NICK_KEY, nick)
    onJoin(topic, nick)
  })

  topicInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join.click()
  })

  const links = document.createElement('p')
  links.className = 'links'
  const about = document.createElement('a')
  about.href = 'https://github.com/routman/ncrypt.org'
  about.textContent = 'about'
  const terms = document.createElement('a')
  terms.href = '/terms.html'
  terms.textContent = 'terms'
  const priv = document.createElement('a')
  priv.href = '/privacy.html'
  priv.textContent = 'privacy'
  links.append(about, document.createTextNode(' · '), terms, document.createTextNode(' · '), priv)

  const inner = document.createElement('div')
  inner.className = 'screen-inner'
  inner.append(logo, tagline, topicField, nickField, note, error, join, links)
  screen.append(inner)
  app.append(screen)
  topicInput.focus()
}

export function mountChatView({ nick, topic, muted: initialMuted, onHome, onToggleMute, onSend }) {
  let isMuted = initialMuted
  let onlineNicks = new Set()
  const msgDots = []
  const app = document.getElementById('app')
  app.textContent = ''

  const chat = document.createElement('div')
  chat.className = 'chat'

  const header = document.createElement('div')
  header.className = 'chatheader'
  const logo = makeLogo()
  logo.title = 'home'
  logo.addEventListener('click', onHome)
  const topicLabel = document.createElement('span')
  topicLabel.className = 'topic'
  topicLabel.textContent = topic
  const dot = document.createElement('span')
  dot.className = 'dot'
  const topicwrap = document.createElement('span')
  topicwrap.className = 'topicwrap'
  topicwrap.append(topicLabel, dot)
  const nickLabel = document.createElement('span')
  nickLabel.className = 'nick'
  nickLabel.textContent = nick
  const nickwrap = document.createElement('span')
  nickwrap.className = 'nickwrap'
  nickwrap.append(nickLabel)
  const muteBtn = document.createElement('button')
  muteBtn.className = 'mute'
  muteBtn.type = 'button'
  muteBtn.innerHTML = isMuted ? MUTE_ICON : SOUND_ICON
  muteBtn.title = isMuted ? 'unmute' : 'mute'
  muteBtn.classList.toggle('muted', isMuted)
  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted
    onToggleMute(isMuted)
    muteBtn.innerHTML = isMuted ? MUTE_ICON : SOUND_ICON
    muteBtn.title = isMuted ? 'unmute' : 'mute'
    muteBtn.classList.toggle('muted', isMuted)
  })
  header.append(logo, topicwrap, nickwrap, muteBtn)

  const messages = document.createElement('div')
  messages.className = 'messages'

  const composer = document.createElement('div')
  composer.className = 'composer'
  const input = document.createElement('input')
  input.maxLength = 500
  input.placeholder = 'message'
  const send = document.createElement('button')
  send.textContent = 'send'

  const doSend = () => {
    const text = input.value.trim()
    if (!text) return
    if (onSend(text) === false) return
    input.value = ''
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSend()
  })
  send.addEventListener('click', doSend)
  composer.append(input, send)

  chat.append(header, messages, composer)
  app.append(chat)
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()

  function updateShadows() {
    const atTop = messages.scrollTop <= 0
    const atBottom = messages.scrollTop + messages.clientHeight >= messages.scrollHeight - 1
    chat.classList.toggle('scrolled-top', !atTop)
    chat.classList.toggle('scrolled-bottom', !atBottom)
  }
  messages.addEventListener('scroll', updateShadows)
  updateShadows()

  return {
    append(msg) {
      const m = document.createElement('div')
      const own = msg.nick === nick
      m.className = 'msg' + (own ? ' own' : '')
      if (!own) m.style.setProperty('--msg-color', nickColor(msg.nick))
      const head = document.createElement('div')
      head.className = 'head'
      const nickwrap = document.createElement('span')
      nickwrap.className = 'nickwrap'
      const ndot = document.createElement('span')
      ndot.className = 'nickdot'
      ndot.classList.toggle('off', !onlineNicks.has(msg.nick))
      const n = document.createElement('span')
      n.className = 'nick'
      n.textContent = msg.nick
      nickwrap.append(ndot, n)
      msgDots.push({ nick: msg.nick, dot: ndot })
      const t = document.createElement('span')
      t.className = 'time'
      t.textContent = fmtTime(msg.ts)
      head.append(nickwrap, t)
      const body = document.createElement('span')
      body.className = 'text'
      body.textContent = msg.text
      m.append(head, body)
      messages.append(m)
      messages.scrollTop = messages.scrollHeight
    },
    setConnected(connected) {
      dot.classList.toggle('on', connected)
    },
    setPresence(nicks) {
      onlineNicks = new Set(nicks)
      for (const { nick: n, dot: d } of msgDots) {
        d.classList.toggle('off', !onlineNicks.has(n))
      }
    },
  }
}
