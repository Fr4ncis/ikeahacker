/**
 * Short links for IKEA Hacker plans.
 *
 * The app can share a plan with no backend at all by packing it into a URL
 * fragment. This service exists only to shorten that: it stores the identical
 * payload and hands back an id. Nothing here understands what a plan is, which
 * keeps the client free to change its encoding without a migration.
 *
 *   POST /plans      body: the payload text   -> { id }
 *   GET  /plans/:id                           -> { payload }
 */

export interface Env {
  DB: D1Database
  /** Comma-separated origins allowed to call this. */
  ALLOWED_ORIGINS: string
}

/** Payload cap. A 60-item plan is under 2 KB, so this is generous. */
const MAX_PAYLOAD = 64 * 1024

/** Unambiguous alphabet: no I, l, O or 0 to misread when typed out. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
const ID_LENGTH = 8

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH))
  let id = ''
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length]
  return id
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? ''
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  return {
    // Echo the origin only when it is one we know, so the allowlist means something.
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] ?? '',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '')

    try {
      if (request.method === 'POST' && path === '/plans') return await store(request, env, cors)

      const match = path.match(/^\/plans\/([a-z2-9]{4,32})$/)
      if (request.method === 'GET' && match) return await load(match[1], env, cors)

      if (request.method === 'GET' && path === '/health') {
        return json({ ok: true }, 200, cors)
      }
      return json({ error: 'Not found' }, 404, cors)
    } catch (err) {
      // Never leak internals to the caller; the detail goes to the Worker log.
      console.error(err)
      return json({ error: 'Something went wrong storing the plan' }, 500, cors)
    }
  },
}

async function store(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const payload = (await request.text()).trim()

  if (!payload) return json({ error: 'Empty plan' }, 400, cors)
  if (payload.length > MAX_PAYLOAD) {
    return json({ error: `Plan is too large (${payload.length} bytes, limit ${MAX_PAYLOAD})` }, 413, cors)
  }
  // The client sends base64url; anything else is not ours.
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return json({ error: 'Malformed plan' }, 400, cors)

  const hash = await sha256(payload)
  const now = Date.now()

  const existing = await env.DB.prepare('SELECT id FROM plans WHERE hash = ?').bind(hash).first<{ id: string }>()
  if (existing) {
    await env.DB.prepare('UPDATE plans SET last_seen = ? WHERE id = ?').bind(now, existing.id).run()
    return json({ id: existing.id, reused: true }, 200, cors)
  }

  // Ids are random and short, so a collision is possible if unlikely.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newId()
    try {
      await env.DB.prepare(
        'INSERT INTO plans (id, hash, payload, created_at, last_seen) VALUES (?, ?, ?, ?, ?)',
      )
        .bind(id, hash, payload, now, now)
        .run()
      return json({ id, reused: false }, 201, cors)
    } catch (err) {
      // A clash on the hash means someone stored the same plan a moment ago.
      const message = String(err)
      if (message.includes('plans_hash')) {
        const race = await env.DB.prepare('SELECT id FROM plans WHERE hash = ?').bind(hash).first<{ id: string }>()
        if (race) return json({ id: race.id, reused: true }, 200, cors)
      }
      if (!message.includes('UNIQUE')) throw err
    }
  }
  return json({ error: 'Could not allocate an id' }, 503, cors)
}

async function load(id: string, env: Env, cors: Record<string, string>): Promise<Response> {
  const row = await env.DB.prepare('SELECT payload FROM plans WHERE id = ?').bind(id).first<{ payload: string }>()
  if (!row) return json({ error: 'No plan with that link' }, 404, cors)

  // Opening a plan keeps it alive, so links in use are never pruned.
  await env.DB.prepare('UPDATE plans SET views = views + 1, last_seen = ? WHERE id = ?').bind(Date.now(), id).run()

  return json({ payload: row.payload }, 200, {
    ...cors,
    // Plans are immutable once stored, so this can be cached hard.
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
}
