import { useEffect, useState } from 'react'
import { formatPrice, getCatalog, getItem, groupOf, productHost, retailerOf } from '../lib/catalog'
import { ensureParts, largestBox, looseManuals, manualFor, packageSummary, partsOf, weightOf } from '../lib/parts'
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
        <span className="muted"> — {retailerOf(cat)} lists “{cat.measureText}”</span>
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

      <WhatItIsMadeOf itemId={placed.itemId} />

      {cat.productUrl && (
        <a className="product-link" href={cat.productUrl} target="_blank" rel="noreferrer noopener">
          Open on {productHost(cat)} ↗
        </a>
      )}
    </div>
  )
}

/**
 * Pulls the parts file in the first time anything wants it, and re-renders
 * when it lands. Nothing here blocks: until it arrives these simply say
 * nothing, which is also what they do when the pass was never run.
 */
function useParts() {
  const [, arrived] = useState(0)
  useEffect(() => {
    let live = true
    void ensureParts().then(() => {
      if (live) arrived((n) => n + 1)
    })
    return () => {
      live = false
    }
  }, [])
}

/**
 * The boxes it arrives in, the articles it is built from, and the instruction
 * sheets for each of them.
 *
 * Folded away by default. It is reference material -- what you reach for once,
 * when you are working out whether it fits in the car or which sheet to follow
 * -- and the panel above it is what you use while you are planning.
 *
 * The sheets are linked, not copied. They are IKEA's documents, they are
 * revised without notice, and the link is the one the product page gives.
 */
function WhatItIsMadeOf({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false)
  useParts()
  const info = partsOf(itemId)
  if (!info || (!info.boxes.length && !info.parts.length && !info.manuals.length)) return null

  const biggest = largestBox(info.boxes)
  const loose = looseManuals(info.parts, info.manuals)
  const summary = packageSummary(info.boxes) || `${info.parts.length} articles`

  return (
    <section className="made-of">
      <button className="made-of-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="facet-caret" aria-hidden="true" />
        <span className="made-of-title">In the box</span>
        <span className="made-of-summary">{summary}</span>
      </button>

      {open && (
        <div className="made-of-body">
          {biggest && (
            <p className="made-of-note">
              Largest package {biggest.length} × {biggest.width} × {biggest.height} cm
              {biggest.weight ? `, ${biggest.weight.toFixed(1)} kg` : ''}
            </p>
          )}

          {info.parts.length > 0 && (
            <ul className="parts">
              {info.parts.map((part) => {
                const sheet = manualFor(part, info.manuals)
                return (
                  <li key={part.id}>
                    <span className="part-qty">{part.quantity}×</span>
                    <span className="part-name">
                      {part.name} <em>{part.type}</em>
                      <span className="part-article">{part.article}</span>
                    </span>
                    {sheet && (
                      <a href={sheet.url} target="_blank" rel="noreferrer noopener" title={`Instructions for ${sheet.label}`}>
                        PDF ↗
                      </a>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {loose.length > 0 && (
            <p className="made-of-note">{info.parts.length ? 'Also published' : 'Instructions'}</p>
          )}
          {loose.length > 0 && (
            <ul className="parts parts--sheets">
              {loose.map((sheet) => (
                <li key={sheet.url}>
                  <span className="part-name">{sheet.label}</span>
                  <a href={sheet.url} target="_blank" rel="noreferrer noopener">
                    {sheet.kind === 'manual' ? 'Manual ↗' : 'PDF ↗'}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
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
      <Haul rows={rows} />
    </div>
  )
}

/**
 * What the plan weighs and how many boxes it is.
 *
 * The thing a shopping list does not tell you is whether it goes home in one
 * trip. Counted from the packages rather than the furniture, since a 202 cm
 * bookcase travels as a 207 cm box, and only over the products the parts pass
 * has reached -- it says so when it has not reached them all, rather than
 * quietly under-counting.
 */
function Haul({ rows }: { rows: { cat: { id: string }; qty: number }[] }) {
  useParts()
  let boxes = 0
  let weight = 0
  let unknown = 0

  for (const { cat, qty } of rows) {
    const info = partsOf(cat.id)
    if (!info?.boxes.length) {
      unknown += qty
      continue
    }
    boxes += info.boxes.length * qty
    weight += weightOf(info.boxes) * qty
  }
  if (!boxes) return null

  return (
    <div className="shopping-haul">
      <span>
        {boxes} package{boxes === 1 ? '' : 's'}
        {weight > 0 ? `, ${weight < 10 ? weight.toFixed(1) : Math.round(weight)} kg` : ''}
      </span>
      {unknown > 0 && <em>{unknown} not counted</em>}
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
