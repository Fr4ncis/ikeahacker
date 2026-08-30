import { useMemo, useState } from 'react'
import { getCatalog, getItem } from '../lib/catalog'
import { exportCsv, exportJson, exportPng } from '../lib/export'
import type { Scene } from '../lib/render'
import { deleteSave, readSaves, usePlanner, writeSave, type SavedLayouts } from '../state/store'

const PRESETS: { label: string; width: number; depth: number }[] = [
  { label: 'Box room 3×2.5 m', width: 300, depth: 250 },
  { label: 'Bedroom 4.2×3.4 m', width: 420, depth: 340 },
  { label: 'Living room 5×4 m', width: 500, depth: 400 },
  { label: 'Studio 6×4.5 m', width: 600, depth: 450 },
]

const WALL_COLORS = ['#e8e4dc', '#f4f4f2', '#dfe4e2', '#e6dcd2', '#cfd6da', '#2f3336']
const FLOOR_COLORS = ['#c8ac86', '#a97d4f', '#d9cdbb', '#8d8a86', '#6d5744', '#efeae2']

function RoomField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="field field--tight">
      <span>{label}</span>
      <input
        type="number"
        min={100}
        max={1200}
        step={10}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v) && v >= 100) onChange(v)
        }}
      />
    </label>
  )
}

export function Toolbar() {
  const catalog = getCatalog()
  const room = usePlanner((s) => s.room)
  const items = usePlanner((s) => s.items)
  const camera = usePlanner((s) => s.camera)
  const showGrid = usePlanner((s) => s.showGrid)
  const showLabels = usePlanner((s) => s.showLabels)
  const [saves, setSaves] = useState<SavedLayouts>(() => readSaves())
  const [panel, setPanel] = useState<'room' | 'saves' | null>(null)
  const [saveName, setSaveName] = useState('')

  const scene: Scene = useMemo(
    () => ({
      room,
      items,
      lookup: getItem,
      camera,
      selectedUid: null,
      hoverUid: null,
      collisions: new Set<string>(),
      showGrid: false,
      showLabels,
    }),
    [room, items, camera, showLabels],
  )

  const store = usePlanner.getState()
  const saveNames = Object.keys(saves).sort()

  const onSave = () => {
    const name = saveName.trim() || `Plan ${saveNames.length + 1}`
    setSaves(writeSave(store.exportLayout(name)))
    setSaveName('')
  }

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">▚</span>
        <div>
          <strong>IKEA Hacker</strong>
          <span className="brand-sub">
            {catalog.items.length.toLocaleString()} products · {catalog.systems.length} systems · {catalog.market}
          </span>
        </div>
      </div>

      <div className="tool-group">
        <button className={panel === 'room' ? 'on' : ''} onClick={() => setPanel(panel === 'room' ? null : 'room')}>
          Room {room.width}×{room.depth} cm
        </button>
        <button onClick={() => store.rotateCamera(-1)} title="Turn the room left ([)">
          ↺
        </button>
        <button onClick={() => store.rotateCamera(1)} title="Turn the room right (])">
          ↻
        </button>
        <button onClick={() => store.setCamera({ zoom: 0, panX: 0, panY: 0 })} title="Reset the view">
          Fit
        </button>
      </div>

      <div className="tool-group">
        <button className={showGrid ? 'on' : ''} onClick={store.toggleGrid}>
          Grid
        </button>
        <button className={showLabels ? 'on' : ''} onClick={store.toggleLabels}>
          Labels
        </button>
      </div>

      <div className="tool-group tool-group--end">
        <button className={panel === 'saves' ? 'on' : ''} onClick={() => setPanel(panel === 'saves' ? null : 'saves')}>
          Layouts
        </button>
        <button onClick={() => exportPng(scene)} disabled={!items.length}>
          PNG
        </button>
        <button onClick={() => exportCsv(items)} disabled={!items.length}>
          CSV
        </button>
        <button
          className="danger"
          disabled={!items.length}
          onClick={() => {
            if (window.confirm(`Remove all ${items.length} items from the room?`)) store.clearRoom()
          }}
        >
          Clear
        </button>
      </div>

      {panel === 'room' && (
        <div className="popover">
          <div className="popover-row">
            <RoomField label="Width" value={room.width} onChange={(width) => store.setRoom({ width })} />
            <RoomField label="Depth" value={room.depth} onChange={(depth) => store.setRoom({ depth })} />
            <RoomField label="Height" value={room.height} onChange={(height) => store.setRoom({ height })} />
          </div>
          <div className="popover-presets">
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => store.setRoom({ width: p.width, depth: p.depth })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="popover-colors">
            <span>Walls</span>
            {WALL_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${room.wallColor === c ? 'swatch--on' : ''}`}
                style={{ background: c }}
                onClick={() => store.setRoom({ wallColor: c })}
              />
            ))}
          </div>
          <div className="popover-colors">
            <span>Floor</span>
            {FLOOR_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${room.floorColor === c ? 'swatch--on' : ''}`}
                style={{ background: c }}
                onClick={() => store.setRoom({ floorColor: c })}
              />
            ))}
          </div>
        </div>
      )}

      {panel === 'saves' && (
        <div className="popover popover--right">
          <div className="popover-row">
            <label className="field field--tight">
              <span>Name</span>
              <input
                type="text"
                value={saveName}
                placeholder={`Plan ${saveNames.length + 1}`}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSave()
                }}
              />
            </label>
            <button onClick={onSave} disabled={!items.length}>
              Save
            </button>
          </div>
          <div className="popover-row">
            <button onClick={() => exportJson(store.exportLayout(saveName.trim() || 'layout'), 'ikea-layout')} disabled={!items.length}>
              Download layout as JSON
            </button>
          </div>
          {saveNames.length === 0 && <p className="empty-note">No saved layouts yet.</p>}
          {saveNames.map((name) => (
            <div key={name} className="save-row">
              <button className="save-load" onClick={() => store.loadLayout(saves[name])}>
                {name}
                <span className="muted">
                  {saves[name].items.length} items · {new Date(saves[name].savedAt).toLocaleDateString()}
                </span>
              </button>
              <button className="danger" onClick={() => setSaves(deleteSave(name))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </header>
  )
}
