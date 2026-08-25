import { defineConfig } from '@playwright/test'

const host = '127.0.0.1'
const port = 4173
const baseURL = 'http:' + '//' + host + ':' + port

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath:
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    },
  },
  webServer: {
    command: 'pnpm --filter crm preview --host 127.0.0.1 --port 4173',
    url: baseURL,
    reuseExistingServer: true,
  },
})
