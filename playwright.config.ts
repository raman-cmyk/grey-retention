import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3100'
const scheduledSweep = /scheduled-sweep\.spec\.ts$/

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // These local journeys share persisted fixture tenants and an owner queue.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // CI runs every journey one after another on a dev server, and the last
  // mobile journeys run 20+ minutes in, where a server action can take
  // longer than the default 5s. Checks still have to come true; they just
  // get more time on CI. Locally the default stays.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  // CI adds an HTML report, uploaded by the Browser workflow when it fails.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: scheduledSweep,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chromium',
      testIgnore: scheduledSweep,
      use: { ...devices['Pixel 7'] }
    },
    // The scheduled sweep drains every workspace's queue, so it runs only
    // after all desktop and mobile journeys have finished.
    {
      name: 'scheduled-sweep',
      testMatch: scheduledSweep,
      dependencies: ['desktop-chromium', 'mobile-chromium'],
      use: { ...devices['Desktop Chrome'] }
    }
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
