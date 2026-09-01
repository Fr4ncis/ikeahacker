/**
 * The Dunelm dimension parser, against strings taken verbatim from live
 * product pages. Every case here is a spelling that was actually observed in a
 * twelve-product sample, which is to say the format variance is not
 * hypothetical: labels move, colons come and go, and a product page can be
 * several products.
 */
import { parseDimensions, extractProduct, isBedCategory } from '../scraper/dunelm-pdp.ts'

let failures = 0

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`PASS ${name}`)
  } else {
    console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`)
    failures++
  }
}

const one = (v: string) => parseDimensions(v).map(({ label, ...d }) => d)

// Tribeca Tall Bookcase: the common case, plus a shelf that must not win.
check(
  'takes the product block and ignores the shelf',
  one('<p>H 140cm x W 63cm x D 32cm</p><p>Shelf Dimensions: H 27.5cm x W 60cm x D 32cm</p>'),
  [{ width: 63, depth: 32, height: 140 }],
)

// Dos Fabric 2 Seater Double Sofa Bed: colons after each axis letter.
check(
  'reads axis labels written with a colon',
  one('<p>H: 77cm x W: 128cm x D: 71cm</p><p>Mattress H: 202cm x W: 128cm</p>'),
  [{ width: 128, depth: 71, height: 77 }],
)

// Aylesbury Wide 3 Drawer Bedside Table: imperial in brackets. Reading the
// bracketed number would make this a 26 cm tall bedside table.
check(
  'ignores imperial sizes in brackets',
  one('<p>H 65cm (26") x W 50cm (20") x D 37cm (15")</p>'),
  [{ width: 50, depth: 37, height: 65 }],
)

// Maya Bed Frame: beds lead with W, so position tells you nothing.
check(
  'reads by label, not by position',
  one('<p>Single: W 100cm x D 198.5cm x H 85cm</p>'),
  [{ width: 100, depth: 198.5, height: 85 }],
)

// Vienna Flip Top Dining Table: the retracted size comes first, which is the
// size the planner must use, the same rule the IKEA parser already follows.
check(
  'takes the closed size of an extendable table',
  one(
    '<p>Table Closed: H 76cm x W 75cm x D 75cm</p><p>Table Extended: H 76cm x W 100cm x D 75cm</p>' +
      '<p>Chair: H 90cm x W 41cm x D 48.5cm</p><p>Floor Clearance: 67cm</p>',
  ),
  [{ width: 75, depth: 75, height: 76 }],
)

// One bed page really is three products. Dropping the other two would lose
// most of the range.
check(
  'keeps every mattress size on a bed page',
  parseDimensions(
    '<p>Single: W 100cm x D 198.5cm x H 85cm</p><p>Small Double: W 130cm x D 198cm x H 85cm</p>' +
      '<p>Double: W 145cm x D 198.5cm x H 85cm</p><p>Siderail Height: 27.2cm</p>' +
      '<p>Underbed Clearance: 26.2cm</p>',
  ),
  [
    { label: 'Single', width: 100, depth: 198.5, height: 85 },
    { label: 'Small Double', width: 130, depth: 198, height: 85 },
    { label: 'Double', width: 145, depth: 198.5, height: 85 },
  ],
)

// Oswald Check Wingback Armchair: a seat block and several one-axis notes.
check(
  'ignores single-axis notes',
  one(
    '<p>H 96.5cm x W 71.5cm x D 74.5cm</p><p>Seat: H 48cm x W 46cm x D 49cm</p>' +
      '<p>Arm height: 60cm</p><p>Leg height: 16cm</p><p>Back: 55cm</p>',
  ),
  [{ width: 71.5, depth: 74.5, height: 96.5 }],
)

// A product whose own block is short must yield nothing rather than silently
// reporting the size of a drawer.
check(
  'refuses to fall back to a sub-part',
  one('<p>H 80cm x W 40cm</p><p>Internal Drawer Dimensions: H 12.5cm x W 29.5cm x D 20cm</p>'),
  [],
)

check('handles a missing value', parseDimensions(undefined), [])
check('handles a value with no sizes in it', parseDimensions('<p>See product page</p>'), [])

// A packaging block is never the product, even listed on its own.
check(
  'never reads packaging as the product',
  one('<p>Box 1: H 81cm x W 60cm x D 11.5cm, 19.5kg</p>'),
  [],
)

// --- length, which is where the first version of this parser went wrong ---
//
// Most furniture is published H/W/D, but bed frames give a length instead of a
// depth. A twelve-product sample happened to contain the one bed that used D,
// so the rule looked settled and every ottoman and metal bed frame in the
// catalogue was silently dropped. These cases are the ones that caught it.

const bed = (v: string) => parseDimensions(v, true).map(({ label, ...d }) => d)

// Sedna Bed Frame: a bed's length runs head to foot, so it is the depth.
check(
  'reads a bed length as the depth',
  bed('<p>Single: H 90cm x W 102cm x L 203cm</p>'),
  [{ width: 102, depth: 203, height: 90 }],
)

// Neptune Bunk Bed Frame, which is wider than it is long. The rule still has
// to be "length is the depth", not "the long side is the width".
check(
  'keeps a bed length as depth even when it is the shorter side',
  bed('<p>H 151cm x W 204.5cm x L 104cm</p>'),
  [{ width: 204.5, depth: 104, height: 151 }],
)

// Foldable Ottoman: not a bed, so the length is simply the long horizontal
// side and the piece stays wider than it is deep.
check(
  'reads a non-bed length as the long side',
  one('L 80cm (31.5") x W 40cm (16") x H 40cm (16"), Capacity: 128 litres'),
  [{ width: 80, depth: 40, height: 40 }],
)

// Berlin Ottoman Bed Frame: every mattress size, all of them using L.
check(
  'keeps every size on a bed page written with lengths',
  parseDimensions(
    '<p>Single: H 84cm x W 101cm x L 205cm</p><p>Small Double: H 84cm x W 132cm x L 205cm</p>' +
      '<p>Double: H 84cm x W 147cm x L 205cm</p><p>Kingsize: H 84cm x W 162cm x L 214cm</p>' +
      '<p>Footboard Height 30cm</p>',
    true,
  ),
  [
    { label: 'Single', width: 101, depth: 205, height: 84 },
    { label: 'Small Double', width: 132, depth: 205, height: 84 },
    { label: 'Double', width: 147, depth: 205, height: 84 },
    { label: 'Kingsize', width: 162, depth: 214, height: 84 },
  ],
)

// Barcelona Kids Bunk Bed: the mattress space must not be mistaken for the bed.
check(
  'ignores mattress space on a bunk bed',
  bed(
    '<p>H 159cm x W 107cm x L 208cm</p><p>Mattress Space: W 90cm x L 190cm</p>' +
      '<p>Siderail Height: 150cm</p><p>Underbed Clearance: 29cm</p>',
  ),
  [{ width: 107, depth: 208, height: 159 }],
)

check('a bedside table is not a bed', isBedCategory('Bedside Tables'), false)
check('a sofa bed is not a bed, since folded its length is its width', isBedCategory('Sofa Beds'), false)
check('metal beds are beds', isBedCategory('Metal Beds'), true)
check('storage bed frames are beds', isBedCategory('Storage Bed Frames'), true)
check('bunks are beds', isBedCategory('Childrens Bunk Beds'), true)
check('bookcases are not beds', isBedCategory('Bookcases'), false)

// --- extractProduct ---

const PAGE = `
<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","@id":"1000095052",
"name":"Manhattan Double Wardrobe, White","category":"Wardrobes","color":"White","sku":"30304316",
"image":["https://images.dunelm.com/30304316.jpg"],"description":"A wardrobe.",
"offers":{"@type":"Offer","price":"369","priceCurrency":"GBP"}}</script>
</head><body>
<script>{"property":"Product Dimensions","value":"\\u003cp\\u003eH 197cm x W 74cm x D 53cm\\u003c/p\\u003e"}
{"property":"Packaging Dimensions","value":"\\u003cp\\u003eBox 1: H 81cm\\u003c/p\\u003e"}
{"property":"Brand","value":"Julian Bowen"}</script>
</body></html>`

const raw = extractProduct(PAGE)
check('picks the Product blob past the breadcrumbs', raw?.id, '1000095052')
check('reads the price', raw?.price, 369)
check('reads the colour', raw?.color, 'White')
check('takes the first image', raw?.image, 'https://images.dunelm.com/30304316.jpg')
check('unescapes the dimensions attribute', raw?.attributes['Product Dimensions'], '<p>H 197cm x W 74cm x D 53cm</p>')
check('keeps packaging separate from the product size', raw?.attributes['Packaging Dimensions'], '<p>Box 1: H 81cm</p>')
check(
  'parses the attribute it extracted',
  one(raw!.attributes['Product Dimensions']),
  [{ width: 74, depth: 53, height: 197 }],
)
check('returns nothing for a page with no product', extractProduct('<html></html>'), null)

console.log(failures === 0 ? '\nAll Dunelm parser tests passed.' : `\n${failures} failure(s).`)
process.exit(failures === 0 ? 0 : 1)
