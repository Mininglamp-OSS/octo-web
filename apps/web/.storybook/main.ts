import type { StorybookConfig } from '@storybook/react-vite'
import { mergeConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import commonjs from 'vite-plugin-commonjs'
import tsconfigPaths from 'vite-tsconfig-paths'
import postcssImport from 'postcss-import'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
  staticDirs: ['../public'],
  stories: [
    '../src/**/*.mdx',
    '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
    '../../../packages/*/src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
  ],
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-onboarding',
    '@storybook/addon-vitest',
    '@storybook/addon-mcp',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {
      // The application Vite config intentionally stubs @storybook/* for
      // production bundles. Storybook must not inherit that exclusion plugin.
      builder: {
        viteConfigPath: path.resolve(__dirname, 'vite.config.ts'),
      },
    },
  },
  viteFinal: (config) =>
    mergeConfig(config, {
      optimizeDeps: {
        // 扫描 workspace 所有包的源码，自动发现并预编译依赖，无需手动维护列表
        entries: [
          path.resolve(__dirname, '../../../packages/*/src/**/*.{ts,tsx}'),
          path.resolve(__dirname, '../src/**/*.{ts,tsx}'),
          // 排除测试文件
          `!${path.resolve(__dirname, '../src/**/*.{test,spec}.{ts,tsx}')}`,
          `!${path.resolve(__dirname, '../src/__tests__/**')}`,
          `!${path.resolve(__dirname, '../../../packages/*/src/**/*.{test,spec}.{ts,tsx}')}`,
        ],
        include: ['expect-type'],
        // Vitest owns its runtime initialization, so keep it out of Vite's
        // dependency optimizer. expect-type is intentionally not excluded:
        // it is CommonJS and must be pre-bundled for interactive Stories.
        exclude: [
          'vitest',
          '@vitest/runner',
          '@vitest/expect',
          '@vitest/spy',
          '@vitest/utils',
          '@vitest/snapshot',
          '@storybook/addon-vitest',
          '@storybook/test',
        ],
      },
      css: {
        postcss: {
          plugins: [postcssImport()],
        },
      },
      plugins: [
        {
          name: 'storybook-exclude-test-files',
          enforce: 'pre',
          resolveId(id) {
            const isTestFile =
              /[/\\]__tests__[/\\]/.test(id) ||
              /\.(?:test|spec)\.[jt]sx?$/.test(id)
            return isTestFile ? '\0storybook-test-stub' : undefined
          },
          load(id) {
            return id === '\0storybook-test-stub' ? 'export default {}' : undefined
          },
        },
        commonjs(),
        tsconfigPaths({ root: path.resolve(__dirname, '../../../') }),
      ],
      resolve: {
        alias: {
          '@octo/base': path.resolve(__dirname, '../../../packages/dmworkbase'),
          '@octo/contacts': path.resolve(__dirname, '../../../packages/dmworkcontacts'),
          '@octo/login': path.resolve(__dirname, '../../../packages/dmworklogin'),
        },
        dedupe: ['react', 'react-dom'],
      },
    }),
}

export default config
