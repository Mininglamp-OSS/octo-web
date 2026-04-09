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
      optimizeDeps: {
        include: [
          '@douyinfe/semi-ui/lib/es/checkbox',
          '@lottiefiles/lottie-player/dist/tgs-player',
          '@tanstack/react-virtual',
          '@tauri-apps/api',
          '@tauri-apps/api/event',
          '@tauri-apps/api/process',
          '@tauri-apps/api/updater',
          'benz-amr-recorder',
          'bignumber.js',
          'howler',
          'qrcode.react',
          'react-avatar-editor',
          'react-dom',
          'web-vitals',
          'zxcvbn',
        ],
      },
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
          '@octo/base': path.resolve(__dirname, '../../../packages/dmworkbase'),
          '@octo/contacts': path.resolve(__dirname, '../../../packages/dmworkcontacts'),
          '@octo/login': path.resolve(__dirname, '../../../packages/dmworklogin'),
        },
        dedupe: ['react', 'react-dom'],
      },
    }),
}

export default config
