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
      '@octo/base': path.resolve(__dirname, 'src/__mocks__/dmworkBase.ts'),
      // Semi UI pulls lottie-web transitively; its canvas init throws in jsdom.
      'lottie-web': path.resolve(__dirname, 'src/__mocks__/lottieStub.ts'),
    },
  },
});
