import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import postgres from 'postgres';
import { BASE_PATH } from '../src/lib/base-path';
import { demoUuid } from '../src/lib/data/supabase/rows';
import { applyWorld } from '../src/lib/data/supabase/world';

/*
 * The product, end to end, through Demo Mode. The same suite runs on both backends:
 *   npm test                                   the seed + journal (HYPHY_DATA=demo)
 *   HYPHY_DATA=supabase DATABASE_URL=… npm test  the development database, re-seeded per test
 */
const onDatabase = process.env.HYPHY_DATA === 'supabase';

/** A seeded record's id on the backend under test. */
const id = (key: string) => (onDatabase ? demoUuid(key) : key);

async function previewAs(context: BrowserContext, person: string, baseURL: string) {
  await context.addCookies([{ name: 'hyphy_preview_as', value: person, url: baseURL }]);
}

/** Opens a page once it's interactive: scripts loaded and the page hydrated. */
async function visit(page: Page, path: string) {
  await page.goto(`${BASE_PATH}${path === '/' ? '' : path}`, { waitUntil: 'networkidle' });
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
  // Fresh cookies are a fresh demo; on the database, put the seeded world back.
  if (onDatabase) {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    await applyWorld(sql);
    await sql.end();
  }
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
    `/abc-construction/projects/${id('prj_elmhurst')}`,
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
  await visit(page, `/abc-construction/people/${id('mike')}`);
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
  await expect(page).toHaveURL(new RegExp(`/vehicles/${id('veh_t24')}$`));
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

test('PDF samples can be merged or split without a file of your own', async ({ page }) => {
  await visit(page, '/personal/tools/pdf');
  await page.getByRole('button', { name: /Try three samples/ }).click();
  await expect(page.getByText('6 pages in total')).toBeVisible();
  await page.getByRole('button', { name: 'Merge 3 PDFs' }).click();
  await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();

  await page.getByText('Extract pages', { exact: true }).click();
  await page.getByRole('button', { name: /Try a 7-page sample/ }).click();
  await page.getByRole('button', { name: 'Page 7', exact: true }).click();
  await expect(page.getByLabel(/Pages to keep/)).toHaveValue('7');
});

test('an image sample shrinks right away and shows before and after', async ({ page }) => {
  await visit(page, '/personal/tools/images');
  await page.getByRole('button', { name: /Try a sample photo/ }).click();
  const figure = page.getByRole('figure');
  await expect(figure.getByText(/Before 4032×3024/)).toBeVisible({ timeout: 15_000 });
  await expect(figure.getByText(/After 1920×1440/)).toBeVisible();
});

test('the mileage number is the input, and a round trip counts it twice', async ({
  page,
  context,
  baseURL,
}) => {
  await previewAs(context, 'mike', baseURL!);
  await visit(page, '/abc-construction');
  await shortcut(page, 'c', page.getByRole('menu', { name: 'Create' }));
  await page.getByRole('menuitem', { name: /Log mileage/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Log mileage' });
  await sheet.getByLabel('Miles one way').fill('12.5');
  await expect(sheet.getByText('12.5 mi this trip')).toBeVisible();
  await sheet.getByRole('radio', { name: 'Round trip' }).click();
  await expect(sheet.getByText('25 mi there and back')).toBeVisible();
  // A trip driven before fills everything in one tap.
  await sheet.getByRole('button', { name: /Shop → Oak Brook Remodel/ }).click();
  await expect(sheet.getByLabel('To', { exact: true })).toHaveValue('Oak Brook Remodel');
  await expect(sheet.getByText('14.2 mi this trip')).toBeVisible();
});

test('a guest sees what is shared, what is private, and who to call', async ({
  page,
  context,
  baseURL,
}) => {
  await previewAs(context, 'chris', baseURL!);
  await visit(page, '/abc-construction');
  await expect(page.getByRole('heading', { level: 2, name: 'Oak Brook Remodel' })).toBeVisible();
  await expect(page.getByText('Money, receipts and other projects stay private')).toBeVisible();
  await expect(page.getByText('Questions? Your contact')).toBeVisible();
  await expect(page.getByText('Ray Kowalski').first()).toBeVisible();
});

test('People shows what each person is on and what waits on the approver', async ({
  page,
  context,
  baseURL,
}) => {
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/people');
  const mike = page.getByRole('link', { name: /Mike Rodriguez/ });
  await expect(mike).toContainText('Oak Brook Remodel');
  await expect(mike).toContainText('4 waiting on you');
  await mike.click();
  await expect(page.getByText(/4 waiting on you/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'View pending submissions' })).toHaveAttribute(
    'href',
    `${BASE_PATH}/abc-construction/inbox?from=${id('mike')}`,
  );
});

test('every tool in the library has a way in', async ({ page, context, baseURL }) => {
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/tools');
  // Image Resize has no Create action in a business Space; its card still leads somewhere.
  await expect(page.getByRole('link', { name: 'Resize images' })).toHaveAttribute(
    'href',
    `${BASE_PATH}/abc-construction/tools/images`,
  );
});

async function reset(page: Page) {
  await page
    .getByRole('button', { name: /Reset demo/ })
    .filter({ visible: true })
    .click();
  // Done when the change count is gone — on the database, the next test mustn't race the reseed.
  await expect(
    page.getByRole('button', { name: 'Reset demo', exact: true }).filter({ visible: true }),
  ).toBeVisible();
}

test('returning with a reason reaches the person, who fixes and resubmits it', async ({
  page,
  context,
  baseURL,
}) => {
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/inbox?view=approvals');
  const row = page.getByRole('listitem').filter({ hasText: 'Home Depot · $58.64' });
  await row.getByRole('button', { name: 'Return' }).click();
  const sheet = page.getByRole('dialog', { name: 'Return this receipt' });
  await sheet.getByLabel('What should change?').fill('Please attach this to Oak Brook Remodel.');
  await sheet.getByRole('button', { name: 'Return to Mike' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Home Depot · $58.64' })).toHaveCount(
    0,
  );

  await previewAs(context, 'mike', baseURL!);
  await visit(page, '/abc-construction/tools/receipts?view=returned');
  await page
    .getByRole('link', { name: /Home Depot/ })
    .first()
    .click();
  const detail = page.getByRole('dialog', { name: 'Home Depot' });
  await expect(
    detail.getByText('“Please attach this to Oak Brook Remodel.”').first(),
  ).toBeVisible();
  await detail.getByRole('button', { name: 'Edit & resubmit' }).click();
  const form = page.getByRole('dialog', { name: 'Fix and resubmit' });
  await expect(form.getByText(/Dana returned it/)).toBeVisible();
  await form.getByLabel('Project').selectOption({ label: 'Oak Brook Remodel' });
  await form.getByRole('button', { name: 'Resubmit receipt' }).click();
  await expect(page.getByText('Sent back for approval')).toBeVisible();

  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/inbox?view=approvals');
  const again = page.getByRole('listitem').filter({ hasText: 'Receipt resubmitted' });
  await expect(again).toContainText('Oak Brook Remodel');
  await expect(again).toContainText('Fixed after: “Please attach this to Oak Brook Remodel.”');
  await reset(page);
});

test('a trip goes all the way round the approval loop, and every page agrees', async ({
  page,
  context,
  baseURL,
}) => {
  // Mike logs a trip for Oak Brook Remodel in his own car and submits it.
  await previewAs(context, 'mike', baseURL!);
  await visit(page, '/abc-construction/tools/mileage');
  await page.getByRole('button', { name: 'Log a trip' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Log mileage' });
  await sheet.getByLabel('From').fill('Hinge Supply, Lombard');
  await sheet.getByLabel('To', { exact: true }).fill('Oak Brook Remodel');
  await sheet.getByLabel('Miles one way').fill('9.8');
  await sheet.getByLabel('Vehicle').selectOption({ label: 'Personal vehicle' });
  await sheet.getByLabel(/^(Project|Job)/).selectOption({ label: 'Oak Brook Remodel' });
  await sheet.getByLabel('Purpose').fill('Cabinet hinges for the island');
  await sheet.getByRole('button', { name: 'Submit trip' }).click();
  await expect(sheet).toBeHidden();

  // Dana returns it from her Inbox, with a reason.
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/inbox?view=approvals');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Hinge Supply' })
    .getByRole('button', { name: 'Return' })
    .click();
  const back = page.getByRole('dialog', { name: /^Return this/ });
  await back.getByLabel('What should change?').fill('Log it on Truck 24, please.');
  await back.getByRole('button', { name: 'Return to Mike' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Hinge Supply' })).toHaveCount(0);

  // Mike sees it came back and why, fixes the vehicle and sends it again.
  await previewAs(context, 'mike', baseURL!);
  await visit(page, '/abc-construction');
  await expect(page.getByText('“Log it on Truck 24, please.”').first()).toBeVisible();
  await visit(page, '/abc-construction/tools/mileage');
  await page
    .getByRole('link', { name: /Hinge Supply/ })
    .first()
    .click();
  const trip = page.getByRole('dialog', { name: /Hinge Supply/ });
  await trip.getByRole('button', { name: 'Edit & resubmit' }).click();
  const fix = page.getByRole('dialog', { name: 'Fix and resubmit' });
  await fix.getByLabel('Vehicle').selectOption({ label: 'Truck 24' });
  await fix.getByRole('button', { name: 'Resubmit trip' }).click();
  await expect(fix).toBeHidden();

  // Dana approves it.
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/inbox?view=approvals');
  const resent = page.getByRole('listitem').filter({ hasText: 'Hinge Supply' });
  await expect(resent).toContainText('Fixed after: “Log it on Truck 24, please.”');
  await resent.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Hinge Supply' })).toHaveCount(0);

  // Fresh page loads everywhere: the stored record is the only story.
  await visit(page, '/abc-construction/tools/mileage');
  const row = page.getByRole('link', { name: /Hinge Supply/ }).first();
  await expect(row).toContainText('Truck 24');
  await expect(row).toContainText('Approved');
  await row.click();
  const timeline = page.getByRole('dialog', { name: /Hinge Supply/ });
  for (const step of [
    'Submitted by Mike',
    'Returned by Dana',
    '“Log it on Truck 24, please.”',
    'Fixed and sent again by Mike',
    'Approved by Dana',
  ])
    await expect(timeline.getByText(step).first()).toBeVisible();
  await visit(page, `/abc-construction/projects/${id('prj_oakbrook')}`);
  await expect(page.getByText(/Hinge Supply/).first()).toBeVisible();
  await visit(page, `/abc-construction/vehicles/${id('veh_t24')}`);
  await expect(page.getByText(/Hinge Supply/).first()).toBeVisible();
  await visit(page, `/abc-construction/people/${id('mike')}`);
  await expect(page.getByText(/Hinge Supply/).first()).toBeVisible();
  await visit(page, '/abc-construction/activity');
  await expect(page.getByText(/Hinge Supply/).first()).toBeVisible();

  await previewAs(context, 'mike', baseURL!);
  await visit(page, '/abc-construction');
  await expect(page.getByText('“Log it on Truck 24, please.”')).toHaveCount(0);
  await reset(page);
});

test('a receipt is returned, fixed, batch approved, and shows up where it belongs', async ({
  page,
  context,
  baseURL,
}) => {
  // Mike submits a receipt for Oak Brook Remodel on Truck 24.
  await previewAs(context, 'mike', baseURL!);
  await visit(page, '/abc-construction/tools/receipts');
  await page.getByRole('button', { name: 'Submit receipt' }).first().click();
  const sheet = page.getByRole('dialog').filter({ has: page.getByLabel('Where') });
  await sheet.getByLabel('Where').fill('Ace Hardware');
  await sheet.getByLabel('Total').fill('23.40');
  await sheet.getByLabel('Vehicle').selectOption({ label: 'Truck 24 (yours)' });
  await sheet.getByLabel(/^(Project|Job)/).selectOption({ label: 'Oak Brook Remodel' });
  await sheet.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(sheet).toBeHidden();

  // Dana returns it with a reason; Mike fixes it and sends it again.
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/inbox?view=approvals');
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Ace Hardware' })
    .getByRole('button', { name: 'Return' })
    .click();
  const back = page.getByRole('dialog', { name: /^Return this/ });
  await back.getByLabel('What should change?').fill('Add a note on what it was for.');
  await back.getByRole('button', { name: 'Return to Mike' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Ace Hardware' })).toHaveCount(0);

  await previewAs(context, 'mike', baseURL!);
  await visit(page, '/abc-construction/tools/receipts?view=returned');
  await page
    .getByRole('link', { name: /Ace Hardware/ })
    .first()
    .click();
  const detail = page.getByRole('dialog', { name: 'Ace Hardware' });
  await expect(detail.getByText('“Add a note on what it was for.”').first()).toBeVisible();
  await detail.getByRole('button', { name: 'Edit & resubmit' }).click();
  const fix = page.getByRole('dialog', { name: 'Fix and resubmit' });
  await fix.getByLabel('Note').fill('Cabinet pulls for the island.');
  await fix.getByRole('button', { name: 'Resubmit receipt' }).click();
  await expect(page.getByText('Sent back for approval')).toBeVisible();

  // Dana approves everything Mike has waiting in one go.
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/inbox?view=approvals');
  const mike = page.getByRole('region', { name: 'From Mike Rodriguez' });
  await expect(mike.getByText('Receipt resubmitted')).toBeVisible();
  await mike.getByRole('button', { name: /^Approve all \d+/ }).click();
  await mike.getByRole('button', { name: /^Yes, approve \d+/ }).click();
  await expect(page.getByRole('region', { name: 'From Mike Rodriguez' })).toHaveCount(0);

  // Reloaded, the receipt is approved, with its whole history, on its project, truck and person.
  await visit(page, '/abc-construction/tools/receipts');
  await page
    .getByRole('link', { name: /Ace Hardware/ })
    .first()
    .click();
  const done = page.getByRole('dialog', { name: 'Ace Hardware' });
  for (const step of [
    'Submitted by Mike',
    'Returned by Dana',
    'Fixed and sent again by Mike',
    'Approved by Dana',
  ])
    await expect(done.getByText(step).first()).toBeVisible();
  for (const path of [
    `/abc-construction/projects/${id('prj_oakbrook')}`,
    `/abc-construction/vehicles/${id('veh_t24')}`,
    `/abc-construction/people/${id('mike')}`,
    '/abc-construction/activity',
  ]) {
    await visit(page, path);
    await expect(page.getByText(/Ace Hardware/).first()).toBeVisible();
  }
  await reset(page);
});

test('a project gathers its money, trucks and records, each linked to the others', async ({
  page,
  context,
  baseURL,
}) => {
  await previewAs(context, 'dana', baseURL!);
  await visit(page, `/abc-construction/projects/${id('prj_oakbrook')}`);
  const money = page.getByRole('region', { name: 'Money' });
  await expect(money.getByText('Contract value')).toBeVisible();
  await expect(money.getByText('$148,000')).toBeVisible();
  await expect(money.getByText('Tracked costs', { exact: true })).toBeVisible();
  await expect(money.getByText('Cost allowance')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Vehicles on this job' })).toContainText(
    'Truck 24',
  );

  // An event has a day and no percent complete.
  await previewAs(context, 'rosa', baseURL!);
  await visit(page, `/salt-and-ember/projects/${id('prj_se_keller')}`);
  await expect(page.getByText('How far along')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Money' })).toContainText('Booking');
});

test('pins are remembered, and Reset puts the defaults back', async ({ page }) => {
  await visit(page, '/personal');
  const tools = page.getByRole('region', { name: 'Your tools' });
  await expect(tools.getByRole('button', { name: 'Unpin PDF' })).toBeVisible();
  // The button flips at once; wait for the save itself before reloading.
  const saved = page.waitForResponse((response) => response.request().method() === 'POST');
  await tools.getByRole('button', { name: 'Pin Image Resize' }).click();
  await expect(tools.getByRole('button', { name: 'Unpin Image Resize' })).toBeVisible();
  await saved;
  await visit(page, '/personal');
  await expect(
    page
      .getByRole('region', { name: 'Your tools' })
      .getByRole('button', { name: 'Unpin Image Resize' }),
  ).toBeVisible();
  await reset(page);
  await visit(page, '/personal');
  await expect(
    page
      .getByRole('region', { name: 'Your tools' })
      .getByRole('button', { name: 'Pin Image Resize' }),
  ).toBeVisible();
});

test('a link page makes its own QR code, saved with the page', async ({
  page,
  context,
  baseURL,
}) => {
  await previewAs(context, 'rosa', baseURL!);
  await visit(page, '/salt-and-ember/tools/links');
  const panel = page.getByRole('region', { name: 'QR code for this page' });
  await panel.getByRole('button', { name: 'Create QR for this page' }).click();
  await expect(panel.getByText('@saltandember link page')).toBeVisible();
  await visit(page, '/salt-and-ember/tools/qr');
  await expect(page.getByText('@saltandember link page').first()).toBeVisible();
  await reset(page);
});

test('a PDF made with the tool lands in Files, on its project, with its origin', async ({
  page,
  context,
  baseURL,
}) => {
  await previewAs(context, 'dana', baseURL!);
  await visit(page, '/abc-construction/tools/pdf');
  await page.getByRole('button', { name: /Try three samples/ }).click();
  await page.getByRole('button', { name: 'Merge 3 PDFs' }).click();
  await page.getByLabel('Attach to').selectOption({ label: 'Oak Brook Remodel' });
  await page.getByRole('button', { name: 'Save to Files' }).click();
  await page.getByRole('link', { name: /Saved to Files · Open/ }).click();
  await expect(page.getByText(/Made with the PDF tool/)).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Belongs to' }).getByRole('link', { name: 'Oak Brook Remodel' }),
  ).toBeVisible();
  await reset(page);
});

test.describe('phones', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const [person, path] of [
    ['mike', '/abc-construction'],
    ['mike', '/abc-construction/tools/receipts'],
    ['dana', `/abc-construction/projects/${id('prj_oakbrook')}`],
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

  test('Mike fixes a returned trip; Dana batch approves and follows a receipt to its people and places', async ({
    page,
    context,
    baseURL,
  }) => {
    await previewAs(context, 'mike', baseURL!);
    await visit(page, '/abc-construction');
    const back = page.getByRole('region', { name: 'Sent back to you' });
    await expect(
      back.getByText('“Please use Truck 24 instead of Personal Vehicle.”'),
    ).toBeVisible();
    await back.getByRole('button', { name: 'Edit & resubmit' }).click();
    const form = page.getByRole('dialog', { name: 'Fix and resubmit' });
    await form.getByLabel('Vehicle').selectOption({ label: 'Truck 24' });
    await form.getByRole('button', { name: 'Resubmit trip' }).click();
    await expect(page.getByText('11.6 mi resubmitted')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sent back to you' })).toHaveCount(0);

    await previewAs(context, 'dana', baseURL!);
    await visit(page, '/abc-construction/inbox?view=approvals');
    const mike = page.getByRole('region', { name: 'From Mike Rodriguez' });
    await expect(mike.getByText('Mileage resubmitted')).toBeVisible();
    await mike.getByRole('button', { name: 'Approve all 5' }).click();
    await mike.getByRole('button', { name: 'Yes, approve 5' }).click();
    await expect(page.getByRole('region', { name: 'From Mike Rodriguez' })).toHaveCount(0);
    await noHorizontalScroll(page);

    await visit(page, `/abc-construction/tools/receipts?receipt=${id('rc_abc_01')}`);
    const receipt = page.getByRole('dialog', { name: 'Shell' });
    await expect(receipt.getByText(/Approved by Dana/)).toBeVisible();
    const links = receipt.getByRole('list', { name: 'Belongs to' });
    await links.getByRole('link', { name: 'Mike Rodriguez' }).click();
    await expect(page).toHaveURL(new RegExp(`/people/${id('mike')}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Mike Rodriguez' })).toBeVisible();
    await page
      .getByRole('link', { name: /^Truck 24/ })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/vehicles/${id('veh_t24')}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Truck 24' })).toBeVisible();
    await page.getByRole('link', { name: /Oak Brook Remodel.*From its latest trips/ }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${id('prj_oakbrook')}$`));
    await noHorizontalScroll(page);
    await reset(page);
  });
});

test('Demo Mode: business creation and invitation links are previews that change nothing', async ({
  page,
  context,
  baseURL,
}) => {
  await previewAs(context, 'jerry', baseURL!);
  await visit(page, '/create-business');
  await expect(page.getByText('Creating a business needs a real account')).toBeVisible();
  await page.getByLabel('Business name').fill('Preview Co');
  await page.getByText('Retail').click();
  await page.getByRole('button', { name: 'Create business' }).click();
  await expect(page.locator('form').getByRole('alert')).toContainText('needs a real account');
  await expect(page).toHaveURL(`${BASE_PATH}/create-business`);

  await visit(page, '/invite/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  await expect(
    page.getByRole('heading', { name: 'Invitations work with real accounts.' }),
  ).toBeVisible();

  // Managing the demo team explains itself instead of changing the story.
  await previewAs(context, 'dana', baseURL!);
  await visit(page, `/abc-construction/people/${id('mike')}`);
  await page.getByRole('radio', { name: /Manager/ }).click();
  await expect(page.getByText(/In Demo Mode the team is part of the story/)).toBeVisible();
  await visit(page, '/abc-construction/people');
  await expect(page.getByRole('region', { name: 'Invited' })).toBeVisible();
});
