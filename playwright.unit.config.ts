import { defineConfig } from '@playwright/test';

/**
 * Pure rules only (no browser, no server): `npm run test:unit`. The full suite (`npm test`)
 * runs these too, alongside the end-to-end tests.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: ['unit.spec.ts', 'catalog.spec.ts', 'lib-*.spec.ts'],
  workers: 4,
  reporter: 'list',
});
