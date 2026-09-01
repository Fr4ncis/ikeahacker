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
import { app, BrowserWindow, ipcMain, Menu, session, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { protocol, net } from 'electron'
import { checkForUpdate, downloadAsset, installUpdate, type UpdateState } from './update'

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
  repository: string
}

/**
 * Pinned rather than inferred, because everything the app keeps hangs off it:
 * `userData` is the saved layouts, the cached catalogue and the downloads.
 * Electron names an unpackaged app after its entry script's directory, so
 * without this the shell and its own smoke test disagree about where the data
 * lives. The value matches the packaged productName, so nothing moves.
 */
app.setName(manifest.productName ?? 'IKEA Hacker')

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

/**
 * The catalogues the planner asks for, one per shop. Each is refreshed and
 * cached separately, because each is scraped by its own pass and published as
 * its own file; `src/lib/catalog.ts` merges them in the renderer.
 */
const CATALOGUES = ['catalog.json', 'catalog-dunelm.json']

/** Where a refreshed catalogue is kept. Outside the app, which is read-only once installed. */
const cachedCatalogue = (name: string) => join(app.getPath('userData'), name)

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
 * Product photos come from the shops the catalogue was scraped from; everything
 * else is local. Written here rather than as a meta tag in the HTML because the
 * web build is served from a different origin and configures its plan service
 * at build time.
 *
 * A shop added to `CATALOGUES` needs its image host added here too, or its
 * products show up in the planner with every thumbnail blank and nothing in the
 * console to say why on a packaged build.
 */
const IMAGE_HOSTS = ['https://www.ikea.com', 'https://images.dunelm.com']

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' ${IMAGE_HOSTS.join(' ')} data: blob:`,
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

    const source = CATALOGUES.includes(relative) ? await newestCatalogue(relative, file) : file
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
async function newestCatalogue(name: string, bundled: string): Promise<string> {
  try {
    const cached = cachedCatalogue(name)
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
 * Fetches every published catalogue and keeps the ones that look whole,
 * reporting what happened to each. One shop being unreachable does not stop
 * the others.
 */
export async function refreshCatalogue(): Promise<string> {
  const outcomes = await Promise.all(CATALOGUES.map(refreshOne))
  return outcomes.map(([name, said]) => `${name}: ${said}`).join('; ')
}

/**
 * Refreshes one shop's catalogue.
 *
 * The guard is the one the nightly re-scrape workflow applies before it
 * publishes: under 500 products, or under 70% of what we already have, means
 * the shop changed something rather than that the catalogue shrank. Keeping
 * such a result would silently strip articles out of saved layouts. Both
 * catalogues run to thousands of products, so the flat floor is generous; a
 * genuinely small shop would need its own.
 *
 * A shop the published site does not carry yet simply reports its 404 and
 * leaves the bundled copy in place, which is what happens between adding a
 * scrape here and the first deploy that publishes it.
 */
async function refreshOne(name: string): Promise<[string, string]> {
  const bundled = productCount(await readFile(join(rendererRoot, name), 'utf8').catch(() => ''))
  const have = Math.max(bundled, productCount(await readFile(cachedCatalogue(name), 'utf8').catch(() => '')))

  let text: string
  try {
    const res = await net.fetch(new URL(name, PUBLIC_SITE).toString())
    if (!res.ok) return [name, `the site returned ${res.status}`]
    text = await res.text()
  } catch {
    return [name, 'could not reach the site']
  }

  const count = productCount(text)
  if (count < 500) return [name, `only ${count} products, so it was not kept`]
  if (have > 0 && count < Math.floor((have * 70) / 100)) {
    return [name, `${count} products is under 70% of the ${have} already here, so it was not kept`]
  }
  if (count === have) return [name, `no change, still ${count} products`]

  await writeFile(cachedCatalogue(name), text, 'utf8')
  return [name, `updated to ${count} products, from the next launch`]
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.js'),
    },
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
          { label: 'Check for updates…', click: () => void runCheck(true) },
          { type: 'separator' },
          {
            label: 'Open the web version',
            click: () => void shell.openExternal(PUBLIC_SITE),
          },
        ],
      },
    ]),
  )
}

/**
 * Update state, and the one place it is kept.
 *
 * The window is told every time it changes rather than asked, so a download
 * that started before the page was ready still shows up: the state is replayed
 * to whoever asks for it.
 */
let updateState: UpdateState = { status: 'idle' }

function setUpdateState(next: UpdateState) {
  updateState = next
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('update:state', next)
  }
}

const currentInfo = () =>
  updateState.status === 'available' || updateState.status === 'downloading' || updateState.status === 'ready'
    ? updateState.info
    : null

/**
 * Looks for a newer release.
 *
 * A check nobody asked for stays quiet unless it finds something: the app
 * starting should not report that the network is down. A check from the menu
 * or from the page says what happened either way.
 */
export async function runCheck(manual: boolean): Promise<UpdateState> {
  if (updateState.status === 'downloading') return updateState
  if (manual) setUpdateState({ status: 'checking' })
  try {
    const info = await checkForUpdate(manifest.repository)
    const next: UpdateState = info
      ? { status: 'available', info }
      : { status: 'current', version: app.getVersion() }
    if (info || manual) setUpdateState(next)
    return next
  } catch (err) {
    const failed: UpdateState = {
      status: 'failed',
      message: err instanceof Error ? err.message : 'Could not check for updates',
    }
    if (manual) setUpdateState(failed)
    return failed
  }
}

function wireUpdates() {
  ipcMain.handle('update:version', () => app.getVersion())
  ipcMain.handle('update:check', () => runCheck(true))

  ipcMain.handle('update:download', async () => {
    const info = currentInfo()
    if (!info?.asset) return updateState
    setUpdateState({ status: 'downloading', info, received: 0, total: info.asset.size })
    try {
      const file = await downloadAsset(info.asset, (received, total) =>
        setUpdateState({ status: 'downloading', info, received, total }),
      )
      setUpdateState({ status: 'ready', info, file, manual: process.platform !== 'win32' })
    } catch (err) {
      setUpdateState({ status: 'failed', message: err instanceof Error ? err.message : 'Download failed' })
    }
    return updateState
  })

  ipcMain.handle('update:install', async () => {
    if (updateState.status !== 'ready') return updateState
    try {
      return await installUpdate(updateState.file)
    } catch (err) {
      setUpdateState({ status: 'failed', message: err instanceof Error ? err.message : 'Could not open the installer' })
      return updateState
    }
  })

  ipcMain.handle('update:page', async () => {
    const info = currentInfo()
    await shell.openExternal(info?.url ?? `${manifest.repository.replace(/\.git$/, '')}/releases/latest`)
  })

  // Replayed to a window that arrives after a check has already happened.
  ipcMain.handle('update:state', () => updateState)
}

/** Everything that has to be in place before a window can load. */
export function configure() {
  serveApp()
  // Nothing is loaded from the network into the page, so nothing needs to be
  // permitted: no camera, no location, no notifications.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  wireUpdates()
  buildMenu()
}

// Not when this file is loaded by the smoke test, which drives the pieces itself.
if (require.main === module) {
  void app.whenReady().then(() => {
    configure()
    createWindow()
    void refreshCatalogue()
    // After the window, and quietly: a launch should not wait on GitHub.
    setTimeout(() => void runCheck(false), 4000)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}
