import { useCallback, useEffect, useState } from 'react'
import { ContextMenu, type MenuTarget } from './components/ContextMenu'
import { Inspector } from './components/Inspector'
import { Notice } from './components/Notice'
import { RoomCanvas } from './components/RoomCanvas'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { UpdateBanner } from './components/UpdateBanner'
import { productHost } from './lib/catalog'
import { decodeLayout, layoutFromUrl } from './lib/layout'
import { fetchPlan, shortIdFromUrl } from './lib/shortlink'
import { Sound } from './lib/sound'
import { restoreAutosave, startAutosave, usePlanner } from './state/store'
import type { CatalogItem } from './lib/types'

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
  const [menu, setMenu] = useState<MenuTarget | null>(null)

  // A plan in the URL wins over the autosave, then the URL is cleaned so later
  // edits behave normally and autosave takes over from here. A short link has
  // to be fetched, so the autosave loads first and is replaced on arrival
  // rather than leaving the room blank while the request is in flight.
  useEffect(() => {
    const stop = startAutosave()
    const cleanUrl = () => history.replaceState(null, '', window.location.pathname)

    const openShared = (dropped: number) => {
      cleanUrl()
      setNotice({
        text: `Opened a shared plan.${dropped ? droppedNote(dropped) : ''}`,
        tone: dropped ? 'warning' : 'info',
      })
    }

    const inFragment = layoutFromUrl()
    if (inFragment) {
      usePlanner.getState().loadLayout(inFragment.layout)
      openShared(inFragment.dropped)
      return stop
    }

    const dropped = restoreAutosave()
    if (dropped) setNotice({ text: droppedNote(dropped).trim(), tone: 'warning' })

    const shortId = shortIdFromUrl()
    if (!shortId) return stop

    let cancelled = false
    void fetchPlan(shortId).then((payload) => {
      if (cancelled) return
      const loaded = payload ? decodeLayout(payload) : null
      if (!loaded) {
        setNotice({ text: 'That shared link could not be opened. It may have expired.', tone: 'warning' })
        cleanUrl()
        return
      }
      usePlanner.getState().loadLayout(loaded.layout)
      openShared(loaded.dropped)
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const announce = useCallback((next: LoadNotice) => setNotice(next), [])
  const openProductPage = useCallback((item: CatalogItem) => {
    window.open(item.productUrl, '_blank', 'noopener,noreferrer')
  }, [])

  const copyArticle = useCallback(
    (item: CatalogItem) => {
      void navigator.clipboard
        .writeText(item.id)
        .then(() => {
          Sound.confirm()
          setNotice({ text: `Copied article number ${item.id}.`, tone: 'info' })
        })
        .catch(() => setNotice({ text: `Article number is ${item.id}.`, tone: 'info' }))
    },
    [],
  )

  /** Right-click in the catalogue: look the product up or drop it in the room. */
  const catalogueMenu = useCallback(
    (item: CatalogItem, x: number, y: number) => {
      setMenu({
        item,
        x,
        y,
        actions: [
          { label: `Open on ${productHost(item)} ↗`, onSelect: () => openProductPage(item) },
          {
            label: 'Add to room',
            onSelect: () => {
              usePlanner.getState().addItem(item.id)
              Sound.place()
            },
          },
          { label: 'Copy article number', onSelect: () => copyArticle(item) },
        ],
      })
    },
    [openProductPage, copyArticle],
  )

  /** Right-click on something already placed: the same, plus editing it. */
  const roomMenu = useCallback(
    (item: CatalogItem, uid: string, x: number, y: number) => {
      const store = usePlanner.getState()
      setMenu({
        item,
        x,
        y,
        actions: [
          { label: `Open on ${productHost(item)} ↗`, onSelect: () => openProductPage(item) },
          {
            label: 'Duplicate',
            onSelect: () => {
              store.duplicateItem(uid)
              Sound.place()
            },
          },
          {
            label: 'Rotate 90°',
            onSelect: () => {
              store.rotateItem(uid, 90)
              Sound.rotate()
            },
          },
          { label: 'Copy article number', onSelect: () => copyArticle(item) },
          {
            label: 'Remove',
            onSelect: () => {
              store.removeItem(uid)
              Sound.remove()
            },
            danger: true,
          },
        ],
      })
    },
    [openProductPage, copyArticle],
  )

  return (
    <div className="app">
      <Toolbar onNotice={announce} />
      <main className="workspace">
        <Sidebar onContext={catalogueMenu} />
        <RoomCanvas onContext={roomMenu} />
        <Inspector />
      </main>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <UpdateBanner />
      <ContextMenu target={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
