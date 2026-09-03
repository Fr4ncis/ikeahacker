/**
 * What a product is made of, and how it arrives.
 *
 * A product page carries three things the planner has no other way to know:
 * the assembly instructions, the articles a combination is built from, and the
 * flat-packs it comes home in. All three are on the page as structured data or
 * as plain links, so this reads them out and `public/parts.json` keeps them.
 *
 * The instructions are linked, never copied. They are IKEA's documents, the
 * link is the same one the product page offers, and a PDF mirrored into this
 * repository would be both a copyright problem and out of date by the time
 * anyone read it.
 *
 *   npm run parts                  # every product without an entry yet
 *   PARTS_LIMIT=50 npm run parts   # a taste of it
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapLimit } from './pip.ts'
import type { Catalog, CatalogItem } from '../src/lib/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const CATALOG = resolve(here, '../public/catalog.json')
const PARTS = resolve(here, '../public/parts.json')
const CACHE_DIR = resolve(here, '.cache/parts')

const LIMIT = Number(process.env.PARTS_LIMIT ?? 5000)
const CONCURRENCY = Number(process.env.PARTS_CONCURRENCY ?? 4)

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

export interface Manual {
  /** "Assembly instructions" or "Manual". */
  kind: 'assembly' | 'manual'
  /** What the link is called on the product page, e.g. "BILLY Bookcase". */
  label: string
  url: string
}

