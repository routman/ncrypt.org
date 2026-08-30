import { getIdentityId, nickSuffix } from './crypto.js'

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
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

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
  nickField.className = 'field nickrow'
  const nickInput = document.createElement('input')
  nickInput.autocapitalize = 'off'
  nickInput.maxLength = 20
  nickInput.placeholder = 'nickname'
  nickInput.value = localStorage.getItem(NICK_KEY) || ''
  const idSpan = document.createElement('span')
  idSpan.className = 'id'
  idSpan.style.display = 'none'
  nickField.append(nickInput, idSpan)

  let idGen = 0
  function updateId() {
    const topic = topicInput.value
    const nick = nickInput.value
    if (!nick) {
      idSpan.style.display = 'none'
      idSpan.textContent = ''
      return
    }
    idSpan.style.display = ''
    const myGen = ++idGen
    nickSuffix(getIdentityId(), topic, nick).then((suffix) => {
      if (myGen !== idGen) return
      idSpan.textContent = '-' + suffix
    })
  }
  topicInput.addEventListener('input', updateId)
  nickInput.addEventListener('input', updateId)
  updateId()

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

export function mountChatView({ nick, topic, onHome, onSend }) {
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
  topicLabel.textContent = 'channel: ' + topic
  const nickLabel = document.createElement('span')
  nickLabel.className = 'nick'
  nickLabel.textContent = nick
  const dot = document.createElement('span')
  dot.className = 'dot'
  const nickwrap = document.createElement('span')
  nickwrap.className = 'nickwrap'
  nickwrap.append(nickLabel, dot)
  header.append(logo, topicLabel, nickwrap)

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

  return {
    append(msg) {
      const m = document.createElement('div')
      m.className = 'msg' + (msg.nick === nick ? ' own' : '')
      const head = document.createElement('div')
      head.className = 'head'
      const n = document.createElement('span')
      n.className = 'nick'
      n.textContent = msg.nick
      const t = document.createElement('span')
      t.className = 'time'
      t.textContent = fmtTime(msg.ts)
      head.append(n, t)
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
  }
}
