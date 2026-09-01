# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev          # Vite dev server on :5173; the repo ships a scraped catalogue
npm run build        # tsc -b && vite build
npm test             # all app tests
npm run scrape       # refresh public/catalog.json from ikea.com
npm run scrape:dry   # fetch and report, write nothing
```

There is no test framework and no runner flags. Each file in `test/` is a standalone
`tsx` script that prints `PASS`/`FAIL` lines and exits non-zero on failure, so a single
suite runs as `npx tsx test/layout.test.ts`. `npm test` is just those scripts chained
with `&&`, which means it stops at the first failing file. Tests import from `../src/...`
with an explicit `.ts` extension (`allowImportingTsExtensions`); app code imports without.

`npm run test:worker` is separate and is not part of `npm test`.

`npm run shapes` is a separate pass over about 1,600 model downloads, cached under
`scraper/.cache`; knobs are `SHAPES_LIMIT`, `SHAPES_CONCURRENCY` and `SHAPES_CELL` (the
cube size, which invalidates every shape when it changes). It is not part of `npm run
scrape`, so a nightly re-scrape can add products that have no shape yet.

Scraper environment knobs: `PIP_LIMIT=0` skips the slow product-page pass,
`PIP_CONCURRENCY`, `IKEA_MARKET`/`IKEA_LANG` target another market. Product pages are
cached under `scraper/.cache` (gitignored), so a second run is nearly free.

The Cloudflare Worker in `worker/` has its own `package.json` and `node_modules`; run
wrangler commands from inside that directory. So does the Electron shell in `desktop/`:
`npm start` runs it, `npm run smoke` boots it hidden and asserts the planner really
loads, `npm run dist` packages installers. `npm run dist` and `npm start` both build the
planner first, with `VITE_BASE=./` and `VITE_PUBLIC_URL` set from the `publicSite` field
in `desktop/package.json`. The smoke test is not part of `npm test`, because it needs
Electron installed; `SMOKE_DOWNLOAD=1 npm run smoke` adds the real 90 MB download and
hash check, which is the only thing that proves the update verification does anything.

`build.publish` is null on purpose: `desktop/package.json` carries a `repository` field
for the updater, and electron-builder takes that as an instruction to upload to GitHub
itself on a tagged CI build, which fails for want of a token. The workflow's own release
job does the publishing.

Releases are cut by tagging `v*`, which is the only trigger that publishes installers;
the version in the tag must match `version` in `desktop/package.json`, since that is what
electron-builder names the files after and what the updater compares against.

Build-time env: `VITE_BASE` (GitHub Pages subpath, set by the deploy workflow),
`VITE_API_URL` (short-link service; unset is a supported configuration), `VITE_PUBLIC_URL`
(where Share should point when the page itself is not on the web, i.e. the desktop app).

## Architecture

A React + Vite SPA with a single canvas. There is no router and no server for the app
itself. Three pieces are worth understanding before editing.

**Catalogue as a fetched singleton.** `src/lib/catalog.ts` holds module-level mutable
state (`data`, `byId`, `groups`, `bounds`). `main.tsx` awaits `loadCatalog()` before the
first render, which is what lets every other module call `getItem(id)` synchronously.
`public/catalog.json` is fetched as a static asset rather than imported, keeping ~3.7k
products out of the JS bundle. Anything that runs before that await has no catalogue.

Products are grouped by `system|name|type|WxDxH`, so colourways collapse into one
`ProductGroup` with `variants`, but different sizes stay distinct. Size facets are
computed on rounded whole centimetres, and each dimension's facet is computed with every
other filter applied but its own selection ignored (that is what allows switching from
"80 wide" to "100 wide" without the list collapsing).

**Rendering and hit testing are the same code path twice.** `src/lib/render.ts` paints
the scene, then paints the identical geometry into an offscreen canvas with one flat
colour per item (`indexToPickColor`/`pickColorToIndex`) and reads back the pixel under
the cursor. Clicks agree with the screen by construction. If you change how an item is
drawn, the pick pass must see the same shape.

Draw order (`paintOrder` in `src/lib/iso.ts`) is a topological sort over separating-axis
comparisons, not a distance sort: a long sofa can be nearer than a wardrobe at one end
and further at the other. Interpenetrating pieces fall back to `depthKey`.

Coordinate spaces: world cm (`x`, `y`, `z` on `PlacedItem`, origin at the room's corner),
view cm (world rotated by the camera's quarter turn, via `toView`/`fromView`), and screen
pixels (`project`/`unproject`). Camera rotation is a pure rotation, so polygon winding is
preserved and orientation tests hold at every angle. A floor outline is always wound
clockwise; a wall is a far wall when its outward normal `(dy, -dx)` runs against the view
diagonal. Do not replace that with a centroid heuristic, which breaks on the inside
corner of an L-shaped room.

**State.** `src/state/store.ts` is one Zustand store (room, items, selection, camera,
flags) plus `localStorage` persistence under `ikeahacker.autosave` and `ikeahacker.saves`.
`RoomCanvas` owns transient interaction state (drag kind, animation clocks) in refs and
drives a rAF loop that stops entirely once nothing is animating.

**The desktop shell is a window, not a fork.** `desktop/main.ts` serves the built `dist`
over a registered `app://ikeahacker` scheme rather than `file://`, because Chromium
blocks `fetch` on file URLs and the catalogue is fetched, and because a registered scheme
gives the page a stable origin so `localStorage` layouts survive an update. Changing the
scheme or host orphans every saved plan. The shell also refreshes `catalog.json` from the
published site into `userData`, behind the same guard as the re-scrape workflow, and the
protocol handler prefers that copy; it takes effect at the next launch. Link building
goes through `linkBase()` in `src/lib/layout.ts`, which returns the current URL on the
web and the configured public site off it: a shared `app://` link opens for nobody.

