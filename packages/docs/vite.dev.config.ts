import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Dev-only Vite config for the docs/whiteboard STANDALONE harness (`dev:standalone` script).
//
// It aliases `@octo/base` to a lightweight dev shim (dev/octoBase.dev.ts) so the dev server runs
// on this package's React 18 alone, without dragging in the React 17 host (packages/dmworkbase).
// Production is unaffected: apps/web builds docs against the real `@octo/base`.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@octo/base': resolve(__dirname, 'dev/octoBase.dev.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 4178,
    host: true,
  },
  build: {
    outDir: 'dev-dist',
  },
})
