/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import path from 'path';

// Single config for the package. Consumed as source by apps/web (main:
// src/index.tsx) — no per-package lib build, matching dmworktodo. This file
// only drives vitest; the '@octo/base' alias points at a lightweight mock so
// the api layer can be unit-tested without the full app runtime.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
  },
  resolve: {
    alias: {
      // Real (self-contained, dependency-free) pinyin helpers the org picker
      // uses for local search — aliased before the '@octo/base' barrel mock so
      // the deep imports resolve to the actual util instead of the stub.
      '@octo/base/src/Utils/pinYin': path.resolve(__dirname, '../dmworkbase/src/Utils/pinYin.ts'),
      '@octo/base/src/Utils/t2s': path.resolve(__dirname, '../dmworkbase/src/Utils/t2s.ts'),
      '@octo/base': path.resolve(__dirname, 'src/__mocks__/dmworkBase.ts'),
      // Semi UI pulls lottie-web transitively; its canvas init throws in jsdom.
      'lottie-web': path.resolve(__dirname, 'src/__mocks__/lottieStub.ts'),
    },
  },
});
