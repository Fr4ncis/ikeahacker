/**
 * End-to-end check of the plan service: encode a plan with the real client
 * code, store it through a running Worker, fetch it back and decode it. That
 * is the exact path a short share link takes.
 *
 * Needs a Worker to talk to, so it is not part of `npm test`:
 *
 *   cd worker && npm run dev          # in one shell
 *   PLANS_API=http://127.0.0.1:8787 npm run test:worker
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Catalog, Layout } from '../src/lib/types.ts'

const API = process.env.PLANS_API
if (!API) {
  console.error('Set PLANS_API to the Worker URL, e.g. PLANS_API=http://127.0.0.1:8787')
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const catalog = JSON.parse(readFileSync(resolve(here, '../public/catalog.json'), 'utf8')) as Catalog

// The catalogue loads from disk; everything else goes to the network for real.
const realFetch = globalThis.fetch
;(globalThis as unknown as { fetch: unknown }).fetch = async (url: unknown, init?: unknown) =>
  String(url) === 'catalog'
    ? { ok: true, status: 200, json: async () => catalog }
    : realFetch(url as string, init as RequestInit)
;(globalThis as unknown as { window: unknown }).window = { location: { href: 'http://localhost:5173/' } }

const { loadCatalog } = await import('../src/lib/catalog.ts')
await loadCatalog('catalog')
const { encodeLayout, decodeLayout } = await import('../src/lib/layout.ts')

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`)
}

const article = (n: number) => catalog.items[n].id
const plan: Layout = {
  version: 1,
  name: 'L-shaped living room',
  room: {
    width: 500,
    depth: 380,
    height: 260,
    wallColor: '#dfe4e2',
    floorColor: '#a97d4f',
    outline: [
      [0, 0],
      [500, 0],
      [500, 228],
      [300, 228],
      [300, 380],
      [0, 380],
    ],
  },
  items: [
    { uid: 'a', itemId: article(0), x: 10, y: 10, z: 0, rotation: 0 },
    { uid: 'b', itemId: article(500), x: 120, y: 250, z: 0, rotation: 90, color: '#a8423c' },
    { uid: 'c', itemId: article(1200), x: 380, y: 20, z: 120, rotation: 270 },
  ],
  savedAt: '2026-01-01T00:00:00.000Z',
}

const payload = encodeLayout(plan)
console.log(`payload: ${payload.length} chars\n`)

const post = await realFetch(`${API}/plans`, { method: 'POST', body: payload })
const stored = (await post.json()) as { id: string }
check('the Worker accepts a real encoded plan', post.ok, String(post.status))
check(`the resulting link is short (?s=${stored.id})`, `?s=${stored.id}`.length <= 12)

const got = await realFetch(`${API}/plans/${stored.id}`)
const { payload: back } = (await got.json()) as { payload: string }
check('the payload returns byte for byte', back === payload)

const decoded = decodeLayout(back)
check('it decodes back into a layout', decoded !== null)
check('every item survives', decoded?.layout.items.length === 3, String(decoded?.layout.items.length))
check('nothing was dropped', decoded?.dropped === 0)
check(
  'articles, positions, rotations and colours all match',
  JSON.stringify(decoded?.layout.items.map((i) => [i.itemId, i.x, i.y, i.z, i.rotation, i.color])) ===
    JSON.stringify(plan.items.map((i) => [i.itemId, i.x, i.y, i.z, i.rotation, i.color])),
)
check(
  'the L-shaped floor plan survives the round trip',
  JSON.stringify(decoded?.layout.room.outline) === JSON.stringify(plan.room.outline),
  JSON.stringify(decoded?.layout.room.outline),
)
check(
  'room size and colours survive',
  decoded?.layout.room.width === 500 &&
    decoded.layout.room.depth === 380 &&
    decoded.layout.room.height === 260 &&
    decoded.layout.room.floorColor === '#a97d4f',
)

const again = (await (await realFetch(`${API}/plans`, { method: 'POST', body: payload })).json()) as {
  id: string
  reused: boolean
}
check('re-sharing an unchanged plan reuses the link', again.id === stored.id && again.reused === true)

const missing = await realFetch(`${API}/plans/zzzzzzzz`)
check('a link that does not resolve is a clean 404', missing.status === 404)

console.log(failures ? `\n${failures} failing` : `\nall passing`)
process.exit(failures ? 1 : 0)
