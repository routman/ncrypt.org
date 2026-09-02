const ALT = ['[nN]', '[iI1]', '[gG]', '[gG]', '[eE3]', '[rR]']
const SEP = '[\\s-]?'
const SLUR_RE = new RegExp(
  `(?<![0-9A-Za-z])${ALT.join(SEP)}(?![0-9A-Za-z])`,
  'g',
)

export function sanitizeSlur(text) {
  return String(text).replace(SLUR_RE, 'n****')
}
