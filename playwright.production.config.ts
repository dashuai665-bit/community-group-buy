import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['production-navigation.spec.ts', 'production-auth.spec.ts'],
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:3222',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node tests/e2e/support/production-server.mjs',
    url: 'http://127.0.0.1:3222',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
