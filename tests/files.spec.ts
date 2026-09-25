import { expect, test, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { BASE_PATH } from '../src/lib/base-path';

/*
 * Real files, end to end, as real people: the app in real-account mode (HYPHY_IDENTITY=supabase),
 * a real Supabase Auth session in the browser, and real Supabase Storage holding the bytes. Every
 * upload here goes through the product's own pipeline — a signed upload link, the bytes checked
 * again, the database finishing the file — and every open and download through the app's access
 * check and a one-minute signed link.
 *
 * `npm run test:auth` against the local stack (supabase/local/stack.mjs). Everything it makes is
 * deleted afterwards, bytes first.
 */
const env = process.env;
const URL = env.AUTH_E2E_SUPABASE_URL;
const KEY = env.AUTH_E2E_PUBLISHABLE_KEY;
const ADMIN_DB = env.AUTH_E2E_ADMIN_DATABASE_URL;
const SERVICE = env.STORAGE_E2E_SERVICE_KEY;
test.skip(!URL || !KEY || !ADMIN_DB || !SERVICE, 'Needs the local Supabase stack.');

const PASSWORD = 'files-Pass-2026';
const run = Date.now().toString(36);
const address = (who: string) => `${who}-${run}.auth-test@hyphy-tools.example`;
const SLUG = `harbor-files-${run}`;
const space = randomUUID();
const project = randomUUID();
const ids: Record<string, string> = {};

const admin = () => postgres(ADMIN_DB!, { max: 1, onnotice: () => {} });
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PLANS = Buffer.from(`%PDF-1.4\n% Harbor plans ${run}\n%%EOF\n`);

async function account(who: string, name: string) {
  const client = createClient(URL!, KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signUp({
    email: address(who),
    password: PASSWORD,
    options: { data: { name } },
  });
  expect(error).toBeNull();
  ids[who] = data.user!.id;
  const db = admin();
  await db`update auth.users set email_confirmed_at = now() where id = ${ids[who]}`;
  await db.end();
}

async function signIn(browser: Browser, who: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE_PATH}/sign-in`, { waitUntil: 'networkidle' });
  await page.getByLabel('Email').fill(address(who));
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/sign-in'));
  return page;
}

async function visit(page: Page, path: string) {
  await page.goto(`${BASE_PATH}${path}`, { waitUntil: 'networkidle' });
}

/** The stored object for a file record, as Storage has it. */
async function stored(fileId: string) {
  const db = admin();
  const [row] = await db`
    select f.status, f.storage_path, f.size, o.metadata from files f
    left join storage.objects o on o.bucket_id = 'hyphy-files' and o.name = f.storage_path
    where f.id = ${fileId}`;
  await db.end();
  return row as
    | {
        status: string;
        storage_path: string;
        size: string;
        metadata: { size: number; mimetype: string } | null;
      }
    | undefined;
}

async function fileId(name: string) {
  const db = admin();
  const [row] =
    await db`select id from files where space_id = ${space} and name = ${name} order by created_at desc limit 1`;
  await db.end();
  return row?.id as string | undefined;
}

/** Follows the app's download link as this page's person: the app's answer, then the bytes. */
async function fetchAs(page: Page, path: string) {
  return page.request.get(`${BASE_PATH}${path}`, { maxRedirects: 0 });
}

test.describe.configure({ mode: 'serial' });

let dana: Page;
let mike: Page;
let eve: Page;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await account('dana', 'Dana Harbor');
  await account('mike', 'Mike Harbor');
  await account('eve', 'Eve Elsewhere');
  const db = admin();
  await db.begin(async (tx) => {
    await tx`set local hyphy.seeding = on`;
    await tx`insert into spaces (id, slug, kind, name, plan, modules, setup_done_at) values
      (${space}, ${SLUG}, 'business', 'Harbor Files', 'business-pro',
       array['files', 'people', 'projects', 'receipts', 'pdf', 'qr', 'images'], now())`;
    await tx`insert into space_members (space_id, person_id, role, title, status) values
      (${space}, ${ids.dana}, 'owner', 'Owner', 'active'),
      (${space}, ${ids.mike}, 'member', 'Field', 'active')`;
    await tx`insert into projects (id, space_id, created_by, name, team_ids, status) values
      (${project}, ${space}, ${ids.dana}, 'Harbor Pier', ${[ids.mike]}::uuid[], 'active')`;
  });
  await db.end();
  dana = await signIn(browser, 'dana');
  mike = await signIn(browser, 'mike');
  eve = await signIn(browser, 'eve');
});

test.afterAll(async () => {
  if (!ADMIN_DB) return;
  const db = admin();
  const objects = await db`select name from storage.objects where bucket_id = 'hyphy-files'
    and (name like ${`spaces/${space}/%`} or split_part(name, '/', 2) in (
      select s.id::text from spaces s join profiles p on p.id = s.owner_id
      where p.email like ${`%-${run}.auth-test@hyphy-tools.example`}))`;
  if (objects.length)
    await createClient(URL!, SERVICE!, { auth: { persistSession: false } })
      .storage.from('hyphy-files')
      .remove(objects.map((row) => row.name as string));
  await db.begin(async (tx) => {
    await tx`set local hyphy.seeding = on`;
    await tx`delete from spaces where id = ${space} or owner_id in (
      select id from profiles where email like ${`%-${run}.auth-test@hyphy-tools.example`})`;
    await tx`delete from auth.users where email like ${`%-${run}.auth-test@hyphy-tools.example`}`;
  });
  const [left] =
    await db`select count(*)::int as n from storage.objects where name like ${`spaces/${space}/%`}`;
  expect(left.n, 'no test bytes left behind').toBe(0);
  await db.end();
});

test('Dana uploads plans to a project; the bytes are in Storage, private, and open for her team', async () => {
  await visit(dana, `/${SLUG}/files`);
  await dana.getByRole('button', { name: 'Upload', exact: true }).click();
  const sheet = dana.getByRole('dialog', { name: 'Upload files' });
  await sheet.locator('input[type=file]').setInputFiles({
    name: 'Harbor Plans.pdf',
    mimeType: 'application/pdf',
    buffer: PLANS,
  });
  await sheet.getByLabel('Belongs to').selectOption({ label: 'Harbor Pier' });
  await sheet.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(sheet).toBeHidden({ timeout: 20_000 });

  const id = (await fileId('Harbor Plans.pdf'))!;
  const row = await stored(id);
  // Hyphy's own path: the Space, the file's id, a safe name. The bytes and the record agree.
  expect(row?.status).toBe('ready');
  expect(row?.storage_path).toBe(`spaces/${space}/files/${id}/harbor-plans.pdf`);
  expect(row?.metadata).toMatchObject({ size: PLANS.length, mimetype: 'application/pdf' });

  // Download: the app checks access, then redirects to a short-lived signed link.
  const answer = await fetchAs(dana, `/${SLUG}/files/${id}/download`);
  expect(answer.status()).toBe(302);
  const location = answer.headers().location;
  expect(location).toContain('/storage/v1/object/sign/hyphy-files/');
  expect(location).toContain('token=');
  const bytes = await dana.request.get(location);
  expect(await bytes.body()).toEqual(PLANS);
  expect(bytes.headers()['content-disposition']).toContain('Harbor Plans.pdf');

  // Mike is on the project: he sees it there and opens it.
  await visit(mike, `/${SLUG}/projects/${project}?tab=files`);
  await expect(mike.getByRole('link', { name: /Harbor Plans\.pdf/ })).toBeVisible();
  const his = await fetchAs(mike, `/${SLUG}/files/${id}/open`);
  expect(his.status()).toBe(302);
  expect(await (await mike.request.get(his.headers().location)).body()).toEqual(PLANS);

  // Eve, in another business, with the exact link and id: nothing.
  const hers = await fetchAs(eve, `/${SLUG}/files/${id}/download`);
  expect(hers.status()).toBe(404);
  // The signed link itself expires; Storage refuses a path without one.
  const bare = await eve.request.get(`${URL}/storage/v1/object/hyphy-files/${row!.storage_path}`, {
    headers: { apikey: KEY! },
  });
  expect(bare.ok()).toBe(false);
});

test('a program named invoice.pdf never reaches Storage', async () => {
  await visit(dana, `/${SLUG}/files`);
  await dana.getByRole('button', { name: 'Upload', exact: true }).click();
  const sheet = dana.getByRole('dialog', { name: 'Upload files' });
  await sheet.locator('input[type=file]').setInputFiles({
    name: 'invoice.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('MZ\x90\x00\x03\x00\x00\x00 this is a program'),
  });
  await sheet.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(sheet.getByText(/isn’t really a PDF file/)).toBeVisible();
  await dana.keyboard.press('Escape');
  expect(await fileId('invoice.pdf')).toBeUndefined();
});

test('Mike photographs a receipt; Dana sees the real photo from Storage and approves', async () => {
  await visit(mike, `/${SLUG}/tools/receipts`);
  await mike
    .getByRole('button', { name: /Submit receipt/ })
    .first()
    .click();
  const sheet = mike.getByRole('dialog');
  await sheet.getByLabel('Choose a photo or PDF').setInputFiles({
    name: 'pier-receipt.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(sheet.getByText('Uploaded. Fill in the details below.')).toBeVisible({
    timeout: 20_000,
  });
  await sheet.getByLabel('Where').fill('Marine Supply');
  await sheet.getByLabel('Total').fill('88.10');
  await sheet.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(sheet).toBeHidden({ timeout: 20_000 });

  const photo = (await fileId('pier-receipt.png'))!;
  expect((await stored(photo))?.metadata).toMatchObject({ mimetype: 'image/png' });

  await visit(dana, `/${SLUG}/tools/receipts`);
  await dana
    .getByRole('link', { name: /Marine Supply/ })
    .first()
    .click();
  const figure = dana.getByRole('figure', { name: 'Receipt photo' });
  const img = figure.locator('img');
  await expect(img).toBeVisible();
  // A signed Storage link made for this page, not a stored URL — and it really loads.
  expect(await img.getAttribute('src')).toContain('/storage/v1/object/sign/hyphy-files/');
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  await dana.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dana.getByText('Approved').first()).toBeVisible();
});

test('tools save real results: a PDF, a resized image, a QR code', async () => {
  await visit(dana, `/${SLUG}/tools/pdf`);
  await dana.getByRole('button', { name: /Try three samples/ }).click();
  await dana.getByRole('button', { name: 'Merge 3 PDFs' }).click();
  await dana.getByRole('button', { name: 'Save to Files' }).click();
  await expect(dana.getByRole('link', { name: /Saved to Files · Open/ })).toBeVisible({
    timeout: 20_000,
  });
  const db = admin();
  const results = await db`
    select f.source, f.mime_type, f.status, o.metadata ->> 'size' as bytes, f.size
    from files f join storage.objects o on o.bucket_id = 'hyphy-files' and o.name = f.storage_path
    where f.space_id = ${space} and f.source = 'pdf'`;
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ mime_type: 'application/pdf', status: 'ready' });
  expect(Number(results[0].bytes)).toBe(Number(results[0].size));

  await visit(dana, `/${SLUG}/tools/images`);
  await dana.getByRole('button', { name: /Try a sample photo/ }).click();
  await dana.getByRole('button', { name: /Save 1 to Files/ }).click({ timeout: 20_000 });
  await expect(dana.getByRole('link', { name: /Saved to Files · Open/ })).toBeVisible({
    timeout: 20_000,
  });
  const images = await db`
    select f.mime_type, f.width, f.height, (o.metadata ->> 'size')::int as bytes, f.size
    from files f join storage.objects o on o.bucket_id = 'hyphy-files' and o.name = f.storage_path
    where f.space_id = ${space} and f.source = 'images'`;
  expect(images).toHaveLength(1);
  expect(images[0].width).toBe(1920);
  expect(images[0].bytes).toBe(Number(images[0].size));

  await visit(dana, `/${SLUG}/tools/qr`);
  await dana.getByLabel('Link or text').fill('https://harbor.example/pier');
  await dana.getByRole('button', { name: 'Save image to Files' }).click();
  await expect(dana.getByRole('button', { name: 'Image saved to Files' })).toBeVisible({
    timeout: 20_000,
  });
  // Previewing made nothing; saving made exactly one stored PNG.
  const codes =
    await db`select f.mime_type from files f join storage.objects o on o.name = f.storage_path
                         where f.space_id = ${space} and f.source = 'qr'`;
  expect(codes.map((row) => row.mime_type)).toEqual(['image/png']);
  await db.end();
});

test('Trash hides a file; deleting it for good removes its bytes from Storage', async () => {
  const id = (await fileId('Harbor Plans.pdf'))!;
  const path = (await stored(id))!.storage_path;
  await visit(dana, `/${SLUG}/files?file=${id}`);
  await dana.getByRole('button', { name: 'Move to Trash' }).click();
  await dana
    .getByRole('dialog', { name: 'Move to Trash?' })
    .getByRole('button', { name: 'Move to Trash' })
    .click();
  await expect(dana.getByRole('link', { name: /Harbor Plans\.pdf/ })).toHaveCount(0);
  // Mike no longer opens it; the bytes are still stored.
  expect((await fetchAs(mike, `/${SLUG}/files/${id}/open`)).status()).toBe(404);
  expect((await stored(id))?.metadata).toBeTruthy();
  await visit(dana, `/${SLUG}/files?view=trash&file=${id}`);
  await dana.getByRole('button', { name: 'Delete for good' }).click();
  await dana
    .getByRole('dialog', { name: 'Delete for good?' })
    .getByRole('button', { name: 'Delete for good' })
    .click();
  await expect(dana.getByText('Deleted for good')).toBeVisible();
  const db = admin();
  const [row] = await db`select (select count(*) from files where id = ${id})::int as records,
                                (select count(*) from storage.objects where name = ${path})::int as objects`;
  await db.end();
  expect(row).toEqual({ records: 0, objects: 0 });
});

test('the logo: Dana uploads it and her team sees it on the business’s mark', async () => {
  await visit(dana, `/${SLUG}/settings/basics`);
  await dana
    .getByLabel('Upload logo')
    .setInputFiles({ name: 'harbor.png', mimeType: 'image/png', buffer: PNG });
  await expect(dana.getByText('Logo updated')).toBeVisible({ timeout: 20_000 });
  await visit(mike, `/${SLUG}`);
  const logo = mike.locator(`img[src*="/${SLUG}/logo"]`).first();
  await expect(logo).toBeAttached();
  await expect.poll(() => logo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1);
  // Someone outside the business gets nothing from the logo address.
  expect((await fetchAs(eve, `/${SLUG}/logo`)).status()).toBe(404);
});

test('a removed member loses every file, even with the links in hand', async () => {
  const photo = (await fileId('pier-receipt.png'))!;
  expect((await fetchAs(mike, `/${SLUG}/files/${photo}/open`)).status()).toBe(302);
  const db = admin();
  await db.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${JSON.stringify({ sub: ids.dana, role: 'authenticated' })}, true)`;
    await tx`select remove_member(${space}, ${ids.mike})`;
  });
  await db.end();
  expect((await fetchAs(mike, `/${SLUG}/files/${photo}/open`)).status()).toBe(404);
  expect((await fetchAs(mike, `/${SLUG}/logo`)).status()).toBe(404);
  // The business keeps his receipt photo.
  expect((await fetchAs(dana, `/${SLUG}/files/${photo}/open`)).status()).toBe(302);
});
