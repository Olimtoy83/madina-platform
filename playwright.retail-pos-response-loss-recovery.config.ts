import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'retailPosResponseLossRecovery.browser.spec.ts',
  workers: 1,
  timeout: 60_000,
  use: { channel: 'chrome' },
})
