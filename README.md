# IKEA Hacker

An isometric room planner built on real IKEA product data. Scrape the systems
you care about, then drag the actual articles around a room drawn to scale and
walk away with a shopping list.

![systems](https://img.shields.io/badge/systems-40-1a7f6b) ![products](https://img.shields.io/badge/products-3.7k-1a7f6b)

## Run it

```bash
npm install
npm run dev        # the repo ships a scraped catalogue
```

To refresh the product data, or to point it at a different IKEA market:

```bash
npm run scrape
```

`npm test` checks the projection, camera rotation and draw-ordering maths.

## What it does

**Catalogue.** Every product is scraped from ikea.com with its real width,
depth, height, finish, price, photo and product URL. 40 systems are covered,
from the modular storage ones (PAX, PLATSA, BILLY, BESTÅ, KALLAX, IVAR, EKET,
METOD, ELVARLI, BOAXEL, TROFAST) through bedroom, desk, seating and table
ranges. Filter by category, by system, by free-text search, or by what actually
fits across your room.

**Room.** Set the width, depth and height in centimetres, or start from a
preset. Recolour the walls and floor. The two walls facing the camera are drawn
so pieces read against them.

**Placing things.** Click a product to drop it in the first free spot. Drag it
around the floor on a 5 cm grid (hold <kbd>Alt</kbd> for 1 cm). Rotate in 90°
steps, raise it off the floor to hang wall units, recolour a single piece, or
duplicate it. Overlapping items are flagged. Turn the camera in quarter steps
to check the layout from each corner.

Pieces are drawn as shaded isometric boxes with front detailing that follows the
product type: doors get a split and handles, chests get drawer lines, bookcases
get a recessed interior with shelves, tables get a slab on four legs, and sofas
get a seat, a back and arms.

**Output.** The shopping list totals up what is in the room at current prices.
Export the plan as a PNG, the list as CSV, or the layout as JSON. Layouts save
to the browser, and whatever you had last is restored on load.

### Keyboard

| | |
|---|---|
| <kbd>R</kbd> / <kbd>Shift</kbd>+<kbd>R</kbd> | rotate the selection |
| <kbd>D</kbd> | duplicate |
| <kbd>⌫</kbd> | remove |
| arrows | nudge 5 cm (<kbd>Shift</kbd> for 25 cm) |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + <kbd>↑</kbd><kbd>↓</kbd> | raise and lower |
| <kbd>[</kbd> <kbd>]</kbd> | turn the room |
| <kbd>Esc</kbd> | deselect |

Drag empty space to pan, scroll to zoom.

## The scraper

`npm run scrape` reads `scraper/systems.ts` and writes `public/catalog.json`.
The app fetches that file at startup, so it stays out of the JS bundle and the
browser caches it separately.

It uses two sources. The first is the JSON endpoint that ikea.com's own search
page calls, which returns a whole system in one request along with a
`"100x58x201 cm"` measurement string for most flat-pack storage. The second is
the product page, which is only needed for the items the search API leaves
unsized — sofas have no measurement string at all, and desks and dining tables
publish only two of the three figures. Those pages are about a megabyte each, so
they are fetched concurrently, capped, and cached under `scraper/.cache`; a
second run costs nothing.

A few details worth knowing:

- Extendable tables are listed as `140/196x85 cm`. The planner takes the
  retracted size, so a piece fits where the plan says it fits.
- IKEA does not always publish a depth. A table's `Length` is its long
  horizontal axis and becomes the width; a bed's `Length` runs away from the
  wall and becomes the depth; round tables give only a diameter.
- Finishes are parsed out of the product URL, which transliterates Swedish
  characters in its own way — `POÄNG` becomes `poaeng`, `SÖDERHAMN` becomes
  `soederhamn`. They are then mapped to a hex colour for shading.

```bash
npm run scrape:dry              # fetch and report, write nothing
PIP_LIMIT=0 npm run scrape      # search API only, skip the product pages
IKEA_MARKET=de IKEA_LANG=de npm run scrape
```

Other markets work, though the finish-colour and product-type matching are
tuned for English and will degrade.

## Layout

```
scraper/
  systems.ts     which IKEA systems to scrape, and how they are categorised
  scrape.ts      search API pass, product page pass, normalisation
  pip.ts         product page measurement extraction and its disk cache
  finish.ts      finish words to hex colours
src/lib/
  iso.ts         isometric projection, camera rotation, footprints, draw order
  render.ts      canvas painting, and the colour-coded pick pass for hit testing
  geometry.ts    a product's boxes: slab and legs, seat and back, or one box
  catalog.ts     loading and filtering the scraped data
  export.ts      PNG, CSV and JSON output
src/components/  toolbar, catalogue sidebar, canvas, inspector
src/state/       the room, what is in it, and browser persistence
test/            geometry checks
public/          the scraped catalogue, fetched at startup
```

Hit testing renders the same geometry a second time into an offscreen canvas,
one flat colour per item, and reads back the pixel under the cursor. Clicks
therefore agree with what is on screen by construction, including where a
wardrobe is half behind a sofa.

Draw order is a topological sort rather than a distance sort. Sorting boxes on
a single distance number gets large abutting furniture wrong: a long sofa can
be nearer than a wardrobe at one end and further at the other, and no single
key expresses that. Instead each pair that a separating axis can order becomes
an edge, and the graph is sorted back to front; interpenetrating pieces, which
have no correct answer, fall back to distance.

## Notes

Prices and availability are whatever the scrape captured; check ikea.com before
buying. The catalogue is a snapshot, not a live feed. Dimensions are IKEA's own
published product measurements, but a plan is not a substitute for a tape
measure.
