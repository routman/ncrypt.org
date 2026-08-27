const NICK_KEY = 'ncrypt-nick'

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function mountTopicScreen({ onJoin }) {
  const app = document.getElementById('app')
  app.textContent = ''

  const screen = document.createElement('div')
  screen.className = 'screen'

  const h1 = document.createElement('h1')
  h1.textContent = 'ncrypt.org'

  const topicField = document.createElement('div')
  topicField.className = 'field'
  const topicInput = document.createElement('input')
  topicInput.type = 'password'
  topicInput.maxLength = 100
  topicInput.placeholder = 'topic'
  const eye = document.createElement('div')
  eye.className = 'eye'
  eye.addEventListener('click', () => {
    const show = topicInput.type === 'password'
    topicInput.type = show ? 'text' : 'password'
    eye.classList.toggle('closed', show)
  })
  topicField.append(topicInput, eye)

  const nickField = document.createElement('div')
  nickField.className = 'field'
  const nickInput = document.createElement('input')
  nickInput.maxLength = 20
  nickInput.placeholder = 'nickname'
  nickInput.value = localStorage.getItem(NICK_KEY) || ''
  nickField.append(nickInput)

  const error = document.createElement('div')
  error.className = 'error'

  const join = document.createElement('button')
  join.textContent = 'join'
  join.addEventListener('click', () => {
    const topic = topicInput.value.trim()
    const nick = nickInput.value.trim()
    if (topic.length < 1 || topic.length > 100) {
      error.textContent = 'topic must be 1-100 characters'
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

  screen.append(h1, topicField, nickField, error, join)
  app.append(screen)
  topicInput.focus()
}

export function mountChatView({ nick, onSend }) {
  const app = document.getElementById('app')
  app.textContent = ''

  const chat = document.createElement('div')
  chat.className = 'chat'

  const header = document.createElement('div')
  header.className = 'chatheader'
  const nickLabel = document.createElement('span')
  nickLabel.className = 'nick'
  nickLabel.textContent = nick
  const dot = document.createElement('span')
  dot.className = 'dot'
  header.append(nickLabel, dot)

  const note = document.createElement('div')
  note.className = 'note'
  note.textContent = 'last 100 messages'

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

  chat.append(header, note, messages, composer)
  app.append(chat)
  input.focus()

  return {
    append(msg) {
      const m = document.createElement('div')
      m.className = 'msg' + (msg.nick === nick ? ' own' : '')
      const n = document.createElement('span')
      n.className = 'nick'
      n.textContent = msg.nick
      const t = document.createElement('span')
      t.className = 'time'
      t.textContent = fmtTime(msg.ts)
      const body = document.createElement('span')
      body.className = 'text'
      body.textContent = msg.text
      m.append(n, t, body)
      messages.append(m)
      messages.scrollTop = messages.scrollHeight
    },
    setConnected(connected) {
      dot.classList.toggle('on', connected)
    },
  }
}
