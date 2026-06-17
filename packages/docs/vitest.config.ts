import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['src/test/setup.ts'],
  },
  resolve: {
    // Yjs / y-protocols / prosemirror-* MUST resolve to a single physical copy
    // (frontend-design §2.4) or Yjs throws "imported twice" at runtime.
    dedupe: [
      'yjs',
      'y-protocols',
      '@tiptap/pm',
      'prosemirror-state',
      'prosemirror-view',
      'prosemirror-model',
    ],
    alias: {
      // Resolve @octo/base to a lightweight stub so tests don't pull the whole app
      // into jsdom; tests inject behaviour via setWKApp(createMockWKApp()).
      '@octo/base': path.resolve(__dirname, 'src/__mocks__/octoBase.ts'),
    },
  },
});
