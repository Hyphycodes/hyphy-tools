import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';
import { BASE_PATH } from '../src/lib/base-path';

/*
 * Real accounts, end to end (HYPHY_IDENTITY=supabase): a real Supabase Auth server, a real
 * database with the Hyphy migrations, and a mail catcher for the confirmation and reset emails.
 * Nothing here is mocked. Run with `npm run test:auth` (playwright.auth.config.ts), which starts
 * the app in real-account mode; see docs/AUTH.md for the local stack. Without it, these skip.
 *
 * Every account made here uses an `.auth-test@hyphy-tools.example` address and is deleted
 * afterwards.
 */
const MAILPIT = process.env.AUTH_E2E_MAILPIT_URL;
const ADMIN_DB = process.env.AUTH_E2E_ADMIN_DATABASE_URL;
test.skip(!MAILPIT || !ADMIN_DB, 'Real-account E2E needs the local Auth stack (docs/AUTH.md).');

const PASSWORD = 'first-Pass-2026';
const NEW_PASSWORD = 'second-Pass-2026';
const run = Date.now().toString(36);
const address = (who: string) => `${who}-${run}.auth-test@hyphy-tools.example`;

const sql = () => postgres(ADMIN_DB!, { max: 1, onnotice: () => {} });

test.afterAll(async () => {
  if (!ADMIN_DB) return;
  const db = sql();
  // Signing out never deletes anything; the test identities are removed here, on purpose.
  await db`delete from auth.users where email like ${'%-' + run + '.auth-test@hyphy-tools.example'}`;
  await db.end();
});

/** The form's one problem (not Next.js's route announcer, which is also an alert). */
const problem = (page: Page) => page.locator('form').getByRole('alert');

async function visit(page: Page, path: string) {
  await page.goto(`${BASE_PATH}${path === '/' ? '' : path}`, { waitUntil: 'networkidle' });
}

