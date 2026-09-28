import { expect, test, type Browser, type Page } from '@playwright/test';
import { BASE_PATH } from '../src/lib/base-path';

/*
 * Where?, Plan, Secret Santa, Receipts and Mileage, end to end, the way people use them: on a
 * phone, one person making it and another opening the link they were sent.
 */

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

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

/** A second person on their own phone. */
async function friend(browser: Browser) {
  const context = await browser.newContext(phone);
  return context.newPage();
}

test('Where?: add places, vote, a friend votes from the link, the favorite wins', async ({
  page,
  browser,
}) => {
  await page.setViewportSize(phone.viewport);
  await visit(page, '/tools/where');
  await expect(page.getByText('Add somewhere you’d actually go.')).toBeVisible();
  await noHorizontalScroll(page);
  // A pasted Maps link names the place.
  await page
    .getByLabel('Add a place or paste a link')
    .fill('https://www.google.com/maps/place/Monteverde+Restaurant/@41.88,-87.65,17z');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: /Tacos/ }).click();
  await expect(page.getByRole('list', { name: 'The places' }).getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Love it: Monteverde Restaurant' }).click();
  await page.getByLabel('Your name').fill('Jerry');
  await page.getByRole('button', { name: 'Vote' }).click();
  await expect(page.getByText('1 vote so far')).toBeVisible();
  // The link is ready (and the address current) once sending is possible.
  await expect(page.getByRole('button', { name: 'Send this to the group' }).first()).toBeEnabled();
  const link = page.url();

  const guest = await friend(browser);
  await guest.goto(link, { waitUntil: 'networkidle' });
  await expect(guest.getByText('You’re invited to vote')).toBeVisible();
  await guest.getByRole('button', { name: 'Works for me: Monteverde Restaurant' }).click();
  await guest.getByLabel('Your name').fill('Kamila');
  await guest.getByRole('button', { name: 'Vote' }).click();
  await expect(guest.getByText('Your votes are in.')).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Send my votes back' })).toBeEnabled();
  const back = guest.url();
  expect(back).not.toBe(link);
  await guest.context().close();

  await page.goto(back, { waitUntil: 'networkidle' });
  await expect(page.getByText('Kamila voted.')).toBeVisible();
  const ticket = page.getByRole('region', { name: /Monteverde Restaurant is winning/ });
  await expect(ticket).toBeVisible();
  await expect(ticket.getByText('2 of 2 are in')).toBeVisible();
  await expect(ticket.getByRole('link', { name: 'Open directions' })).toHaveAttribute(
    'href',
    /google\.com\/maps\/place/,
  );
  // Kept on this device.
  await visit(page, '/tools/where');
  await expect(page.getByText('2 votes so far')).toBeVisible();
});

