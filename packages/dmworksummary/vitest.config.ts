import { defineConfig } from 'vitest/config';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const pnpm = path.resolve(root, 'node_modules/.pnpm');

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    css: false,
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
      { find: '@octo/base', replacement: path.resolve(__dirname, 'src/__mocks__/dmworkBase.ts') },
      { find: /^react-dom\/(.*)/, replacement: path.resolve(pnpm, 'react-dom@17.0.2_react@17.0.2/node_modules/react-dom') + '/$1' },
      { find: /^react-dom$/, replacement: path.resolve(pnpm, 'react-dom@17.0.2_react@17.0.2/node_modules/react-dom') },
      { find: /^react$/, replacement: path.resolve(pnpm, 'react@17.0.2/node_modules/react') },
    ],
  },
});
