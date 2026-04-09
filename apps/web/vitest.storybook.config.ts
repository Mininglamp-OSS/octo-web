import { defineConfig } from 'vitest/config'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    storybookTest({
      configDir: path.resolve(__dirname, '.storybook'),
    }),
  ],
  test: {
    name: 'storybook',
    retry: 2, // CI 环境下 Vite HMR reload 可能导致动态 import 失败，重试2次
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
})
