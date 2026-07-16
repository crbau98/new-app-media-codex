import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  globalTimeout: process.env.CI ? 6 * 60 * 1000 : undefined,
  timeout: 20 * 1000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  expect: {
    timeout: 7 * 1000,
  },
  use: {
    baseURL: 'http://localhost:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'cd frontend && npm run build && cd .. && uvicorn app.main:app --host 0.0.0.0 --port 8000',
    url: 'http://localhost:8000/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
})
