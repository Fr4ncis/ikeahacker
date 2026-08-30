import { useEffect } from 'react'
import { Inspector } from './components/Inspector'
import { RoomCanvas } from './components/RoomCanvas'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { restoreAutosave, startAutosave } from './state/store'

export default function App() {
  // Bring back whatever was in the room last time, then keep saving it.
  useEffect(() => {
    restoreAutosave()
    return startAutosave()
  }, [])

  return (
    <div className="app">
      <Toolbar />
      <main className="workspace">
        <Sidebar />
        <RoomCanvas />
        <Inspector />
      </main>
    </div>
  )
}
