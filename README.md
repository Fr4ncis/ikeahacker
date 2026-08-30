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

`npm test` checks the projection, camera rotation and draw-ordering maths, the
layout serialisation that share links depend on, and the catalogue grouping and
filtering.

## What it does

**Catalogue.** Every product is scraped from ikea.com with its real width,
depth, height, finish, price, photo and product URL. 40 systems are covered,
from the modular storage ones (PAX, PLATSA, BILLY, BESTÅ, KALLAX, IVAR, EKET,
METOD, ELVARLI, BOAXEL, TROFAST) through bedroom, desk, seating and table
ranges.

Colourways are folded together. IKEA lists every finish as its own article, so
a POÄNG armchair appears thirty-three times and a BILLY bookcase eight; here
that is one product with a row of swatches, which turns 3,725 articles into
1,568 things you might actually buy. Different *sizes* stay separate, because
those are different purchases. Searching a finish picks it out — "billy oak"
lands on the oak one.

Filter by category, by system, by free-text search, and by size. The System and
Size filters are collapsible and only one opens at a time, so the panel stays
about 70 px tall until you reach for it, with the current selection shown in
the header.

Sizes are pills, one row per dimension, and they are contextual: they show the
sizes actually present in what you are looking at, each with how many products
it would leave. Pick BILLY and the widths are 40, 80, 95, 120, 136, 160, 200,
215, 240 — the sizes that exist, not an abstract range. They are multi-select,
choosing a width narrows the depths and heights on offer, and a dimension's own
choice does not collapse its own list, so you can switch between sizes rather
than having to clear first. One button restricts every dimension to what will
physically go in the room.

Right-click any product to open it on ikea.com, drop it straight into the room,
or copy its article number.

**Room.** Set the width, depth and height in centimetres, or start from a
preset. Recolour the walls and floor.

Rooms do not have to be rectangles. Start from an L-shape or draw your own
floor plan: drag a corner to move it, click an edge to add one, <kbd>Alt</kbd>-click
a corner to remove it. Corners snap to 10 cm. The floor area is reported in m²,
the grid is clipped to the outline, and anything left sitting outside the room
is flagged — you can still park a piece over a notch while you work out where
it goes.

**Placing things.** Click a product to drop it in the first free spot. Drag it
around the floor on a 5 cm grid (hold <kbd>Alt</kbd> for 1 cm). Rotate in 90°
steps, raise it off the floor to hang wall units, recolour a single piece, or
duplicate it. Right-click something in the room for the same menu plus
duplicate, rotate and remove. Overlapping items are flagged. Turn the camera in
quarter steps to check the layout from each corner.

Pieces are drawn as shaded isometric boxes with front detailing that follows the
product type: doors get a split and handles, chests get drawer lines, bookcases
get a recessed interior with shelves, tables get a slab on four legs, and sofas
get a seat, a back and arms.

**Output.** The shopping list totals up what is in the room at current prices.
Export the plan as a PNG, the list as CSV, or the layout as JSON.

**Saving and sharing.** Whatever you had last is restored when you come back.
Layouts can be named and saved, which keeps them in that browser. To move a
plan somewhere else there are two routes:

- **Share** copies a link that opens the exact layout — same room, same pieces,
  same positions. With the optional plan service deployed (see below) the link
  is a short `?s=k4mp2xqd`; without it the whole plan travels in the URL
  fragment instead, which always works but makes a longer link. Both forms keep
  working, so a fork with no backend still shares and old long links still open.
- **Download JSON** and **Import JSON…** round-trip a plan through a file.

Because the catalogue is a snapshot, a plan can outlive an article. Anything a
layout references that is no longer in the catalogue is dropped and counted, so
furniture is never quietly missing — you get told how many and why.

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
  polygon.ts     floor-plan geometry: inside/outside, edges, shapes
  layout.ts      validating a layout, and packing one into a share link
  render.ts      canvas painting, and the colour-coded pick pass for hit testing
  geometry.ts    a product's boxes: slab and legs, seat and back, or one box
  catalog.ts     loading the scraped data, grouping colourways, filtering
  export.ts      PNG, CSV and JSON output
