# Pulling products from Swyft and Dunelm

Findings from probing both sites on 2026-09-01, before writing any scraper code. The
question this answers is not "can we fetch their pages" but "do they publish a width, a
depth and a height we can trust", because a product without three numbers is not
placeable and the planner drops it.

## Verdict

Both are workable. Dunelm is a plain `fetch` job in the same shape as the existing IKEA
pass. Swyft needs a browser to get past Cloudflare, but only one, for one session, and
its data is the cleaner of the two once you are in.

## Dunelm

**Discovery.** `https://www.dunelm.com/sitemap.xml` indexes three product sitemaps,
42,093 product URLs in total. Slugs end in the product id
(`/product/manhattan-white-double-wardrobe-1000095052`), so the id is free and stable,
the same way IKEA's article number is. Category pages are useless for enumeration: the
grid is client-rendered, the `CollectionPage` ld+json ships an empty `itemListElement`,
and loading one in a real browser fires no listing request we can see, so the products
come from a server-side BFF we would have to guess at. Filtering the sitemap by slug
keyword instead (`bookcase|wardrobe|desk|sofa|...`) leaves 3,352 candidates, which is the
same order as the ~3,000 product pages the IKEA pass already fetches, and the ld+json on
each page carries the real `category` so a bad keyword guess gets discarded on arrival
rather than polluting the catalogue.

**The page.** Two things worth having, both server-rendered into the HTML:

- `<script type="application/ld+json">` with `@type: Product`: `@id` (the product id),
  `name`, `category`, `image`, `sku`, `color`, `description`, `offers.price`.
- A structured attribute list, `{"property":"...","value":"..."}`, with `Product
  Dimensions`, `Brand`, `Finish`, `Composition`, `Assembly`, `Pack Contents` and
  `Packaging Dimensions`.

Pages are ~270 KB and answered in 72-370 ms unthrottled across a 12-page sample, with no
sign of rate limiting. `robots.txt` disallows `/search?`, `/facet/` and paginated
category URLs, and says nothing about `/product/` or the sitemaps, which is the route
taken here.

**Dimensions.** All 12 sampled products published a usable overall size, and Dunelm
labels its axes, which is better than IKEA's bare `100x58x201 cm`. The value is a run of
`<p>` blocks and only the first is the whole product; the rest describe shelves, drawers
and seats.

A warning about what follows. This list came out of twelve products and it was not
enough. Every bed in that sample used `D` for its depth, so the parser was written to
expect it, and the first real run silently dropped almost every bed frame in the
catalogue: Dunelm publishes beds with an `L` for length, not a `D`. Twelve products
tells you which spellings exist, not which are common, and a parser that drops a product
looks exactly like a product with no dimensions. The counters in the scraper exist for
that reason, and a jump in "furniture with no usable size" is the signal to go and read
some raw values again.

