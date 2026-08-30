import { useMemo, useState } from 'react'
import { CATEGORY_LABELS, categories, filterItems, formatPrice, getCatalog, type Filters } from '../lib/catalog'
import { usePlanner } from '../state/store'
import type { CatalogItem } from '../lib/types'

const PAGE = 60

function ItemCard({ item, onAdd }: { item: CatalogItem; onAdd: () => void }) {
  return (
    <button className="item-card" onClick={onAdd} title={`Add ${item.name} ${item.type}`}>
      <span className="item-thumb" style={{ background: item.color }}>
        {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" /> : null}
      </span>
      <span className="item-body">
        <span className="item-name">
          {item.name} <em>{item.type}</em>
        </span>
        <span className="item-meta">
          {item.width} × {item.depth} × {item.height} cm
        </span>
        <span className="item-meta item-meta--sub">
          {item.finish !== 'unspecified' ? item.finish : ' '}
        </span>
      </span>
      <span className="item-price">{formatPrice(item.price, item.currency)}</span>
    </button>
  )
}

export function Sidebar() {
  const catalog = getCatalog()
  const addItem = usePlanner((s) => s.addItem)
  const room = usePlanner((s) => s.room)
  const [filters, setFilters] = useState<Filters>({ query: '', category: 'all', system: 'all', maxWidth: 0 })
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
    [filters.category],
  )

  const { items, total } = useMemo(() => filterItems(filters, 600), [filters])
  const visible = items.slice(0, shown)
  const activeSystem = catalog.systems.find((s) => s.id === filters.system)

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

        <label className="fit-filter">
          <input
            type="checkbox"
            checked={filters.maxWidth > 0}
            onChange={(e) => patch({ maxWidth: e.target.checked ? room.width : 0 })}
          />
          Only show what fits across the room ({room.width} cm)
        </label>
      </div>

      <div className="results-count">
        {total.toLocaleString()} product{total === 1 ? '' : 's'}
      </div>

      <div className="item-list">
        {visible.map((item) => (
          <ItemCard key={item.id} item={item} onAdd={() => addItem(item.id)} />
        ))}
        {!visible.length && <p className="empty-note">Nothing matches. Try a shorter search.</p>}
        {shown < items.length && (
          <button className="more" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, items.length - shown)} more
          </button>
        )}
      </div>
    </aside>
  )
}
