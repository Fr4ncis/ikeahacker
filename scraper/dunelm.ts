/**
 * Scrapes Dunelm furniture into `public/catalog-dunelm.json`.
 *
 * Dunelm has no usable search API: category pages render their grid on the
 * client and the `CollectionPage` blob ships an empty item list, so there is
 * nothing cheap to page through. What it does have is a complete sitemap and a
 * product page that server-renders both a schema.org `Product` blob and a
 * labelled `Product Dimensions` string. So discovery is the sitemap, and
 * everything else is one request per product.
 *
 * The sitemap holds ~42,000 URLs, the overwhelming majority of them homeware.
 * A slug keyword filter cuts that to ~3,300 candidates, which is only a
 * prefilter: what actually decides is the `category` on the page itself, so a
 * greedy keyword costs a wasted fetch rather than a bathmat in the planner.
 *
 * Output is a separate file from `catalog.json` on purpose. The nightly
 * re-scrape workflow rewrites `catalog.json` from IKEA alone, and merging the
 * two sources into one file would have it delete every Dunelm product once a
 * night.
 *
 *   npm run scrape:dunelm              # fetch and write
 *   npm run scrape:dunelm -- --dry-run # fetch and report, write nothing
 *   DUNELM_LIMIT=50 npm run scrape:dunelm
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapLimit } from './pip.ts'
import {
  fetchProduct,
  isBedCategory,
  parseDimensions,
  type LabelledDims,
  type RawProduct,
} from './dunelm-pdp.ts'
import { colorForFinish, DEFAULT_COLOR } from './finish.ts'
import type { Catalog, CatalogItem, FaceStyle, SystemCategory, SystemSummary } from '../src/lib/types.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../public/catalog-dunelm.json')
const CACHE_DIR = resolve(HERE, '.cache/dunelm')

const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT = Number(process.env.DUNELM_LIMIT ?? 6000)
const CONCURRENCY = Number(process.env.DUNELM_CONCURRENCY ?? 4)

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

/**
 * Slugs worth opening. Deliberately generous: a false positive costs one
 * request and is then thrown away by the category check, whereas a false
 * negative is a product that can never appear.
 */
const CANDIDATE =
  /(bookcase|shelving|shelf-unit|wardrobe|chest-of-drawers|drawer-chest|bedside|sideboard|tv-unit|tv-stand|media-unit|desk|dining-table|dining-set|coffee-table|console-table|side-table|lamp-table|nest-of-tables|sofa|settee|armchair|accent-chair|dining-chair|bar-stool|footstool|ottoman|blanket-box|bed-frame|bedstead|bunk|daybed|divan|cabinet|cupboard|dressing-table|display-unit|storage-unit|bench)/

/**
 * Dunelm's own category, mapped to how the planner files and draws a piece.
 * Order matters: a coffee table is a table, but it belongs in the living room
 * and is drawn as a surface, so it has to be tested before the plain table
 * rule. Anything unmatched is not furniture and is dropped, which is what
 * keeps 42,000 sitemap entries down to a catalogue.
 */
const CATEGORIES: [RegExp, SystemCategory, FaceStyle][] = [
  [/wardrobe/i, 'wardrobe', 'double-door'],
  [/bookcase|shelv/i, 'shelving', 'shelves'],
  [/bedside/i, 'bedroom', 'drawers'],
  [/chest of drawers|drawer/i, 'bedroom', 'drawers'],
  [/dressing table/i, 'bedroom', 'surface'],
  [/bed|bunk|divan|headboard/i, 'bedroom', 'soft'],
  [/desk/i, 'office', 'surface'],
  [/coffee table|side table|lamp table|console table|nest of table/i, 'living', 'surface'],
  [/sideboard|tv stand|tv unit|media|display cabinet/i, 'living', 'door'],
  [/dining table|table/i, 'table', 'surface'],
  [/sofa|settee|armchair|accent chair|occasional chair|recliner/i, 'seating', 'soft'],
  [/stool|footstool|ottoman|bench|chair/i, 'seating', 'soft'],
  [/cabinet|cupboard|storage|blanket box/i, 'utility', 'door'],
]

/**
 * The shallowest a bed can be and still hold a mattress. The shortest UK size
 * is a small single at 190 cm, so this is a generous floor that only catches
 * pages contradicting themselves, e.g. a bed published as 107 cm deep whose own
 * ottoman storage space is listed at 193 cm. Placing one of those would put a
 * bed in the room that no mattress fits.
 */
