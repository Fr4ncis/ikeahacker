import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { loadCatalog } from './lib/catalog'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

// The catalogue is fetched before the first render so every component can read
// it synchronously. Without it there is no app, so a failure is shown plainly
// rather than left as a blank page.
loadCatalog().then(
  () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  (err: Error) =>
    root.render(
      <div className="fatal">
        <h1>Could not start</h1>
        <p>{err.message}</p>
      </div>,
    ),
)
