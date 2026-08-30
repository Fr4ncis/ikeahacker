/**
 * Reading and writing layouts: validating one from an untrusted source, and
 * packing one into a URL so a plan can be shared as a link.
 *
 * The share format is deliberately compact because it has to fit in a URL. It
 * is a positional array rather than an object, article numbers travel as
 * numbers rather than strings, and rotation is a quarter-turn count. A typical
 * room encodes to well under a kilobyte. The payload lives in the fragment, so
 * it is never sent to a server.
 */
import { getItem } from './catalog'
import type { Layout, PlacedItem, Room } from './types'

const VERSION = 1

/** Article numbers are always eight digits, so leading zeros survive the trip as numbers. */
const ID_DIGITS = 8

export const SHARE_PARAM = 'p'

// --- Validation -------------------------------------------------------------

const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

const hex = (v: unknown, fallback: string): string =>
  typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback

const ROTATIONS: PlacedItem['rotation'][] = [0, 90, 180, 270]

export interface LoadedLayout {
  layout: Layout
  /** Items referencing articles that are no longer in the catalogue. */
  dropped: number
}

/**
 * Turns arbitrary parsed JSON into a layout we are willing to render.
 *
 * Anything malformed is rejected outright; anything merely unknown, such as an
 * article that has since left the catalogue, is dropped and counted so the
 * caller can say so rather than letting furniture silently disappear.
 */
export function sanitizeLayout(raw: unknown): LoadedLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Partial<Layout>
  if (input.version !== VERSION || !Array.isArray(input.items)) return null

  const r = (input.room ?? {}) as Partial<Room>
  const room: Room = {
    width: num(r.width, 100, 1200, 420),
    depth: num(r.depth, 100, 1200, 340),
    height: num(r.height, 100, 400, 250),
    wallColor: hex(r.wallColor, '#e8e4dc'),
    floorColor: hex(r.floorColor, '#c8ac86'),
  }

  let dropped = 0
  const items: PlacedItem[] = []
  for (const [index, entry] of input.items.entries()) {
    if (!entry || typeof entry !== 'object') {
      dropped++
      continue
    }
    const it = entry as Partial<PlacedItem>
    if (typeof it.itemId !== 'string' || !getItem(it.itemId)) {
      dropped++
      continue
    }
    items.push({
      // Regenerate instance ids so a layout pasted twice cannot collide.
      uid: `i${index.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      itemId: it.itemId,
      x: num(it.x, 0, 1200, 0),
      y: num(it.y, 0, 1200, 0),
      z: num(it.z, 0, 400, 0),
      rotation: ROTATIONS.includes(it.rotation as PlacedItem['rotation']) ? it.rotation! : 0,
      ...(typeof it.color === 'string' && /^#[0-9a-f]{6}$/i.test(it.color) ? { color: it.color } : {}),
    })
  }

  return {
    layout: {
      version: VERSION,
      name: typeof input.name === 'string' ? input.name.slice(0, 80) : 'Shared plan',
      room,
      items,
      savedAt: typeof input.savedAt === 'string' ? input.savedAt : new Date().toISOString(),
    },
    dropped,
  }
}

// --- base64url --------------------------------------------------------------

/** Chunked so a large payload cannot overflow the argument stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64ToBytes(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// --- Share encoding ---------------------------------------------------------

/** Positions are stored to a tenth of a centimetre; finer than that is noise. */
const round = (v: number) => Math.round(v * 10) / 10

type PackedItem = [number, number, number, number, number] | [number, number, number, number, number, string]
type Packed = [number, number, number, number, string, string, PackedItem[]]

export function encodeLayout(layout: Layout): string {
  const packed: Packed = [
    VERSION,
    round(layout.room.width),
    round(layout.room.depth),
    round(layout.room.height),
    layout.room.wallColor.replace('#', ''),
    layout.room.floorColor.replace('#', ''),
    layout.items.map((it): PackedItem => {
      const base: [number, number, number, number, number] = [
        Number(it.itemId),
        round(it.x),
        round(it.y),
        round(it.z),
        it.rotation / 90,
      ]
      return it.color ? [...base, it.color.replace('#', '')] : base
    }),
  ]
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(packed)))
}

export function decodeLayout(text: string): LoadedLayout | null {
  let packed: unknown
  try {
    packed = JSON.parse(new TextDecoder().decode(base64ToBytes(text)))
  } catch {
    return null
  }
  if (!Array.isArray(packed) || packed[0] !== VERSION || !Array.isArray(packed[6])) return null

  const [, width, depth, height, wall, floor, items] = packed as Packed
  return sanitizeLayout({
    version: VERSION,
    name: 'Shared plan',
    savedAt: new Date().toISOString(),
    room: {
      width,
      depth,
      height,
      wallColor: `#${wall}`,
      floorColor: `#${floor}`,
    },
    items: (items as PackedItem[]).map((p) => ({
      uid: '',
      itemId: String(p[0]).padStart(ID_DIGITS, '0'),
      x: p[1],
      y: p[2],
      z: p[3],
      rotation: ((p[4] ?? 0) * 90) as PlacedItem['rotation'],
      ...(p[5] ? { color: `#${p[5]}` } : {}),
    })),
  } satisfies Layout)
}

/** The full link to a plan, for copying to the clipboard. */
export function shareUrl(layout: Layout, base = window.location.href): string {
  const url = new URL(base)
  url.hash = `${SHARE_PARAM}=${encodeLayout(layout)}`
  return url.toString()
}

/** Reads a shared plan out of the current URL, if there is one. */
export function layoutFromUrl(hash = window.location.hash): LoadedLayout | null {
  const match = hash.replace(/^#/, '').match(new RegExp(`(?:^|&)${SHARE_PARAM}=([^&]+)`))
  return match ? decodeLayout(match[1]) : null
}