test('Plan: what, name, when, who; a guest says they’re in; Where? fills the place', async ({
  page,
  browser,
}) => {
  await page.setViewportSize(phone.viewport);
  await visit(page, '/tools/plan');
  await expect(page.getByText('Start with the one thing you know.')).toBeVisible();
  await page.getByRole('radio', { name: /Birthday/ }).click();
  await page.getByLabel('The plan’s name').fill('Kamila’s Birthday');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('radio', { name: 'Saturday', exact: true }).click();
  await page.getByRole('radio', { name: '7:30 PM' }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByLabel('Your name').fill('Jerry');
  await page.getByRole('button', { name: 'That’s me' }).click();
  await page.getByLabel('Add people').fill('Kamila, Emauri');
  await page.getByLabel('Add people').press('Enter');
  await page.getByRole('button', { name: 'See the plan' }).click();

  const card = page.getByRole('article', { name: 'Kamila’s Birthday' });
  await expect(card).toBeVisible();
  await expect(card.getByText(/Saturday, .* · 7:30 PM/)).toBeVisible();
  await noHorizontalScroll(page);
  await expect(page.getByRole('button', { name: 'Send the invite' }).first()).toBeEnabled();
  const link = page.url();

  const guest = await friend(browser);
  await guest.goto(link, { waitUntil: 'networkidle' });
  await guest.getByRole('radio', { name: 'I’m in' }).click();
  await expect(guest.getByRole('heading', { name: 'Which one is you?' })).toBeVisible();
  await guest.getByRole('button', { name: /Kamila/ }).click();
  await expect(guest.getByText('You’re in, Kamila.')).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Send it back' }).first()).toBeEnabled();
  const back = guest.url();
  await guest.context().close();
  await page.goto(back, { waitUntil: 'networkidle' });
  await expect(page.getByText('Kamila is in.')).toBeVisible();

  // Choose the place with the group: Where? opens for this plan and brings the winner back.
  await page.getByRole('button', { name: /Where: Place to be decided/ }).click();
  await page.getByRole('button', { name: /Let everyone vote/ }).click();
  await page.waitForURL(/\/tools\/where\?plan=/, { timeout: 20_000 });
  await expect(page.getByText('For Kamila’s Birthday', { exact: true })).toBeVisible();
  await page.getByLabel('Add a place or paste a link').fill('Monteverde');
  await page.getByLabel('Add a place or paste a link').press('Enter');
  await page.getByLabel('Add a place or paste a link').fill('Aba');
  await page.getByLabel('Add a place or paste a link').press('Enter');
  await page.getByRole('button', { name: 'Love it: Monteverde' }).click();
  await page.getByRole('button', { name: 'Vote' }).click();
  await page.getByRole('button', { name: /Add to the plan/ }).click();
  await page.waitForURL(/\/tools\/plan/, { timeout: 20_000 });
  await expect(page.getByText('Added from Where?: Monteverde')).toBeVisible();
  await expect(
    page.getByRole('article', { name: 'Kamila’s Birthday' }).getByText('Monteverde'),
  ).toBeVisible();
});

test('Secret Santa: a private draw and an envelope only its person opens', async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize(phone.viewport);
  await visit(page, '/tools/secret-santa');
  await expect(page.getByText('Add the crew.')).toBeVisible();
  await page.getByLabel('Add names').fill('Jerry, Kamila, Emauri and Sophia');
  await page.getByLabel('Add names').press('Enter');
  await page.getByRole('button', { name: 'Keep two people apart' }).click();
  await page.getByRole('button', { name: 'Jerry', exact: true }).click();
  await page.getByRole('button', { name: 'Kamila', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Kept apart' })).toContainText('Jerry');
  await page.getByRole('radio', { name: '$50' }).click();
  await page.getByRole('button', { name: 'Draw names for 4' }).click();
  await expect(page.getByRole('heading', { name: 'Which one is you?' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: /Jerry/ }).click();
  await page.getByRole('button', { name: 'Open it', exact: true }).click();
  // Jerry can't have drawn Kamila, and never himself.
  const mine = page.getByText('You’re giving to').locator('..');
  await expect(mine).not.toContainText(/Kamila|Jerry/);
  await page.getByRole('button', { name: /Send the envelopes/ }).click();
  await expect(page.getByText('0 of 3 sent')).toBeVisible();
  await page.getByRole('button', { name: 'Copy Kamila’s envelope link' }).click();
  await expect(page.getByText('1 of 3 sent')).toBeVisible();
  const message = await page.evaluate(() => navigator.clipboard.readText());
  expect(message).toMatch(/^Kamila, here’s your Secret Santa envelope/);

  const kamila = await friend(browser);
  await kamila.goto(message.slice(message.indexOf('http')), { waitUntil: 'networkidle' });
  await expect(kamila.getByText('For Kamila, and only Kamila.')).toBeVisible();
  await kamila.getByRole('button', { name: 'Open my envelope' }).click();
  const reveal = await kamila.getByText(/You’re giving a gift to/).textContent();
  expect(reveal).not.toMatch(/Kamila|Jerry\.$/);
  await expect(kamila.getByText('Up to $50')).toBeVisible();
  await kamila.context().close();

  // The organizer's page never shows who got whom, and it's all still there after a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByText('1 of 3 sent')).toBeVisible();
  await expect(page.getByText('You’re giving to')).toBeHidden();
});

test('Receipts: a photo is read, checked, filed, found, fixed and exported', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(phone.viewport);
  await visit(page, '/tools/receipts');
  await expect(page.getByText('No receipts yet.')).toBeVisible();
  await noHorizontalScroll(page);
  await page.locator('input[type=file][capture]').setInputFiles('tests/fixtures/receipt.jpg');
  await expect(page.getByRole('button', { name: 'Looks right' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: /^Total: \$70\.69/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Where: Rosa's Kitchen/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Meals/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Looks right' }).click();
  await expect(page.getByText('Filed', { exact: true })).toBeVisible();

  // No photo: type it in.
  await page.getByRole('button', { name: /Type it in/ }).click();
  await expect(page.getByRole('button', { name: 'Add the total to save' })).toBeDisabled();
  await page.getByLabel('Total').fill('48.72');
  await page.getByLabel('Where it’s from').fill('Home Depot');
  await page.getByRole('radio', { name: /Materials/ }).click();
  await page.getByRole('button', { name: 'Looks right' }).click();
  await expect(page.getByRole('button', { name: /Home Depot.*\$48\.72/ })).toBeVisible();

  // Fix one.
  await page.getByRole('button', { name: /Home Depot.*\$48\.72/ }).click();
  await page.getByRole('button', { name: /^Where:/ }).click();
  await page.getByLabel('Where it’s from').fill('The Home Depot');
  await page.getByLabel('Where it’s from').press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /The Home Depot/ })).toBeVisible();

  await page.getByLabel('Search receipts').fill('rosa');
  await expect(page.getByRole('button', { name: /The Home Depot/ })).toBeHidden();
  await page.getByLabel('Search receipts').fill('');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^receipts-\d{4}-\d{2}\.csv$/);

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /Rosa's Kitchen.*\$70\.69/ })).toBeVisible();
});

