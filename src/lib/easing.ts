/** Timing curves for the canvas animations. */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Settles gently. Good for anything sliding into place. */
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

/**
 * Overshoots slightly before settling, which is what makes a piece read as
 * having weight when it lands rather than simply appearing.
 */
export function easeOutBack(t: number, overshoot = 1.7): number {
  const c = overshoot + 1
  return 1 + c * (t - 1) ** 3 + overshoot * (t - 1) ** 2
}

export const lerp = (from: number, to: number, t: number) => from + (to - from) * t

/** How long a piece takes to drop into the room, in milliseconds. */
export const APPEAR_MS = 320
/** How long a removed piece lingers while it fades. */
export const VANISH_MS = 220
