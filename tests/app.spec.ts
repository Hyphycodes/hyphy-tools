import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

/* The product, end to end, through Demo Mode. */

async function previewAs(context: BrowserContext, person: string, baseURL: string) {
  await context.addCookies([{ name: 'hyphy_preview_as', value: person, url: baseURL }]);
}

/** Opens a page once it's interactive: scripts loaded and the page hydrated. */
async function visit(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
}

/**
 * Presses a keyboard shortcut until it takes effect. Shortcut listeners attach just after the
 * page hydrates, so on a slow machine the first press can land before they exist.
 */
async function shortcut(page: Page, key: string, until: Locator) {
  await expect(async () => {
    if (!(await until.isVisible())) await page.keyboard.press(key);
    await expect(until).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
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
  await visit(page, '/');
  await expect(page).toHaveURL(/\/hyphy$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Jerry');
  await expect(
    page
      .getByRole('region', { name: 'Demo Mode' })
      .getByRole('button', { name: /Preview as someone else — now Jerry/ })
      .filter({ visible: true }),
  ).toBeVisible();
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
    await visit(page, view.path);
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
    await visit(page, path);
    await expect(
      page.getByText(/Not available to you here|This isn’t in your Spaces/),
    ).toBeVisible();
  }
});

test('Preview As switches the person and their Space', async ({ page }) => {
  await visit(page, '/hyphy');
  await page
    .getByRole('button', { name: /Preview as someone else/ })
    .filter({ visible: true })
    .click();
  await page.getByRole('button', { name: /Preview as Mike Rodriguez, Member in ABC/ }).click();
  await expect(page).toHaveURL(/\/abc-construction$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mike');
});

test('Shift+D opens Preview As from anywhere', async ({ page }) => {
  await visit(page, '/personal/tools');
  const sheet = page.getByRole('dialog', { name: 'Preview as' });
  await shortcut(page, 'Shift+D', sheet);
  await expect(
    sheet.getByRole('button', { name: /Preview as Jerry, Manager in Salt & Ember/ }),
  ).toBeVisible();
});

test('everyone agrees on what Mike is working on', async ({ page, context, baseURL }) => {
  await previewAs(context, 'mike', baseURL!);
  await visit(page, '/abc-construction');
  await expect(page.getByText('You’re on Oak Brook Remodel.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Oak Brook Remodel' })).toBeVisible();
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/people/mike');
  const current = page.getByText('Current project').locator('..');
  await expect(current).toContainText('Oak Brook Remodel');
});

test('a receipt opens with its details, and approving it updates the status', async ({
  page,
  context,
  baseURL,
}) => {
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/tools/receipts');
  await page.getByRole('link', { name: /Shell/ }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Shell' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText('Waiting for a manager')).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'Truck 24' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Approve' }).click();
  await expect(sheet.getByText(/Approved by Dana/)).toBeVisible();
  await visit(page, '/abc-construction/tools/receipts');
  await page
    .getByRole('button', { name: /Reset demo/ })
    .filter({ visible: true })
    .click();
});

