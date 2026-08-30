import { useCallback, useEffect, useState } from 'react'
import { Inspector } from './components/Inspector'
import { Notice } from './components/Notice'
import { RoomCanvas } from './components/RoomCanvas'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { layoutFromUrl } from './lib/layout'
import { restoreAutosave, startAutosave, usePlanner } from './state/store'

/** Describes what happened on the last load, shown briefly to the user. */
export interface LoadNotice {
  text: string
  tone: 'info' | 'warning'
}

function droppedNote(dropped: number): string {
  return ` ${dropped} item${dropped === 1 ? '' : 's'} left out: no longer in the catalogue.`
}

export default function App() {
  const [notice, setNotice] = useState<LoadNotice | null>(null)

  // A plan in the URL wins over the autosave, then the fragment is cleared so
  // later edits behave normally and autosave takes over from here.
  useEffect(() => {
    const shared = layoutFromUrl()
    if (shared) {
      usePlanner.getState().loadLayout(shared.layout)
      history.replaceState(null, '', window.location.pathname + window.location.search)
      setNotice({
        text: `Opened a shared plan.${shared.dropped ? droppedNote(shared.dropped) : ''}`,
        tone: shared.dropped ? 'warning' : 'info',
      })
    } else {
      const dropped = restoreAutosave()
      if (dropped) setNotice({ text: droppedNote(dropped).trim(), tone: 'warning' })
    }
    return startAutosave()
  }, [])

  const announce = useCallback((next: LoadNotice) => setNotice(next), [])

  return (
    <div className="app">
      <Toolbar onNotice={announce} />
      <main className="workspace">
        <Sidebar />
        <RoomCanvas />
        <Inspector />
      </main>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
    </div>
  )
}
