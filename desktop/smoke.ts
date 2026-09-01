/**
 * Does the packaged planner actually run?
 *
 * An Electron app cannot be tested by importing it: the things that break --
 * the custom scheme, the catalogue fetch, the content security policy -- only
 * exist inside a real browser window. So this boots the shell for real with
 * the window hidden, drives the page, and reports like the other suites.
 *
 * Run with `npm run smoke` from `desktop/`. It needs the app built first,
 * which the script does for you.
 */
import { app, BrowserWindow, net } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configure, createWindow, PUBLIC_SITE, refreshCatalogue } from './main'
import { compareVersions, pickUpdate, repoSlug } from './update'

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`)
}

/** Resolves when the window has loaded, and gives up rather than hanging a run. */
const load = (window: BrowserWindow, ms = 20000) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`nothing loaded within ${ms / 1000}s`)), ms)
    const settle = (err?: Error) => {
      clearTimeout(timer)
      err ? reject(err) : resolve()
    }
    window.webContents.once('did-finish-load', () => settle())
    window.webContents.once('did-fail-load', (_e, code, description) =>
      settle(new Error(`${description} (${code})`)),
    )
  })

app.whenReady().then(async () => {
  configure()

  const problems: string[] = []
  const window = createWindow(false)
  // A page that logs an error is a page with something wrong with it, and the
  // usual something is a request the content security policy blocked. The
  // event's shape changed in Electron 35, so read both.
  window.webContents.on('console-message', (...args: unknown[]) => {
    const [, level, message] = args as [unknown, number | { level: string; message: string }, string]
    if (typeof level === 'object') {
      if (level.level === 'error') problems.push(level.message)
    } else if (level >= 3) {
      problems.push(message)
    }
  })

  try {
    await load(window)
    // The catalogue is fetched before the first render, so wait for the app.
    await window.webContents.executeJavaScript(
      `new Promise((done, fail) => {
         const started = Date.now()
         const tick = () => {
           if (document.querySelector('.sidebar')) return done(true)
           if (document.querySelector('.fatal')) return fail(new Error(document.querySelector('.fatal p')?.textContent ?? 'fatal'))
           if (Date.now() - started > 15000) return fail(new Error('the planner never rendered'))
           setTimeout(tick, 100)
         }
         tick()
       })`,
    )

    const products = (await window.webContents.executeJavaScript(
      `Number((document.querySelector('.results-count span')?.textContent ?? '0').replace(/[^0-9]/g, ''))`,
    )) as number
    check(`the catalogue loads over the app scheme (${products.toLocaleString()} products)`, products > 500)

    const origin = (await window.webContents.executeJavaScript(`window.location.origin`)) as string
    check('the page has a stable origin, so saved layouts survive an update', origin === 'app://ikeahacker', origin)

    const stored = (await window.webContents.executeJavaScript(
      `(() => { try { localStorage.setItem('smoke', 'yes'); return localStorage.getItem('smoke') } catch (e) { return String(e) } })()`,
    )) as string
    check('localStorage works, which is where a plan is kept', stored === 'yes', stored)

    // Place something, which exercises the store, the canvas and the picker.
    const placed = (await window.webContents.executeJavaScript(
      `(async () => {
         const search = document.querySelector('.search')
         const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
         set.call(search, 'billy bookcase')
         search.dispatchEvent(new Event('input', { bubbles: true }))
         await new Promise((r) => setTimeout(r, 400))
         document.querySelector('.item-main')?.click()
         await new Promise((r) => setTimeout(r, 900))
         return document.querySelector('.shopping-row')?.textContent ?? ''
       })()`,
    )) as string
    check('a product can be found and placed in the room', /BILLY/.test(placed), JSON.stringify(placed))

    const canvas = (await window.webContents.executeJavaScript(
      `(() => { const c = document.querySelector('canvas'); return c ? c.width * c.height : 0 })()`,
    )) as number
    check('the room canvas is painted', canvas > 0)

    const link = (await window.webContents.executeJavaScript(
      `(() => { const a = document.querySelector('.ikea-link'); return a ? a.href : '' })()`,
    )) as string
    check('a product still links to ikea.com', /^https:\/\/www\.ikea\.com\//.test(link), link)

    check('the page reports no errors', problems.length === 0, problems.join(' | '))

    // The one change the planner needed for the desktop: a link to
    // app://ikeahacker opens for nobody, so Share has to build web links.
    //
    // The copy is intercepted rather than read back off the clipboard.
    // Chromium refuses to write to it from a window that is not focused, and
    // this one is deliberately hidden; what is being checked is the link the
    // app builds, not the browser's clipboard.
    const copied = (await window.webContents.executeJavaScript(
      `(async () => {
         let link = ''
         Object.defineProperty(navigator.clipboard, 'writeText', {
           configurable: true,
           value: (text) => { link = text; return Promise.resolve() },
         })
         const share = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Share')
         if (!share) return 'no Share button'
         share.click()
         await new Promise((r) => setTimeout(r, 600))
         return link
       })()`,
    )) as string
    check(
      'Share builds a link to the published site, not to the app scheme',
      copied.startsWith(PUBLIC_SITE) && copied.includes('#p='),
      copied.slice(0, 120),
    )

    const bridge = (await window.webContents.executeJavaScript(
      `Object.keys(window.desktopUpdates ?? {}).sort().join(',')`,
    )) as string
    check(
      'the page is handed the update bridge and nothing else',
      bridge === 'check,download,install,openPage,state,subscribe,version',
      bridge,
    )

    // Nothing newer than the running version is published, which is the point
    // of the check above, so the banner is shown what it would be shown.
    window.webContents.send('update:state', {
      status: 'available',
      info: {
        version: '0.2.0',
        notes: 'A pretend release, for seeing the banner.',
        url: 'https://github.com/Fr4ncis/ikeahacker/releases/tag/v0.2.0',
        asset: { name: 'IKEA.Hacker-0.2.0-arm64.dmg', url: 'https://github.com/x', size: 98444611, sha256: null },
      },
    })
    await new Promise((r) => setTimeout(r, 300))
    const banner = (await window.webContents.executeJavaScript(
      `document.querySelector('.update-bar')?.textContent ?? ''`,
    )) as string
    check(
      'a new version shows a banner offering the download',
      banner.includes('0.2.0') && banner.includes('Download') && banner.includes('93.9 MB'),
      JSON.stringify(banner),
    )

    const image = await window.webContents.capturePage()
    const shot = join(__dirname, 'smoke.png')
    writeFileSync(shot, image.toPNG())
    console.log(`      window captured to ${shot}`)

    // Once downloaded, the button has to say what pressing it will do, which
    // is not the same thing on a platform that cannot replace the app itself.
    for (const [manual, label] of [
      [false, 'Install and restart'],
      [true, 'Open the installer'],
    ] as const) {
      window.webContents.send('update:state', {
        status: 'ready',
        manual,
        file: '/tmp/pretend.dmg',
        info: { version: '0.2.0', notes: '', url: 'https://example.invalid', asset: null },
      })
      await new Promise((r) => setTimeout(r, 200))
      const text = (await window.webContents.executeJavaScript(
        `document.querySelector('.update-bar')?.textContent ?? ''`,
      )) as string
      check(`a downloaded update offers "${label}"`, text.includes(label), JSON.stringify(text))
    }

    const refreshed = await refreshCatalogue()
    console.log(`      catalogue refresh: ${refreshed}`)
    check('the catalogue refresh reports an outcome rather than throwing', refreshed.length > 0)

    await checkUpdates()
  } catch (err) {
    check('the app starts', false, err instanceof Error ? err.message : String(err))
  }

  console.log(failures ? `\n${failures} failing` : `\nall passing`)
  app.exit(failures ? 1 : 0)
})

/**
 * The update check, against the real releases rather than a fixture.
 *
 * What actually breaks an updater is the shape of somebody else's JSON
 * changing, so the parsing is checked against what GitHub returns today, with
 * the current version faked older to reach the interesting branch. Offline,
 * the network half is skipped rather than failed.
 */
async function checkUpdates() {
  check(
    'a newer version sorts above an older one, and a pre-release below its own',
    compareVersions('0.2.0', '0.1.9') > 0 &&
      compareVersions('0.1.10', '0.1.9') > 0 &&
      compareVersions('v1.0.0', '1.0.0') === 0 &&
      compareVersions('1.0.0-beta.1', '1.0.0') < 0 &&
      compareVersions('0.1.0', '0.2.0') < 0,
  )

  check('the repository field resolves to owner/repo', repoSlug('https://github.com/Fr4ncis/ikeahacker') === 'Fr4ncis/ikeahacker')

  let release: Parameters<typeof pickUpdate>[1] = null
  try {
    const res = await net.fetch('https://api.github.com/repos/Fr4ncis/ikeahacker/releases/latest', {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'ikeahacker-smoke' },
    })
    if (res.ok) release = (await res.json()) as typeof release
  } catch {
    release = null
  }
  if (!release) {
    console.log('      skipped the published-release checks: GitHub was not reachable')
    return
  }

  check(
    'the running version is not offered an update to itself',
    pickUpdate(app.getVersion(), release) === null,
    `${app.getVersion()} vs ${(release as { tag_name: string }).tag_name}`,
  )

  const found = pickUpdate('0.0.1', release, 'darwin', 'arm64')
  check(
    'an older version is offered the macOS build, with the hash to check it against',
    !!found?.asset?.name.endsWith('.dmg') &&
      /^[0-9a-f]{64}$/.test(found.asset.sha256 ?? '') &&
      found.asset.url.startsWith('https://github.com/'),
    JSON.stringify(found?.asset),
  )

  check(
    'each platform is offered its own installer',
    pickUpdate('0.0.1', release, 'win32', 'x64')?.asset?.name.endsWith('.exe') === true &&
      pickUpdate('0.0.1', release, 'linux', 'x64')?.asset?.name.endsWith('.AppImage') === true,
  )

  check(
    // The release carries an arm64 dmg only, and an Intel Mac cannot open it.
    'a machine with no build in the release is offered no download',
    pickUpdate('0.0.1', release, 'darwin', 'x64')?.asset === null,
    JSON.stringify(pickUpdate('0.0.1', release, 'darwin', 'x64')?.asset),
  )
}
