import { defineConfig } from 'vite'

// Storybook-specific base config. Shared aliases, CSS handling and plugins are
// added in main.ts via viteFinal; keeping this file minimal prevents the app's
// production-only test/runtime exclusion plugin from stubbing Storybook itself.
export default defineConfig({})
