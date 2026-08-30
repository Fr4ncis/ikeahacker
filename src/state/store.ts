import { create } from 'zustand'
import { getItem } from '../lib/catalog'
import { footprint, overlaps } from '../lib/iso'
import { sanitizeLayout } from '../lib/layout'
import type { Camera, CameraRotation, Layout, PlacedItem, Room } from '../lib/types'

const AUTOSAVE_KEY = 'ikeahacker.autosave'
const SAVES_KEY = 'ikeahacker.saves'

export const DEFAULT_ROOM: Room = {
  width: 420,
  depth: 340,
  height: 250,
  wallColor: '#e8e4dc',
  floorColor: '#c8ac86',
}

/** Placement snaps to this grid, in cm. Set to 1 with the Alt key for free positioning. */
export const SNAP_CM = 5

interface PlannerState {
  room: Room
  items: PlacedItem[]
  selectedUid: string | null
  camera: Camera
  showGrid: boolean
  showLabels: boolean

  addItem: (itemId: string) => void
  removeItem: (uid: string) => void
  duplicateItem: (uid: string) => void
  moveItem: (uid: string, x: number, y: number) => void
  updateItem: (uid: string, patch: Partial<PlacedItem>) => void
  rotateItem: (uid: string, delta: 90 | -90) => void
  select: (uid: string | null) => void
  clearRoom: () => void

  setRoom: (patch: Partial<Room>) => void
  setCamera: (patch: Partial<Camera>) => void
  rotateCamera: (delta: 1 | -1) => void

  toggleGrid: () => void
  toggleLabels: () => void

  loadLayout: (layout: Layout) => void
  exportLayout: (name: string) => Layout
}

let uidCounter = 0
const nextUid = () => `p${Date.now().toString(36)}${(uidCounter++).toString(36)}`

/** Keeps an item inside the room, given its footprint. */
function clampToRoom(item: PlacedItem, room: Room): PlacedItem {
  const cat = getItem(item.itemId)
  if (!cat) return item
  const fp = footprint(item, cat.width, cat.depth)
  return {
    ...item,
    x: Math.max(0, Math.min(room.width - fp.width, item.x)),
    y: Math.max(0, Math.min(room.depth - fp.depth, item.y)),
    z: Math.max(0, Math.min(room.height - cat.height, item.z)),
  }
}

/**
 * Finds a free spot for a newly added item by scanning the floor grid, so
 * adding ten wardrobes does not stack them all on the same square.
 */