/** One article a combination is built from. */
export interface Part {
  id: string
  /** The dotted form IKEA prints on the label, e.g. "002.458.42". */
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

export interface PartsFile {
  version: 1
  builtAt: string
  products: Record<string, ProductParts>
}

/** IKEA escapes forward slashes inside the page's embedded JSON. */
const unescape = (s: string) => s.replace(/\\u002F/g, '/').replace(/\\\//g, '/')

/**
 * The instruction sheets linked on the page.
 *
 * A combination links one per article it is built from, which is why a BESTÅ
 * run can have twenty of them, and why they keep the label the page gives
 * them: "BESTÅ Frame" is the only thing that tells you which sheet is which.
 */
export function extractManuals(html: string): Manual[] {
  const found = new Map<string, Manual>()
  // Unescaped first rather than per match: the same link appears both as a
  // plain href and inside the page's embedded JSON, where every slash is
  // written \u002F, and a pattern written for one form silently misses the other.
  const source = unescape(html)
  const link = /href="(https:\/\/www\.ikea\.com\/[^"]*?\/(assembly_instructions|manuals)\/[^"]*?\.pdf)"[^>]*?aria-label="([^"]*?)(?:\s*\(opens[^"]*)?"/g

  for (const [, url, section, label] of source.matchAll(link)) {
    if (found.has(url)) continue
    found.set(url, {
      kind: section === 'manuals' ? 'manual' : 'assembly',
      label: label.replace(/&amp;/g, '&').trim(),
      url,
    })
  }
  return [...found.values()]
}

/** Reads a balanced JSON value out of the page, starting at `open`. */
function jsonAt(html: string, open: number): unknown | null {
  const first = html[open]
  const close = first === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = open; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === first) depth++
    else if (c === close) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(open, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

interface RawSub {
  itemNo?: string
  visibleItemNo?: string
  name?: string
  typeName?: string
  quantity?: number
}

/** The articles a combination is built from, with how many of each. */
export function extractParts(html: string): Part[] {
  const at = html.indexOf('"subProducts":[')
  if (at === -1) return []
  const raw = jsonAt(html, at + '"subProducts":'.length)
  if (!Array.isArray(raw)) return []

  return (raw as RawSub[])
    .filter((p) => p.itemNo && p.name)
    .map((p) => ({
      id: p.itemNo!,
      article: p.visibleItemNo ?? '',
      name: p.name!,
      type: (p.typeName ?? '').trim(),
      quantity: Math.max(1, Math.round(p.quantity ?? 1)),
    }))
}

interface RawPackage {
  measurementGroups?: { measurements?: { type?: string; value?: number }[] }[]
  quantity?: { value?: number }
}

/**
 * The flat-packs the product arrives in.
 *
 * Taken from the packaging block rather than the product's own measurements:
 * a 202 cm bookcase travels as a 207 cm box, and it is the box that has to go
 * up the stairs.
 */
export function extractBoxes(html: string): Box[] {
  const at = html.indexOf('"packaging":')
  if (at === -1) return []
  const raw = jsonAt(html, html.indexOf('{', at)) as { packages?: RawPackage[] } | null
  if (!raw?.packages) return []

  const boxes: Box[] = []
  for (const pack of raw.packages) {
    const measures: Record<string, number> = {}
    for (const group of pack.measurementGroups ?? [])
      for (const m of group.measurements ?? []) if (m.type && m.value !== undefined) measures[m.type] = m.value

    const box: Box = {
      width: measures.width ?? 0,
      height: measures.height ?? 0,
      length: measures.length ?? 0,
      weight: measures.weight ?? 0,
    }
    if (!box.width && !box.length && !box.weight) continue
    for (let i = 0; i < Math.max(1, Math.round(pack.quantity?.value ?? 1)); i++) boxes.push(box)
  }
  return boxes
}

export const extractProductParts = (html: string): ProductParts => ({
  manuals: extractManuals(html),
  parts: extractParts(html),
  boxes: extractBoxes(html),
})

const isEmpty = (p: ProductParts) => !p.manuals.length && !p.parts.length && !p.boxes.length

/** The same grouping the app uses: one entry per product, not per colourway. */
const groupKey = (i: CatalogItem) => `${i.system}|${i.name}|${i.type}|${i.width}x${i.depth}x${i.height}`

async function fetchParts(item: CatalogItem): Promise<ProductParts | null> {
  const file = resolve(CACHE_DIR, `${item.id}.json`)
  try {
    return JSON.parse(await readFile(file, 'utf8')) as ProductParts
  } catch {
    // Not fetched yet.
  }

  let parts: ProductParts = { manuals: [], parts: [], boxes: [] }
  try {
    const res = await fetch(item.productUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-GB,en;q=0.9' },
    })
    // A retired article redirects to a category page, which has none of this.
    if (res.ok && res.url.includes('/p/')) parts = extractProductParts(await res.text())
  } catch {
    return null
  }
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(file, JSON.stringify(parts))
  return parts
}

async function main() {
  const catalog = JSON.parse(await readFile(CATALOG, 'utf8')) as Catalog
  const existing: PartsFile = await readFile(PARTS, 'utf8')
    .then((raw) => JSON.parse(raw) as PartsFile)
    .catch(() => ({ version: 1, builtAt: '', products: {} }))

  const groups = new Map<string, CatalogItem>()
  for (const item of catalog.items) if (!groups.has(groupKey(item))) groups.set(groupKey(item), item)

  const products = existing.products
  const pending = [...groups.values()].filter((i) => !products[i.id])
  const budget = pending.slice(0, LIMIT)
  console.log(`${groups.size} products, ${Object.keys(products).length} done, fetching ${budget.length}`)

  let withManuals = 0
  let withParts = 0
  let withBoxes = 0

  await mapLimit(budget, CONCURRENCY, async (item, index) => {
    if (index % 50 === 0 && index) console.log(`  ${index}/${budget.length}…`)
    const parts = await fetchParts(item)
    if (!parts || isEmpty(parts)) return
    products[item.id] = parts
    if (parts.manuals.length) withManuals++
    if (parts.parts.length) withParts++
    if (parts.boxes.length) withBoxes++
  })

  await writeFile(PARTS, JSON.stringify({ version: 1, builtAt: new Date().toISOString(), products } satisfies PartsFile))
  const total = Object.keys(products).length
  console.log(`\n${total} products described`)
  console.log(`  ${withManuals} gained instructions, ${withParts} a parts list, ${withBoxes} package sizes (this run)`)
  console.log(`wrote ${PARTS} (${((await readFile(PARTS)).length / 1024).toFixed(0)} KB)`)
}

// Only when run as the script: the tests import the extractors above.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
