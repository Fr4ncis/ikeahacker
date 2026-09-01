import { useEffect, useState } from 'react'
import { desktopUpdates, megabytes, type UpdateState } from '../lib/updates'
import { Sound } from '../lib/sound'

/**
 * Says when a newer version has been published, and gets it.
 *
 * Only ever visible in the desktop app: on the web there is no bridge to
 * subscribe to and this renders nothing. It stays out of the way -- an
 * automatic check that finds nothing is silent, and the only thing that ever
 * appears unprompted is an actual new version.
 *
 * The wording is deliberate about what happens next. Windows can replace the
 * app itself, so the button installs. Nothing else can, because the builds are
 * unsigned, so the button opens what was downloaded and says so rather than
 * pretending the update is done.
 */
export function UpdateBanner() {
  const bridge = desktopUpdates()
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    if (!bridge) return
    // Asked as well as subscribed: the shell checks a few seconds after launch
    // and the answer would be missed by a page that was still loading.
    void bridge.state().then(setState)
    return bridge.subscribe(setState)
  }, [bridge])

  // "Up to date" is an answer to a question, not news; it goes away by itself.
  useEffect(() => {
    if (state.status !== 'current' && state.status !== 'failed') return
    const timer = setTimeout(() => setState({ status: 'idle' }), 5000)
    return () => clearTimeout(timer)
  }, [state])

  if (!bridge) return null

  const version = 'info' in state ? state.info.version : null
  if (version && dismissed === version) return null

  switch (state.status) {
    case 'idle':
      return null

    case 'checking':
      return <Bar text="Looking for a newer version…" />

    case 'current':
      return <Bar text={`Version ${state.version} is the latest.`} />

    case 'failed':
      return <Bar text={state.message} tone="warning" onDismiss={() => setState({ status: 'idle' })} />

    case 'available': {
      const { info } = state
      return (
        <Bar
          text={`Version ${info.version} is available.`}
          detail={info.asset ? megabytes(info.asset.size) : 'No download for this platform'}
          onDismiss={() => setDismissed(info.version)}
        >
          <button className="update-link" onClick={() => void bridge.openPage()}>
            What changed
          </button>
          {info.asset && (
            <button
              className="update-go"
              onClick={() => {
                Sound.tick()
                void bridge.download()
              }}
            >
              Download
            </button>
          )}
        </Bar>
      )
    }

    case 'downloading': {
      const done = state.total ? Math.round((state.received / state.total) * 100) : 0
      return (
        <Bar text={`Downloading version ${state.info.version}…`} detail={`${done}%`}>
          <progress className="update-progress" value={state.received} max={state.total || 1} />
        </Bar>
      )
    }

    case 'ready':
      return (
        <Bar
          text={`Version ${state.info.version} is downloaded.`}
          detail={state.manual ? 'Finish in the installer that opens' : 'The app will close while it installs'}
          onDismiss={() => setDismissed(state.info.version)}
        >
          <button
            className="update-go"
            onClick={() => {
              Sound.confirm()
              void bridge.install()
            }}
          >
            {state.manual ? 'Open the installer' : 'Install and restart'}
          </button>
        </Bar>
      )
  }
}

function Bar({
  text,
  detail,
  tone,
  onDismiss,
  children,
}: {
  text: string
  detail?: string
  tone?: 'warning'
  onDismiss?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className={`update-bar ${tone ? `update-bar--${tone}` : ''}`} role="status">
      <span className="update-text">
        {text}
        {detail && <em>{detail}</em>}
      </span>
      {children}
      {onDismiss && (
        <button className="update-dismiss" onClick={onDismiss} aria-label="Not now">
          ✕
        </button>
      )}
    </div>
  )
}
