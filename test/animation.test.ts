/**
 * Checks on the drop-in animation and its timing curves. Screenshots race the
 * animation, so the maths is asserted directly: a piece must end up exactly
 * where it belongs, however it got there.
 *
 * Run with `npm test`.
 */
import { APPEAR_MS, clamp01, easeOutBack, easeOutCubic, lerp, VANISH_MS } from '../src/lib/easing.ts'
import { liftAndScale } from '../src/lib/render.ts'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`)
}
const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

// --- Curves -----------------------------------------------------------------

check('easing starts at nothing and ends complete',
  close(easeOutCubic(0), 0) && close(easeOutCubic(1), 1) && close(easeOutBack(0), 0) && close(easeOutBack(1), 1))

check('easeOutCubic never overshoots',
  Array.from({ length: 101 }, (_, i) => easeOutCubic(i / 100)).every((v) => v >= 0 && v <= 1))

check('easeOutBack does overshoot, which is what gives the landing its weight',
  Array.from({ length: 101 }, (_, i) => easeOutBack(i / 100)).some((v) => v > 1.02))

check('easeOutCubic only ever moves forwards',
  Array.from({ length: 101 }, (_, i) => easeOutCubic(i / 100)).every((v, i, a) => i === 0 || v >= a[i - 1]))

check('clamp01 holds the ends', clamp01(-5) === 0 && clamp01(5) === 1 && close(clamp01(0.3), 0.3))
check('lerp spans its range', close(lerp(10, 20, 0), 10) && close(lerp(10, 20, 1), 20) && close(lerp(10, 20, 0.5), 15))
check('the timings are short enough not to be in the way', APPEAR_MS <= 400 && VANISH_MS <= 300)

// --- The transform ----------------------------------------------------------

const box = { vx0: 100, vy0: 50, vx1: 180, vy1: 90, z0: 0, z1: 200, tint: 1, detailFront: true }
const bounds = { vx0: 100, vy0: 50, vx1: 180, vy1: 90 }

check(
  'a settled piece is left exactly alone',
  (() => {
    const out = liftAndScale(box, bounds, 1, 0)
    return (['vx0', 'vy0', 'vx1', 'vy1', 'z0', 'z1'] as const).every((k) => close(out[k], box[k]))
  })(),
)

check(
  'a piece arriving is smaller and off the floor',
  (() => {
    const out = liftAndScale(box, bounds, 0.5, 26)
    return out.vx1 - out.vx0 < box.vx1 - box.vx0 && out.z0 > box.z0 && out.z1 < box.z1 + 26
  })(),
)

check(
  'scaling happens about the footprint centre, so a piece does not slide as it lands',
  (() => {
    const centreX = (box.vx0 + box.vx1) / 2
    const centreY = (box.vy0 + box.vy1) / 2
    return [0.2, 0.5, 0.9, 1].every((scale) => {
      const out = liftAndScale(box, bounds, scale, 0)
      return close((out.vx0 + out.vx1) / 2, centreX) && close((out.vy0 + out.vy1) / 2, centreY)
    })
  })(),
)

check(
  'the footprint scales in proportion',
  (() => {
    const out = liftAndScale(box, bounds, 0.25, 0)
    return close(out.vx1 - out.vx0, (box.vx1 - box.vx0) * 0.25) && close(out.vy1 - out.vy0, (box.vy1 - box.vy0) * 0.25)
  })(),
)

check(
  'the lift applies equally to top and bottom, so the piece stays rigid',
  (() => {
    const out = liftAndScale(box, bounds, 1, 30)
    return close(out.z0 - box.z0, 30) && close(out.z1 - box.z1, 30)
  })(),
)

check(
  'a sub-box keeps its place within the piece throughout',
  (() => {
    // A sofa's back is offset inside its parent footprint; that offset must
    // shrink with the rest rather than drifting.
    const back = { ...box, vy1: 62 }
    return [0.3, 0.7, 1].every((scale) => {
      const whole = liftAndScale(box, bounds, scale, 0)
      const part = liftAndScale(back, bounds, scale, 0)
      const wholeSpan = whole.vy1 - whole.vy0
      const partSpan = part.vy1 - part.vy0
      return close(partSpan / wholeSpan, (back.vy1 - back.vy0) / (box.vy1 - box.vy0))
    })
  })(),
)

check(
  'the animation reaches its exact final position, not merely near it',
  (() => {
    // The last frame runs at appear = 1, and must land on the true geometry.
    const grow = easeOutBack(clamp01((APPEAR_MS + 1) / APPEAR_MS))
    const lift = (1 - easeOutCubic(clamp01((APPEAR_MS + 1) / APPEAR_MS))) * 26
    const out = liftAndScale(box, bounds, grow, lift)
    return (['vx0', 'vy0', 'vx1', 'vy1', 'z0', 'z1'] as const).every((k) => close(out[k], box[k], 1e-9))
  })(),
)

check(
  'other box properties survive the transform',
  (() => {
    const out = liftAndScale({ ...box, tint: 0.9, detailFront: false }, bounds, 0.5, 5)
    return out.tint === 0.9 && out.detailFront === false
  })(),
)

console.log(failures ? `\n${failures} failing` : `\nall passing`)
process.exit(failures ? 1 : 0)
