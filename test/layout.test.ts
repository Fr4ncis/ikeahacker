/**
 * Checks on layout serialisation: a share link must survive the round trip
 * exactly, and anything malformed must be rejected rather than half-loaded.
 * Errors here are silent data loss, so the encoding is asserted directly.
 *
 * Run with `npm test`.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Catalog, Layout, PlacedItem } from '../src/lib/types.ts'

// The browser globals the layout module expects. Node 22 has btoa/atob and the
// text codecs; `window` only needs to exist for the URL helpers, which are
// exercised through explicit arguments below.
const here = dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(resolve(here, '../public/catalog.json'), 'utf8')) as Catalog
;(globalThis as unknown as { window: unknown }).window = { location: { href: 'https://example.test/app/' } }

const { loadCatalog } = await import('../src/lib/catalog.ts')
// Serve the catalogue from disk rather than the network.
;(globalThis as unknown as { fetch: unknown }).fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => catalog,
})
await loadCatalog('ignored')

const { decodeLayout, encodeLayout, layoutFromUrl, sanitizeLayout, shareUrl } = await import('../src/lib/layout.ts')

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`)
}

// Pick real articles, including one whose id has a leading zero, since those
// are the ones a numeric encoding can quietly corrupt.
const leadingZero = catalog.items.find((i) => i.id.startsWith('0'))!
const normal = catalog.items.find((i) => !i.id.startsWith('0'))!

const item = (over: Partial<PlacedItem> & { itemId: string }): PlacedItem => ({
  uid: 'x',
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  ...over,
})

const layout: Layout = {
  version: 1,
  name: 'Test',
  room: { width: 420, depth: 340, height: 250, wallColor: '#e8e4dc', floorColor: '#c8ac86' },
  items: [
    item({ itemId: leadingZero.id, x: 12.5, y: 300, z: 95, rotation: 270, color: '#a8423c' }),
    item({ itemId: normal.id, x: 0, y: 0, z: 0, rotation: 90 }),
  ],
  savedAt: '2026-01-01T00:00:00.000Z',
}

const strip = (l: Layout) =>
  l.items.map((i) => ({ itemId: i.itemId, x: i.x, y: i.y, z: i.z, rotation: i.rotation, color: i.color }))

// --- Round trip -------------------------------------------------------------

const decoded = decodeLayout(encodeLayout(layout))

check('a layout survives the encode/decode round trip', decoded !== null)
check(
  'every item comes back with the same article, position, rotation and colour',
  JSON.stringify(strip(decoded!.layout)) === JSON.stringify(strip(layout)),
  JSON.stringify(strip(decoded!.layout)),
)
check(
  'an article number with a leading zero is not corrupted',
  decoded!.layout.items[0].itemId === leadingZero.id,
  `${decoded!.layout.items[0].itemId} vs ${leadingZero.id}`,
)
check(
  'the room comes back unchanged',
  JSON.stringify(decoded!.layout.room) === JSON.stringify(layout.room),
  JSON.stringify(decoded!.layout.room),
)
check('nothing was dropped from a clean layout', decoded!.dropped === 0, String(decoded!.dropped))

check(
  'instance ids are regenerated, so pasting a plan twice cannot collide',
  new Set(decoded!.layout.items.map((i) => i.uid)).size === decoded!.layout.items.length &&
    decoded!.layout.items.every((i) => i.uid !== 'x'),
)

// --- Size -------------------------------------------------------------------

{
  const big: Layout = {
    ...layout,
    items: catalog.items.slice(0, 60).map((c, n) => item({ itemId: c.id, x: n * 3, y: n, rotation: 90 })),
  }
  const url = shareUrl(big, 'https://example.test/app/')
  check(`a 60-item plan fits comfortably in a URL (${url.length} chars)`, url.length < 8000, `${url.length} chars`)
  const back = decodeLayout(encodeLayout(big))
  check('a 60-item plan round trips intact', back !== null && back.layout.items.length === 60)
}

// --- Reading from a URL -----------------------------------------------------

{
  const url = shareUrl(layout, 'https://example.test/app/')
  const hash = new URL(url).hash
  const fromUrl = layoutFromUrl(hash)
  check('a plan can be read back out of a share URL', fromUrl !== null && fromUrl.layout.items.length === 2)
  check('the payload rides in the fragment, so it never reaches a server', url.includes('#p='), url.slice(0, 60))
  check('a URL with no plan yields nothing', layoutFromUrl('') === null)
  check('a URL with an unrelated fragment yields nothing', layoutFromUrl('#section-two') === null)
}

// --- Rejecting bad input ----------------------------------------------------

check('garbage does not decode', decodeLayout('not-base64!!') === null)
check('valid base64 that is not a layout does not decode', decodeLayout(btoa('{"hello":1}')) === null)
check('an empty string does not decode', decodeLayout('') === null)
check('null is rejected', sanitizeLayout(null) === null)
check('a layout from a future version is rejected', sanitizeLayout({ ...layout, version: 99 }) === null)
check('a layout with no items array is rejected', sanitizeLayout({ version: 1, room: layout.room }) === null)

// --- Dropping unknown articles ---------------------------------------------

{
  const loaded = sanitizeLayout({
    ...layout,
    items: [...layout.items, item({ itemId: '99999999' }), item({ itemId: 'not-an-id' })],
  })
  check('articles missing from the catalogue are dropped, not rendered', loaded!.layout.items.length === 2)
  check('and the count is reported so it can be surfaced', loaded!.dropped === 2, String(loaded!.dropped))
}

check(
  'out-of-range positions are clamped rather than rejected',
  (() => {
    const loaded = sanitizeLayout({ ...layout, items: [item({ itemId: normal.id, x: -50, y: 99999, z: -1 })] })
    const p = loaded!.layout.items[0]
    return p.x === 0 && p.y === 1200 && p.z === 0
  })(),
)

check(
  'an invalid rotation falls back to zero rather than skewing the item',
  sanitizeLayout({ ...layout, items: [item({ itemId: normal.id, rotation: 45 as PlacedItem['rotation'] })] })!
    .layout.items[0].rotation === 0,
)

check(
  'a colour that is not a hex triple is ignored',
  sanitizeLayout({ ...layout, items: [item({ itemId: normal.id, color: 'javascript:alert(1)' })] })!.layout.items[0]
    .color === undefined,
)

console.log(failures ? `\n${failures} failing` : `\nall passing`)
process.exit(failures ? 1 : 0)