const MATTRESS_MIN = 150

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Fetches a URL as text, cached on disk under the given name. */
async function cachedText(name: string, url: string): Promise<string> {
  const file = resolve(CACHE_DIR, name)
  try {
    return await readFile(file, 'utf8')
  } catch {
    // Not cached yet.
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const text = await res.text()
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(file, text)
  return text
}

/** Every `/product/` URL Dunelm publishes, from the sitemap index. */
async function discover(): Promise<string[]> {
  const index = await cachedText('sitemap-index.xml', 'https://www.dunelm.com/sitemap.xml')
  const maps = [...index.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => u.includes('product'))

  const urls: string[] = []
  for (const [i, map] of maps.entries()) {
    const xml = await cachedText(`sitemap-product-${i + 1}.xml`, map)
    urls.push(...[...xml.matchAll(/https:\/\/www\.dunelm\.com\/product\/[a-z0-9-]+/g)].map((m) => m[0]))
    await sleep(300)
  }
  return [...new Set(urls)]
}

/** The trailing number in `/product/manhattan-white-double-wardrobe-1000095052`. */
const idFromUrl = (url: string): string | null => url.match(/-(\d{6,})$/)?.[1] ?? null

function classify(category: string): [SystemCategory, FaceStyle] | null {
  for (const [re, cat, face] of CATEGORIES) if (re.test(category)) return [cat, face]
  return null
}

/**
 * The finish as a person would read it. Dunelm publishes a `color` on about
 * half its furniture; where it does not, the part of the name after the comma
 * is the finish ("Corona Large Sideboard, Pine").
 */
function finishOf(raw: RawProduct): string {
  if (raw.color) return slugify(raw.color)
  const after = raw.name.split(',').slice(1).join(' ').trim()
  return after ? slugify(after) : ''
}

/**
 * The text to hunt for a shade in, which is deliberately wider than the finish
 * shown in the UI. Two thirds of the catalogue has no `color` and no comma, yet
 * says "Walnut Effect" or "Black Gloss" in the name, and drawing all of that as
 * the same default grey makes a room of Dunelm furniture unreadable. The colour
 * table already matches on a substring, so feeding it the name is the same
 * trick the IKEA scraper plays with the product URL.
 */
function shadeSlug(raw: RawProduct): string {
  return slugify([raw.color, raw.name, raw.attributes['Finish'] ?? ''].join(' '))
}

/**
 * Shades for words Dunelm uses and IKEA does not. Most of these come off
 * upholstery rather than flat pack, which is why `finish.ts` has never needed
 * them: IKEA describes a sofa by its cover name, Dunelm by its colour.
 *
 * This is a supplement rather than an addition to the shared table, because
 * words like "natural" and "light" appear in IKEA slugs too, and adding them
 * over there would quietly restyle products in the existing catalogue. It is
 * only consulted when the shared table has given up. Compounds first, since
 * the first match wins.
 */
const DUNELM_FINISHES: [string, string][] = [
  ['faux-leather', '#7a6250'],
  ['light-wood', '#d3b184'],
  ['dark-wood', '#5f452f'],
  ['smoked-oak', '#8c6f52'],
  ['natural', '#d8c7a2'],
  ['charcoal', '#3f4246'],
  ['cream', '#efe6d5'],
  ['ivory', '#f2ead9'],
  ['sage', '#a3b09a'],
  ['olive', '#7a7f4a'],
  ['ochre', '#cf9b3c'],
  ['mustard', '#d3a83b'],
  ['navy', '#29344d'],
  ['teal', '#2f6f78'],
  ['blush', '#e5c3bd'],
  ['mink', '#a9968a'],
  ['taupe', '#b3a595'],
  ['rust', '#a35a35'],
  ['terracotta', '#b4593c'],
  ['sand', '#ded0b6'],
  ['stone', '#cfc8bd'],
  ['mango', '#a9764a'],
  ['linen', '#ded5c4'],
  ['tan', '#b07b4f'],
  ['wood', '#b98d59'],
  ['marble', '#e8e6e1'],
  ['rattan', '#c8a06a'],
  ['velvet', '#7c6d80'],
]

/** The shared table first, then the words only Dunelm uses. */
function shadeFor(raw: RawProduct): string {
  const slug = shadeSlug(raw)
  const shared = colorForFinish(slug)
  if (shared !== DEFAULT_COLOR) return shared
  for (const [key, hex] of DUNELM_FINISHES) if (slug.includes(key)) return hex
  return DEFAULT_COLOR
}

interface Candidate {
  raw: RawProduct
  /** The sitemap URL. Kept rather than rebuilt, because the real slug carries
   * the colour and would not survive a round trip through the name. */
  url: string
  cat: SystemCategory
  face: FaceStyle
  sizes: LabelledDims[]
  /** First word of the name, e.g. "Corona". Dunelm's answer to a system. */
  range: string
}

/**
 * Builds the catalogue items for one product page. A page is usually one item,
 * but a bed lists a size per mattress and really is several.
 *
 * Share links pack article numbers as numbers, so a derived id has to stay
 * numeric. Multiplying by ten and adding the index keeps it so, and lands in
 * the eleven-digit space that Dunelm's own ten-digit ids never occupy, so a
 * derived id cannot collide with a real one.
 */
function itemsFor(c: Candidate, system: string, systemLabel: string): CatalogItem[] {
  const finish = finishOf(c.raw)
  return c.sizes.map((size, i) => {
    const multi = c.sizes.length > 1
    return {
      id: multi ? String(Number(c.raw.id) * 10 + i) : c.raw.id,
      system,
      systemLabel,
      name: multi && size.label ? `${c.raw.name} (${size.label})` : c.raw.name,
      type: c.raw.category,
      finish: finish.replace(/-/g, ' ') || 'unspecified',
      color: shadeFor(c.raw),
      width: size.width,
      depth: size.depth,
      height: size.height,
      measureText: `H ${size.height}cm x W ${size.width}cm x D ${size.depth}cm`,
      price: c.raw.price,
      currency: c.raw.currency || 'GBP',
      imageUrl: c.raw.image,
      productUrl: c.url,
      category: c.cat,
      face: c.face,
    }
  })
}

/**
 * Groups products into "systems" for the sidebar.
 *
 * A Dunelm range (Corona, Tribeca) is the real analogue of an IKEA system: a
 * set of matching pieces you would furnish a room from. But most first words
 * are not ranges at all, so a range only earns its own entry when it has
 * several pieces spanning more than one kind of furniture. Everything else
 * falls back to its category, which is always populated and never surprising.
 */
function assignSystems(candidates: Candidate[]): Map<Candidate, [string, string]> {
  const byRange = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const bucket = byRange.get(c.range)
    if (bucket) bucket.push(c)
    else byRange.set(c.range, [c])
  }

  const out = new Map<Candidate, [string, string]>()
  for (const c of candidates) {
    const peers = byRange.get(c.range)!
    const kinds = new Set(peers.map((p) => p.raw.category))
    if (peers.length >= 4 && kinds.size >= 2) {
      out.set(c, [`DUNELM-${slugify(c.range).toUpperCase()}`, c.range])
    } else {
      const label = c.raw.category || 'Furniture'
      out.set(c, [`DUNELM-${slugify(label).toUpperCase()}`, label])
    }
  }
  return out
}

