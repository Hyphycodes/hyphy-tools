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
  await expect(page.getByRole('heading', { level: 1, name: 'What do you want to do?' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Demo Mode' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Spaces/ })).toHaveCount(0);
});

test('search understands what people mean', async ({ page }) => {
  await visit(page, '/tools');
  const box = page.getByRole('combobox', { name: 'What do you need to do?' });
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
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    // The details are in the drawer, one tap away, not in front of the tool.
    await expect(page.getByRole('heading', { name: 'Where your data goes' })).toBeHidden();
    if (tool.status !== 'soon') {
      await page.locator('button[popovertarget="tool-info"]').first().click();
      await expect(page.getByRole('heading', { name: 'Where your data goes' })).toBeVisible();
    }
  }
  await visit(page, '/tools/not-a-tool');
  await expect(page.getByRole('heading', { name: /no tool at this address/ })).toBeVisible();
});

test('Spaces are still there, just not in the public world', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'hyphy_preview_as', value: 'jerry', url: baseURL! }]);
  await visit(page, '/spaces');
  await expect(page).toHaveURL(/\/platform\/(hyphy|personal)$/);
});

/** A bill in Split, typed in: the way that works without a camera. */
async function typeBill(page: Page) {
  await visit(page, '/tools/split');
  await page.getByRole('button', { name: 'Type it in instead' }).click();
  await expect(page).toHaveURL(/\?step=receipt$/);
  await page.getByLabel('New item', { exact: true }).fill('Pizza');
  await page.getByLabel('New item’s price').fill('20');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('New item', { exact: true }).fill('Salad');
  await page.getByLabel('New item’s price').fill('10');
  await page.getByLabel('New item’s price').press('Enter');
  await page.getByRole('button', { name: /Who’s splitting/ }).click();
  await page.getByLabel('Person 1’s name').fill('Ana');
  await page.getByLabel('Add a name').fill('Ben');
  await page.getByLabel('Add a name').press('Enter');
  await page.getByRole('button', { name: /Who had what/ }).click();
  await page
    .getByRole('group', { name: 'Who had Salad' })
    .getByRole('button', { name: 'Ben' })
    .click();
  await page.getByRole('button', { name: /Tax and tip/ }).click();
  await page.getByRole('button', { name: '20%' }).click();
  await page.getByRole('button', { name: /See the split/ }).click();
}

test('Split, typed in: a shared plate, tax and tip, and a link with everyone’s total', async ({
  page,
  browser,
}) => {
  await typeBill(page);
  const totals = page.getByRole('region', { name: 'Totals' });
  await expect(totals).toContainText('$36.00');
  await expect(totals.getByRole('button', { name: /Ana/ })).toContainText('$12.00');
  await expect(totals.getByRole('button', { name: /Ben/ })).toContainText('$24.00');
  // How it was worked out is one tap away.
  await totals.getByRole('button', { name: /Ben/ }).click();
  await expect(totals).toContainText('Salad');

  await page.getByRole('button', { name: 'More ways to share' }).click();
  await page.getByRole('button', { name: 'Share the bill as a link' }).click();
  const link = await page.locator('span.mono-num').filter({ hasText: '#' }).first().textContent();
  expect(link).toContain('/platform/tools/split#');
  const other = await browser.newPage();
  await other.goto(link!, { waitUntil: 'networkidle' });
  await expect(other.getByText('A bill someone shared with you')).toBeVisible();
  await expect(
    other.getByRole('region', { name: 'Totals' }).getByRole('button', { name: /Ben/ }),
  ).toContainText('$24.00');
  await other.close();
});

test('Split steps are pages: back steps back, a reload keeps the bill', async ({ page }) => {
  await typeBill(page);
  await expect(page).toHaveURL(/\?step=done$/);
  await page.goBack();
  await expect(page).toHaveURL(/\?step=tip$/);
  await expect(page.getByRole('heading', { name: 'Tax and tip' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Who had what?' })).toBeVisible();
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Who had what?' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Who had Pizza' })).toBeVisible();
});

test('Split reads a receipt photo on the device, and every value can be fixed', async ({
  page,
}) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname))
      outside.push(request.url());
    // The photo is never sent anywhere: only the reader's own files are fetched.
    if (request.method() === 'POST') outside.push(`POST ${request.url()}`);
  });
  await visit(page, '/tools/split');
  await page.getByLabel('Upload a photo').setInputFiles('tests/fixtures/receipt.jpg');
  await expect(page.getByRole('heading', { name: 'Check the receipt' })).toBeVisible({
    timeout: 60_000,
  });
  const items = page.getByRole('list', { name: 'Items' });
  await expect(items.getByRole('listitem')).toHaveCount(5);
  await expect(page.getByLabel('Item 2', { exact: true })).toHaveValue('Burger');
  await expect(page.getByLabel('Item 2’s price')).toHaveValue('22.50');
  await expect(page.getByLabel('Where was this?')).toHaveValue(/Rosa.s Kitchen/);
  await expect(page.getByLabel('Tax', { exact: true })).toHaveValue('5.69');
  // Fix a line and remove one: it's the person's call, not the reader's.
  await page.getByLabel('Item 3’s price').fill('10');
  await page.getByRole('button', { name: 'Remove Lemonade' }).click();
  await expect(items.getByRole('listitem')).toHaveCount(4);
  await page.getByRole('button', { name: /Who’s splitting/ }).click();
  await page.getByLabel('Add a name').fill('Ana');
  await page.getByLabel('Add a name').press('Enter');
  await page.getByRole('button', { name: /Who had what/ }).click();
  await page.getByRole('button', { name: /Tax and tip/ }).click();
  await page.getByRole('button', { name: 'No tip' }).click();
  await page.getByRole('button', { name: /See the split/ }).click();
  // 14 + 22.50 + 10 + 11.50 = 58.00, plus 5.69 tax, between two.
  await expect(page.getByRole('region', { name: 'Totals' })).toContainText('$63.69');
  expect(outside).toEqual([]);
});

test('Split evenly is a shortcut, not a detour', async ({ page }) => {
  await visit(page, '/tools/split');
  await page.getByRole('button', { name: 'Split evenly instead' }).click();
  await page.getByLabel('Bill total').fill('90');
  await page.getByRole('button', { name: 'One more person' }).click();
  await expect(page.getByText('Each person pays')).toBeVisible();
  await expect(page.locator('[aria-live="polite"]').filter({ hasText: '$' })).toHaveText('$30.00');
});

test('QR Studio draws as you type and hands over a PNG', async ({ page }) => {
  await visit(page, '/tools/qr');
  await page.getByRole('radio', { name: /^Link/ }).click();
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
  await page.getByRole('button', { name: 'Next: add your links' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Rosa Delgado');
  await page.getByLabel('Link 1 address').fill('saltandember.example/book');
  await page.getByLabel('Link 1 name').fill('Book a table');
  await page.getByRole('button', { name: 'Next: share your page' }).click();
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
