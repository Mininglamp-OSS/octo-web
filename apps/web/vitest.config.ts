import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import path from 'path'

export default defineConfig({
  plugins: [react(), tsconfigPaths({ root: '../../' })],
  resolve: {
    alias: {
      'react': path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      '@douyinfe/semi-ui': path.resolve(__dirname, 'node_modules/@douyinfe/semi-ui'),
      '@douyinfe/semi-icons': path.resolve(__dirname, 'node_modules/@douyinfe/semi-icons'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    // `e2e/` holds Playwright specs (run via e2e/bind.config.ts). Their
    // @playwright/test runner API throws if Vitest collects them, so exclude
    // that dir from Vitest's default `**/*.spec.*` glob.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // Force Vite to transform @tiptap/react instead of letting Node's strict
    // ESM resolver handle it. Its dist ships `import ... from 'react/jsx-runtime'`
    // without a `.js` extension, which Node's strict ESM resolver rejects under
    // PNPM's nested node_modules layout. Without this, any test file whose
    // module graph transitively reaches @tiptap/react (e.g. via the real
    // @douyinfe/semi-ui package, which WKBase uses) fails to load before any
    // vi.mock can intervene. Pre-existing issue also previously blocking the
    // voice-input test files; now that those files can load, their own
    // assertions run — failures inside them are pre-existing and unrelated
    // to PR#1113.
    server: {
      deps: {
        inline: [/@tiptap\/react/, /@douyinfe\/semi-icons/, /@douyinfe\/semi-ui/],
      },
    },
  },
})
