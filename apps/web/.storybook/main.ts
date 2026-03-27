import type { StorybookConfig } from '@storybook/react-vite'
import { mergeConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import commonjs from 'vite-plugin-commonjs'
import tsconfigPaths from 'vite-tsconfig-paths'
import postcssImport from 'postcss-import'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config: StorybookConfig = {
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
  framework: '@storybook/react-vite',
  viteFinal: (config) =>
    mergeConfig(config, {
      css: {
        postcss: {
          plugins: [postcssImport()],
        },
      },
      plugins: [
        commonjs(),
        tsconfigPaths({ root: path.resolve(__dirname, '../../../') }),
      ],
      resolve: {
        alias: {
          '@octo/base': path.resolve(__dirname, '../../../packages/dmworkbase/src'),
          '@octo/contacts': path.resolve(__dirname, '../../../packages/dmworkcontacts/src'),
          '@octo/login': path.resolve(__dirname, '../../../packages/dmworklogin/src'),
        },
        dedupe: ['react', 'react-dom'],
      },
    }),
}

export default config
