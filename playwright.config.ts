import { defineConfig, devices } from '@playwright/test';

// Only what this file uses of Node's `process`; the project deliberately has no @types/node.
declare const process: { env: Record<string, string | undefined> };

const ci = process.env.CI !== undefined && process.env.CI !== '';

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: ci,
  // One retry on CI absorbs the rare timing flake of a shared runner without hiding a test that really fails.
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm dev --open false', url: 'http://localhost:5173/demo/', reuseExistingServer: !ci },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
