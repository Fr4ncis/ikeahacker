/** Colour helpers for shading isometric boxes. */

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

/** Multiplies a hex colour's brightness. `amount` > 1 lightens, < 1 darkens. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex)
  return `rgb(${clamp(r * amount)},${clamp(g * amount)},${clamp(b * amount)})`
}

/** Blends a hex colour towards another by `t` (0-1). */
export function mix(hex: string, towards: string, t: number): string {
  const a = parseHex(hex)
  const b = parseHex(towards)
  return `rgb(${clamp(a[0] + (b[0] - a[0]) * t)},${clamp(a[1] + (b[1] - a[1]) * t)},${clamp(a[2] + (b[2] - a[2]) * t)})`
}

/** Picks black or white text depending on how dark the background is. */
export function readableOn(hex: string): string {
  const [r, g, b] = parseHex(hex)
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#1b1b1d' : '#f5f5f4'
}

/** Face brightness multipliers, so a box reads as lit from above and the left. */
export const FACE_LIGHT = { top: 1.14, left: 0.94, right: 0.72 } as const
