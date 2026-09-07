import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@testing-library/react',
        replacement: path.resolve(__dirname, 'src/__tests__/testingLibraryReact17.ts'),
      },
      {
        find: 'react',
        replacement: path.resolve(__dirname, 'node_modules/react'),
      },
      {
        find: 'react-dom',
        replacement: path.resolve(__dirname, 'node_modules/react-dom'),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      },
      {
        find: '@octo/chat-core',
        replacement: path.resolve(__dirname, 'src/__tests__/mockChatCore.ts'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
  },
})