function findFreeSpot(items: PlacedItem[], room: Room, width: number, depth: number): { x: number; y: number } {
  const occupied = items
    .map((it) => {
      const cat = getItem(it.itemId)
      return cat && it.z === 0 ? footprint(it, cat.width, cat.depth) : null
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)

  const step = 10
  for (let y = 0; y + depth <= room.depth; y += step) {
    for (let x = 0; x + width <= room.width; x += step) {
      const candidate = { x, y, width, depth }
      if (!occupied.some((o) => overlaps(candidate, o))) return { x, y }
    }
  }
  return { x: 0, y: 0 }
}

export const usePlanner = create<PlannerState>((set, get) => ({
  room: DEFAULT_ROOM,
  items: [],
  selectedUid: null,
  // Zoom 0 means "fit the room"; the canvas resolves it once it knows its size.
  camera: { rotation: 0, zoom: 0, panX: 0, panY: 0 },
  showGrid: true,
  showLabels: true,

  addItem: (itemId) => {
    const cat = getItem(itemId)
    if (!cat) return
    const { items, room } = get()
    const spot = findFreeSpot(items, room, cat.width, cat.depth)
    const placed: PlacedItem = { uid: nextUid(), itemId, ...spot, z: 0, rotation: 0 }
    set({ items: [...items, clampToRoom(placed, room)], selectedUid: placed.uid })
  },

  removeItem: (uid) =>
    set((s) => ({
      items: s.items.filter((i) => i.uid !== uid),
      selectedUid: s.selectedUid === uid ? null : s.selectedUid,
    })),

  duplicateItem: (uid) => {
    const { items, room } = get()
    const source = items.find((i) => i.uid === uid)
    const cat = source && getItem(source.itemId)
    if (!source || !cat) return
    const copy = clampToRoom(
      { ...source, uid: nextUid(), x: source.x + cat.width, y: source.y },
      room,
    )
    set({ items: [...items, copy], selectedUid: copy.uid })
  },

  moveItem: (uid, x, y) =>
    set((s) => ({
      items: s.items.map((i) => (i.uid === uid ? clampToRoom({ ...i, x, y }, s.room) : i)),
    })),

  updateItem: (uid, patch) =>
    set((s) => ({
      items: s.items.map((i) => (i.uid === uid ? clampToRoom({ ...i, ...patch }, s.room) : i)),
    })),

  rotateItem: (uid, delta) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.uid === uid
          ? clampToRoom({ ...i, rotation: (((i.rotation + delta) % 360 + 360) % 360) as PlacedItem['rotation'] }, s.room)
          : i,
      ),
    })),

  select: (uid) => set({ selectedUid: uid }),

  clearRoom: () => set({ items: [], selectedUid: null }),

  setRoom: (patch) =>
    set((s) => {
      const room = { ...s.room, ...patch }
      return { room, items: s.items.map((i) => clampToRoom(i, room)) }
    }),

  setCamera: (patch) => set((s) => ({ camera: { ...s.camera, ...patch } })),

  rotateCamera: (delta) =>
    set((s) => ({
      camera: { ...s.camera, rotation: (((s.camera.rotation + delta) % 4 + 4) % 4) as CameraRotation },
    })),

  toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),

  loadLayout: (layout) =>
    set({ room: layout.room, items: layout.items, selectedUid: null }),

  exportLayout: (name) => ({
    version: 1,
    name,
    room: get().room,
    items: get().items,
    savedAt: new Date().toISOString(),
  }),
}))

// --- Persistence -----------------------------------------------------------

export interface SavedLayouts {
  [name: string]: Layout
}

export function readSaves(): SavedLayouts {
  try {
    return JSON.parse(localStorage.getItem(SAVES_KEY) ?? '{}') as SavedLayouts
  } catch {
    return {}
  }
}

export function writeSave(layout: Layout): SavedLayouts {
  const saves = { ...readSaves(), [layout.name]: layout }
  localStorage.setItem(SAVES_KEY, JSON.stringify(saves))
  return saves
}

export function deleteSave(name: string): SavedLayouts {
  const saves = readSaves()
  delete saves[name]
  localStorage.setItem(SAVES_KEY, JSON.stringify(saves))
  return saves
}

/**
 * Restores the autosaved layout, if there is one. Called once on startup.
 * Returns how many items referenced articles no longer in the catalogue, so a
 * re-scrape that retires a product does not make furniture vanish silently.
 */
export function restoreAutosave(): number {
  try {
    const stored = localStorage.getItem(AUTOSAVE_KEY)
    if (!stored) return 0
    const loaded = sanitizeLayout(JSON.parse(stored))
    if (!loaded) return 0
    usePlanner.getState().loadLayout(loaded.layout)
    return loaded.dropped
  } catch {
    // A corrupt autosave should not stop the app from starting.
    return 0
  }
}

/**
 * Persists the plan whenever it changes. Camera moves are ignored, so panning
 * does not write to storage on every mouse event.
 */
export function startAutosave(): () => void {
  let lastItems = usePlanner.getState().items
  let lastRoom = usePlanner.getState().room

  return usePlanner.subscribe((state) => {
    if (state.items === lastItems && state.room === lastRoom) return
    lastItems = state.items
    lastRoom = state.room

    const layout: Layout = {
      version: 1,
      name: 'autosave',
      room: state.room,
      items: state.items,
      savedAt: new Date().toISOString(),
    }
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(layout))
    } catch {
      // Storage full or blocked; the planner still works, it just will not persist.
    }
  })
}