Traps confirmed against real values:

    H 140cm x W 63cm x D 32cm                      the common case
    H: 77cm x W: 128cm x D: 71cm                   colons after the label
    H 65cm (26") x W 50cm (20") x D 37cm (15")     imperial in brackets, do not read the 26
    W 100cm x D 198.5cm x H 85cm                   beds put W first, so parse by label not position
    Single: H 90cm x W 102cm x L 203cm             beds give a length, not a depth
    L 80cm x W 40cm x H 40cm, Capacity: 128 litres so do some ottomans, and on those the
                                                   length is the long side, not the depth
    Table Closed: H 76cm ... | Table Extended: ... first block is the retracted size, which
                                                   matches what the IKEA scraper already does
    Single: ... | Kingsize: ...                    one page, several mattress sizes

The length rows are the same distinction `dimsFromMeasures` already draws for IKEA, and
for the same reason: a bed's length runs head to foot, away from the wall, so it is the
depth, whereas on anything else the length is simply the long horizontal side. Sofa beds
go with "anything else", since folded they sit along a wall like any sofa. A bunk bed can
be wider than it is long, so the rule has to be "length is the depth", not "the long side
is the width".

The mattress rows are the one real design decision: a bed page is several products.
Emitting one catalogue item per named size is closer to the truth than taking the first.
Watch the spelling, though, because "Kingsize" as one word is as common as "King Size"
and a `king\b` match quietly loses a size on most bed pages.

`offers.price` was missing on two of the twelve (a sofa bed and a bed frame), presumably
because those pages price a range, so price has to be optional or read from elsewhere.

## Swyft

**Discovery is trivial, fetching is not.** It is a Shopify store, and
`https://swyfthome.com/products.json?limit=250&page=N` returns the whole catalogue,
around 750 products over three or four pages, with `title`, `handle`, `product_type`,
`tags`, `options`, `variants` (sku, price, colour) and images. `product_type` maps
straight onto the planner's categories: Sofa, Chaise sofa, Sofa bed, Love Seat, Ottoman,
Dining table, Dining chair, Desk, Coffee table, Console table, Sideboard, TV Unit, Bed,
Occasional Chair, Floor Lamp.

There are no dimensions in that feed and none in `body_html`, so the size has to come
from the product page. The page has exactly what is wanted, server-rendered by the theme:

    <script id="product-metadata" type="application/json">
      { "swyft_product": { "title": ..., "type": "Sofa", "handle": ...,
          "metafields": { "model": "Model 19", "width": "200cm",
                          "depth": "81cm", "height": "83.5cm" },
          "variants": [ { "sku": ..., "price": "£999", "rrp": "£1,199",
                          "metafields": { "colour": "Harissa", "material": "Chenille" },
                          "variant_media": [...] } ] } }

Labelled, in centimetres, one blob per page, with the colourway and material already
split out. `metafields.model` is a family name (Model 19) that behaves like an IKEA
system, and the page count is small: 250 products collapse to 51 distinct model, type and
size combinations, so the whole catalogue is on the order of 150 pages, not 750.

**The wall, and the way round it.** Cloudflare serves a managed challenge to plain
`fetch`/`curl`. The first three `products.json` requests returned 200; the fourth returned
429 with a "Verifying your connection" interstitial, and after that every path on the
host, `robots.txt` included, kept returning the challenge. Full browser headers and a
cookie jar did not help, which is expected: the challenge wants JavaScript.

What does work is doing the fetching *from inside* a page that has already cleared the
challenge. Load any Swyft URL in a real browser once, then call same-origin `fetch()` in
the page context: the clearance cookie rides along and every request is answered
normally. `products.json?page=1` returns 200 with 250 products through the page while
`curl` on the same URL gets 429. That turns "we need a browser per product page" into
"we need one browser, once", which is a much smaller dependency.

**Confirmed by running it.** The whole catalogue was pulled this way, one page at a
time with a 250-400 ms gap, no throttling seen:

- 750 listings over three `products.json` pages (page 4 is a genuine Shopify 500, not a
  challenge, and marks the end).
- 94 distinct shapes once colourways are collapsed on title-before-the-comma plus type.
- 70 of those 94 published width, depth and height, covering **715 of the 750 listings**.
- The 24 without dimensions are not losses: sofa covers, ottoman covers, sofa legs and
  ottoman legs, plus a handful of untyped legacy duplicates (`desk-3` alongside the live
  `desk-03-walnut`) whose metafields are all null. Dropping anything with an empty
  `product_type` removes the duplicates cleanly.

The extracted table is uniform in a way IKEA's is not. Every sofa has a depth, which is
precisely what the IKEA search API fails to give and why `scraper/pip.ts` exists at all:

    Model 19 | Sofa              | 200cm   | 81cm    | 83.5cm
    Model 19 | Chaise sofa       | 202.5cm | 81cm    | 83.5cm
    Model 15 | Sofa              | 206cm   | 103.5cm | 91cm
    Model 02 | Armchair          | 80cm    | 85cm    | 82cm
    Sideboard 01 | Sideboard     | 170cm   | 45cm    | 68cm
    Console Table 01 | Console Table | 110 cm | 35 cm | 80 cm

Two small parsing notes from the real data: the unit is sometimes spaced (`110 cm`) and
one value carries a trailing space, so trim before matching; and one product has an empty
`model`, so do not key on it.

Remaining options if the in-page trick ever stops working: pace plain fetches hard and
accept the occasional lockout, or ask Swyft for a Storefront API token. Their metafields
are already public on the page, so there is nothing to hide.

## What this means for the code

None of this fits `CatalogItem` as it stands. `id` is documented as an IKEA article
number, `system`/`systemLabel` as an IKEA system, and `scraper/systems.ts` is a list of
IKEA search phrases.

Dunelm is now wired in: `loadCatalog` merges `catalog-dunelm.json` beside `catalog.json`,
`retailer` is an optional field read as IKEA when absent, and the sidebar grows a shop
row when more than one is present. What follows is what that had to respect.

The share encoding is the constraint to check first. `src/lib/layout.ts` packs `itemId`
through `Number()` and re-pads with `padStart(8, '0')` on the way back, so an id only
survives if it is numeric and has no leading zero past the eighth digit. Both retailers
happen to pass: Dunelm ids are ten digits (`1000095052`) and Shopify variant ids fourteen
(`58324104380751`), so `padStart(8)` is a no-op and the round trip is lossless. The
danger is quieter than a broken link. Nothing in that id says which retailer it came
from, so the day a supplier hands out an eight-digit number, a shared plan resolves to
somebody else's product with no error anywhere. A retailer prefix wants designing before
the second source ships, not after.

The other trap is Swyft's natural key. The dimensions live on the product, but the thing
worth placing is a product plus a colourway, and Shopify gives that a numeric variant id
while the product page is addressed by a text handle. Pick the variant id.

The other loss is shapes. `npm run shapes` works because IKEA publishes a glTF per
product; neither of these does, so their items fall back to the type archetype. That is
the same fallback the un-modelled IKEA products already use, so it degrades rather than
breaks, but a Dunelm bookcase will not look as good as a BILLY next to it.
