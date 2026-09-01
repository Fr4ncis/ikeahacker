/**
 * Dunelm product pages.
 *
 * Unlike IKEA, Dunelm server-renders everything worth having into the HTML:
 * a schema.org `Product` blob, and a list of `{"property":...,"value":...}`
 * attributes that includes a labelled `Product Dimensions` string. So one
 * request per product is enough and there is no search API to lean on first.
 *
 * As in `pip.ts`, the disk cache stores the extracted fields rather than the
 * finished item, because pages are ~270 KB and deciding what counts as a width
 * is the part most likely to change. Re-reading 3,000 cached blobs is free;
 * re-downloading 800 MB is not.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '.cache/dunelm')

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

/** What one product page is worth keeping, before any interpretation. */
export interface RawProduct {
  id: string
  name: string
  category: string
  description: string
  image: string
  sku: string
  color: string
  price: number | null
  currency: string
  /** Attribute list, e.g. `{ "Product Dimensions": "<p>H 140cm...</p>", "Brand": "..." }`. */
  attributes: Record<string, string>
}

export interface Dims {
  width: number
  depth: number
  height: number
}

/** A size published on the page, with the label it was listed under. */
export interface LabelledDims extends Dims {
  /** "" for the plain case, else "Single", "Table Closed", and so on. */
  label: string
}

/**
 * Blocks whose label names a part rather than the product. This is a guard,
 * not the mechanism: the product is identified by being listed first, and this
 * list only stops a shelf being mistaken for the product when the product's own
 * block is missing a dimension. Trying to enumerate every part name would be a
 * losing game, which is why it is not what the parser relies on.
 */
const PART_LABELS =
  /\b(shelf|shelves|drawers?|seats?|mattress|arms?|legs?|back|internal|packaging|box|cushions?|headboard|footboard|clearance|between|space|storage|compartment)\b/i

/**
 * Mattress sizes, the one case where a single page really is several products.
 * Dunelm writes "Kingsize" as one word about as often as "King Size", so a
 * plain `king\b` misses a size on most bed pages.
 */
const BED_SIZES =
  /^(small\s+single|single|small\s+double|double|super\s*king(?:\s*size)?|king(?:\s*size)?|emperor)\b/i

const sane = (v: number): boolean => Number.isFinite(v) && v >= 5 && v <= 400

/**
 * Reads one `H 140cm x W 63cm x D 32cm` block.
 *
 * Dunelm labels its axes, which is a good deal more robust than IKEA's bare
 * `100x58x201 cm`, but the labels move: beds lead with W, some products write
 * `H:` with a colon, and older listings append imperial in brackets, so
 * `H 65cm (26")` must not be read as 26. Stripping bracketed text first is what
 * makes the rest a simple label-to-number scan.
 */
function parseBlock(text: string, isBed: boolean): Dims | null {
  const cleaned = text.replace(/\([^)]*\)/g, ' ')
  const found: Record<string, number> = {}
  const re = /\b([HWDL])\s*:?\s*(\d+(?:\.\d+)?)\s*cm\b/gi
  for (let m = re.exec(cleaned); m; m = re.exec(cleaned)) {
    const axis = m[1].toUpperCase()
    // First wins, so "H 197cm x W 74cm x D 53cm" is not overwritten by a
    // trailing note that repeats an axis.
    found[axis] ??= parseFloat(m[2])
  }

  let { W: width, D: depth, H: height } = found
  const { L: length } = found

  // Most furniture is published as H/W/D, but bed frames give a length instead
  // of a depth, and so do the odd table and ottoman. This is the same call
  // `dimsFromMeasures` makes for IKEA, for the same reason: a bed's length runs
  // head to foot, i.e. away from the wall, so it is the depth, while on
  // anything else the length is simply the long horizontal side.
  if (length !== undefined) {
    if (height === undefined && width !== undefined && depth !== undefined) {
      // "Single: L 190cm x W 90cm x D 38cm", which divan bases use. All three
      // letters are present and none of them is H, so the D is doing the job of
      // the height and the length is the depth. Reading this literally leaves
      // the block with no height at all, and the parser then falls through to
      // whatever comes next, which is how a divan base became its own drawer.
      height = depth
      depth = length
    } else if (isBed) {
      depth ??= length
    } else if (depth === undefined && width !== undefined) {
      depth = Math.min(width, length)
      width = Math.max(width, length)
    } else {
      width ??= length
    }
  }

  if (width === undefined || depth === undefined || height === undefined) return null
  if (!sane(width) || !sane(depth) || !sane(height)) return null
  return { width, depth, height }
}

/** Splits the value into its `<p>` blocks, each paired with its leading label. */
function blocks(value: string): { label: string; text: string }[] {
  return value
    .split(/<\/p>|<br\s*\/?>|\n/i)
    .map((s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text) => {
      const m = text.match(/^([^:]{1,40}):\s*(.*)$/)
      // A colon straight after an axis letter is the "H: 77cm" spelling, not a label.
      if (m && !/^\s*[HWD]\s*$/i.test(m[1])) return { label: m[1].trim(), text: m[2] }
      return { label: '', text }
    })
}

