/**
 * What a product is made of, and how it arrives.
 *
 * Built by `npm run parts` into `public/parts.json` and fetched beside the
 * catalogue. Optional, like the shapes: a fork that never runs the pass, or a
 * product added by the nightly re-scrape before it runs again, simply shows
 * nothing here rather than breaking.
 *
 * These types mirror `scraper/parts.ts`. They are written out twice because
 * `src/` must not import from the scraper, which reads the filesystem.
 */
import { groupOf } from './catalog'

export interface Manual {
  kind: 'assembly' | 'manual'
  label: string
  url: string
}

export interface Part {
  id: string
  article: string
  name: string
  type: string
  quantity: number
}

export interface Box {
  width: number
  height: number
  length: number
  weight: number
}

export interface ProductParts {
  manuals: Manual[]
  parts: Part[]
  boxes: Box[]
}

let products: Record<string, ProductParts> | null = null
let inFlight: Promise<void> | null = null

/**
 * Fetches the file, once, the first time anything asks.
 *
 * It is 2.6 MB -- larger than the catalogue -- and it is reference material:
 * the boxes and the instruction sheets matter when you are working out whether
 * a plan goes home in one trip, not while you are moving furniture around. So
 * it stays off the path that has to finish before the first frame.
 */
export function ensureParts(): Promise<void> {
  if (products) return Promise.resolve()
  inFlight ??= fetch(`${import.meta.env.BASE_URL}parts.json`)
    .then((res) => (res.ok ? (res.json() as Promise<{ products?: Record<string, ProductParts> }>) : null))
    .then((file) => {
      products = file?.products ?? {}
    })
    .catch(() => {
      // Never run, or not deployed: the panel simply has nothing to show.
      products = {}
    })
  return inFlight
}

/**
 * What is known about a product, or nothing.
 *
 * A colourway falls back to its product's other articles: the same piece in a
 * different finish is assembled from the same articles, out of the same boxes,
 * with the same instructions, and the pass only fetched one of them.
 */
export function partsOf(itemId: string): ProductParts | undefined {
  if (!products) return undefined
  const direct = products[itemId]
  if (direct) return direct
  const group = groupOf(itemId)
  return group?.variants.map((v) => products![v.id]).find(Boolean)
}

/** Total weight of a set of boxes, which is what has to come up the stairs. */
export const weightOf = (boxes: Box[]) => boxes.reduce((sum, b) => sum + b.weight, 0)

/** "5 packages · 14.7 kg", or just the weight when there is one box. */
export function packageSummary(boxes: Box[]): string {
  if (!boxes.length) return ''
  const kg = weightOf(boxes)
  const packages = `${boxes.length} package${boxes.length === 1 ? '' : 's'}`
  return kg > 0 ? `${packages} · ${kg.toFixed(kg < 10 ? 1 : 0)} kg` : packages
}

/** The biggest box, which is the one that has to fit through the door. */
export function largestBox(boxes: Box[]): Box | null {
  let biggest: Box | null = null
  for (const b of boxes) {
    if (!biggest || b.length * b.width * b.height > biggest.length * biggest.width * biggest.height) biggest = b
  }
  return biggest
}

/**
 * The instruction sheet for one part of a combination.
 *
 * IKEA labels the sheets by product and type -- "BESTÅ Frame" for the part it
 * calls a "frame" -- so the two are matched on that rather than on an article
 * number, which the sheets do not carry.
 */
export function manualFor(part: Part, manuals: Manual[]): Manual | undefined {
  const want = `${part.name} ${part.type}`.toLowerCase().trim()
  return manuals.find((m) => m.label.toLowerCase().trim() === want)
}

/** Whatever is left once each part has taken its own sheet. */
export function looseManuals(parts: Part[], manuals: Manual[]): Manual[] {
  const claimed = new Set(parts.map((p) => manualFor(p, manuals)?.url).filter(Boolean))
  return manuals.filter((m) => !claimed.has(m.url))
}
