import { expect, test, type Page } from '@playwright/test';
import { BASE_PATH } from '../src/lib/base-path';

/*
 * Browsing the marketplace the way people do: scan, search, filter, open a few tools, come back.
 * Runs against the production build (`npm run start`), so prefetching and bundles are real.
 */

async function visit(page: Page, path: string) {
  await page.goto(`${BASE_PATH}${path}`, { waitUntil: 'networkidle' });
}

/** Page data requests (Next.js RSC fetches) for tool pages. */
function watchToolFetches(page: Page) {
  const seen: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('_rsc=') && /\/tools\/[a-z-]+\?/.test(url)) seen.push(url);
  });
  return seen;
}

/** Script bytes this page has downloaded (decoded), from the browser's own timing entries. */
async function scriptBytes(page: Page) {
  return page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === 'script')
      .reduce((sum, entry) => sum + (entry as PerformanceResourceTiming).decodedBodySize, 0),
  );
}

test('the marketplace scans fast: featured, everyday, then every tool as a row', async ({
  page,
}) => {
  await visit(page, '/tools');
  await expect(page.getByRole('heading', { level: 2, name: 'Everyday' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'All tools' })).toBeVisible();
  for (const shelf of ['Get together', 'Money', 'Links & QR', 'Images', 'Files & PDF'])
    await expect(page.getByRole('group', { name: shelf })).toBeVisible();
  // No counts or staff-pick language on the way in.
  await expect(page.getByText(/run on your device|Staff pick|No sign-up/)).toHaveCount(0);
});

test('scrolling the marketplace doesn’t download every tool', async ({ page }) => {
  await visit(page, '/tools');
  const fetched = watchToolFetches(page);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  });
  await page.waitForTimeout(800);
  expect(fetched).toEqual([]);
});

test('the marketplace ships no tool engines', async ({ page }) => {
  const heavy: string[] = [];
  page.on('request', (request) => {
    if (/vendor\/ocr|pdf\.worker|tesseract/.test(request.url())) heavy.push(request.url());
  });
  await visit(page, '/tools');
  expect(heavy).toEqual([]);
  // react, Next.js, search and the page itself; a PDF or OCR library would blow well past this.
  expect(await scriptBytes(page)).toBeLessThan(800_000);
});

test('open several tools in a row, and back always lands on the marketplace', async ({ page }) => {
  await visit(page, '/tools');
  for (const [name, heading] of [
    ['QR Studio', 'QR Studio'],
    ['PDF', 'PDF'],
    ['Social Crop', 'Social Crop'],
  ]) {
    await page
      .getByRole('group', { name: /Links & QR|Files & PDF|Images/ })
      .getByRole('link', { name: new RegExp(`^${name}`) })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.locator('#tool [aria-busy="true"]')).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/tools$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tools' })).toBeVisible();
  }
  // Tool to tool, then back through both.
  await page
    .getByRole('link', { name: /^Split a check/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Split' })).toBeVisible();
  // “Open next” on Split.
  await page
    .getByRole('link', { name: /^When\?/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'When?' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Split' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Tools' })).toBeVisible();
});

test('a category is a filter with an address, and back undoes nothing unexpected', async ({
  page,
}) => {
  await visit(page, '/tools');
  const bar = page.getByRole('toolbar', { name: /Filter tools/ });
  await bar.getByRole('button', { name: 'Images' }).click();
  await expect(page).toHaveURL(/\?c=images$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Images' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Palette/ }).first()).toBeVisible();
  await bar.getByRole('button', { name: 'All' }).click();
  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Everyday' })).toBeVisible();
});

test('a tool page opens straight into the tool, with privacy one tap away', async ({ page }) => {
  await visit(page, '/tools/resize');
  await expect(page.getByText('Processed on your device').first()).toBeVisible();
  await page.getByRole('button', { name: 'Processed on your device' }).click();
  await expect(page.locator('#privacy-details')).toBeVisible();
  await expect(page.locator('#privacy-details')).toContainText('never uploaded');
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.locator('#privacy-details')).toBeHidden();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the first screen shows search and a featured tool; the tool starts on screen one', async ({
    page,
  }) => {
    await visit(page, '/tools');
    const search = await page.getByRole('combobox').first().boundingBox();
    expect(search!.y + search!.height).toBeLessThan(844);
    await page
      .getByRole('link', { name: /^Split a check/ })
      .first()
      .tap();
    await expect(page.getByRole('heading', { level: 1, name: 'Split' })).toBeVisible();
    const camera = await page.getByText('Take a photo', { exact: true }).boundingBox();
    // The camera button is on the first screen, no scrolling.
    expect(camera!.y + camera!.height).toBeLessThan(844);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Tools' })).toBeVisible();
  });

  test('a phone screen of the index shows many tools at once', async ({ page }) => {
    await visit(page, '/tools');
    await page.getByRole('heading', { level: 2, name: 'All tools' }).scrollIntoViewIfNeeded();
    await page.evaluate(() =>
      window.scrollTo(
        0,
        document.getElementById('all-title')!.getBoundingClientRect().top + window.scrollY - 80,
      ),
    );
    const visible = await page.evaluate(
      () =>
        [...document.querySelectorAll('#all a')].filter((link) => {
          const box = link.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= window.innerHeight;
        }).length,
    );
    expect(visible).toBeGreaterThanOrEqual(8);
  });

  test('the filter chips scroll sideways without scrolling the page', async ({ page }) => {
    await visit(page, '/tools');
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await page
      .getByRole('toolbar', { name: /Filter tools/ })
      .getByRole('button', { name: 'Money' })
      .tap();
    await expect(page).toHaveURL(/\?c=money$/);
  });
});