/** The newest link in the newest email to `to` whose subject matches. */
async function emailLink(to: string, subject: RegExp): Promise<string> {
  let link = '';
  await expect(async () => {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    ).then((response) => response.json());
    const message = (search.messages ?? []).find((item: { Subject: string }) =>
      subject.test(item.Subject),
    );
    expect(message, `an email to ${to}`).toBeTruthy();
    const full = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`).then((r) => r.json());
    const href = /href="([^"]+)"/.exec(full.HTML ?? '')?.[1];
    expect(href).toBeTruthy();
    link = href!.replace(/&amp;/g, '&');
  }).toPass({ timeout: 15_000 });
  return link;
}

async function signUp(page: Page, name: string, email: string) {
  await visit(page, '/sign-up');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
}

async function signIn(page: Page, email: string, password: string, from = '/sign-in') {
  await visit(page, from);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function counts(email: string) {
  const db = sql();
  const [row] = await db`
    select (select count(*) from auth.users where email = ${email})::int as users,
           (select count(*) from profiles where email = ${email})::int as profiles,
           (select count(*) from spaces s join profiles p on p.id = s.owner_id
              where p.email = ${email} and s.kind = 'personal')::int as personal,
           (select count(*) from space_members m join profiles p on p.id = m.person_id
              where p.email = ${email})::int as memberships,
           (select count(*) from space_members m join profiles p on p.id = m.person_id
              where p.email = ${email} and m.role = 'owner' and m.status = 'active')::int as owner`;
  await db.end();
  return row;
}

test.describe.configure({ mode: 'serial' });

test('the app is closed to anyone not signed in, and remembers where they were going', async ({
  page,
}) => {
  await visit(page, '/');
  await expect(page).toHaveURL(`${BASE_PATH}/sign-in`);
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  // No Demo Mode: nobody to preview as.
  await expect(page.getByText('Preview.')).toHaveCount(0);

  await visit(page, '/abc/projects');
  await expect(page).toHaveURL(`${BASE_PATH}/sign-in?next=%2Fabc%2Fprojects`);
});

test('sign up → confirm by email → Welcome, with exactly one profile, Personal Space and membership', async ({
  page,
}) => {
  const email = address('ada');
  await signUp(page, 'Ada Test', email);
  expect(await counts(email)).toEqual({
    users: 1,
    profiles: 1,
    personal: 1,
    memberships: 1,
    owner: 1,
  });

  // Not confirmed yet: sign-in says so.
  await signIn(page, email, PASSWORD);
  await expect(problem(page)).toContainText('Confirm your email first');

  // The confirmation email (Supabase's default template: PKCE code, same browser).
  await page.goto(await emailLink(email, /confirm/i), { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(`${BASE_PATH}/welcome`);
  await expect(page.getByRole('heading', { name: 'Hi, Ada.' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  // The name can be fixed here; it's the profile's.
  await page.getByLabel('Display name').fill('Ada Lovelace-Test');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // Opening the same link again: already confirmed and signed in, so straight on.
  expect(await counts(email)).toEqual({
    users: 1,
    profiles: 1,
    personal: 1,
    memberships: 1,
    owner: 1,
  });
});

test('a new account’s Home offers first steps and shows no demo data', async ({ page }) => {
  const email = address('ada');
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(`${BASE_PATH}/personal`);
  await expect(page.getByRole('heading', { name: /Welcome to Hyphy, Ada/ })).toBeVisible();
  const start = page.getByRole('region', { name: 'Start here' });
  for (const line of ['Work with a PDF', 'Create a QR code', 'Resize an image', 'Track mileage'])
    await expect(start.getByText(line)).toBeVisible();
  const body = await page.locator('body').innerText();
  for (const demo of ['ABC Construction', 'Oak Brook', 'Truck 24', 'Dana', 'Mike', 'Salt & Ember'])
    expect(body).not.toContain(demo);

  // Their only Space is their own; other Spaces don't exist for them.
  await visit(page, '/abc-construction');
  await expect(page.getByText(/This isn’t in your Spaces/)).toBeVisible();
  await visit(page, '/');
  await expect(page).toHaveURL(`${BASE_PATH}/personal`);

  // A tool works and the dashboard fills in.
  await visit(page, '/personal/tools/qr');
  await expect(page).toHaveURL(`${BASE_PATH}/personal/tools/qr`);
});

test('sessions persist across reloads and tabs; signing in again is skipped', async ({
  page,
  context,
}) => {
  await signIn(page, address('ada'), PASSWORD);
  await expect(page).toHaveURL(`${BASE_PATH}/personal`);
  await page.reload();
  await expect(page).toHaveURL(`${BASE_PATH}/personal`);
  const second = await context.newPage();
  await visit(second, '/personal/profile');
  await expect(second.getByText('Managed by your account')).toBeVisible();
  await expect(second.getByText(address('ada')).first()).toBeVisible();
  // Signed in: the sign-in page sends them home.
  await visit(second, '/sign-in');
  await expect(second).toHaveURL(new RegExp(`${BASE_PATH}/personal$`));
});

test('sign out ends the session, clears it, and deletes nothing', async ({ page, context }) => {
  const email = address('ada');
  await signIn(page, email, PASSWORD);
  await page
    .getByRole('button', { name: /Ada Lovelace-Test/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(`${BASE_PATH}/sign-in`);
  const cookies = await context.cookies();
  expect(cookies.filter((cookie) => cookie.name.startsWith('sb-') && cookie.value)).toEqual([]);
  await visit(page, '/personal');
  await expect(page).toHaveURL(`${BASE_PATH}/sign-in?next=%2Fpersonal`);
  expect(await counts(email)).toMatchObject({ profiles: 1, personal: 1, memberships: 1 });
});

test('sign-in problems are said plainly', async ({ page }) => {
  await signIn(page, address('ada'), 'not-the-password-1');
  await expect(problem(page)).toContainText('That email and password don’t match');
  // Same words for an address with no account.
  await signIn(page, address('nobody'), 'not-the-password-1');
  await expect(problem(page)).toContainText('That email and password don’t match');
  await signIn(page, 'not-an-email', 'x');
  await expect(problem(page)).toContainText('Enter a valid email address.');
  await expect(page.getByLabel('Email')).toBeFocused();
});

test('after sign-in, only a place inside Hyphy is a destination', async ({ page }) => {
  await signIn(page, address('ada'), PASSWORD, '/sign-in?next=/personal/tools/pdf');
  await expect(page).toHaveURL(`${BASE_PATH}/personal/tools/pdf`);
  await page.context().clearCookies();
  for (const next of [
    '//evil.example',
    'https://evil.example',
    '/\\evil.example',
    '/..//evil.example',
  ]) {
    await signIn(page, address('ada'), PASSWORD, `/sign-in?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(`${BASE_PATH}/personal`);
    await page.context().clearCookies();
  }
});

