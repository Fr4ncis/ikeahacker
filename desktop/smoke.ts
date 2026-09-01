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
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configure, createWindow, PUBLIC_SITE, refreshCatalogue } from './main'

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

    const image = await window.webContents.capturePage()
    const shot = join(__dirname, 'smoke.png')
    writeFileSync(shot, image.toPNG())
    console.log(`      window captured to ${shot}`)

    const refreshed = await refreshCatalogue()
    console.log(`      catalogue refresh: ${refreshed}`)
    check('the catalogue refresh reports an outcome rather than throwing', refreshed.length > 0)
  } catch (err) {
    check('the app starts', false, err instanceof Error ? err.message : String(err))
  }

  console.log(failures ? `\n${failures} failing` : `\nall passing`)
  app.exit(failures ? 1 : 0)
})
