/**
 * The desktop app's update bridge, as the planner sees it.
 *
 * These types mirror `desktop/update.ts` across the process boundary; they are
 * written out twice on purpose, because the web build must not depend on
 * anything in `desktop/`. On the web the bridge is simply not there, which is
 * also how the planner knows which of the two it is running as.
 */

export interface UpdateAsset {
  name: string
  url: string
  size: number
  sha256: string | null
}

export interface UpdateInfo {
  version: string
  notes: string
  url: string
  asset: UpdateAsset | null
}

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current'; version: string }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'downloading'; info: UpdateInfo; received: number; total: number }
  | { status: 'ready'; info: UpdateInfo; file: string; manual: boolean }
  | { status: 'failed'; message: string }

export interface DesktopUpdates {
  subscribe: (listener: (state: UpdateState) => void) => () => void
  state: () => Promise<UpdateState>
  check: () => Promise<UpdateState>
  download: () => Promise<UpdateState>
  install: () => Promise<{ quitting: boolean }>
  openPage: () => Promise<void>
  version: () => Promise<string>
}

/** The bridge, or null when this is the web version. */
export function desktopUpdates(): DesktopUpdates | null {
  return (window as unknown as { desktopUpdates?: DesktopUpdates }).desktopUpdates ?? null
}

/** "93.4 MB", for a download whose size is the only thing worth saying about it. */
export function megabytes(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`
}
