import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'retailPosOfflineAcceptance.browser.spec.ts',
  workers: 1,
  use: { channel: 'chrome' },
})
