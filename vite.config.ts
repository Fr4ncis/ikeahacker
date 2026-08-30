import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app from a subpath, so the deploy workflow sets
// VITE_BASE=/<repo>/. Local dev and preview stay at the root.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: { port: 5173, open: false },
})
