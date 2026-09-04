import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    {
      command: 'pnpm dev --port 5173 --strictPort',
      port: 5173,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @neon-arena/server dev',
      port: 2567,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
