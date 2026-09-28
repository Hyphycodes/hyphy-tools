import { expect, test, type Page } from '@playwright/test';
import { BASE_PATH } from '../src/lib/base-path';
import { listedTools } from '../src/lib/catalog';

/*
 * The public Tools world, end to end: the front door, search, filters, every tool page, and the
 * tools that share through their own links. No sign-in anywhere.
 */

async function visit(page: Page, path: string) {
  await page.goto(`${BASE_PATH}${path}`, { waitUntil: 'networkidle' });
}

async function noHorizontalScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(width);
}

test('the front door is the marketplace, not a dashboard', async ({ page }) => {
  await visit(page, '');
  await expect(page).toHaveURL(/\/platform\/tools$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Tools' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Demo Mode' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Spaces/ })).toHaveCount(0);
});

test('search understands what people mean', async ({ page }) => {
  await visit(page, '/tools');
  const box = page.getByRole('combobox', { name: 'What are you trying to do?' });
  await box.fill('linktree');
  await expect(page.getByRole('option').first()).toContainText('Signal Pages');
  await expect(page.getByRole('option').first()).toContainText('linktree');
  await box.fill('split dinner');
  await expect(page.getByRole('option').first()).toContainText('Split');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/tools\/split$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Split' })).toBeVisible();
});

test('⌘K searches from any tool page', async ({ page }) => {
  await visit(page, '/tools/qr');
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog', { name: 'Search tools' })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole('dialog').getByRole('combobox').fill('rename files');
  await expect(page.getByRole('dialog').getByRole('option').first()).toContainText('Clean');
});

test('filters narrow the marketplace, and the address remembers', async ({ page }) => {
  await visit(page, '/tools');
  await page
    .getByRole('toolbar', { name: /Filter tools/ })
    .getByRole('button', { name: /Money/ })
    .click();
  await expect(page).toHaveURL(/\?c=money$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Money' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Subscriptions/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Show everything' }).click();
  await expect(page).toHaveURL(/\/tools$/);
  // A shared filtered address opens filtered.
  await visit(page, '/tools?c=drops');
  await expect(page.getByRole('heading', { level: 2, name: 'Drops' })).toBeVisible();
});

test('every tool has a page with its name, its privacy and a way back', async ({ page }) => {
  for (const tool of listedTools) {
    await visit(page, `/tools/${tool.slug}`);
    await expect(page.getByRole('heading', { level: 1 }), tool.id).toHaveText(tool.name);
    await expect(page.getByRole('heading', { name: 'Where your data goes' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
  }
  await visit(page, '/tools/not-a-tool');
  await expect(page.getByRole('heading', { name: /no tool at this address/ })).toBeVisible();
});

test('Spaces are still there, just not in the public world', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'hyphy_preview_as', value: 'jerry', url: baseURL! }]);
  await visit(page, '/spaces');
  await expect(page).toHaveURL(/\/platform\/(hyphy|personal)$/);
});

test('Split: a shared plate, tax and tip, and a link that shows everyone’s total', async ({
  page,
  browser,
}) => {
  await visit(page, '/tools/split');
  await page.getByLabel('Person 1’s name').fill('Ana');
  await page.getByLabel('Person 2’s name').fill('Ben');
  await page.getByLabel('New item', { exact: true }).fill('Pizza');
  await page.getByLabel('New item’s price').fill('20');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('New item', { exact: true }).fill('Salad');
  await page.getByLabel('New item’s price').fill('10');
  await page.getByLabel('New item’s price').press('Enter');
  await page
    .getByRole('group', { name: 'Who had Salad' })
    .getByRole('button', { name: 'Ben' })
    .click();
  await page.getByRole('button', { name: '20%' }).click();
  const totals = page.getByRole('complementary', { name: 'Totals' });
  await expect(totals).toContainText('$36.00');
  await expect(totals.getByRole('button', { name: /Ana/ })).toContainText('$12.00');
  await expect(totals.getByRole('button', { name: /Ben/ })).toContainText('$24.00');

  await page.getByRole('button', { name: 'Share the bill as a link' }).click();
  const link = await totals.locator('span.mono-num').filter({ hasText: '#' }).first().textContent();
  expect(link).toContain('/platform/tools/split#');
  const other = await browser.newPage();
  await other.goto(link!, { waitUntil: 'networkidle' });
  await expect(other.getByText('A bill someone shared with you')).toBeVisible();
  await expect(
    other.getByRole('complementary', { name: 'Totals' }).getByRole('button', { name: /Ben/ }),
  ).toContainText('$24.00');
  await other.close();
});

test('QR Studio draws as you type and hands over a PNG', async ({ page }) => {
  await visit(page, '/tools/qr');
  await page.getByLabel('Link or text').fill('saltandember.example/menu');
  await expect(page.getByRole('img', { name: /QR code for https:\/\/saltandember/ })).toBeVisible();
  const [png] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'PNG' }).click(),
  ]);
  expect(png.suggestedFilename()).toMatch(/^qr-.*\.png$/);
});

test('a Signal Page is published as its own link', async ({ page, browser }) => {
  await visit(page, '/tools/signal-pages');
  await page.getByLabel('Name', { exact: true }).fill('Rosa Delgado');
  await page.getByLabel('Link 1 name').fill('Book a table');
  await page.getByLabel('Link 1 address').fill('saltandember.example/book');
  await page.getByRole('button', { name: /Get your page’s link/ }).click();
  const link = await page
    .locator('span.mono-num')
    .filter({ hasText: '/platform/p#' })
    .first()
    .textContent();
  const visitor = await browser.newPage();
  await visitor.goto(link!, { waitUntil: 'networkidle' });
  await expect(visitor.getByRole('heading', { level: 1, name: 'Rosa Delgado' })).toBeVisible();
  await expect(visitor.getByRole('link', { name: /Book a table/ })).toHaveAttribute(
    'href',
    'https://saltandember.example/book',
  );
  await visitor.close();
});

test.describe('phones', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const path of ['/tools', '/tools/split', '/tools/qr', '/tools/pdf', '/tools/when']) {
    test(`${path} fits the screen`, async ({ page }) => {
      await visit(page, path);
      await noHorizontalScroll(page);
    });
  }
});
