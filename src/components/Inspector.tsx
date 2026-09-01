import { formatPrice, getCatalog, getItem, groupOf } from '../lib/catalog'
import { Sound } from '../lib/sound'
import { usePlanner } from '../state/store'
import type { PlacedItem } from '../lib/types'

const SWATCHES = ['#f2f2f0', '#2b2b2d', '#3b2b21', '#c9a87c', '#9aa0a6', '#5c7a5c', '#4a6b8a', '#a8423c', '#d8bd5c']

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        min={min}
        max={max}
        step={1}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
      />
    </label>
  )
}

function SelectedItem({ placed }: { placed: PlacedItem }) {
  const cat = getItem(placed.itemId)
  const group = groupOf(placed.itemId)
  const room = usePlanner((s) => s.room)
  const { updateItem, rotateItem, removeItem, duplicateItem } = usePlanner.getState()

  if (!cat) return <p className="empty-note">This product is no longer in the catalogue.</p>

  const swapped = placed.rotation === 90 || placed.rotation === 270
  const spanX = swapped ? cat.depth : cat.width
  const spanY = swapped ? cat.width : cat.depth

  return (
    <div className="inspector-body">
      <div className="inspector-hero">
        {cat.imageUrl && <img src={cat.imageUrl} alt="" />}
        <div>
          <h3>{cat.name}</h3>
          <p className="muted">{cat.type}</p>
          <p className="muted">{cat.finish !== 'unspecified' ? cat.finish : 'finish not listed'}</p>
          <p className="price">{formatPrice(cat.price, cat.currency)}</p>
        </div>
      </div>

      <p className="dims">
        {cat.width} × {cat.depth} × {cat.height} cm
        <span className="muted"> — IKEA lists “{cat.measureText}”</span>
      </p>

      <div className="field-row">
        <NumberField label="X (cm)" value={placed.x} min={0} max={room.width - spanX} onChange={(x) => updateItem(placed.uid, { x })} />
        <NumberField label="Y (cm)" value={placed.y} min={0} max={room.depth - spanY} onChange={(y) => updateItem(placed.uid, { y })} />
        <NumberField
          label="Off floor"
          value={placed.z}
          min={0}
          max={Math.max(0, room.height - cat.height)}
          onChange={(z) => updateItem(placed.uid, { z })}
        />
      </div>

      <div className="btn-row">
        <button
          onClick={() => {
            rotateItem(placed.uid, -90)
            Sound.rotate()
          }}
        >
          ↺ Rotate
        </button>
        <span className="rotation-readout">{placed.rotation}°</span>
        <button
          onClick={() => {
            rotateItem(placed.uid, 90)
            Sound.rotate()
          }}
        >
          Rotate ↻
        </button>
      </div>

      {/* The finishes IKEA actually sells this piece in. Picking one swaps the
          article, so the price and the link follow the colour, and it drops any
          paint over the top rather than leaving the change invisible. */}
      {group && group.variants.length > 1 && (
        <div className="swatch-group">
          <span className="swatch-label">
            Finish <em>{group.variants.length} colours</em>
          </span>
          <div className="swatches">
            {group.variants.map((v) => (
              <button
                key={v.id}
                className={`swatch ${v.id === placed.itemId && !placed.color ? 'swatch--on' : ''}`}
                style={{ background: v.color }}
                onClick={() => {
                  updateItem(placed.uid, { itemId: v.id, color: undefined })
                  Sound.tick()
                }}
                title={`${v.finish} — ${formatPrice(v.price, v.currency)}`}
                aria-label={v.finish}
              />
            ))}
          </div>
        </div>
      )}

      <div className="swatch-group">
        <span className="swatch-label">
          Paint <em>this piece only</em>
        </span>
        <div className="swatches">
          <button
            className={`swatch swatch--reset ${!placed.color ? 'swatch--on' : ''}`}
            onClick={() => updateItem(placed.uid, { color: undefined })}
            title="Use the product's own finish"
          >
            ✕
          </button>
          {SWATCHES.map((c) => (
            <button
              key={c}
              className={`swatch ${placed.color === c ? 'swatch--on' : ''}`}
              style={{ background: c }}
              onClick={() => {
                updateItem(placed.uid, { color: c })
                Sound.tick()
              }}
              title="Recolour this piece"
            />
          ))}
        </div>
      </div>

      <div className="btn-row">
        <button
          onClick={() => {
            duplicateItem(placed.uid)
            Sound.place()
          }}
        >
          Duplicate
        </button>
        <button
          className="danger"
          onClick={() => {
            removeItem(placed.uid)
            Sound.remove()
          }}
        >
          Remove
        </button>
      </div>

      {cat.productUrl && (
        <a className="ikea-link" href={cat.productUrl} target="_blank" rel="noreferrer noopener">
          Open on ikea.com ↗
        </a>
      )}
    </div>
  )
}

function ShoppingList() {
  const catalog = getCatalog()
  const items = usePlanner((s) => s.items)
  const select = usePlanner((s) => s.select)

  const counted = new Map<string, number>()
  for (const it of items) counted.set(it.itemId, (counted.get(it.itemId) ?? 0) + 1)

  const rows = [...counted.entries()]
    .map(([id, qty]) => ({ cat: getItem(id), qty }))
    .filter((r): r is { cat: NonNullable<ReturnType<typeof getItem>>; qty: number } => Boolean(r.cat))
    .sort((a, b) => b.qty - a.qty)

  const total = rows.reduce((sum, r) => sum + (r.cat.price ?? 0) * r.qty, 0)
  const missingPrice = rows.some((r) => r.cat.price === null)

  if (!rows.length) return <p className="empty-note">Nothing placed yet.</p>

  return (
    <div className="shopping">
      {rows.map(({ cat, qty }) => (
        <button
          key={cat.id}
          className="shopping-row"
          onClick={() => {
            const first = items.find((i) => i.itemId === cat.id)
            if (first) select(first.uid)
          }}
        >
          <span className="qty">{qty}×</span>
          <span className="shopping-name">
            {cat.name} <em>{cat.type}</em>
          </span>
          <span className="shopping-price">{formatPrice(cat.price === null ? null : cat.price * qty, cat.currency)}</span>
        </button>
      ))}
      <div className="shopping-total">
        <span>Total{missingPrice ? ' (some prices unlisted)' : ''}</span>
        <strong>{formatPrice(total, catalog.currency)}</strong>
      </div>
    </div>
  )
}

export function Inspector() {
  const selectedUid = usePlanner((s) => s.selectedUid)
  const items = usePlanner((s) => s.items)
  const placed = items.find((i) => i.uid === selectedUid) ?? null

  return (
    <aside className="inspector">
      <section>
        <h2>{placed ? 'Selected' : 'Nothing selected'}</h2>
        {placed ? (
          <SelectedItem placed={placed} />
        ) : (
          <p className="empty-note">
            Click a piece in the room to move, rotate, raise or recolour it.
            <br />
            <br />
            <kbd>R</kbd> rotate · <kbd>D</kbd> duplicate · <kbd>Del</kbd> remove
            <br />
            <kbd>[</kbd> <kbd>]</kbd> turn the room · arrows nudge · <kbd>Ctrl</kbd>+arrows raise
            <br />
            Hold <kbd>Alt</kbd> while dragging for 1 cm steps
          </p>
        )}
      </section>

      <section>
        <h2>Shopping list</h2>
        <ShoppingList />
      </section>
    </aside>
  )
}
