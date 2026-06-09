import { defineConfig } from 'vitest/config';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const pnpm = path.resolve(root, 'node_modules/.pnpm');
// @testing-library/react renders via react-dom/client (React 18+). The pnpm
// store links it against react-dom@17 (which has no client.js), so render/hook
// tests can only resolve through these aliases. Pin react/react-dom to 18 and
// @testing-library/react to its react-18-linked variant; tests opt back into
// legacy rendering via { legacyRoot: true }.
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
      { find: /^@octo\/base\/src\/Components\/VoiceInputButton$/, replacement: path.resolve(__dirname, 'src/__mocks__/VoiceInputButton.tsx') },
      { find: /^@octo\/base\/src\/Components\/AiBadge$/, replacement: path.resolve(__dirname, 'src/__mocks__/AiBadge.tsx') },
      { find: /^@octo\/base\/src\/EndpointCommon$/, replacement: path.resolve(__dirname, 'src/__mocks__/EndpointCommon.ts') },
      { find: /^@octo\/base\/src\/Service\/Const$/, replacement: path.resolve(__dirname, 'src/__mocks__/Const.ts') },
      { find: /^@octo\/base\/src\/App$/, replacement: path.resolve(__dirname, 'src/__mocks__/dmworkBase.ts') },
      { find: /^@octo\/base\/src\/Components\/WKLayout\/layoutWidth$/, replacement: path.resolve(root, 'packages/dmworkbase/src/Components/WKLayout/layoutWidth.ts') },
      { find: '@octo/base', replacement: path.resolve(__dirname, 'src/__mocks__/dmworkBase.ts') },
      { find: /^@testing-library\/react$/, replacement: testingLibraryReact },
      { find: /^react-dom\/(.*)/, replacement: reactDom18 + '/$1' },
      { find: /^react-dom$/, replacement: reactDom18 },
      { find: /^react\/(.*)/, replacement: react18 + '/$1' },
      { find: /^react$/, replacement: react18 },
    ],
  },
});
