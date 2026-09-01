/**
 * Short links.
 *
 * Sharing works with no backend at all: the whole plan rides in the URL
 * fragment. When `VITE_API_URL` is set at build time, the same payload is
 * stored server-side instead and the link carries only an id, which keeps it
 * short enough to paste anywhere and read out loud.
 *
 * The two forms coexist by design. A fork deployed without an API still
 * shares; a long link made before the API existed still opens.
 */
import { linkBase, SHARE_PARAM } from './layout'

const API = import.meta.env.VITE_API_URL?.replace(/\/+$/, '') ?? ''

/** Query parameter carrying a stored plan's id, e.g. ?s=k4mp2xqd */
export const SHORT_PARAM = 's'

export const shortLinksAvailable = () => API !== ''

export class ShortLinkError extends Error {}

/** Stores a payload and returns its id. Throws if the service is unreachable. */
export async function storePlan(payload: string): Promise<string> {
  if (!API) throw new ShortLinkError('No plan service is configured')

  let res: Response
  try {
    res = await fetch(`${API}/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: payload,
    })
  } catch {
    throw new ShortLinkError('Could not reach the plan service')
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new ShortLinkError((detail as { error?: string } | null)?.error ?? `Plan service returned ${res.status}`)
  }
  const body = (await res.json()) as { id?: string }
  if (!body.id) throw new ShortLinkError('Plan service returned no id')
  return body.id
}

/** Fetches a stored payload. Returns null when the link does not resolve. */
export async function fetchPlan(id: string): Promise<string | null> {
  if (!API) return null
  try {
    const res = await fetch(`${API}/plans/${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const body = (await res.json()) as { payload?: string }
    return body.payload ?? null
  } catch {
    return null
  }
}

/** The id in the current URL, if this page was opened from a short link. */
export function shortIdFromUrl(search = window.location.search): string | null {
  const id = new URLSearchParams(search).get(SHORT_PARAM)
  return id && /^[a-z2-9]{4,32}$/.test(id) ? id : null
}

export function shortUrl(id: string, base = linkBase()): string {
  const url = new URL(base)
  url.hash = ''
  url.search = `?${SHORT_PARAM}=${id}`
  return url.toString()
}

/** True when a URL carries a plan in either form. */
export function hasPlanInUrl(): boolean {
  return shortIdFromUrl() !== null || window.location.hash.includes(`${SHARE_PARAM}=`)
}
