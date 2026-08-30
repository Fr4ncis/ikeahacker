/**
 * Product-page fallback.
 *
 * The search API leaves `itemMeasureReferenceText` empty for a lot of
 * upholstered furniture, and gives only two numbers for desks and tables. The
 * product page embeds the real figures as
 *   "measurements":[{"measure":"228 cm","name":"Width",...},...]
 * so we fetch the page and pull that block out. Pages are ~1 MB, so the raw
 * label-to-centimetre map is cached on disk; deciding what counts as width or
 * depth is left to the caller, which keeps the cache valid across changes to
 * that logic.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '.cache/measures')

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

/** Lowercase measurement label ("width", "length", "diameter"...) to centimetres. */
export type Measures = Record<string, number>

interface RawMeasure {
  measure?: string
  name?: string
}

/** "228 cm" -> 228, "1200 mm" -> 120, "2.3 m" -> 230. Returns null if unparseable. */
function toCm(measure: string | undefined): number | null {
  if (!measure) return null
  const m = measure.match(/(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?/i)
  if (!m) return null
  const value = parseFloat(m[1].replace(',', '.'))
  if (!Number.isFinite(value)) return null
  switch ((m[2] ?? 'cm').toLowerCase()) {
    case 'mm':
      return value / 10
    case 'm':
      return value * 100
    default:
      return value
  }
}

/**
 * Collects the product's own measurements from a PIP page.
 *
 * The page contains several `"measurements":[...]` arrays. The first ones are
 * flat-pack package sizes, keyed `label`/`text`/`value`; the product's own
 * measurements are keyed `measure`/`name`. Entries in the wrong shape simply
 * yield nothing, so scanning every block is safe.
 */
export function extractMeasures(html: string): Measures {
  const out: Measures = {}
  const marker = '"measurements":['

  for (let at = html.indexOf(marker); at !== -1; at = html.indexOf(marker, at + 1)) {
    const open = at + marker.length - 1
    const close = html.indexOf(']', open)
    if (close === -1) break

    let measures: RawMeasure[]
    try {
      measures = JSON.parse(html.slice(open, close + 1)) as RawMeasure[]
    } catch {
      continue
    }

    for (const entry of measures) {
      const cm = toCm(entry.measure)
      const label = (entry.name ?? '').toLowerCase().trim()
      if (cm === null || !label) continue
      out[label] ??= cm
    }
  }
  return out
}

async function readCache(itemNo: string): Promise<Measures | null> {
  try {
    return JSON.parse(await readFile(resolve(CACHE_DIR, `${itemNo}.json`), 'utf8')) as Measures
  } catch {
    return null
  }
}

/** Fetches (or reads from cache) the measurement table for one product. */
export async function fetchMeasures(itemNo: string, pipUrl: string): Promise<Measures> {
  const cached = await readCache(itemNo)
  if (cached) return cached

  let measures: Measures = {}
  try {
    const res = await fetch(pipUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-GB,en;q=0.9' },
    })
    if (res.ok) measures = extractMeasures(await res.text())
  } catch {
    // Network hiccups just mean no dimensions; the item gets dropped upstream.
  }
  // Cache misses too, so a re-run does not re-download a page with no measurements.
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(resolve(CACHE_DIR, `${itemNo}.json`), JSON.stringify(measures))
  return measures
}

/** Runs `worker` over `items` with a bounded number of in-flight requests. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}
