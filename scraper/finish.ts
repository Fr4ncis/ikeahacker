/**
 * Maps IKEA finish words (parsed from a product URL slug) to a hex colour we
 * can shade an isometric box with. Order matters: the first entry whose key
 * appears in the slug wins, so compound finishes like "black-brown" must be
 * listed before "black".
 */
const FINISH_COLORS: [string, string][] = [
  ['black-brown', '#3b2b21'],
  ['white-stained-oak', '#e0d7c8'],
  ['dark-grey', '#4a4d52'],
  ['light-grey', '#c3c5c7'],
  ['grey-turquoise', '#7d9a99'],
  ['grey-green', '#8a9384'],
  ['light-beige', '#e3d9c8'],
  ['dark-beige', '#b8a68c'],
  ['high-gloss-white', '#f7f8f9'],
  ['dark-green', '#2f4739'],
  ['light-green', '#b3c6a5'],
  ['dark-blue', '#2c3d55'],
  ['light-blue', '#a9c2d6'],
  ['dark-red', '#5e2b2b'],
  ['pale-pink', '#e6cfcb'],
  ['oak-effect', '#c9a87c'],
  ['walnut', '#6b4a32'],
  ['ash-veneer', '#d8c7a9'],
  ['white-oak', '#ddd0bb'],
  ['anthracite', '#3a3d40'],
  ['stained-pine', '#b98d59'],
  ['galvanised', '#b9bec3'],
  ['aluminium', '#c8ccd0'],
  ['mirror', '#cdd8de'],
  ['glass', '#d5e2e8'],
  ['bamboo', '#d7bb87'],
  ['birch', '#e2d3b6'],
  ['acacia', '#a4763f'],
  ['brown', '#6f4e37'],
  ['beige', '#d9cbb2'],
  ['white', '#f2f2f0'],
  ['black', '#2b2b2d'],
  ['grey', '#9aa0a6'],
  ['green', '#5c7a5c'],
  ['blue', '#4a6b8a'],
  ['red', '#a8423c'],
  ['pink', '#dcb6b6'],
  ['yellow', '#d8bd5c'],
  ['orange', '#c9743a'],
  ['turquoise', '#5f9ea0'],
  ['gold', '#c2a24a'],
  ['silver', '#c0c4c8'],
  ['chrome', '#cdd2d6'],
  ['pine', '#d8b483'],
  ['oak', '#c9a87c'],
  ['bleached', '#ece2d2'],
]

/** Default colour when nothing in the slug looks like a finish. */
export const DEFAULT_COLOR = '#d5d2cb'

export function colorForFinish(finishSlug: string): string {
  for (const [key, hex] of FINISH_COLORS) {
    if (finishSlug.includes(key)) return hex
  }
  return DEFAULT_COLOR
}

/** Turns "white-stained-oak-effect" into "white stained oak effect". */
export function humanizeFinish(finishSlug: string): string {
  return finishSlug.replace(/-/g, ' ').trim()
}
