import { useMemo, useRef, useState } from 'react'
import { getCatalog, getItem } from '../lib/catalog'
import { exportCsv, exportJson, exportPng } from '../lib/export'
import type { Scene } from '../lib/render'
import { sanitizeLayout, shareUrl } from '../lib/layout'
import { area } from '../lib/polygon'
import { floorOutline } from '../lib/iso'
import {
  deleteSave,
  readSaves,
  SHAPE_PRESETS,
  usePlanner,
  writeSave,
  type SavedLayouts,
} from '../state/store'
import type { LoadNotice } from '../App'

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

export function Toolbar({ onNotice }: { onNotice: (notice: LoadNotice) => void }) {
  const catalog = getCatalog()
  const room = usePlanner((s) => s.room)
  const items = usePlanner((s) => s.items)
  const camera = usePlanner((s) => s.camera)
  const showGrid = usePlanner((s) => s.showGrid)
  const showLabels = usePlanner((s) => s.showLabels)
  const editingShape = usePlanner((s) => s.editingShape)
  const [saves, setSaves] = useState<SavedLayouts>(() => readSaves())
  const [panel, setPanel] = useState<'room' | 'saves' | null>(null)
  const [saveName, setSaveName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const scene: Scene = useMemo(
    () => ({
      room,
      items,
      lookup: getItem,
      camera,
      selectedUid: null,
      hoverUid: null,
      collisions: new Set<string>(),
      outside: new Set<string>(),
      showGrid: false,
      showLabels,
      editing: false,
      activeCorner: null,
    }),
    [room, items, camera, showLabels],
  )

  const store = usePlanner.getState()
  const saveNames = Object.keys(saves).sort()

  const onSave = () => {
    const name = saveName.trim() || `Plan ${saveNames.length + 1}`
    setSaves(writeSave(store.exportLayout(name)))
    setSaveName('')
    onNotice({ text: `Saved “${name}” to this browser.`, tone: 'info' })
  }

  /** Copies a link that carries the whole plan in its fragment. */
  const onShare = async () => {
    const url = shareUrl(store.exportLayout(saveName.trim() || 'Shared plan'))
    const count = `${items.length} item${items.length === 1 ? '' : 's'}`
    // Chat apps and mail clients start wrapping links somewhere past a couple
    // of thousand characters, so say so rather than let one arrive broken.
    const long = url.length > 2000 ? ` The link is long (${(url.length / 1024).toFixed(1)} KB) — send it as a link, not as plain text.` : ''
    try {
      await navigator.clipboard.writeText(url)
      onNotice({ text: `Link copied — it opens this exact layout, all ${count}.${long}`, tone: long ? 'warning' : 'info' })
    } catch {
      // Clipboard access can be refused, e.g. without a user gesture. Putting
      // the plan in the address bar still lets the link be copied by hand.
      window.location.hash = new URL(url).hash
      onNotice({ text: 'Link is in the address bar — copy it from there.', tone: 'warning' })
    }
  }

  const onImportFile = async (file: File) => {
    try {
      const loaded = sanitizeLayout(JSON.parse(await file.text()))
      if (!loaded) {
        onNotice({ text: `“${file.name}” is not a layout file this version understands.`, tone: 'warning' })
        return
      }
      store.loadLayout(loaded.layout)
      onNotice({
        text: loaded.dropped
          ? `Imported ${loaded.layout.items.length} items. ${loaded.dropped} left out: no longer in the catalogue.`
          : `Imported ${loaded.layout.items.length} items from “${file.name}”.`,
        tone: loaded.dropped ? 'warning' : 'info',
      })
    } catch {
      onNotice({ text: `Could not read “${file.name}”. Is it a layout JSON file?`, tone: 'warning' })
    }
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
          {room.outline ? ` · ${(area(floorOutline(room)) / 10000).toFixed(1)} m²` : ''}
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
        <button onClick={onShare} disabled={!items.length} title="Copy a link that opens this exact layout">
          Share
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
          <div className="popover-shape">
            <button
              className={editingShape ? 'on' : ''}
              onClick={() => store.setEditingShape(!editingShape)}
            >
              {editingShape ? 'Done editing shape' : 'Edit floor shape'}
            </button>
            {SHAPE_PRESETS.map((preset) => (
              <button key={preset.label} onClick={() => store.setOutline(preset.make(room.width, room.depth))}>
                {preset.label}
              </button>
            ))}
          </div>
          {editingShape && (
            <p className="shape-help">
              Drag a corner to move it, click an edge to add one, <kbd>Alt</kbd>-click a corner to remove it.
              Corners snap to 10 cm; hold <kbd>Alt</kbd> while dragging for 1 cm.
            </p>
          )}

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
              Download JSON
            </button>
            <button onClick={() => fileRef.current?.click()}>Import JSON…</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                // Reset first, so picking the same file twice fires again.
                e.target.value = ''
                if (file) void onImportFile(file)
              }}
            />
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
