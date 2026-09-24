import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/* The product, end to end, through Demo Mode. */

async function previewAs(context: BrowserContext, person: string, baseURL: string) {
  await context.addCookies([{ name: 'hyphy_preview_as', value: person, url: baseURL }]);
}

async function noHorizontalScroll(page: Page) {
  const [scroll, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(width);
}

test.beforeEach(async ({ context, baseURL }) => {
  await context.clearCookies();
  await previewAs(context, 'jerry', baseURL!);
});

test('opens straight into the product, no sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/hyphy$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Jerry');
  await expect(page.getByRole('region', { name: 'Demo Mode' })).toBeVisible();
});

const perspectives = [
  {
    person: 'jerry',
    path: '/personal',
    heading: 'Welcome back, Jerry',
    sees: ['History', 'Receipts'],
    hides: ['People', 'Vehicles'],
  },
  {
    person: 'jerry',
    path: '/hyphy',
    heading: 'Jerry',
    sees: ['Projects', 'People', 'Space settings'],
    hides: ['Vehicles'],
  },
  {
    person: 'sarah',
    path: '/hyphy',
    heading: 'Sarah',
    sees: ['Projects', 'People'],
    hides: ['Space settings'],
  },
  {
    person: 'dana',
    path: '/abc-construction',
    heading: 'Dana',
    sees: ['Vehicles', 'People', 'Space settings'],
    hides: [],
  },
  {
    person: 'mike',
    path: '/abc-construction',
    heading: 'Mike',
    sees: ['Vehicles', 'Receipts'],
    hides: ['Space settings'],
  },
  {
    person: 'chris',
    path: '/abc-construction',
    heading: 'Chris',
    sees: ['Projects', 'Files'],
    hides: ['People', 'Vehicles', 'Tools'],
  },
  {
    person: 'rosa',
    path: '/salt-and-ember',
    heading: 'Rosa',
    sees: ['Events', 'Link Pages'],
    hides: ['Vehicles', 'Mileage'],
  },
];

for (const view of perspectives) {
  test(`${view.person} in ${view.path} sees their own product`, async ({
    page,
    context,
    baseURL,
  }) => {
    await previewAs(context, view.person, baseURL!);
    await page.goto(view.path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(view.heading);
    const nav = page.getByRole('complementary', { name: 'Main' });
    for (const label of view.sees)
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    for (const label of view.hides)
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  });
}

test('pages outside your role are refused', async ({ page, context, baseURL }) => {
  await previewAs(context, 'chris', baseURL!);
  for (const path of [
    '/abc-construction/people',
    '/abc-construction/vehicles',
    '/abc-construction/projects/prj_elmhurst',
    '/hyphy',
  ]) {
    await page.goto(path);
    await expect(
      page.getByText(/Not available to you here|This isn’t in your Spaces/),
    ).toBeVisible();
  }
});

test('Preview As switches the person and their Space', async ({ page }) => {
  await page.goto('/hyphy');
  await page.getByRole('button', { name: 'Preview as Mike Rodriguez' }).click();
  await expect(page).toHaveURL(/\/abc-construction$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mike');
});

test('the Space switcher moves between Spaces', async ({ page }) => {
  await page.goto('/hyphy');
  await page
    .getByRole('complementary', { name: 'Main' })
    .getByRole('button', { name: /Hyphy LLC/ })
    .click();
  await page.getByRole('link', { name: 'Salt & Ember Manager' }).click();
  await expect(page).toHaveURL(/\/salt-and-ember$/);
  await expect(
    page.getByRole('complementary', { name: 'Main' }).getByRole('link', { name: 'Events' }),
  ).toBeVisible();
});

test('command search finds records and navigates', async ({ page, context, baseURL }) => {
  await previewAs(context, 'dana', baseURL!);
  await page.goto('/abc-construction');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Search' }).fill('truck 24');
  await expect(page.getByRole('option', { name: /Truck 24/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/vehicles\/veh_t24$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Truck 24');
});

test('a member submits a trip and a manager approves it', async ({ page, context, baseURL }) => {
  await previewAs(context, 'mike', baseURL!);
  await page.goto('/abc-construction');
  await page.keyboard.press('c');
  await page.getByRole('menuitem', { name: /Log mileage/ }).click();
  await page.getByLabel('Miles one way').fill('4.4');
  await page.getByLabel('To', { exact: true }).fill('Lumber yard');
  await page.getByRole('button', { name: 'Submit trip' }).click();
  await expect(page.getByText('4.4 mi logged')).toBeVisible();

  await previewAs(context, 'dana', baseURL!);
  await page.goto('/abc-construction/inbox');
  const item = page.getByRole('listitem').filter({ hasText: '4.4 mi' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved').first()).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: '4.4 mi' })).toHaveCount(0);

  await page.getByRole('button', { name: /Reset/ }).click();
  await expect(page).toHaveURL(/\/inbox$/);
});

test('turning a tool off hides it for the Space', async ({ page, context, baseURL }) => {
  await previewAs(context, 'dana', baseURL!);
  await page.goto('/abc-construction/settings');
  await page.getByRole('switch', { name: /Mileage on/ }).click();
  await expect(page.getByRole('switch', { name: /Mileage off/ })).toBeVisible();
  await expect(page.getByText('Mileage off')).toBeVisible();
  await page.goto('/abc-construction');
  await expect(
    page.getByRole('complementary', { name: 'Main' }).getByRole('link', { name: 'Mileage' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: /Reset/ }).click();
});

test('QR codes draw as you type', async ({ page }) => {
  await page.goto('/personal/tools/qr');
  const input = page.getByLabel(/Link or text/);
  await input.fill('https://example.com/menu');
  await expect(
    page.getByRole('img', { name: /QR code for https:\/\/example.com\/menu/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /PNG/ })).toBeEnabled();
});

test.describe('phones', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const [person, path] of [
    ['mike', '/abc-construction'],
    ['mike', '/abc-construction/tools/receipts'],
    ['dana', '/abc-construction/projects/prj_oakbrook'],
    ['jerry', '/personal/tools'],
    ['chris', '/abc-construction/files'],
  ]) {
    test(`${person} ${path} fits the screen`, async ({ page, context, baseURL }) => {
      await previewAs(context, person, baseURL!);
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeVisible();
      await noHorizontalScroll(page);
    });
  }
  test('create opens as a sheet of big targets', async ({ page, context, baseURL }) => {
    await previewAs(context, 'mike', baseURL!);
    await page.goto('/abc-construction');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Create' });
    await expect(sheet.getByRole('button', { name: /Submit receipt/ })).toBeVisible();
    const box = await sheet.getByRole('button', { name: /Submit receipt/ }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
