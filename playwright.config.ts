import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // These local journeys share persisted fixture tenants and an owner queue.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } }
  ],
  webServer: [
    // Loopback OpenAI test double; the app accepts plain HTTP only for loopback outside production.
    {
      command: 'node scripts/fake-openai.mjs',
      url: 'http://127.0.0.1:3199/health',
      reuseExistingServer: false,
      timeout: 30_000
    },
    {
      command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3100',
      url: `${baseURL}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...(process.env as Record<string, string>),
        OPENAI_API_KEY: 'local-fake-openai-key',
        OPENAI_BASE_URL: 'http://127.0.0.1:3199/v1',
        OPENAI_TIMEOUT_MS: '15000'
      }
    }
  ]
})
