import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import postgres from 'postgres';
import { BASE_PATH } from '../src/lib/base-path';
import { demoUuid } from '../src/lib/data/supabase/rows';
import { applyWorld } from '../src/lib/data/supabase/world';

/*
 * Business customization (Phase 2C), end to end through Demo Mode: Dana sets ABC Construction up
 * as the owner, then the same browser previews as Mike and meets the forms her setup produced.
 * Runs on either backend, like tests/app.spec.ts.
 */
const onDatabase = process.env.HYPHY_DATA === 'supabase';
const id = (key: string) => (onDatabase ? demoUuid(key) : key);

async function as(context: BrowserContext, person: string, baseURL: string) {
  await context.addCookies([{ name: 'hyphy_preview_as', value: person, url: baseURL }]);
}

async function visit(page: Page, path: string) {
  await page.goto(`${BASE_PATH}${path}`, { waitUntil: 'networkidle' });
}

async function reset(page: Page) {
  await page
    .getByRole('button', { name: /Reset demo/ })
    .filter({ visible: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Reset demo', exact: true }).filter({ visible: true }),
  ).toBeVisible();
}

/** Picks one answer of a rule ("A project on every receipt" → Required). */
async function rule(page: Page, name: string, answer: string) {
  await page.getByRole('group', { name }).getByText(answer, { exact: true }).click();
}

async function toast(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible();
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.clearCookies();
  if (onDatabase) {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    await applyWorld(sql);
    await sql.end();
  }
  await as(context, 'dana', baseURL!);
});

