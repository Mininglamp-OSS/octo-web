import { defineConfig } from 'vitest/config';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const pnpm = path.resolve(root, 'node_modules/.pnpm');
// @testing-library/react renders via react-dom/client (React 18+). The pnpm
// store links it against react-dom@17 (which has no client.js), so render/hook
// tests can only resolve through these aliases. Pin react/react-dom to 18 and
// @testing-library/react to its react-18-linked variant; the meeting package
// still ships against React 17 in production (see package.json).
const react18 = path.resolve(pnpm, 'react@18.3.1/node_modules/react');
const reactDom18 = path.resolve(pnpm, 'react-dom@18.3.1_react@18.3.1/node_modules/react-dom');
const testingLibraryReact = path.resolve(
  pnpm,
  '@testing-library+react@14.3.1_@types+react@18.3.28_react-dom@18.3.1_react@18.3.1__react@18.3.1/node_modules/@testing-library/react',
);

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
      // The base package is a large IM runtime; the meeting module only touches
      // a narrow WKApp seam, so tests resolve @octo/base to a focused mock.
      { find: '@octo/base', replacement: path.resolve(__dirname, 'src/__mocks__/dmworkBase.ts') },
      { find: /^@testing-library\/react$/, replacement: testingLibraryReact },
      { find: /^react-dom\/client$/, replacement: path.resolve(reactDom18, 'client.js') },
      { find: /^react-dom$/, replacement: reactDom18 },
      { find: /^react$/, replacement: react18 },
    ],
  },
});