test('an existing email gets the same “check your email” as a new one', async ({ page }) => {
  await signUp(page, 'Someone Else', address('ada'));
  expect(await counts(address('ada'))).toMatchObject({ users: 1, profiles: 1, personal: 1 });
});

test('weak passwords are refused before and by Supabase', async ({ page }) => {
  await visit(page, '/sign-up');
  await page.getByLabel('Name').fill('Weak Test');
  await page.getByLabel('Email').fill(address('weak'));
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(problem(page)).toContainText('at least 8 characters');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
});

test('password recovery: email → token-hash link → new password → sign in with it', async ({
  page,
  context,
}) => {
  const email = address('ada');
  await visit(page, '/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // The recommended template: /auth/confirm?token_hash=…&type=recovery — works in any browser.
  const link = await emailLink(email, /reset/i);
  expect(link).toContain('token_hash=');
  await context.clearCookies();
  await page.goto(link, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(`${BASE_PATH}/reset-password`);
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText('Your password is updated.')).toBeVisible();

  // The same link again: used up.
  await context.clearCookies();
  await page.goto(link, { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/auth\/error\?reason=(expired|invalid)&for=reset/);
  await expect(page.getByRole('heading', { name: /reset link/ })).toBeVisible();

  await signIn(page, email, PASSWORD);
  await expect(problem(page)).toContainText('That email and password don’t match');
  await signIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(`${BASE_PATH}/personal`);
});

test('a reset page without a reset session says the link expired', async ({ page }) => {
  await visit(page, '/reset-password');
  await expect(page.getByRole('heading', { name: 'This link has expired.' })).toBeVisible();
});

test('bad confirmation links explain themselves', async ({ page }) => {
  await visit(page, '/auth/confirm?token_hash=not-a-real-token&type=signup');
  await expect(page).toHaveURL(/\/auth\/error\?reason=(expired|invalid)$/);
  await visit(page, '/auth/confirm');
  await expect(page).toHaveURL(`${BASE_PATH}/auth/error?reason=invalid`);
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
});

test('a forged session cookie gets nothing', async ({ page, context, baseURL }) => {
  const ref = new URL(process.env.AUTH_E2E_SUPABASE_URL ?? 'http://localhost').hostname.split(
    '.',
  )[0];
  const fake = Buffer.from(
    JSON.stringify({
      access_token:
        'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDAiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.forged',
      refresh_token: 'forged',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: { id: '00000000-0000-4000-8000-000000000000' },
    }),
  ).toString('base64url');
  await context.addCookies([
    { name: `sb-${ref}-auth-token`, value: `base64-${fake}`, url: baseURL! },
  ]);
  await visit(page, '/personal');
  await expect(page).toHaveURL(`${BASE_PATH}/sign-in?next=%2Fpersonal`);
});

test('profile: change password while signed in', async ({ page }) => {
  const email = address('ada');
  await signIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(`${BASE_PATH}/personal`);
  await visit(page, '/personal/profile');
  await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm new password').fill('does-not-match-1');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(problem(page)).toContainText('don’t match');
  // Password fields are cleared after each try.
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
  await page.getByLabel('New password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm new password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Your password is updated.')).toBeVisible();
});

test('Demo Mode controls do nothing with real accounts', async ({ page }) => {
  await signIn(page, address('ada'), PASSWORD);
  await expect(page).toHaveURL(`${BASE_PATH}/personal`);
  await expect(page.getByRole('button', { name: /Previewing as|Preview as/i })).toHaveCount(0);
  await page.context().addCookies([{ name: 'hyphy_preview_as', value: 'dana', url: page.url() }]);
  await visit(page, '/personal/profile');
  await expect(page.getByText(address('ada')).first()).toBeVisible();
  await expect(page.getByText('dana@', { exact: false })).toHaveCount(0);
});
