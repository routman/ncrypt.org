const MEOW = /^meow\.?$/i

export function isMeow(text) {
  return MEOW.test(String(text).trim())
}

const CATS = ['🐱', '🐈', '😺', '😸', '😻', '😽', '🐾']

export function catRain() {
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div')
    el.className = 'cat-fall'
    el.textContent = CATS[(Math.random() * CATS.length) | 0]
    el.style.left = Math.random() * 100 + 'vw'
    el.style.fontSize = 18 + Math.random() * 30 + 'px'
    el.style.animationDuration = 2 + Math.random() * 2 + 's'
    el.style.animationDelay = Math.random() * 0.6 + 's'
    document.body.append(el)
    el.addEventListener('animationend', () => el.remove())
  }
}
