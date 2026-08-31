let ctx = null

export function primeAudio() {
  if (ctx) return
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    if (ctx.state === 'suspended') ctx.resume()
  } catch {
    ctx = null
  }
}

export function ding() {
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume()
  const now = ctx.currentTime
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(880, now)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.26)
}
