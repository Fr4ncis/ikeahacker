import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CATEGORY_LABELS,
  DIMENSIONS,
  DIMENSION_LABELS,
  EMPTY_FILTERS,
  categories,
  clearSizes,
  filterGroups,
  formatPrice,
  formatPriceRange,
  getCatalog,
  hasSizeFilter,
  sizeFacets,
  toggleSize,
  type Dimension,
  type Filters,
  type GroupMatch,
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
        <span className="item-thumb" style={{ background: variant.color }}>
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
      <button className="facet-head" onClick={onToggle} aria-expanded={open}>
        <span className="facet-caret" aria-hidden="true" />
        <span className="facet-title">{title}</span>
        <span className={`facet-summary ${onClear ? 'facet-summary--on' : ''}`}>{summary}</span>
      </button>
      {open && (
        <div className="facet-body">
          {children}
          {onClear && (
            <button className="facet-clear" onClick={onClear}>
              Clear {title.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </section>
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
  const visible = matches.slice(0, shown)
  const activeSystem = catalog.systems.find((s) => s.id === filters.system)
  const sizeActive = hasSizeFilter(filters)

  const sizeSummary = sizeActive
    ? DIMENSIONS.filter((d) => filters[d].length)
        .map((d) => `${DIMENSION_LABELS[d].toLowerCase()} ${filters[d].join(', ')}`)
        .join(' · ')
    : 'Any size'

  /** Restricts every dimension to sizes that will physically go in the room. */
  const fitToRoom = () => {
    const limits: Record<Dimension, number> = { widths: room.width, depths: room.depth, heights: room.height }
    const available = sizeFacets(clearSizes(filters))
    update({
      ...filters,
      widths: available.widths.filter((o) => o.value <= limits.widths).map((o) => o.value),
      depths: available.depths.filter((o) => o.value <= limits.depths).map((o) => o.value),
      heights: available.heights.filter((o) => o.value <= limits.heights).map((o) => o.value),
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
            DIMENSIONS.map((dimension) => {
              const options = facets[dimension]
              const chosen = filters[dimension]
              return (
                <div className="dimension" key={dimension}>
                  <span className="dimension-label">
                    {DIMENSION_LABELS[dimension]} <em>cm</em>
                  </span>
                  {options.length ? (
                    <div className="pills pills--scroll pills--sizes">
                      {options.map((o) => (
                        <button
                          key={o.value}
                          className={`pill pill--size ${chosen.includes(o.value) ? 'pill--on' : ''}`}
                          onClick={() => {
                            update(toggleSize(filters, dimension, o.value))
                            Sound.tick()
                          }}
                          title={`${o.count} product${o.count === 1 ? '' : 's'}`}
                        >
                          {o.value}
                          <span className="pill-count">{o.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-note empty-note--inline">Nothing at this size.</p>
                  )}
                </div>
              )
            })}
          <button className="fit-room" onClick={fitToRoom}>
            Only what fits the room ({room.width} × {room.depth} × {room.height} cm)
          </button>
        </Facet>
      </div>

      <div className="results-count">
        {total.toLocaleString()} product{total === 1 ? '' : 's'}
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
