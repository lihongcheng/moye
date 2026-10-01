import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { build: { externalizeDeps: true } },
  preload: { build: { externalizeDeps: true } },
  renderer: {
    plugins: [react()],
    build: { assetsInlineLimit: 1_000_000 },
    server: { host: '127.0.0.1' }
  }
})
