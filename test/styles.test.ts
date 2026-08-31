/**
 * Guards on two CSS decisions that shipped as bugs.
 *
 * Layout cannot be asserted without a browser, so these check the rules that
 * caused the failures rather than the rendered result. They exist because both
 * bugs were invisible in the common case and only showed up on particular
 * products. Run with `npm test`.
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../src/styles.css'), 'utf8')

let failures = 0
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : '  -> ' + detail}`)
}

/** The declarations inside one rule, e.g. `.preview-image`. */
function ruleBody(selector: string): string {
  const at = css.indexOf(`${selector} {`)
  if (at === -1) return ''
  return css.slice(at, css.indexOf('}', at))
}

const PHOTO_CONTAINERS = ['.preview-image', '.item-thumb']

for (const selector of PHOTO_CONTAINERS) {
  const body = ruleBody(selector)
  check(`${selector} exists`, body !== '')

  check(
    `${selector} clips its photo`,
    /overflow:\s*hidden/.test(body),
    'without this a tall photo escapes the box and covers the text beside it',
  )

  check(
    // A grid row sizes to the image's intrinsic height, so `max-height: 100%`
    // resolves against 1400px rather than the container and does nothing.
    `${selector} does not size its photo with an auto grid row`,
    !/display:\s*grid/.test(body),
    'use flex: an auto grid row grows to the image and max-height stops working',
  )
}

for (const selector of [...PHOTO_CONTAINERS, '.inspector-hero']) {
  check(
    `${selector} photos are not blended into their background`,
    !/mix-blend-mode/.test(`${ruleBody(selector)}\n${ruleBody(`${selector} img`)}`),
    'IKEA shoots on white; multiplying that into a dark finish colour hides the product',
  )
}

check(
  'a photo is fitted rather than stretched',
  /object-fit:\s*contain/.test(ruleBody('.preview-image img')),
)

console.log(failures ? `\n${failures} failing` : `\nall passing`)
process.exit(failures ? 1 : 0)
