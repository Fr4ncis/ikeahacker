/**
 * Checks on what a product is made of: the reading of a product page, the
 * pairing of each part with its own instruction sheet, and the shape of what
 * the pass wrote. Run with `npm test`.
 *
 * The page reading is checked against small hand-written fragments rather than
 * a saved IKEA page. A real one is a megabyte of somebody else's copyrighted
 * markup, and it would pin the test to a layout that changes without notice;
 * these say what the extractor is actually looking for.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractBoxes, extractManuals, extractParts } from '../scraper/parts.ts'
import { largestBox, looseManuals, manualFor, packageSummary, weightOf } from '../src/lib/parts.ts'
import type { Catalog } from '../src/lib/types.ts'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`)
}

const here = dirname(fileURLToPath(import.meta.url))

// --- Reading a product page --------------------------------------------------

const documents = `
  <h4>Assembly instructions</h4>
  <a href="https://www.ikea.com/gb/en/assembly_instructions/besta-frame-white__AA-1272028-6.pdf"
     target="_blank" aria-label="BESTÅ Frame (opens in a new tab)"><span>BESTÅ Frame</span></a>
  <a href="https://www.ikea.com/gb/en/assembly_instructions/hedeviken-door__AA-2158169-1.pdf"
     target="_blank" aria-label="HEDEVIKEN Door (opens in a new tab)"><span>HEDEVIKEN Door</span></a>
  <h4>Manuals</h4>
  <a href="https://www.ikea.com/gb/en/manuals/besta-frame-white__AA-2180177-2.pdf"
     target="_blank" aria-label="BESTÅ Frame (opens in a new tab)"><span>BESTÅ Frame</span></a>
`

check(
  'instruction sheets are read with their label and their kind',
  (() => {
    const found = extractManuals(documents)
    return (
      found.length === 3 &&
      found[0].kind === 'assembly' &&
      found[0].label === 'BESTÅ Frame' &&
      found[2].kind === 'manual' &&
      found.every((m) => m.url.startsWith('https://www.ikea.com/') && m.url.endsWith('.pdf'))
    )
  })(),
  JSON.stringify(extractManuals(documents)),
)

check(
  'the same sheet linked twice is listed once',
  extractManuals(documents + documents).length === 3,
)

check(
  'a page with no instructions yields none',
  extractManuals('<h4>Assembly instructions</h4><p>None for this product.</p>').length === 0,
)

check(
  // The page escapes slashes inside its embedded JSON.
  'an escaped URL is unescaped',
  extractManuals(
    'href="https:\\u002F\\u002Fwww.ikea.com\\u002Fgb\\u002Fen\\u002Fmanuals\\u002Fx__AA-1.pdf" aria-label="X Y (opens in a new tab)"',
  )[0]?.url === 'https://www.ikea.com/gb/en/manuals/x__AA-1.pdf',
)

const subProducts =
  '"subProducts":[' +
  '{"itemNo":"60245919","visibleItemNo":"602.459.19","name":"BESTÅ","type":"ART","typeName":"frame","quantity":1},' +
  '{"itemNo":"70491698","visibleItemNo":"704.916.98","name":"HEDEVIKEN","type":"ART","typeName":"door","quantity":2}],'

check(
  'the articles a combination is built from are read, with their quantities',
  (() => {
    const parts = extractParts(subProducts)
    return (
      parts.length === 2 &&
      parts[0].id === '60245919' &&
      parts[0].article === '602.459.19' &&
      parts[0].type === 'frame' &&
      parts[1].quantity === 2
    )
  })(),
  JSON.stringify(extractParts(subProducts)),
)

check('a product built from nothing has no parts', extractParts('"subProducts":[],') .length === 0)

check(
  // A brace inside a name must not end the parse early.
  'a part whose name contains a brace does not truncate the list',
  extractParts('"subProducts":[{"itemNo":"1","name":"A{B}","typeName":"shelf","quantity":1},{"itemNo":"2","name":"C","typeName":"door","quantity":1}],')
    .length === 2,
)

const packaging =
  '"packaging":{"numberOfPackages":2,"packages":[' +
  '{"name":"BILLY","itemNo":"50263838","measurementGroups":[{"measurements":[' +
  '{"type":"width","value":39},{"type":"height","value":6},{"type":"length","value":207},{"type":"weight","value":24.3}]}],' +
  '"quantity":{"value":2}}]},'

check(
  'packages are read at their own size, and counted by their quantity',
  (() => {
    const boxes = extractBoxes(packaging)
    return boxes.length === 2 && boxes[0].length === 207 && boxes[0].weight === 24.3
  })(),
  JSON.stringify(extractBoxes(packaging)),
)

check('a page with no packaging yields no boxes', extractBoxes('{"other":1}').length === 0)

// --- Saying it in the panel --------------------------------------------------

const boxes = [
  { width: 39, height: 6, length: 207, weight: 24.3 },
  { width: 20, height: 3, length: 25, weight: 0.26 },
]

check('weight is the sum of the packages', Math.abs(weightOf(boxes) - 24.56) < 1e-9)

check('the summary counts packages and rounds the weight', packageSummary(boxes) === '2 packages · 25 kg')

check('one package is not "1 packages"', packageSummary([boxes[1]]) === '1 package · 0.3 kg')

check('nothing known says nothing', packageSummary([]) === '')

check(
  'the largest package is the one that has to fit through the door',
  largestBox(boxes)?.length === 207 && largestBox([]) === null,
)

const parts = [
  { id: '1', article: '602.459.19', name: 'BESTÅ', type: 'frame', quantity: 1 },
  { id: '2', article: '704.916.98', name: 'HEDEVIKEN', type: 'door', quantity: 2 },
]
const manuals = extractManuals(documents)

check(
  'each part finds its own sheet, whatever the case',
  manualFor(parts[0], manuals)?.url.includes('besta-frame') === true &&
    manualFor(parts[1], manuals)?.url.includes('hedeviken') === true,
)

check(
  'sheets no part claimed are still offered',
  (() => {
    const left = looseManuals(parts, manuals)
    return left.length === 1 && left[0].kind === 'manual'
  })(),
  JSON.stringify(looseManuals(parts, manuals)),
)

// --- What the pass wrote -----------------------------------------------------

const built = (() => {
  try {
    return JSON.parse(readFileSync(resolve(here, '../public/parts.json'), 'utf8')) as {
      products: Record<string, { manuals: { url: string; kind: string }[]; parts: { quantity: number }[]; boxes: { weight: number }[] }>
    }
  } catch {
    return null
  }
})()

if (!built) {
  console.log('SKIP  no public/parts.json; run `npm run parts` to build one')
} else {
  const catalog = JSON.parse(readFileSync(resolve(here, '../public/catalog.json'), 'utf8')) as Catalog
  const known = new Set(catalog.items.map((i) => i.id))
  const entries = Object.entries(built.products)

  const stale = entries.filter(([id]) => !known.has(id))

  check(
    // Not "every", for the same reason as the shapes: the catalogue is
    // re-scraped nightly and this pass is run by hand, so articles retire out
    // from under it. An entry for a retired article is unreachable, not wrong.
    `described products are still in the catalogue (${entries.length - stale.length} of ${entries.length})`,
    entries.length > 0 && stale.length < entries.length * 0.1,
    `${stale.length} are for retired articles; run \`npm run parts\` to clear them`,
  )

  check(
    // Linked, never copied: everything here is a URL on ikea.com.
    'every instruction sheet is a link to a PDF on ikea.com',
    entries.every(([, p]) =>
      p.manuals.every((m) => /^https:\/\/www\.ikea\.com\/.+\.pdf$/.test(m.url) && (m.kind === 'assembly' || m.kind === 'manual')),
    ),
  )

  check(
    'no product is described as being made of nothing at all',
    entries.every(([, p]) => p.manuals.length > 0 || p.parts.length > 0 || p.boxes.length > 0),
  )

  check('every part is wanted at least once', entries.every(([, p]) => p.parts.every((q) => q.quantity >= 1)))

  check(
    'package weights are plausible',
    entries.every(([, p]) => p.boxes.every((b) => b.weight >= 0 && b.weight < 500)),
  )
}

console.log(failures ? `\n${failures} failing` : `\nall passing`)
process.exit(failures ? 1 : 0)
