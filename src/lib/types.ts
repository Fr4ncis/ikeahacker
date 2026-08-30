/** Shared types for the scraped IKEA catalog and the room planner. */

export type SystemCategory =
  | 'wardrobe'
  | 'shelving'
  | 'kitchen'
  | 'living'
  | 'bedroom'
  | 'office'
  | 'seating'
  | 'table'
  | 'utility'
  | 'kids'

/** A modular IKEA system, e.g. PAX or PLATSA. */
export interface SystemDef {
  /** ASCII id used for filtering and lookups, e.g. "BESTA". */
  id: string
  /** How IKEA spells it, e.g. "BESTÅ". Defaults to the id. */
  label?: string
  /** Search phrase sent to the IKEA search API. */
  query: string
  category: SystemCategory
  /** One-line description shown in the sidebar. */
  blurb: string
  /** Additional product names that belong to this system (fronts, interiors...). */
  aliases?: string[]
  /** True when items are typically hung on a wall rather than standing on the floor. */
  wallMountable?: boolean
}

/** A single placeable product parsed out of the IKEA search API. */
export interface CatalogItem {
  /** IKEA global article number, unique. */
  id: string
  /** System this item was scraped under, e.g. "BESTA". */
  system: string
  /** The system as IKEA spells it, e.g. "BESTÅ". Drawn on the item in the room. */
  systemLabel: string
  /** Full product name, e.g. "PAX / BERGSBO". */
  name: string
  /** Product type, e.g. "Wardrobe frame". */
  type: string
  /** Human finish description parsed from the product URL, e.g. "white stained oak effect". */
  finish: string
  /** Hex colour approximating the finish, used to shade the 3D box. */
  color: string
  /** Width in cm (left to right, at rotation 0). */
  width: number
  /** Depth in cm (front to back, at rotation 0). */
  depth: number
  /** Height in cm. */
  height: number
  /** Raw measurement string from IKEA, kept for display. */
  measureText: string
  /**
   * True when IKEA only published two dimensions (e.g. a bed's mattress size)
   * and the height was inferred from the product type. Surfaced in the UI so
   * nobody treats a guess as a spec.
   */
  heightEstimated?: boolean
  price: number | null
  currency: string
  imageUrl: string
  productUrl: string
  category: SystemCategory
  /** Rendering hint driving the front-face detailing. */
  face: FaceStyle
}

/** How the front of a box is drawn: doors, drawers, open shelves... */
export type FaceStyle = 'plain' | 'door' | 'double-door' | 'drawers' | 'shelves' | 'soft' | 'surface'

export interface Catalog {
  /** ISO timestamp of the scrape. */
  scrapedAt: string
  /** IKEA market the data came from, e.g. "gb/en". */
  market: string
  currency: string
  systems: SystemSummary[]
  items: CatalogItem[]
}

export interface SystemSummary {
  id: string
  label: string
  category: SystemCategory
  blurb: string
  count: number
  wallMountable: boolean
}

/** An item placed in the room. */
export interface PlacedItem {
  /** Instance id, unique per placement. */
  uid: string
  /** References CatalogItem.id. */
  itemId: string
  /** Floor position of the item's near-left corner, in cm from the room origin. */
  x: number
  y: number
  /** Elevation of the item's underside above the floor, in cm. */
  z: number
  /** 0, 90, 180 or 270 degrees clockwise. */
  rotation: 0 | 90 | 180 | 270
  /** Optional per-instance colour override. */
  color?: string
}

/** Quarter turns of the camera, 0-3, counted clockwise from "looking at the back wall". */
export type CameraRotation = 0 | 1 | 2 | 3

export interface Camera {
  rotation: CameraRotation
  /** Pixels per centimetre. */
  zoom: number
  panX: number
  panY: number
}

export interface Room {
  width: number
  depth: number
  height: number
  wallColor: string
  floorColor: string
}

export interface Layout {
  version: 1
  name: string
  room: Room
  items: PlacedItem[]
  savedAt: string
}
