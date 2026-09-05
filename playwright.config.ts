import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Shared only by this Playwright run and its external test proxy.
process.env.E2E_FIXTURE_DIR ??= mkdtempSync(join(tmpdir(), 'linli-e2e-'));

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:3211',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node tests/e2e/support/authenticated-server.mjs',
    url: 'http://127.0.0.1:3211',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
