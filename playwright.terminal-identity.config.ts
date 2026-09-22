import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'terminal*.browser.spec.ts',
  use: { baseURL: 'http://127.0.0.1:4174', launchOptions: { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' } },
  webServer: { command: 'pnpm --filter crm dev --host 127.0.0.1 --port 4174', url: 'http://127.0.0.1:4174', reuseExistingServer: true },
})
