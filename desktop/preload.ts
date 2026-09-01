/**
 * The only bridge between the page and the shell.
 *
 * It exists for one feature -- telling the planner about a new version and
 * letting it ask for the update -- so it exposes exactly that and nothing
 * else. No file access, no shell, no general message channel: the renderer
 * cannot reach anything it is not handed here.
 *
 * `window.desktopUpdates` is also how the planner knows it is running in the
 * desktop app at all. On the web it is simply not there.
 */
import { contextBridge, ipcRenderer } from 'electron'

const updates = {
  /** Follows the shell's update state. Returns a function that stops listening. */
  subscribe(listener: (state: unknown) => void): () => void {
    const relay = (_event: unknown, state: unknown) => listener(state)
    ipcRenderer.on('update:state', relay)
    return () => {
      ipcRenderer.off('update:state', relay)
    }
  },
  /** Whatever the shell knows already, for a page that mounted after a check. */
  state: () => ipcRenderer.invoke('update:state'),
  /** Looks for a newer release now, and reports the outcome either way. */
  check: () => ipcRenderer.invoke('update:check'),
  download: () => ipcRenderer.invoke('update:download'),
  install: () => ipcRenderer.invoke('update:install'),
  /** Opens the release page in a browser, for reading it or downloading by hand. */
  openPage: () => ipcRenderer.invoke('update:page'),
  version: () => ipcRenderer.invoke('update:version'),
}

contextBridge.exposeInMainWorld('desktopUpdates', updates)
