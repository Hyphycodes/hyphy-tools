import { expect, test, type Page } from '@playwright/test';
import { BASE_PATH } from '../src/lib/base-path';

/*
 * The home above the tools: one-tap modes, a toolbox that becomes someone's own (pins, recent,
 * regulars, open work), search by intent, the "+", and All tools always one tap away. Everything
 * personal is kept in the browser; each test starts from an empty one.
 */

async function visit(page: Page, path: string) {
  await page.goto(`${BASE_PATH}${path}`, { waitUntil: 'networkidle' });
}

async function pickMode(page: Page, name: RegExp) {
  await visit(page, '/tools');
  await page.getByRole('list', { name: 'Modes' }).getByRole('button', { name }).click();
}

const shelf = (page: Page) => page.getByRole('list', { name: /Your tools|Start with these/ });
/** The tools on the shelf, in order. */
const onShelf = (page: Page) =>
  shelf(page)
    .locator('[data-tool]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('data-tool')));

test('one tap picks a mode, switching changes the whole home, and it’s remembered', async ({
  page,
}) => {
  await pickMode(page, /^Everyday/);
  await expect(page.getByRole('heading', { level: 1, name: 'What’s the plan?' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-lens', 'everyday');
  // New here: the home isn't empty, it starts with the mode's own tools and situations.
  await expect(shelf(page).getByRole('link', { name: /^Split/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dinner with people' })).toBeVisible();
  // Everyday isn't a wall of business tools.
  await expect(shelf(page).getByRole('link', { name: /^Receipts/ })).toHaveCount(0);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { level: 1, name: 'What’s the plan?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What are you here for?' })).toHaveCount(0);

  const modes = page.getByRole('radiogroup', { name: 'Mode' });
  await modes.getByRole('radio', { name: 'Work' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Let’s get it done.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Working today' })).toBeVisible();
  await expect(shelf(page).getByRole('link', { name: /^Receipts/ })).toBeVisible();
  await modes.getByRole('radio', { name: 'Create' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Let’s make something.' }),
  ).toBeVisible();
  await expect(shelf(page).getByRole('link', { name: /^Social Crop/ })).toBeVisible();
  // Every mode has a way to everything.
  await page
    .getByRole('link', { name: /^All tools/ })
    .last()
    .click();
  await expect(page).toHaveURL(/\/tools\/all$/);
  await expect(page.getByRole('heading', { level: 1, name: 'All tools' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Mileage/ }).first()).toBeVisible();
});

test('Person A: pinned tools lead, the ones they open show up with the day', async ({ page }) => {
  await pickMode(page, /^Everyday/);
  for (const slug of ['split', 'where', 'pdf']) {
    await visit(page, `/tools/${slug}`);
    const keep = page.getByRole('button', { name: /^Keep .* handy$/ });
    await keep.click();
    await expect(page.getByRole('button', { name: /off your tools$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  }
  await visit(page, '/tools/resize');
  await visit(page, '/tools');
  await expect(page.getByRole('heading', { name: 'Your tools' })).toBeVisible();
  expect((await onShelf(page)).slice(0, 4)).toEqual(['split', 'where', 'pdf', 'resize']);
  await expect(shelf(page).getByRole('link', { name: /Resize & Compress/ })).toContainText('Today');

  // Taking one off: it steps back to where its first visit put it.
  await visit(page, '/tools/where');
  await page.getByRole('button', { name: /off your tools$/ }).click();
  await visit(page, '/tools');
  expect((await onShelf(page)).slice(0, 2)).toEqual(['split', 'pdf']);

  // Search starts from their own tools, too.
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Search tools' });
  await expect(dialog.getByText('Your tools')).toBeVisible();
  await expect(dialog.getByRole('option').first()).toContainText('Split');
});

test('Person B: Work puts their drives and receipts, with real numbers, up front', async ({
  page,
}) => {
  await visit(page, '/tools');
  await page.evaluate(() => {
    const now = Date.now();
    const day = 86_400_000;
    const iso = (offset: number) => {
      const date = new Date(now + offset * day);
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    // Both only in this month, so the numbers are exact whatever the date.
    const today = iso(0);
    localStorage.setItem(
      'hyphy.home.v1',
      JSON.stringify({
        v: 1,
        lens: 'work',
        lensAt: now,
        pins: {},
        uses: {
          mileage: { first: now - 9 * day, last: now, days: 6, day: today },
          receipts: { first: now - 8 * day, last: now, days: 4, day: today },
        },
      }),
    );
    const trip = (id: string, miles: number) => ({
      id,
      date: today,
      start: '08:10',
      from: 'Home',
      to: 'Site',
      meters: miles * 1609.344,
      kind: 'business',
      purpose: 'Site visit',
      tag: '',
      note: '',
      source: 'typed',
      seconds: 0,
      roundTrip: false,
      route: [],
      created: now,
      updated: now,
    });
    localStorage.setItem(
      'hyphy.mileage.v1',
      JSON.stringify({ v: 1, unit: 'mi', trips: [trip('a1', 200), trip('a2', 84.7)], drive: null }),
    );
    const receipt = (id: string, total: number) => ({
      id,
      merchant: 'Fuel stop',
      total,
      tax: null,
      date: today,
      category: 'fuel',
      payment: 'Cash',
      tag: '',
      note: '',
      photo: false,
      source: 'typed',
      created: now,
      updated: now,
    });
    localStorage.setItem(
      'hyphy.receipts.v1',
      JSON.stringify({
        v: 1,
        currency: 'USD',
        receipts: [
          receipt('r1', 4000),
          receipt('r2', 1250),
          receipt('r3', 900),
          receipt('r4', 100),
        ],
      }),
    );
  });
  await visit(page, '/tools');
  await expect(page.getByRole('heading', { level: 1, name: 'Let’s get it done.' })).toBeVisible();
  expect((await onShelf(page)).slice(0, 2)).toEqual(['mileage', 'receipts']);
  const open = page.getByRole('region', { name: 'Pick up where you left off' });
  await expect(open.getByRole('link', { name: /mileage: 284\.7 mi, 2 trips/ })).toBeVisible();
  await expect(
    open.getByRole('link', { name: /receipts: \$62\.50, 4 added this week/ }),
  ).toBeVisible();
  // Everything else is still one tap away.
  await expect(page.getByRole('link', { name: /^Get together/ }).first()).toBeVisible();
});

test('Person C: in Create, “instagram” means Social Crop, Resize and Palette', async ({ page }) => {
  await pickMode(page, /^Create/);
  await page.getByRole('combobox', { name: 'Search every tool' }).fill('instagram');
  const options = page.getByRole('option');
  await expect(options.nth(0)).toContainText('Social Crop');
  await expect(options.nth(1)).toContainText('Resize');
  await expect(options.nth(2)).toContainText('Palette');
  await page.getByRole('combobox', { name: 'Search every tool' }).fill('dinner');
  await expect(options.nth(0)).toContainText('Split');
  await expect(options.nth(1)).toContainText('Where?');
});

test('Person D: “Show me everything” keeps the whole marketplace, clean', async ({ page }) => {
  await visit(page, '/tools');
  await page.getByRole('button', { name: /Show me everything/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'What do you want to do?' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'All tools' })).toBeVisible();
  await expect(
    page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Everything' }),
  ).toHaveAttribute('aria-checked', 'true');
  // No personal section before there's anything personal.
  await expect(page.getByRole('heading', { name: 'Your tools' })).toHaveCount(0);
});

test('the “+” starts anything, in the mode’s order', async ({ page }) => {
  await pickMode(page, /^Work/);
  await page.getByRole('button', { name: 'Start something' }).click();
  const sheet = page.getByRole('dialog', { name: 'Start something' });
  await expect(sheet.getByRole('button', { name: /^Track something/ })).toBeVisible();
  await sheet.getByRole('button', { name: /^Track something/ }).click();
  await sheet.getByRole('button', { name: /A drive/ }).click();
  await expect(page).toHaveURL(/\/tools\/mileage$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Mileage' })).toBeVisible();
});

test('Resize hands its photo straight to Social Crop', async ({ page }) => {
  await visit(page, '/tools/resize');
  await page.getByRole('button', { name: /Try a sample photo/ }).click();
  const next = page.getByRole('button', { name: /Make social sizes/ });
  await expect(next).toBeVisible({ timeout: 20_000 });
  await next.click();
  await expect(page).toHaveURL(/\/tools\/social-crop$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Social Crop' })).toBeVisible();
  // The photo is already open: no drop target asking for one.
  await expect(page.getByRole('button', { name: 'Choose a photo' })).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByText(/Couldn’t open/)).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the dock holds Home, the “+” and All tools; tools keep the bottom to themselves', async ({
    page,
  }) => {
    await pickMode(page, /^Everyday/);
    const dock = page.getByRole('navigation', { name: 'Hyphy Tools' });
    await expect(dock.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(dock.getByRole('button', { name: 'Start something' })).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await dock.getByRole('link', { name: 'All tools' }).tap();
    await expect(page).toHaveURL(/\/tools\/all$/);
    // On a phone, pinning is a tap on All tools.
    await page.getByRole('button', { name: 'Keep Palette handy' }).tap();
    await dock.getByRole('link', { name: 'Home' }).tap();
    await expect.poll(async () => (await onShelf(page))[0]).toBe('palette');
    await visit(page, '/tools/split');
    await expect(page.getByRole('navigation', { name: 'Hyphy Tools' })).toHaveCount(0);
  });

  for (const mode of [/^Everyday/, /^Create/, /^Work/])
    test(`the ${mode.source.slice(1)} home fits the screen`, async ({ page }) => {
      await pickMode(page, mode);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(390);
    });
});
