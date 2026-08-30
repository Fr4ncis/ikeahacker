/**
 * Sound effects, synthesised rather than sampled.
 *
 * Every sound here is a few oscillators and an envelope, which keeps them out
 * of the bundle entirely and means no audio files to licence. They are short,
 * quiet and pitched to sit under the interface rather than announce
 * themselves.
 *
 * Browsers refuse to start audio before a gesture, so the context is created
 * on the first sound and resumed if it was suspended.
 */

const STORAGE_KEY = 'ikeahacker.sound'
const MASTER_GAIN = 0.22

type Ctx = AudioContext & { __master?: GainNode }

let context: Ctx | null = null
let enabled = readPreference()

function readPreference(): boolean {
  try {
    // On by default: the sounds are part of how the planner feels.
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function soundEnabled(): boolean {
  return enabled
}

export function setSoundEnabled(next: boolean): void {
  enabled = next
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
  } catch {
    // A blocked storage should not stop sound working for this session.
  }
  if (next) void ensureContext()?.resume()
}

function ensureContext(): Ctx | null {
  if (typeof window === 'undefined') return null
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    context = new Ctor() as Ctx
    const master = context.createGain()
    master.gain.value = MASTER_GAIN
    master.connect(context.destination)
    context.__master = master
  }
  if (context.state === 'suspended') void context.resume()
  return context
}

interface ToneOptions {
  /** Starting frequency in Hz. */
  from: number
  /** Frequency to glide to; defaults to `from`. */
  to?: number
  duration: number
  type?: OscillatorType
  gain?: number
  /** Seconds to wait before this tone starts. */
  delay?: number
}

function tone({ from, to = from, duration, type = 'sine', gain = 1, delay = 0 }: ToneOptions): void {
  const ctx = ensureContext()
  if (!ctx?.__master) return

  const start = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const env = ctx.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(from, start)
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration)

  // A quick attack and an exponential tail; a linear fade clicks at the end.
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(gain, start + 0.008)
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  osc.connect(env).connect(ctx.__master)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

/** A short burst of filtered noise, for the body of an impact. */
function thud(duration: number, frequency: number, gain: number): void {
  const ctx = ensureContext()
  if (!ctx?.__master) return

  const frames = Math.floor(ctx.sampleRate * duration)
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    // Noise shaped by a decaying envelope reads as a knock rather than a hiss.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3
  }

  const source = ctx.createBufferSource()
  source.buffer = buffer

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = frequency

  const env = ctx.createGain()
  env.gain.value = gain

  source.connect(filter).connect(env).connect(ctx.__master)
  source.start()
}

/** Every sound the interface can make. */
export const Sound = {
  /** A piece landing on the floor. */
  place() {
    if (!enabled) return
    tone({ from: 220, to: 120, duration: 0.14, type: 'sine', gain: 0.5 })
    thud(0.12, 500, 0.5)
  },

  /** Lifting a piece to drag it. */
  pickUp() {
    if (!enabled) return
    tone({ from: 520, to: 700, duration: 0.06, type: 'triangle', gain: 0.18 })
  },

  /** Setting a dragged piece back down. */
  drop() {
    if (!enabled) return
    tone({ from: 300, to: 160, duration: 0.1, type: 'sine', gain: 0.32 })
    thud(0.08, 420, 0.32)
  },

  /** Sliding onto the 5 cm grid, or flush against a wall. */
  snap() {
    if (!enabled) return
    tone({ from: 1180, duration: 0.035, type: 'square', gain: 0.06 })
  },

  /** A quarter turn, of a piece or of the room. */
  rotate() {
    if (!enabled) return
    tone({ from: 440, to: 660, duration: 0.07, type: 'triangle', gain: 0.16 })
    tone({ from: 660, to: 880, duration: 0.06, type: 'triangle', gain: 0.1, delay: 0.05 })
  },

  /** Taking a piece out of the room. */
  remove() {
    if (!enabled) return
    tone({ from: 420, to: 90, duration: 0.22, type: 'sawtooth', gain: 0.16 })
  },

  /** Two pieces occupying the same space. */
  clash() {
    if (!enabled) return
    tone({ from: 150, to: 90, duration: 0.18, type: 'square', gain: 0.12 })
    thud(0.14, 260, 0.4)
  },

  /** A general affirmative: saved, copied, exported. */
  confirm() {
    if (!enabled) return
    tone({ from: 660, duration: 0.09, type: 'sine', gain: 0.22 })
    tone({ from: 990, duration: 0.14, type: 'sine', gain: 0.2, delay: 0.075 })
  },

  /** Something did not work. */
  reject() {
    if (!enabled) return
    tone({ from: 320, to: 200, duration: 0.16, type: 'square', gain: 0.12 })
  },

  /** Small interface click, for toggles and pills. */
  tick() {
    if (!enabled) return
    tone({ from: 900, duration: 0.025, type: 'square', gain: 0.05 })
  },
}