src/components/  toolbar, catalogue sidebar, canvas, inspector, menus
src/state/       the room, what is in it, and browser persistence
test/            geometry, floor plans, serialisation and catalogue checks
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

### Sizes

Size facets are computed on whole centimetres. IKEA publishes the same KALLAX
shelving unit at both 146.5 and 147 cm depending on the variant, and offering
those as two choices would be noise. Rounding folds them together while leaving
genuinely distinct products alone: the 146 cm KALLAX underframe keeps its own
pill, and modular values like PAX's 50 / 75 / 100 are untouched.

Each dimension's facet is computed with every other filter applied but its own
selection ignored, which is what lets you switch from "80 wide" to "100 wide"
directly instead of the list collapsing to the one size already chosen.

### Walls of an irregular room

A floor plan is a polygon wound clockwise. For an edge `a → b` the outward
normal is `(dy, -dx)`, and since the camera looks down the `+x/+y` diagonal, a
wall is a far wall exactly when that normal runs against the diagonal. Near
walls are dropped, or they would stand between you and the room.

Camera rotation is a pure rotation, so winding is preserved and the same test
holds at every angle. It also stays correct around the inside corner of an L,
which a centroid-based guess does not — that was the first version, and it left
the notch of an L-shaped room with no walls at all.

### Share links

A plan is encoded as a positional array rather than an object, article numbers
travel as numbers rather than quoted strings, and rotation is a quarter-turn
count. That is what keeps a link short enough to paste. IKEA article numbers are
always eight digits, 379 of them in this catalogue starting with a zero, so
decoding pads them back out — losing a leading zero would silently resolve to
the wrong product, and there is a test for exactly that.

Anything arriving from a link, a file or browser storage goes through the same
validation. Malformed input is rejected outright; input that is merely unknown,
such as a retired article, is dropped and counted. Positions are clamped rather
than trusted, and a colour that is not a hex triple is ignored.

## The plan service (optional)

A Cloudflare Worker in `worker/` turns share links into short ids. The app
works without it — that is the point of the fragment encoding — so this is
purely to make links pasteable.

It stores the same opaque payload the client already produces and nothing else:
no accounts, no personal data, and the service has no idea what a plan is,
which means the client encoding can change without a migration. Re-sharing an
unchanged plan is deduplicated by content hash, so it returns the same link
rather than filling the table.

```bash
cd worker
npm install
npx wrangler login                # once, in a browser
npm run db:create                 # copy the database_id into wrangler.toml
npm run db:init                   # create the table
npm run deploy                    # prints the API URL
```

Then rebuild the app with that URL so Share uses it:

```bash
VITE_API_URL=https://ikeahacker-plans.<subdomain>.workers.dev npm run build
```

For the deployed site, set `VITE_API_URL` as a repository variable
(Settings → Secrets and variables → Actions → Variables) and the Pages workflow
picks it up. Add the site's origin to `ALLOWED_ORIGINS` in `wrangler.toml`.

Everything fits inside Cloudflare's free tier at any plausible usage.

## Keeping the catalogue current

`.github/workflows/rescrape.yml` re-scrapes IKEA nightly and commits
`public/catalog.json` when it changes, which redeploys the site. The
product-page cache is carried between runs, so a nightly run is a few minutes
rather than the full cold scrape.

It refuses to publish a result under 500 products or under 70% of the previous
count. A scrape that collapses almost certainly means IKEA blocked or changed
something rather than discontinuing half their range, and publishing it would
strip articles out of saved layouts.

Run it by hand from the Actions tab; `PIP_LIMIT=0` skips the slow product-page
pass if you only want the search-API data.

## Notes

Prices and availability are whatever the scrape captured; check ikea.com before
buying. The catalogue is a snapshot, not a live feed. Dimensions are IKEA's own
published product measurements, but a plan is not a substitute for a tape
measure.
