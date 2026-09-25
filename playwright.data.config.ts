import { defineConfig } from '@playwright/test';

/*
 * The data layer against the development database (tests/data.spec.ts): no browser, no server.
 * Runs with the `react-server` condition so server-only modules load as they do in the app.
 *   DATABASE_URL=… npm run test:data
 */
export default defineConfig({
  testDir: './tests',
  testMatch: 'data.spec.ts',
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
});
