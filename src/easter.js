// Each animal: the words that trigger it (case-insensitive, any trailing
// punctuation) plus the emojis that rain down.
const ANIMALS = [
  {
    words: ['meow'],
    emojis: ['🐱', '🐈', '😺', '😸', '😻', '😽', '🐾'],
  },
  {
    words: ['bark', 'woof'],
    emojis: ['🐶', '🐕', '🦮', '🐩'],
  },
  {
    words: ['moo'],
    emojis: ['🐮', '🐄'],
  },
  {
    words: ['quack'],
    emojis: ['🦆'],
  },
  {
    words: ['baa'],
    emojis: ['🐑'],
  },
  {
    words: ['oink'],
    emojis: ['🐷', '🐖'],
  },
  {
    words: ['ribbit'],
    emojis: ['🐸'],
  },
  {
    words: ['neigh'],
    emojis: ['🐴', '🐎'],
  },
  {
    words: ['howl'],
    emojis: ['🐺'],
  },
  {
    words: ['hoo'],
    emojis: ['🦉'],
  },
  {
    words: ['buzz'],
    emojis: ['🐝'],
  },
  {
    words: ['roar'],
    emojis: ['🦁'],
  },
  {
    words: ['chirp'],
    emojis: ['🐦'],
  },
  {
    words: ['cluck'],
    emojis: ['🐔', '🐣'],
  },
  {
    words: ['hee-haw'],
    emojis: ['🫏'],
  },
  {
    words: ['cock-a-doodle-doo'],
    emojis: ['🐓'],
  },
]

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// "word" + any trailing punctuation (anything that is not a letter/digit).
const MATCHERS = ANIMALS.map((a) => ({
  re: new RegExp('^(?:' + a.words.map(escapeRe).join('|') + ')[^\\p{L}\\p{N}]*$', 'iu'),
  emojis: a.emojis,
}))

export function animalRain(text) {
  const t = String(text).trim()
  for (const m of MATCHERS) {
    if (m.re.test(t)) {
      rain(m.emojis)
      return true
    }
  }
  return false
}

function rain(emojis) {
  for (let i = 0; i < 24; i++) {
    const el = document.createElement('div')
    el.className = 'animal-fall'
    el.textContent = emojis[(Math.random() * emojis.length) | 0]
    el.style.left = Math.random() * 100 + 'vw'
    el.style.fontSize = 18 + Math.random() * 30 + 'px'
    el.style.animationDuration = 2 + Math.random() * 2 + 's'
    el.style.animationDelay = Math.random() * 0.6 + 's'
    document.body.append(el)
    el.addEventListener('animationend', () => el.remove())
  }
}
