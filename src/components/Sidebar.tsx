import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CATEGORY_LABELS,
  DIMENSIONS,
  DIMENSION_LABELS,
  EMPTY_FILTERS,
  bandLabel,
  categories,
  clearSizes,
  filterGroups,
  formatPrice,
  formatPriceRange,
  getCatalog,
  hasAnyFilter,
  hasSizeFilter,
  setSizes,
  sizeBands,
  sizeFacets,
  summariseSizes,
  toggleBand,
  toggleSize,
  type Dimension,
  type Filters,
  type GroupMatch,
  type SizeOption,
} from '../lib/catalog'
import { Sound } from '../lib/sound'
import { ProductPreview, type PreviewTarget } from './ProductPreview'
import { usePlanner } from '../state/store'
import type { CatalogItem } from '../lib/types'

const PAGE = 40
/** Colourways shown as swatches before the rest are folded away. */
const SWATCH_LIMIT = 7

function ProductCard({
  match,
  currency,
  onAdd,
  onContext,
  onPreview,
}: {
  match: GroupMatch
  currency: string
  onAdd: (item: CatalogItem) => void
  onContext: (item: CatalogItem, x: number, y: number) => void
  onPreview: (item: CatalogItem | null, colours: number, element: HTMLElement | null) => void
}) {
  const { group } = match
  const [picked, setPicked] = useState(match.variant)
  const [expanded, setExpanded] = useState(false)

  // A new search can point at a different colourway of the same product.
  useEffect(() => setPicked(match.variant), [match.variant, group.key])

  const variant = group.variants[Math.min(picked, group.variants.length - 1)]
  const many = group.variants.length > 1
  const shown = expanded ? group.variants : group.variants.slice(0, SWATCH_LIMIT)
  const hidden = group.variants.length - shown.length

  return (
    <div
      className="item-card"
      onContextMenu={(e) => {
        e.preventDefault()
        onContext(variant, e.clientX, e.clientY)
      }}
      onPointerEnter={(e) => onPreview(variant, group.variants.length, e.currentTarget)}
      onPointerLeave={() => onPreview(null, 0, null)}
    >
      <button className="item-main" onClick={() => onAdd(variant)} title={`Add ${group.name} ${group.type}`}>
        <span className="item-thumb" style={variant.imageUrl ? undefined : { background: variant.color }}>
          {variant.imageUrl ? <img src={variant.imageUrl} alt="" loading="lazy" /> : null}
        </span>
        <span className="item-body">
          <span className="item-name">
            {group.name} <em>{group.type}</em>
          </span>
          <span className="item-meta">
            {group.width} × {group.depth} × {group.height} cm
          </span>
          <span className="item-meta item-meta--sub">
            {many ? `${group.variants.length} colours · ` : ''}
            {variant.finish !== 'unspecified' ? variant.finish : 'finish not listed'}
          </span>
        </span>
        <span className="item-price">
          {many ? formatPriceRange(group, currency) : formatPrice(variant.price, currency)}
        </span>
      </button>

      {many && (
        <div className="variants">
          {shown.map((v, i) => (
            <button
              key={v.id}
              className={`variant ${v.id === variant.id ? 'variant--on' : ''}`}
              style={{ background: v.color }}
              title={`${v.finish} — ${formatPrice(v.price, currency)}`}
              aria-label={v.finish}
              onClick={(e) => {
                setPicked(i)
                Sound.tick()
                onPreview(v, group.variants.length, e.currentTarget.closest('.item-card'))
              }}
            />
          ))}
          {hidden > 0 && (
            <button className="variant variant--more" onClick={() => setExpanded(true)} title="Show every colour">
              +{hidden}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** One collapsible filter section. Only one is ever open, keeping the panel short. */
function Facet({
  title,
  summary,
  open,
  onToggle,
  onClear,
  children,
}: {
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  onClear?: () => void
  children: React.ReactNode
}) {
  return (
    <section className={`facet ${open ? 'facet--open' : ''}`}>
      {/* The clear sits beside the toggle rather than inside it: a button
          cannot hold a button, and clearing has to work while closed. */}
      <div className="facet-head">
        <button className="facet-toggle" onClick={onToggle} aria-expanded={open}>
          <span className="facet-caret" aria-hidden="true" />
          <span className="facet-title">{title}</span>
          <span className={`facet-summary ${onClear ? 'facet-summary--on' : ''}`}>{summary}</span>
        </button>
        {onClear && (
          <button className="facet-reset" onClick={onClear} title={`Clear ${title.toLowerCase()}`}>
            <span aria-hidden="true">×</span>
            <span className="sr-only">Clear {title.toLowerCase()}</span>
          </button>
        )}
      </div>
      {open && <div className="facet-body">{children}</div>}
    </section>
  )
}

/**
 * The sizes available in one dimension, as something you can actually pick from.
 *
 * Short lists are the exact sizes, which is the whole point of contextual
 * facets: pick BILLY and the widths are 40, 80, 95, 120. Long ones are folded
 * into brackets first, because with no system chosen there are 184 distinct
 * widths and no one reads those. A bracket filters on its own -- most people
 * want "about 100 wide" -- and opens to the exact sizes for anyone who does
 * care that it is 95 and not 100.
 */
function DimensionPicker({
  dimension,
  options,
  chosen,
  summary,
  onChange,
}: {
  dimension: Dimension
  options: SizeOption[]
  chosen: number[]
  summary: string
  onChange: (values: number[]) => void
}) {
  const [openBand, setOpenBand] = useState<number | null>(null)
  const label = DIMENSION_LABELS[dimension]
  const bands = useMemo(() => sizeBands(options), [options])
  // Keyed on the band's first size rather than its index: the other filters can
  // reshape the list underneath, and then falling back to the brackets is right.
  const band = bands.find((b) => b.lo === openBand) ?? null

  const pick = (values: number[]) => {
    onChange(values)
    Sound.tick()
  }

  const sizePill = (o: SizeOption) => (
    <button
      key={o.value}
      className={`pill pill--size ${chosen.includes(o.value) ? 'pill--on' : ''}`}
      onClick={() => pick(toggleSize(chosen, o.value))}
      title={`${o.count} product${o.count === 1 ? '' : 's'} ${o.value} cm ${dimension.slice(0, -1)}`}
    >
      {o.value}
      <span className="pill-count">{o.count}</span>
    </button>
  )

  return (
    <div className="dimension">
      <div className="dimension-head">
        <span className="dimension-label">
          {label} <em>cm</em>
        </span>
        {chosen.length > 0 && (
          <>
            <span className="dimension-pick">{summary}</span>
            <button className="dimension-clear" onClick={() => onChange([])} title={`Clear ${label.toLowerCase()}`}>
              <span aria-hidden="true">×</span>
              <span className="sr-only">Clear {label.toLowerCase()}</span>
            </button>
          </>
        )}
      </div>

      {!options.length && <p className="empty-note empty-note--inline">Nothing at this size.</p>}

      {options.length > 0 && band && (
        <div className="pills pills--scroll pills--sizes">
          <button className="pill pill--back" onClick={() => setOpenBand(null)}>
            ‹ All {dimension}
          </button>
          <button
            className={`pill pill--size ${band.values.every((v) => chosen.includes(v)) ? 'pill--on' : ''}`}
            onClick={() => pick(toggleBand(chosen, band.values))}
          >
            Any {bandLabel(band)}
            <span className="pill-count">{band.count}</span>
          </button>
          {options.filter((o) => o.value >= band.lo && o.value <= band.hi).map(sizePill)}
        </div>
      )}

      {options.length > 0 && !band && bands.length > 0 && (
        /* Not bounded like the size lists: there are at most eight brackets and
           hiding one behind a scroll would defeat the point of having them. */
        <div className="pills">
          {bands.map((b) => {
            const picked = b.values.filter((v) => chosen.includes(v)).length
            const state = picked === 0 ? '' : picked === b.values.length ? 'pill--on' : 'pill--part'
            const take = (
              <button
                className="pill-take"
                onClick={() => pick(toggleBand(chosen, b.values))}
                title={`${b.count} product${b.count === 1 ? '' : 's'}, ${bandLabel(b)} cm ${label.toLowerCase()}`}
              >
                {bandLabel(b)}
                <span className="pill-count">{b.count}</span>
              </button>
            )
            // A bracket holding one size has nothing to open into.
            if (b.values.length === 1) {
              return (
                <span key={b.lo} className={`pill pill--size pill--split ${state}`}>
                  {take}
                </span>
              )
            }
            return (
              <span key={b.lo} className={`pill pill--size pill--split ${state}`}>
                {take}
                <button
                  className="pill-open"
                  onClick={() => setOpenBand(b.lo)}
                  title={`Pick an exact ${label.toLowerCase()} between ${b.lo} and ${b.hi} cm`}
                >
                  <span aria-hidden="true">⋯</span>
                  <span className="sr-only">
                    Exact sizes between {b.lo} and {b.hi} cm
                  </span>
                </button>
              </span>
            )
          })}
        </div>
      )}

      {options.length > 0 && !band && !bands.length && (
        <div className="pills pills--scroll pills--sizes">{options.map(sizePill)}</div>
      )}
    </div>
  )
}

/** How long to keep pointing at a product before its details open. */
const PREVIEW_DELAY_MS = 240

export function Sidebar({
  onContext,
}: {
  onContext: (item: CatalogItem, x: number, y: number) => void
}) {
  const catalog = getCatalog()
  const [preview, setPreview] = useState<PreviewTarget | null>(null)
  const previewTimer = useRef<number | undefined>(undefined)
  const asideRef = useRef<HTMLElement>(null)
  const addItem = usePlanner((s) => s.addItem)
  const room = usePlanner((s) => s.room)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [open, setOpen] = useState<'system' | 'size' | null>(null)
  const [shown, setShown] = useState(PAGE)

  /**
   * Opens the detail panel after a short delay, so running the cursor down the
   * list does not flash a panel for every product it passes.
   */
  const showPreview = (item: CatalogItem | null, colours: number, element: HTMLElement | null) => {
    window.clearTimeout(previewTimer.current)
    if (!item || !element) {
      setPreview(null)
      return
    }
    const card = element.getBoundingClientRect()
    const aside = asideRef.current?.getBoundingClientRect()
    previewTimer.current = window.setTimeout(
      () => setPreview({ item, colours, y: card.top + card.height / 2, x: aside ? aside.right : card.right }),
      PREVIEW_DELAY_MS,
    )
  }

  // A pending preview must not open after the component is gone.
  useEffect(() => () => window.clearTimeout(previewTimer.current), [])

  // The list can change under a stationary cursor -- typing in the search box,
  // or picking a filter -- and no pointerenter fires for whatever slides into
  // place, so the panel would go on describing a product that has gone.
  useEffect(() => {
    window.clearTimeout(previewTimer.current)
    setPreview(null)
  }, [filters])

  const update = (next: Filters) => {
    setFilters(next)
    setShown(PAGE)
  }
  const patch = (p: Partial<Filters>) => update({ ...filters, ...p })

  const systems = useMemo(
    () =>
      catalog.systems
        .filter((s) => filters.category === 'all' || s.category === filters.category)
        .sort((a, b) => b.count - a.count),
    [catalog.systems, filters.category],
  )

  const { matches, total } = useMemo(() => filterGroups(filters, 400), [filters])
  const facets = useMemo(() => (open === 'size' ? sizeFacets(filters) : null), [filters, open])

  /**
   * The sizes on offer before any size is chosen.
   *
   * Selections are described against this rather than against the contextual
   * facets, which shift under them: having taken widths 100 to 148, choosing a
   * height drops some of those widths from the offer and the run would fall
   * apart into "100, 102 +27 more" without the sizes having changed at all.
   */
  const anySize = useMemo(
    () => sizeFacets(clearSizes(filters)),
    [filters.query, filters.category, filters.system],
  )
  const picked = (d: Dimension) => summariseSizes(filters[d], anySize[d].map((o) => o.value))
  const visible = matches.slice(0, shown)
  const activeSystem = catalog.systems.find((s) => s.id === filters.system)
  const sizeActive = hasSizeFilter(filters)

  const sizeSummary = sizeActive
    ? DIMENSIONS.filter((d) => filters[d].length)
        .map((d) => `${DIMENSION_LABELS[d].toLowerCase()} ${picked(d)}`)
        .join(' · ')
    : 'Any size'

  /** Restricts every dimension to sizes that will physically go in the room. */
  const fitToRoom = () => {
    const limits: Record<Dimension, number> = { widths: room.width, depths: room.depth, heights: room.height }
    update({
      ...filters,
      widths: anySize.widths.filter((o) => o.value <= limits.widths).map((o) => o.value),
      depths: anySize.depths.filter((o) => o.value <= limits.depths).map((o) => o.value),
      heights: anySize.heights.filter((o) => o.value <= limits.heights).map((o) => o.value),
    })
  }

  return (
    <aside className="sidebar" ref={asideRef}>
      <div className="sidebar-head">
        <input
          className="search"
          type="search"
          placeholder={`Search ${catalog.items.length.toLocaleString()} products…`}
          value={filters.query}
          onChange={(e) => patch({ query: e.target.value })}
        />
        <div className="chips">
          <button
            className={`chip ${filters.category === 'all' ? 'chip--on' : ''}`}
            onClick={() => patch({ category: 'all', system: 'all' })}
          >
            All
          </button>
          {categories().map((c) => (
            <button
              key={c}
              className={`chip ${filters.category === c ? 'chip--on' : ''}`}
              onClick={() => patch({ category: c, system: 'all' })}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="facets">
        <Facet
          title="System"
          summary={activeSystem ? activeSystem.label : 'Every system'}
          open={open === 'system'}
          onToggle={() => setOpen(open === 'system' ? null : 'system')}
          onClear={filters.system !== 'all' ? () => patch({ system: 'all' }) : undefined}
        >
          <div className="pills pills--scroll">
            <button
              className={`pill ${filters.system === 'all' ? 'pill--on' : ''}`}
              onClick={() => patch({ system: 'all' })}
            >
              Every system
            </button>
            {systems.map((s) => (
              <button
                key={s.id}
                className={`pill ${filters.system === s.id ? 'pill--on' : ''}`}
                onClick={() => {
                  patch({ system: s.id })
                  Sound.tick()
                }}
                title={s.blurb}
              >
                {s.label}
                <span className="pill-count">{s.count}</span>
              </button>
            ))}
          </div>
          {activeSystem && <p className="system-blurb">{activeSystem.blurb}</p>}
        </Facet>

        <Facet
          title="Size"
          summary={sizeSummary}
          open={open === 'size'}
          onToggle={() => setOpen(open === 'size' ? null : 'size')}
          onClear={sizeActive ? () => update(clearSizes(filters)) : undefined}
        >
          {facets &&
            DIMENSIONS.map((dimension) => (
              <DimensionPicker
                key={dimension}
                dimension={dimension}
                options={facets[dimension]}
                chosen={filters[dimension]}
                summary={picked(dimension)}
                onChange={(values) => update(setSizes(filters, dimension, values))}
              />
            ))}
          <div className="size-actions">
            <button className="fit-room" onClick={fitToRoom}>
              Only what fits the room ({room.width} × {room.depth} × {room.height} cm)
            </button>
            {sizeActive && (
              <button className="fit-room fit-room--clear" onClick={() => update(clearSizes(filters))}>
                Any size
              </button>
            )}
          </div>
        </Facet>
      </div>

      <div className="results-count">
        <span>
          {total.toLocaleString()} product{total === 1 ? '' : 's'}
        </span>
        {hasAnyFilter(filters) && (
          <button className="results-clear" onClick={() => update(EMPTY_FILTERS)}>
            Clear all filters
          </button>
        )}
      </div>

      <div className="item-list" onScroll={() => showPreview(null, 0, null)}>
        {visible.map((m) => (
          <ProductCard
            key={m.group.key}
            match={m}
            currency={catalog.currency}
            onAdd={(item) => {
              addItem(item.id)
              Sound.place()
            }}
            onContext={onContext}
            onPreview={showPreview}
          />
        ))}
        {!visible.length && <p className="empty-note">Nothing matches. Try a shorter search or fewer sizes.</p>}
        {shown < matches.length && (
          <button className="more" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, matches.length - shown)} more
          </button>
        )}
      </div>

      <ProductPreview target={preview} currency={catalog.currency} />
    </aside>
  )
}