**Shapes from IKEA's models beat the archetypes, when there are any.** `npm run shapes`
(`scraper/shapes.ts`) reads IKEA's glTF per product, voxelises it and stores a dozen-odd
boxes in `public/shapes.json`; `subBoxes(item, stored)` uses them and falls back to the
type archetype otherwise. The cache in `scraper/.cache/cells` stops at the merged cubes,
not the finished shape, so how a model is squared up with the published size can change
without re-downloading a gigabyte. Two traps: `merge` counts cells in the model's order
(x, up, depth) and the planner wants (x, depth, up), so `toLocal` swaps them -- getting
that wrong leaves a 202 cm bookcase 39 cm tall and only the "fills the size it was scaled
onto" test catches it; and the enclosed-space fill must not be flooded from below, or
every cabinet is a cage. Sealing the back as well was measured and is not worth it.

**The macOS build must be signed, even with no certificate.** Electron arrives
linker-signed, and packaging renames the bundle and adds resources, which leaves that
signature describing something that no longer exists. macOS rejects a broken signature
much harder than a missing one: v0.1.0 shipped that way and would not start, failing with
"code has no resources but signature indicates they must be present". `desktop/sign.mjs`
runs as an `afterPack` hook and ad-hoc signs the bundle, then verifies it, so a bad
signature fails the build instead of a download. Do not remove that hook, and do not test
a macOS build only by running what you just compiled: an unquarantined local build runs
even when the signature is broken. Copy it out of the dmg and set
`com.apple.quarantine` on it, which is what a download has. Ad-hoc signing does not avoid
the "unidentified developer" prompt; only notarisation does, and that needs a paid
account.

**Updates are the one thing the shell tells the planner about.** `desktop/update.ts`
reads the repository's latest release, compares it to `app.getVersion()`, and picks the
asset for this platform *and* architecture -- never one naming a different arch, since an
Intel Mac cannot open the arm64 dmg. Downloads are checked against the sha256 GitHub
publishes per asset. Installing is a handover, not an install: unsigned apps cannot
replace themselves on macOS, so only Windows runs its installer and quits. The renderer
side is `src/lib/updates.ts` and `UpdateBanner`, which render nothing when
`window.desktopUpdates` is absent, which is how the same build serves the web. The state
types are written out in both places on purpose; `src/` must not import from `desktop/`.

**Untrusted input has one door.** Layouts from a share link, an imported file, or
`localStorage` all pass through `sanitizeLayout` in `src/lib/layout.ts`. Malformed input
is rejected; merely unknown input (a retired article number) is dropped and counted so
the UI can say what went missing. Positions are clamped, non-hex colours ignored. Keep
new load paths behind this function.

Share encoding is positional (arrays, not objects) with numeric article numbers and
quarter-turn rotations, to keep links pasteable. IKEA article numbers are eight digits
and hundreds start with a zero, so decoding re-pads them; losing a leading zero silently
resolves to a different product and there is a test for it.

**Short links are optional by design.** With `VITE_API_URL` unset, `Share` packs the
whole plan into the URL fragment (`#p=...`); with it set, the payload is POSTed to the
Worker and the link is `?s=<id>`. Both forms must keep working: old long links still
open, and a fork with no backend still shares. The Worker stores an opaque string and
knows nothing about plan structure, so the client encoding can change without a
migration.

**Scraper.** `scraper/systems.ts` lists the systems and their categories; `scrape.ts`
does a search-API pass then a product-page pass for items the API leaves unsized
(`pip.ts`, with the disk cache); `finish.ts` maps finish words parsed out of product URLs
to hex colours. URLs transliterate Swedish characters their own way (`POÄNG` becomes
`poaeng`). Extendable tables (`140/196x85 cm`) take the retracted size. Missing depths are
inferred per product type: a table's `Length` is its width, a bed's `Length` is its depth.

## Conventions

Comments in this codebase explain *why*, usually citing the bug or the alternative that
failed (see `test/styles.test.ts`, which asserts CSS rules because the layout bugs it
guards were invisible in the common case). Match that register rather than adding
restating comments. Prose in code and docs uses British spelling and avoids em dashes.

TypeScript is strict with `noUnusedLocals`/`noUnusedParameters`, so `npm run build` fails
on dead bindings.

## CI

`.github/workflows/deploy.yml` runs `npm test` then builds to GitHub Pages on push to
`main`. `.github/workflows/rescrape.yml` re-scrapes nightly and commits
`public/catalog.json` only when it changes; it refuses to publish a result under 500
products or under 70% of the previous count, because a collapsed scrape means IKEA
changed something and publishing it would strip articles out of saved layouts.
