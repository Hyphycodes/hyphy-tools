import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT ?? 3107);

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  reporter: 'list',
  use: {
    baseURL: process.env.QA_URL || `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Lets a sandbox with a preinstalled Chromium run the suite without downloading browsers.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  webServer: process.env.QA_URL
    ? undefined
    : {
        command: `npm run start -- --port ${port}`,
        url: `http://localhost:${port}`,
        reuseExistingServer: true,
      },
});
