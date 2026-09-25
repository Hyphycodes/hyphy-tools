import { defineConfig } from '@playwright/test';

/*
 * Real accounts, end to end (tests/auth.spec.ts): the app in HYPHY_IDENTITY=supabase mode against
 * a Supabase Auth server, a database with the Hyphy migrations and a mail catcher. docs/AUTH.md
 * describes the local stack; never point this at production.
 *
 *   AUTH_E2E_SUPABASE_URL=http://localhost:54321
 *   AUTH_E2E_PUBLISHABLE_KEY=…
 *   AUTH_E2E_DATABASE_URL=postgres://hyphy_app:…@localhost:54322/hyphy_auth
 *   AUTH_E2E_ADMIN_DATABASE_URL=postgres://postgres@localhost:54322/hyphy_auth
 *   AUTH_E2E_MAILPIT_URL=http://localhost:8025
 *   npm run test:auth
 */
const port = Number(process.env.AUTH_E2E_PORT ?? 3108);
const env = process.env;

export default defineConfig({
  testDir: './tests',
  testMatch: 'auth.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: env.PLAYWRIGHT_CHROMIUM_PATH }
      : undefined,
  },
  webServer: {
    command: `npm run start -- --port ${port}`,
    url: `http://localhost:${port}/platform/sign-in`,
    reuseExistingServer: false,
    env: {
      HYPHY_IDENTITY: 'supabase',
      HYPHY_DATA: 'supabase',
      DATABASE_URL: env.AUTH_E2E_DATABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_URL: env.AUTH_E2E_SUPABASE_URL ?? '',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.AUTH_E2E_PUBLISHABLE_KEY ?? '',
      HYPHY_SITE_URL: `http://localhost:${port}`,
    },
  },
});
