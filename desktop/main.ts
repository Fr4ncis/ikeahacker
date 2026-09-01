/**
 * The desktop shell.
 *
 * The planner itself is unchanged: the same built SPA that GitHub Pages
 * serves, loaded here from disk. Two things need arranging to make that work
 * outside a web server.
 *
 * The app is served over a registered `app://` scheme rather than `file://`.
 * Chromium blocks `fetch` on file URLs, and the catalogue is fetched rather
 * than bundled into the JavaScript, so the planner would have no products at
 * all. A registered scheme also gives the renderer a stable origin, which is
 * what `localStorage` keys its data by: saved layouts survive an update
 * because the origin never changes.
 *
 * And the catalogue is refreshed from the published site in the background.
 * A binary otherwise freezes the products at the moment it was built, while
 * the web version picks up the nightly re-scrape. The download is checked
 * before it is kept and only takes effect at the next launch, so a bad
 * network never delays or breaks a start.
 */
import { app, BrowserWindow, Menu, session, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { protocol, net } from 'electron'

// Packaged, the manifest sits at the root of the asar; in development it is
// this package's own, one level up from the compiled shell. `app.getAppPath()`
// is not enough on its own: run as `electron out/smoke.js` it points at `out`.
const manifestPath = app.isPackaged
  ? join(app.getAppPath(), 'package.json')
  : join(__dirname, '..', 'package.json')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  version: string
  productName?: string
  publicSite: string
}

/** Where the same app lives on the web. Shared links point here, and so does the catalogue refresh. */
export const PUBLIC_SITE = manifest.publicSite

/** The scheme and host the planner is served from. Changing either orphans every saved layout. */
const SCHEME = 'app'
const HOST = 'ikeahacker'
export const START_URL = `${SCHEME}://${HOST}/index.html`

/** The built SPA: alongside the shell once packaged, in the repo's dist during development. */
const rendererRoot = app.isPackaged
  ? join(app.getAppPath(), 'renderer')
  : join(__dirname, '..', '..', 'dist')

/** Where a refreshed catalogue is kept. Outside the app, which is read-only once installed. */
const cachedCatalogue = () => join(app.getPath('userData'), 'catalog.json')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/**
 * Product photos come from ikea.com; everything else is local. Written here
 * rather than as a meta tag in the HTML because the web build is served from
 * a different origin and configures its plan service at build time.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https://www.ikea.com data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

/** Serves the built app off disk, with the refreshed catalogue standing in for the bundled one. */
function serveApp() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== HOST) return new Response('Not found', { status: 404 })

    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    // A request cannot climb out of the app directory, whatever it asks for.
    const file = normalize(join(rendererRoot, relative))
    if (file !== rendererRoot && !file.startsWith(rendererRoot + sep)) {
      return new Response('Forbidden', { status: 403 })
    }

    const source = relative === 'catalog.json' ? await newestCatalogue(file) : file
    // Read through Electron's own fetch so the 2 MB catalogue streams rather
    // than being buffered, then re-dress it: the file handler guesses at
    // content types and never sets a policy header.
    const found = await net.fetch(pathToFileURL(source).toString(), { bypassCustomProtocolHandlers: true })
    if (!found.ok) return new Response('Not found', { status: 404 })

    const type = MIME[extname(file)] ?? 'application/octet-stream'
    const headers: Record<string, string> = { 'content-type': type }
    if (type.startsWith('text/html')) headers['content-security-policy'] = CSP
    return new Response(found.body, { headers })
  })
}

/** The downloaded catalogue if there is a usable one, otherwise the copy that shipped. */
async function newestCatalogue(bundled: string): Promise<string> {
  try {
    const cached = cachedCatalogue()
    const text = await readFile(cached, 'utf8')
    return productCount(text) > 0 ? cached : bundled
  } catch {
    return bundled
  }
}

const productCount = (text: string): number => {
  try {
    const parsed = JSON.parse(text) as { items?: unknown }
    return Array.isArray(parsed.items) ? parsed.items.length : 0
  } catch {
    return 0
  }
}

/**
 * Fetches the published catalogue and keeps it if it looks whole.
 *
 * The guard is the one the nightly re-scrape workflow applies before it
 * publishes: under 500 products, or under 70% of what we already have, means
 * IKEA changed something rather than that the catalogue shrank. Keeping such
 * a result would silently strip articles out of saved layouts.
 */
export async function refreshCatalogue(): Promise<string> {
  const bundled = productCount(await readFile(join(rendererRoot, 'catalog.json'), 'utf8').catch(() => ''))
  const have = Math.max(bundled, productCount(await readFile(cachedCatalogue(), 'utf8').catch(() => '')))

  let text: string
  try {
    const res = await net.fetch(new URL('catalog.json', PUBLIC_SITE).toString())
    if (!res.ok) return `the site returned ${res.status}`
    text = await res.text()
  } catch {
    return 'could not reach the site'
  }

  const count = productCount(text)
  if (count < 500) return `only ${count} products, so it was not kept`
  if (have > 0 && count < Math.floor((have * 70) / 100)) {
    return `${count} products is under 70% of the ${have} already here, so it was not kept`
  }
  if (count === have) return `no change, still ${count} products`

  await writeFile(cachedCatalogue(), text, 'utf8')
  return `updated to ${count} products, from the next launch`
}

export function createWindow(show = true): BrowserWindow {
  const window = new BrowserWindow({
    show,
    width: 1440,
    height: 920,
    // The planner puts the catalogue and the room side by side and stops
    // collapsing below this, so there is no point offering a narrower window.
    minWidth: 940,
    minHeight: 620,
    title: manifest.productName ?? 'IKEA Hacker',
    backgroundColor: '#f4f2ee',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })

  // ikea.com opens in the browser. Nothing navigates the app window itself:
  // the planner is one page, so anything trying to is a link.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(`${SCHEME}://${HOST}/`)) return
    event.preventDefault()
    if (/^https:/.test(url)) void shell.openExternal(url)
  })

  void window.loadURL(START_URL)
  return window
}

/**
 * A menu is not decoration on macOS: without one the window has no Edit roles
 * and copy and paste stop working in the search box.
 */
function buildMenu() {
  const mac = process.platform === 'darwin'
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: 'appMenu' as const }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        role: 'help',
        submenu: [
          {
            label: 'Open the web version',
            click: () => void shell.openExternal(PUBLIC_SITE),
          },
        ],
      },
    ]),
  )
}

/** Everything that has to be in place before a window can load. */
export function configure() {
  serveApp()
  // Nothing is loaded from the network into the page, so nothing needs to be
  // permitted: no camera, no location, no notifications.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  buildMenu()
}

// Not when this file is loaded by the smoke test, which drives the pieces itself.
if (require.main === module) {
  void app.whenReady().then(() => {
    configure()
    createWindow()
    void refreshCatalogue()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}
