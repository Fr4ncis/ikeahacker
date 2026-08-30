import { useEffect, useMemo, useState } from 'react'
import {
  CATEGORY_LABELS,
  EMPTY_FILTERS,
  categories,
  filterGroups,
  formatPrice,
  formatPriceRange,
  getCatalog,
  hasSizeFilter,
  isRangeSet,
  NO_RANGE,
  sizeBounds,
  type Filters,
  type GroupMatch,
  type Range,
} from '../lib/catalog'
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
}: {
  match: GroupMatch
  currency: string
  onAdd: (item: CatalogItem) => void
  onContext: (item: CatalogItem, x: number, y: number) => void
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
              onClick={() => setPicked(i)}
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

function RangeRow({
  label,
  range,
  bounds,
  onChange,
}: {
  label: string
  range: Range
  bounds: [number, number]
  onChange: (r: Range) => void
}) {
  const parse = (raw: string): number | null => {
    const v = Number(raw)
    return raw.trim() === '' || !Number.isFinite(v) ? null : v
  }
  return (
    <div className="range-row">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        placeholder={String(bounds[0])}
        value={range[0] ?? ''}
        onChange={(e) => onChange([parse(e.target.value), range[1]])}
      />
      <span className="range-dash">–</span>
      <input
        type="number"
        inputMode="numeric"
        placeholder={String(bounds[1])}
        value={range[1] ?? ''}
        onChange={(e) => onChange([range[0], parse(e.target.value)])}
      />
      <span className="range-unit">cm</span>
    </div>
  )
}

export function Sidebar({
  onContext,
}: {
  onContext: (item: CatalogItem, x: number, y: number) => void
}) {
  const catalog = getCatalog()
  const addItem = usePlanner((s) => s.addItem)
  const room = usePlanner((s) => s.room)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [showSize, setShowSize] = useState(false)
  const [shown, setShown] = useState(PAGE)

  const patch = (p: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...p }))
    setShown(PAGE)
  }

  const systems = useMemo(
    () =>
      catalog.systems
        .filter((s) => filters.category === 'all' || s.category === filters.category)
        .sort((a, b) => b.count - a.count),
    [catalog.systems, filters.category],
  )

  const { matches, total } = useMemo(() => filterGroups(filters, 400), [filters])
  const visible = matches.slice(0, shown)
  const activeSystem = catalog.systems.find((s) => s.id === filters.system)
  const bounds = sizeBounds()
  const sizeActive = hasSizeFilter(filters)

  /** Restricts every dimension to what will physically go in the room. */
  const fitToRoom = () =>
    patch({
      width: [null, room.width],
      depth: [null, room.depth],
      height: [null, room.height],
    })

  return (
    <aside className="sidebar">
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

        <div className="systems">
          <button
            className={`system ${filters.system === 'all' ? 'system--on' : ''}`}
            onClick={() => patch({ system: 'all' })}
          >
            Every system
          </button>
          {systems.map((s) => (
            <button
              key={s.id}
              className={`system ${filters.system === s.id ? 'system--on' : ''}`}
              onClick={() => patch({ system: s.id })}
              title={s.blurb}
            >
              {s.label}
              <span className="system-count">{s.count}</span>
            </button>
          ))}
        </div>

        {activeSystem && <p className="system-blurb">{activeSystem.blurb}</p>}

        <div className="size-filter">
          <button className={`size-toggle ${sizeActive ? 'size-toggle--on' : ''}`} onClick={() => setShowSize((v) => !v)}>
            {showSize ? '▾' : '▸'} Size{sizeActive ? ' · on' : ''}
          </button>
          {sizeActive && (
            <button
              className="size-clear"
              onClick={() => patch({ width: NO_RANGE, depth: NO_RANGE, height: NO_RANGE })}
            >
              Clear
            </button>
          )}
        </div>

        {showSize && (
          <div className="ranges">
            <RangeRow label="Width" range={filters.width} bounds={bounds.width} onChange={(width) => patch({ width })} />
            <RangeRow label="Depth" range={filters.depth} bounds={bounds.depth} onChange={(depth) => patch({ depth })} />
            <RangeRow
              label="Height"
              range={filters.height}
              bounds={bounds.height}
              onChange={(height) => patch({ height })}
            />
            <button className="fit-room" onClick={fitToRoom}>
              Only what fits the room ({room.width} × {room.depth} × {room.height} cm)
            </button>
          </div>
        )}
      </div>

      <div className="results-count">
        {total.toLocaleString()} product{total === 1 ? '' : 's'}
        {isRangeSet(filters.width) || isRangeSet(filters.depth) || isRangeSet(filters.height) ? ' in range' : ''}
      </div>

      <div className="item-list">
        {visible.map((m) => (
          <ProductCard
            key={m.group.key}
            match={m}
            currency={catalog.currency}
            onAdd={(item) => addItem(item.id)}
            onContext={onContext}
          />
        ))}
        {!visible.length && <p className="empty-note">Nothing matches. Try a shorter search or a wider size range.</p>}
        {shown < matches.length && (
          <button className="more" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, matches.length - shown)} more
          </button>
        )}
      </div>
    </aside>
  )
}
