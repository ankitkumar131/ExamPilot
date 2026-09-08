import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Renderer build (overlay + settings windows).
// Output goes to dist/renderer and is loaded by the Electron main process.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      input: {
        overlay: resolve(__dirname, 'src/renderer/overlay.html'),
        settings: resolve(__dirname, 'src/renderer/settings.html')
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true
  }
})