/**
 * Turns a `Product Dimensions` value into one or more placeable sizes.
 *
 * The value is a run of blocks and only the first describes the whole product;
 * the rest are shelves, drawers and seats. The exception is beds, which list a
 * size per mattress and really are several products, so those are kept.
 */
export function parseDimensions(value: string | undefined, isBed = false): LabelledDims[] {
  if (!value) return []
  const parsed = blocks(value)

  let first = -1
  for (let i = 0; i < parsed.length; i++) {
    if (PART_LABELS.test(parsed[i].label)) continue
    if (parseBlock(parsed[i].text, isBed)) {
      first = i
      break
    }
  }
  if (first === -1) return []

  const out: LabelledDims[] = [{ label: parsed[first].label, ...parseBlock(parsed[first].text, isBed)! }]

  // A bed page lists Single, Double and King as separate lines. Taking only the
  // first would quietly drop two thirds of the product.
  if (BED_SIZES.test(parsed[first].label)) {
    for (let i = first + 1; i < parsed.length; i++) {
      // A part header such as "Drawer Space:" or "Ottoman Storage Space:" is
      // followed by that part's own run of Single/Double/Kingsize lines. Those
      // carry exactly the labels we are looking for, so scanning past a header
      // collects a drawer as though it were a mattress size. Everything after
      // the first header describes a part, so stop there.
      if (PART_LABELS.test(parsed[i].label)) break
      if (!BED_SIZES.test(parsed[i].label)) continue
      const dims = parseBlock(parsed[i].text, isBed)
      if (dims) out.push({ label: parsed[i].label, ...dims })
    }
  }
  return out
}

/**
 * Does this Dunelm category describe a bed, for the purpose of reading its
 * length as a depth? Sofa beds are excluded on purpose: folded, their long
 * axis runs along the wall like any other sofa, so it is the width. "Bedside"
 * is not a bed either, which is why this tests for a whole word.
 */
export const isBedCategory = (category: string): boolean =>
  /\bbed\b|\bbeds\b|bunk|divan|bedstead/i.test(category) && !/sofa/i.test(category)

/** Pulls the schema.org Product blob and the attribute list out of a page. */
export function extractProduct(html: string): RawProduct | null {
  const re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g
  let product: Record<string, unknown> | null = null
  for (let m = re.exec(html); m; m = re.exec(html)) {
    try {
      const j = JSON.parse(m[1]) as Record<string, unknown>
      if (j['@type'] === 'Product') {
        product = j
        break
      }
    } catch {
      // Reviews and breadcrumbs share the tag and are of no interest here.
    }
  }
  if (!product) return null

  const attributes: Record<string, string> = {}
  const attrRe = /\{"property":"((?:[^"\\]|\\.)*)","value":"((?:[^"\\]|\\.)*)"\}/g
  for (let m = attrRe.exec(html); m; m = attrRe.exec(html)) {
    try {
      attributes[JSON.parse(`"${m[1]}"`)] ??= JSON.parse(`"${m[2]}"`)
    } catch {
      // A value we cannot unescape is a value we do not want.
    }
  }

  const offers = (product.offers ?? {}) as { price?: string | number; priceCurrency?: string }
  const image = product.image
  const price = offers.price === undefined ? null : Number(offers.price)

  return {
    id: String(product['@id'] ?? ''),
    name: String(product.name ?? ''),
    category: String(product.category ?? ''),
    description: String(product.description ?? ''),
    image: Array.isArray(image) ? String(image[0] ?? '') : String(image ?? ''),
    sku: String(product.sku ?? ''),
    color: String(product.color ?? ''),
    price: price !== null && Number.isFinite(price) ? price : null,
    currency: String(offers.priceCurrency ?? 'GBP'),
    attributes,
  }
}

/**
 * Reads the cache, distinguishing "not cached" from "cached as nothing". A
 * miss is stored as `null`, so returning `null` for both would re-download
 * every page that has no product on it, on every run.
 */
async function readCache(id: string): Promise<{ hit: RawProduct | null } | null> {
  try {
    return { hit: JSON.parse(await readFile(resolve(CACHE_DIR, `${id}.json`), 'utf8')) as RawProduct | null }
  } catch {
    return null
  }
}

/** Fetches (or reads from cache) one product page's extractable fields. */
export async function fetchProduct(id: string, url: string): Promise<RawProduct | null> {
  const cached = await readCache(id)
  if (cached) return cached.hit

  let raw: RawProduct | null = null
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-GB,en;q=0.9' },
    })
    if (res.ok) raw = extractProduct(await res.text())
  } catch {
    // A page we could not read is a product we do not list.
  }
  await mkdir(CACHE_DIR, { recursive: true })
  // Misses are cached too, so a re-run does not re-download a page that has
  // nothing on it. `null` is written as such and read back as a cache hit.
  await writeFile(resolve(CACHE_DIR, `${id}.json`), JSON.stringify(raw))
  return raw
}
