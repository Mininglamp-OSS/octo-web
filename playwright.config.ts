import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  use: {
    headless: true,
    baseURL: 'https://im-test.deepminer.com.cn',
  },
});
