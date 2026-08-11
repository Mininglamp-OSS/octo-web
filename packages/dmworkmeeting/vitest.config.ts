import { defineConfig } from 'vitest/config';
import path from 'path';

// The base package is a large IM runtime; the meeting module only touches a
// narrow WKApp seam, so tests resolve @octo/base to a focused mock. React 18 /
// @testing-library/react 14 are declared as devDependencies of this package, so
// normal node resolution picks them up — no hard-coded pnpm virtual-store paths.
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
    alias: [{ find: '@octo/base', replacement: path.resolve(__dirname, 'src/__mocks__/dmworkBase.ts') }],
  },
});