async function main() {
  console.log('Discovering Dunelm products from the sitemap...')
  const all = await discover()
  const candidates = all.filter((u) => CANDIDATE.test(u)).slice(0, LIMIT)
  console.log(`  ${all.length} products published, ${candidates.length} worth opening.\n`)

  let done = 0
  let noProduct = 0
  let notFurniture = 0
  let unsized = 0
  let implausible = 0
  const kept: Candidate[] = []

  await mapLimit(candidates, CONCURRENCY, async (url) => {
    const id = idFromUrl(url)
    if (id) {
      const raw = await fetchProduct(id, url)
      if (!raw) noProduct++
      else {
        const hit = classify(raw.category)
        if (!hit) notFurniture++
        else {
          const isBed = isBedCategory(raw.category)
          const sizes = parseDimensions(raw.attributes['Product Dimensions'], isBed)
          const usable = isBed ? sizes.filter((s) => s.depth >= MATTRESS_MIN) : sizes
          if (!sizes.length) unsized++
          else if (!usable.length) implausible++
          else {
            kept.push({
              raw,
              url,
              cat: hit[0],
              face: hit[1],
              sizes: usable,
              range: raw.name.split(/[\s,]/)[0],
            })
          }
        }
      }
    }
    if (++done % 250 === 0) process.stdout.write(`  ...${done}/${candidates.length}\n`)
  })

  const systems = assignSystems(kept)
  const items: CatalogItem[] = []
  for (const c of kept) {
    const [id, label] = systems.get(c)!
    items.push(...itemsFor(c, id, label))
  }
  items.sort(
    (a, b) => a.system.localeCompare(b.system) || a.name.localeCompare(b.name) || a.width - b.width,
  )

  const counts = new Map<string, { label: string; category: SystemCategory; count: number }>()
  for (const i of items) {
    const seen = counts.get(i.system)
    if (seen) seen.count++
    else counts.set(i.system, { label: i.systemLabel, category: i.category, count: 1 })
  }

  const catalog: Catalog = {
    scrapedAt: new Date().toISOString(),
    market: 'gb/en',
    currency: items.find((i) => i.currency)?.currency ?? 'GBP',
    systems: [...counts.entries()]
      .map<SystemSummary>(([id, s]) => ({
        id,
        label: s.label,
        category: s.category,
        blurb: `Dunelm ${s.label.toLowerCase()}.`,
        count: s.count,
        wallMountable: false,
      }))
      .sort((a, b) => b.count - a.count),
    items,
  }

  console.log(`\n  ${noProduct} pages with no product blob`)
  console.log(`  ${notFurniture} not furniture`)
  console.log(`  ${unsized} furniture with no usable size`)
  console.log(`  ${implausible} dropped as contradicting themselves`)
  console.log(`\n${items.length} placeable products across ${catalog.systems.length} groups.`)
  for (const s of catalog.systems.slice(0, 15)) console.log(`  ${s.id.padEnd(28)} ${s.count}`)

  if (DRY_RUN) {
    console.log('\nDry run: nothing written.')
    return
  }
  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(catalog))
  console.log(`\nWrote ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