test('Mileage: start, drive, stop, say what it was for; by hand; again; export', async ({
  browser,
}) => {
  const context = await browser.newContext({
    ...phone,
    geolocation: { latitude: 41.88, longitude: -87.63, accuracy: 8 },
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  await visit(page, '/tools/mileage');
  await expect(page.getByText('No drives yet.')).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: /Start drive/ }).click();
  await expect(page.getByText('Driving…')).toBeVisible();
  // About 30 m a second, north.
  for (let step = 1; step <= 14; step += 1) {
    await context.setGeolocation({
      latitude: 41.88 + step * 0.0003,
      longitude: -87.63,
      accuracy: 8,
    });
    await page.waitForTimeout(1050);
  }
  await expect(page.getByText('GPS is good')).toBeVisible();
  await page.getByRole('button', { name: /Stop/ }).click();
  await expect(page.getByText('Drive done')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Business/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByLabel('Purpose').fill('Site visit');
  await page.getByRole('button', { name: 'Save trip' }).click();
  await expect(page.getByRole('button', { name: /Site visit/ })).toContainText(/0\.[1-4]/);

  await page.getByRole('button', { name: /Add a trip by hand/ }).click();
  await page.getByLabel(/^Miles/).fill('18.2');
  await page.getByText('From, to, purpose, client').click();
  await page.getByLabel('From', { exact: true }).fill('Home');
  await page.getByLabel('To', { exact: true }).fill('Home Depot');
  await page.getByRole('button', { name: 'Log it' }).click();
  // The trip, and the route to drive again.
  await expect(page.getByRole('button', { name: /Home → Home Depot.*18\.2/ })).toHaveCount(2);

  // Drive it again, there and back.
  await page
    .getByRole('list')
    .getByRole('button', { name: /Home → Home Depot.*18\.2 mi/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Round trip' }).click();
  await page.getByRole('button', { name: 'Log it' }).click();
  await expect(page.getByRole('button', { name: /36\.4/ })).toBeVisible();

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^mileage-\d{4}-\d{2}\.csv$/);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: /36\.4/ })).toBeVisible();
  await context.close();
});