test('Dana requires a Cost Code, a job and a truck; Mike’s form asks for them; Dana approves', async ({
  page,
  context,
  baseURL,
}) => {
  // Dana: Settings → Receipts.
  await visit(page, '/abc-construction/settings');
  await page
    .getByRole('article', { name: 'Receipts' })
    .getByRole('link', { name: /Customize/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Receipts', level: 1 })).toBeVisible();

  // Extra receipt information → Add field: Cost Code, a dropdown with three choices, required.
  const extra = page.getByRole('region', { name: 'Extra receipt information' });
  await extra.getByRole('button', { name: 'Add field' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a receipt field' });
  await sheet.getByLabel('What should employees enter?').fill('Cost Code');
  await sheet.getByRole('radio', { name: /Dropdown/ }).click();
  const choice = (n: number) => sheet.getByRole('textbox', { name: `Choice ${n}` });
  await choice(1).fill('100 — General');
  await choice(1).press('Enter');
  await choice(2).fill('200 — Materials');
  await choice(2).press('Enter');
  await choice(3).fill('300 — Equipment');
  await sheet.getByText('Required', { exact: true }).click();
  await sheet.getByRole('button', { name: 'Add field' }).click();
  await expect(sheet).toBeHidden();
  await expect(extra.locator('[data-field-row="Cost Code"]')).toContainText('Required');

  // Every receipt names a job and a truck.
  await rule(page, 'A project on every receipt', 'Required');
  await rule(page, 'A vehicle on every receipt', 'Required');
  // The preview shows what Mike will be asked, before saving.
  const preview = page.getByRole('region', { name: 'Employee preview' });
  for (const label of ['Project', 'Vehicle', 'Cost Code'])
    await expect(preview.locator(`[data-preview-field="${label}"]`)).toContainText('*');
  await page.getByRole('button', { name: 'Save receipt rules' }).click();
  await toast(page, 'Receipt rules saved');

  // Mike: Submit receipt. The form simply asks what ABC needs.
  await as(context, 'mike', baseURL!);
  await visit(page, '/abc-construction/tools/receipts');
  await page.getByRole('button', { name: 'Submit receipt' }).first().click();
  const form = page.getByRole('dialog').filter({ has: page.getByLabel('Where') });
  await expect(form.getByLabel('Cost Code')).toBeVisible();
  // Required ones carry no "Optional"; Hyphy's own note field still does.
  for (const label of ['Project', 'Vehicle', 'Cost Code'])
    await expect(form.getByText(label, { exact: true }).locator('..')).not.toContainText(
      'Optional',
    );
  await form.getByLabel('Where').fill('Menards');
  await form.getByLabel('Total').fill('184.20');
  await form.getByLabel('Project').selectOption({ label: 'Oak Brook Remodel' });
  await form.getByLabel('Vehicle').selectOption({ label: 'Truck 24 (yours)' });
  // Sending without the Cost Code is stopped, in plain words.
  await form.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(form.getByRole('alert')).toContainText('Cost Code is required.');
  await form.getByLabel('Cost Code').selectOption('200 — Materials');
  await form.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(form).toBeHidden();

  // Dana: the Inbox shows the Cost Code with the receipt; she approves it.
  await as(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/inbox?view=approvals');
  const item = page.getByRole('listitem').filter({ hasText: 'Menards' });
  await expect(item).toContainText('Cost Code: 200 — Materials');
  await item.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Menards' })).toHaveCount(0);

  // The receipt, approved, with its Cost Code — and on Oak Brook Remodel's costs.
  await visit(page, `/abc-construction/projects/${id('prj_oakbrook')}?tab=costs`);
  await page
    .getByRole('link', { name: /Menards/ })
    .first()
    .click();
  const detail = page.getByRole('dialog', { name: 'Menards' });
  await expect(detail.getByText('Cost Code')).toBeVisible();
  await expect(detail.getByText('200 — Materials')).toBeVisible();
  await expect(detail.getByText('Approved by Dana').first()).toBeVisible();
  // Setup changes are on record, once each.
  await visit(page, '/abc-construction/settings');
  const recent = page.getByRole('region', { name: 'Recent setup changes' });
  await expect(recent).toContainText('added required receipt field “Cost Code”');
  await expect(recent).toContainText('changed the receipt rules');
  await reset(page);
});

test('Dana changes the mileage rate and requires a purpose; Mike’s trip follows both', async ({
  page,
  context,
  baseURL,
}) => {
  await visit(page, '/abc-construction/settings/mileage');
  await page.getByLabel('What you pay back per mile').fill('0.67');
  await rule(page, 'What the trip was for', 'Required');
  await page.getByRole('button', { name: 'Save mileage rules' }).click();
  await toast(page, 'Mileage rules saved');

  await as(context, 'mike', baseURL!);
  await visit(page, '/abc-construction/tools/mileage');
  await page
    .getByRole('button', { name: /Log a trip/ })
    .first()
    .click();
  const form = page.getByRole('dialog').filter({ has: page.getByLabel('Purpose') });
  await form.getByLabel('Miles one way').fill('12');
  await form.getByLabel('To', { exact: true }).fill('Menards, Villa Park');
  await form.getByLabel('Vehicle').selectOption({ label: 'Personal vehicle' });
  // The business's own rate, not a tax table's.
  await expect(form.locator('[data-mileage-payback]')).toHaveText('$8.04 back at $0.67 a mile');
  await form.getByRole('button', { name: 'Submit trip' }).click();
  await expect(form.getByRole('alert')).toHaveText(/Add what the trip was for/);
  await form.getByLabel('Purpose').fill('Cabinet hardware');
  await form.getByRole('button', { name: 'Submit trip' }).click();
  await expect(form).toBeHidden();

  // Dana's view pays it back at the rate she set.
  await as(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/tools/mileage');
  await page
    .getByRole('link', { name: /Menards/ })
    .first()
    .click();
  await expect(page.getByRole('dialog').getByText('$8.04 paid back at $0.67/mi')).toBeVisible();
  // A trip logged before the change keeps the rate it was logged at.
  await visit(page, `/abc-construction/tools/mileage?trip=${id('mi_abc_07')}`);
  await expect(page.getByRole('dialog').getByText('$5.04 paid back at $0.70/mi')).toBeVisible();
  await visit(page, '/abc-construction');
  await reset(page);
});

test('switching Link Pages off hides it from the team; switching it on brings the page back', async ({
  page,
  context,
  baseURL,
}) => {
  // Dana turns Link Pages on and makes ABC's page (it starts from the business's own name).
  await visit(page, '/abc-construction/settings');
  await page.getByRole('switch', { name: /Link Pages off/ }).click();
  await expect(page.getByRole('switch', { name: /Link Pages on/ })).toBeVisible();
  await visit(page, '/abc-construction/tools/links');
  await expect(page.getByText('ABC Construction').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save link page' }).click();
  await toast(page, '@abcconstruction saved');

  // Mike sees it while it's on.
  await as(context, 'mike', baseURL!);
  await visit(page, '/abc-construction');
  const nav = page.getByRole('complementary', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Link Pages' })).toBeVisible();

  // Off: gone from Mike's menu, Create menu and Tools library.
  await as(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/settings');
  await page.getByRole('switch', { name: /Link Pages on/ }).click();
  await expect(page.getByRole('switch', { name: /Link Pages off/ })).toBeVisible();
  await as(context, 'mike', baseURL!);
  await visit(page, '/abc-construction/tools');
  await expect(nav.getByRole('link', { name: 'Link Pages' })).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Link Pages')).toHaveCount(0);
  await visit(page, '/abc-construction/tools/links');
  await expect(page.getByText(/Not available to you here/)).toBeVisible();

  // On again: the saved page is still there.
  await as(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/settings');
  await page.getByRole('switch', { name: /Link Pages off/ }).click();
  await expect(page.getByRole('switch', { name: /Link Pages on/ })).toBeVisible();
  await visit(page, '/abc-construction/tools/links');
  await expect(page.getByRole('region', { name: 'QR code for this page' })).toBeVisible();
  await reset(page);
});

test('changing the kind of business asks first, and never takes anything away', async ({
  page,
}) => {
  await visit(page, '/abc-construction/settings/basics');
  // Keep my current setup: the kind changes, nothing else does.
  await page.getByLabel('Kind of business').selectOption({ label: 'Real Estate' });
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const ask = page.getByRole('dialog', { name: 'Update recommended setup?' });
  await expect(ask).toContainText('MLS Number');
  await expect(ask).toContainText('Properties');
  await ask.getByRole('button', { name: 'Keep my current setup' }).click();
  await toast(page, /Your setup stayed as it was/);
  await visit(page, '/abc-construction/projects');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();

  // Apply recommended additions: new words and fields; the old fields and every record stay.
  await visit(page, '/abc-construction/settings/basics');
  await page.getByLabel('Kind of business').selectOption({ label: 'Professional Services' });
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Update recommended setup?' })
    .getByRole('button', { name: 'Apply recommended additions' })
    .click();
  await toast(page, /Updated/);
  await visit(page, '/abc-construction/settings/work');
  const fields = page.getByRole('region', { name: /What else each engagement keeps/ });
  for (const label of ['Permit #', 'Next inspection', 'Job type', 'Reference #'])
    await expect(fields.locator(`[data-field-row="${label}"]`)).toBeVisible();
  await visit(page, `/abc-construction/projects/${id('prj_oakbrook')}`);
  await expect(page.getByRole('heading', { name: 'Oak Brook Remodel' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('BP-26-0412');
  await expect(page.getByRole('link', { name: 'Engagements' }).first()).toBeVisible();

  // Reset puts ABC's own setup back.
  await reset(page);
  await visit(page, '/abc-construction/settings/basics');
  await expect(page.getByLabel('Kind of business')).toHaveValue('construction');
  await visit(page, '/abc-construction/projects');
  await expect(page.getByRole('heading', { name: 'Projects', level: 1 })).toBeVisible();
});

test('a field that stops being used keeps its answers; new jobs no longer ask', async ({
  page,
}) => {
  await visit(page, '/abc-construction/settings/work');
  const fields = page.getByRole('region', { name: /What else each project keeps/ });
  await fields.getByRole('button', { name: 'Edit Permit #' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit Permit #' });
  // Records already use it, so its kind is fixed.
  await expect(sheet.getByText(/already used, so it stays this kind/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Stop using this field' }).click();
  await sheet.getByRole('button', { name: 'Stop using it' }).click();
  await expect(sheet).toBeHidden();
  await expect(fields.locator('[data-field-row="Permit #"]')).toHaveCount(0);
  await expect(fields.getByRole('button', { name: /No longer asked \(1\)/ })).toBeVisible();

  // The job keeps its permit number...
  await visit(page, `/abc-construction/projects/${id('prj_oakbrook')}`);
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('Permit #');
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('BP-26-0412');
  // ...and a new one isn't asked for it.
  await page
    .getByRole('button', { name: /^Create/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: /Create project/ }).click();
  const create = page.getByRole('dialog').filter({ has: page.getByLabel('Name') });
  await expect(create.getByLabel('Job type')).toBeVisible();
  await expect(create.getByLabel('Permit #')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await reset(page);
});

test('owners and admins set the business up; everyone else uses it', async ({
  page,
  context,
  baseURL,
}) => {
  for (const person of ['ray', 'mike', 'chris']) {
    await as(context, person, baseURL!);
    for (const path of ['/abc-construction/settings', '/abc-construction/settings/receipts']) {
      await visit(page, path);
      await expect(page.getByText(/Not available to you here/), `${person} ${path}`).toBeVisible();
    }
  }
  await as(context, 'luis', baseURL!);
  await visit(page, '/abc-construction/settings/receipts');
  await expect(page.getByRole('heading', { name: 'Receipts', level: 1 })).toBeVisible();
});

test.describe('phones', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('Mike’s receipt form with Dana’s fields fits a phone', async ({
    page,
    context,
    baseURL,
  }) => {
    await visit(page, '/abc-construction/settings/receipts');
    await page
      .getByRole('region', { name: 'Extra receipt information' })
      .getByRole('button', { name: 'Add field' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Add a receipt field' });
    await sheet.getByLabel('What should employees enter?').fill('Reimbursable?');
    await sheet.getByRole('radio', { name: /Yes \/ No/ }).click();
    await sheet.getByRole('button', { name: 'Add field' }).click();
    await expect(sheet).toBeHidden();
    const [scroll, width] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(scroll).toBeLessThanOrEqual(width);

    await as(context, 'mike', baseURL!);
    await visit(page, '/abc-construction/tools/receipts');
    await page.getByRole('button', { name: 'Submit receipt' }).first().click();
    const form = page.getByRole('dialog').filter({ has: page.getByLabel('Where') });
    await expect(form.getByText('Reimbursable?')).toBeVisible();
    await expect(form.getByText('Yes', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await reset(page);
  });
});
