import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: '../../out/web', assetsInlineLimit: 1_000_000 }
})