test('the inbox groups what needs you, and links from the dashboard land on approvals', async ({
  page,
  context,
  baseURL,
}) => {
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction');
  await page.getByRole('link', { name: /Waiting on approval/ }).click();
  await expect(page).toHaveURL(/\/inbox\?view=approvals$/);
  await expect(page.getByRole('region', { name: 'Approvals' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Documents' })).toHaveCount(0);
});

test('the Space switcher moves between Spaces', async ({ page }) => {
  await visit(page, '/hyphy');
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
  await visit(page, '/abc-construction');
  await shortcut(page, 'Control+k', page.getByRole('combobox', { name: 'Search' }));
  await page.getByRole('combobox', { name: 'Search' }).fill('truck 24');
  await expect(page.getByRole('option', { name: /Truck 24/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/vehicles\/veh_t24$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Truck 24');
});

test('a member submits a trip and a manager approves it', async ({ page, context, baseURL }) => {
  await previewAs(context, 'mike', baseURL!);
  await visit(page, '/abc-construction');
  await shortcut(page, 'c', page.getByRole('menu', { name: 'Create' }));
  await page.getByRole('menuitem', { name: /Log mileage/ }).click();
  await page.getByLabel('Miles one way').fill('4.4');
  await page.getByLabel('To', { exact: true }).fill('Lumber yard');
  await page.getByRole('button', { name: 'Submit trip' }).click();
  await expect(page.getByText('4.4 mi logged')).toBeVisible();

  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/inbox');
  const item = page.getByRole('listitem').filter({ hasText: '4.4 mi' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved').first()).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: '4.4 mi' })).toHaveCount(0);

  await page
    .getByRole('button', { name: /Reset demo/ })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/inbox$/);
});

test('turning a tool off hides it for the Space', async ({ page, context, baseURL }) => {
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/settings');
  await page.getByRole('switch', { name: /Mileage on/ }).click();
  await expect(page.getByRole('switch', { name: /Mileage off/ })).toBeVisible();
  await expect(page.getByText('Mileage off')).toBeVisible();
  await visit(page, '/abc-construction');
  await expect(
    page.getByRole('complementary', { name: 'Main' }).getByRole('link', { name: 'Mileage' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: /Reset demo/ })
    .filter({ visible: true })
    .click();
});

test('QR codes draw as you type', async ({ page }) => {
  await visit(page, '/personal/tools/qr');
  const input = page.getByLabel(/Link or text/);
  await input.fill('https://example.com/menu');
  await expect(
    page.getByRole('img', { name: /QR code for https:\/\/example.com\/menu/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /PNG/ })).toBeEnabled();
});

test('a Wi-Fi code carries the network, with a printed caption', async ({ page }) => {
  await visit(page, '/personal/tools/qr');
  await page.getByText('Wi-Fi', { exact: true }).click();
  await page.getByLabel('Network name').fill('Studio-Guest');
  await page.getByLabel('Password').fill('espresso');
  await page.getByRole('button', { name: 'Scan to join our Wi-Fi' }).click();
  const code = page.getByRole('img', {
    name: /QR code for WIFI:T:WPA;S:Studio-Guest;P:espresso;;/,
  });
  await expect(code).toBeVisible();
  await expect(code.getByText('Scan to join our Wi-Fi')).toBeVisible();
});

test('PDFs show their pages, merge, and extract by tapping pages', async ({ page }) => {
  const { PDFDocument } = await import('pdf-lib');
  const make = async (pages: number) => {
    const doc = await PDFDocument.create();
    for (let index = 0; index < pages; index += 1) doc.addPage([300, 400]);
    return Buffer.from(await doc.save());
  };
  await visit(page, '/personal/tools/pdf');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'one.pdf', mimeType: 'application/pdf', buffer: await make(2) },
    { name: 'two.pdf', mimeType: 'application/pdf', buffer: await make(3) },
  ]);
  await expect(page.getByText('5 pages in total')).toBeVisible();
  // Real thumbnails, drawn on the device.
  await expect(page.locator('ol img')).toHaveCount(2);
  await page.getByRole('button', { name: 'Merge 2 PDFs' }).click();
  await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();

  await page.getByText('Extract pages', { exact: true }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles([{ name: 'three.pdf', mimeType: 'application/pdf', buffer: await make(4) }]);
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.getByRole('button', { name: 'Page 4', exact: true }).click();
  await expect(page.getByLabel(/Pages to keep/)).toHaveValue('2, 4');
  await page.getByRole('button', { name: 'Extract 2 pages' }).click();
  await expect(page.getByText('three-pages-2_4.pdf')).toBeVisible();
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
      await visit(page, path);
      await expect(page.getByRole('navigation', { name: 'Tabs' })).toBeVisible();
      await noHorizontalScroll(page);
    });
  }
  test('create opens as a sheet of big targets', async ({ page, context, baseURL }) => {
    await previewAs(context, 'mike', baseURL!);
    await visit(page, '/abc-construction');
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Create' });
    await expect(sheet.getByRole('button', { name: /Submit receipt/ })).toBeVisible();
    const box = await sheet.getByRole('button', { name: /Submit receipt/ }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
