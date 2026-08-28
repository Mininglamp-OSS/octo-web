import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [
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
        find: '@douyinfe/semi-ui',
        replacement: path.resolve(__dirname, 'node_modules/@douyinfe/semi-ui'),
      },
      {
        find: '@douyinfe/semi-icons',
        replacement: path.resolve(__dirname, 'node_modules/@douyinfe/semi-icons'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
