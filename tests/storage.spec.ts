import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

/*
 * Supabase Storage, for real: a real Storage service, real accounts signed in with Supabase Auth,
 * real signed upload and download links, and Hyphy's policies on `storage.objects` — nothing
 * mocked. Each person uses Storage the way the app does on their behalf: as themselves, with the
 * publishable key. What the app's server does in the database (start a file's record, finish it)
 * is done here the same way, as that person under Row Level Security.
 *
 * Runs with `npm run test:auth` against the local stack (supabase/local/stack.mjs). Everything it
 * makes — accounts, businesses, files, stored bytes — is deleted afterwards.
 */
const env = process.env;
const URL = env.AUTH_E2E_SUPABASE_URL;
const KEY = env.AUTH_E2E_PUBLISHABLE_KEY;
const ADMIN_DB = env.AUTH_E2E_ADMIN_DATABASE_URL;
const APP_DB = env.AUTH_E2E_DATABASE_URL;
const SERVICE = env.STORAGE_E2E_SERVICE_KEY;
test.skip(!URL || !KEY || !ADMIN_DB || !APP_DB || !SERVICE, 'Needs the local Supabase stack.');

const BUCKET = 'hyphy-files';
const PASSWORD = 'storage-Pass-2026';
const run = Date.now().toString(36);
const address = (who: string) => `${who}-${run}.auth-test@hyphy-tools.example`;

type Person = { id: string; client: SupabaseClient };
const people: Record<string, Person> = {};
const spaceA = randomUUID();
const spaceB = randomUUID();
const projectShared = randomUUID();
const projectOther = randomUUID();
const made: string[] = [];

const admin = () => postgres(ADMIN_DB!, { max: 1, onnotice: () => {} });
const app = postgres(APP_DB ?? 'postgres://invalid', { max: 2, onnotice: () => {} });

/** SQL as one person, under Row Level Security — how the app's server reaches the database. */
async function as<T>(person: Person, work: (tx: postgres.TransactionSql) => Promise<T>) {
  return (await app.begin(async (tx) => {
    const claims = JSON.stringify({ sub: person.id, role: 'authenticated' });
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${claims}, true)`;
    return work(tx);
  })) as T;
}

async function account(who: string): Promise<Person> {
  const client = createClient(URL!, KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = address(who);
  const { error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { name: who } },
  });
  expect(error).toBeNull();
  const db = admin();
  await db`update auth.users set email_confirmed_at = now() where email = ${email}`;
  await db.end();
  const { data, error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();
  return { id: data.user!.id, client };
}

const storage = (person: Person) => person.client.storage.from(BUCKET);
const pdf = (text: string) =>
  new Blob([`%PDF-1.4\n% ${text}\n%%EOF\n`], { type: 'application/pdf' });
const png = () =>
  new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], {
    type: 'image/png',
  });

type Start = {
  space?: string;
  name?: string;
  mime?: string;
  size: number;
  access?: string;
  source?: string | null;
  attach?: { type: string; id: string };
};

/** What prepareUpload writes: a pending record whose path is made from its own Space and id. */
async function start(person: Person, options: Start) {
  const id = randomUUID();
  const space = options.space ?? spaceA;
  const mime = options.mime ?? 'application/pdf';
  const path = `spaces/${space}/files/${id}/${mime === 'image/png' ? 'image.png' : 'plans.pdf'}`;
  await as(person, async (tx) => {
    await tx`
      insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type,
                         folder, access, source, storage_bucket, storage_path, status)
      values (${id}, ${space}, ${person.id}, ${options.name ?? 'Plans.pdf'},
              ${options.name ?? 'Plans.pdf'}, ${mime === 'image/png' ? 'image' : 'pdf'},
              ${options.size}, ${mime}, 'Uploads', ${options.access ?? 'team'},
              ${options.source ?? null}, ${BUCKET}, ${path}, 'pending')`;
    if (options.attach)
      await tx`insert into file_attachments (file_id, record_type, record_id)
               values (${id}, ${options.attach.type}, ${options.attach.id})`;
  });
  made.push(path);
  return { id, path };
}

const finish = (person: Person, id: string) =>
  as(person, async (tx) => (await tx`select finish_upload(${id}) as outcome`)[0].outcome as string);

/** Start, upload through a signed link, finish: a ready file. */
async function stored(person: Person, options: Omit<Start, 'size'> & { body?: Blob } = {}) {
  const body = options.body ?? pdf(randomUUID());
  const file = await start(person, { ...options, size: body.size, mime: body.type });
  const signed = await storage(person).createSignedUploadUrl(file.path);
  expect(signed.error).toBeNull();
  const upload = await storage(person).uploadToSignedUrl(file.path, signed.data!.token, body);
  expect(upload.error).toBeNull();
  expect(await finish(person, file.id)).toBe('ready');
  return file;
}

/** Whether this person gets a working read link for that path. */
async function canRead(person: Person, path: string) {
  const { data, error } = await storage(person).createSignedUrl(path, 60);
  if (error || !data) return false;
  return (await fetch(data.signedUrl)).ok;
}

async function objectExists(path: string) {
  const db = admin();
  const [row] =
    await db`select count(*)::int as n from storage.objects where bucket_id = ${BUCKET} and name = ${path}`;
  await db.end();
  return row.n === 1;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  for (const who of ['dana', 'luis', 'nia', 'mike', 'omar', 'chris', 'sam', 'eve'])
    people[who] = await account(who);
  const { dana, luis, nia, mike, omar, chris, sam, eve } = people;
  const db = admin();
  await db.begin(async (tx) => {
    await tx`set local hyphy.seeding = on`;
    await tx`insert into spaces (id, slug, kind, name, modules) values
      (${spaceA}, ${`storage-a-${run}`}, 'business', 'Storage Test A',
       array['files', 'people', 'projects', 'vehicles', 'receipts', 'mileage', 'pdf', 'qr', 'images']),
      (${spaceB}, ${`storage-b-${run}`}, 'business', 'Storage Test B', array['files', 'people'])`;
    await tx`insert into space_members (space_id, person_id, role, title, status, project_ids) values
      (${spaceA}, ${dana.id}, 'owner', 'Owner', 'active', '{}'),
      (${spaceA}, ${luis.id}, 'admin', 'Admin', 'active', '{}'),
      (${spaceA}, ${nia.id}, 'manager', 'Manager', 'active', '{}'),
      (${spaceA}, ${mike.id}, 'member', 'Field', 'active', '{}'),
      (${spaceA}, ${omar.id}, 'member', 'Field', 'active', '{}'),
      (${spaceA}, ${chris.id}, 'guest', 'Sub', 'active', ${[projectShared]}::uuid[]),
      (${spaceA}, ${sam.id}, 'member', 'Field', 'active', '{}'),
      (${spaceB}, ${eve.id}, 'owner', 'Owner', 'active', '{}')`;
    await tx`insert into projects (id, space_id, created_by, name, team_ids) values
      (${projectShared}, ${spaceA}, ${dana.id}, 'Shared job', ${[mike.id]}::uuid[]),
      (${projectOther}, ${spaceA}, ${dana.id}, 'Other job', '{}')`;
  });
  await db.end();
});

test.afterAll(async () => {
  if (!ADMIN_DB) return;
  // Stored bytes first (with the local stack's service key — test cleanup only), then rows.
  const cleaner = createClient(URL!, SERVICE!, { auth: { persistSession: false } });
  const db = admin();
  const left = await db`select name from storage.objects
                        where bucket_id = ${BUCKET} and (name like ${`spaces/${spaceA}/%`}
                          or name like ${`spaces/${spaceB}/%`} or name = any(${made}))`;
  if (left.length) await cleaner.storage.from(BUCKET).remove(left.map((row) => row.name as string));
  const personal = await db`select s.id from spaces s join profiles p on p.id = s.owner_id
                            where p.email like ${`%-${run}.auth-test@hyphy-tools.example`}`;
  const more = await db`select name from storage.objects where bucket_id = ${BUCKET}
                        and split_part(name, '/', 2) = any(${personal.map((row) => row.id as string)})`;
  if (more.length) await cleaner.storage.from(BUCKET).remove(more.map((row) => row.name as string));
  await db.begin(async (tx) => {
    await tx`set local hyphy.seeding = on`;
    await tx`delete from spaces where id in (${spaceA}, ${spaceB})`;
    // Their Personal Spaces (and files) before the accounts: see docs/AUTH.md, account deletion.
    await tx`delete from spaces where id = any(${personal.map((row) => row.id as string)})`;
    await tx`delete from auth.users where email like ${`%-${run}.auth-test@hyphy-tools.example`}`;
  });
  const [row] = await db`select count(*)::int as n from storage.objects where bucket_id = ${BUCKET}
                          and (name like ${`spaces/${spaceA}/%`} or name like ${`spaces/${spaceB}/%`})`;
  expect(row.n, 'no test bytes left behind').toBe(0);
  await db.end();
  await app.end();
});

test('the bucket is private: no public link, no anonymous reads', async () => {
  const db = admin();
  const [bucket] =
    await db`select public, file_size_limit, allowed_mime_types from storage.buckets where id = ${BUCKET}`;
  await db.end();
  expect(bucket.public).toBe(false);
  expect(bucket.allowed_mime_types).not.toContain('text/html');
  expect(bucket.allowed_mime_types).not.toContain('image/svg+xml');
  const file = await stored(people.dana);
  const anonymous = createClient(URL!, KEY!, { auth: { persistSession: false } });
  const { data } = await anonymous.storage.from(BUCKET).createSignedUrl(file.path, 60);
  expect(data).toBeNull();
  const publicUrl = anonymous.storage.from(BUCKET).getPublicUrl(file.path).data.publicUrl;
  expect((await fetch(publicUrl)).ok).toBe(false);
});

test('an owner uploads through a signed link; the file is ready only once its bytes are there', async () => {
  const { dana } = people;
  const body = pdf('Oak Brook plans');
  const file = await start(dana, { size: body.size });
  // Nothing arrived yet: not finished, and nobody else can see it.
  expect(await finish(dana, file.id)).toBe('missing');
  const signed = await storage(dana).createSignedUploadUrl(file.path);
  expect(signed.error).toBeNull();
  expect(
    (await storage(dana).uploadToSignedUrl(file.path, signed.data!.token, body)).error,
  ).toBeNull();
  // Uploaded but not finished: only its uploader can read it — not even the other owner-level roles.
  expect(await canRead(dana, file.path)).toBe(true);
  expect(await canRead(people.luis, file.path)).toBe(false);
  expect(await finish(dana, file.id)).toBe('ready');
  expect(await canRead(people.luis, file.path)).toBe(true);
  // Downloads are the same bytes, with the file's name.
  const { data } = await storage(dana).createSignedUrl(file.path, 60, {
    download: 'Oak Brook Plans.pdf',
  });
  const response = await fetch(data!.signedUrl);
  expect(await response.text()).toBe(await body.text());
  expect(response.headers.get('content-disposition')).toContain('Oak Brook Plans.pdf');
  // The upload wrote its activity line, once, when it finished.
  const lines = await as(dana, (tx) => tx`select verb from activity where object_id = ${file.id}`);
  expect(lines.map((row) => row.verb)).toEqual(['uploaded']);
});

test('who can open what: roles, guests, another business and a removed member', async () => {
  const { dana, luis, nia, mike, chris, sam, eve } = people;
  const team = await stored(dana);
  const shared = await stored(dana, {
    access: 'shared',
    attach: { type: 'project', id: projectShared },
  });
  const other = await stored(dana, { attach: { type: 'project', id: projectOther } });
  const privateFile = await stored(dana, { access: 'private' });
  const samsOwn = await stored(sam);

  for (const person of [dana, luis, nia, mike]) expect(await canRead(person, team.path)).toBe(true);
  // Guests: only what's on the projects shared with them.
  expect(await canRead(chris, shared.path)).toBe(true);
  expect(await canRead(chris, team.path)).toBe(false);
  expect(await canRead(chris, other.path)).toBe(false);
  // A member not on that project; managers see it.
  expect(await canRead(mike, other.path)).toBe(false);
  expect(await canRead(nia, other.path)).toBe(true);
  // Private: its uploader only.
  expect(await canRead(luis, privateFile.path)).toBe(false);
  expect(await canRead(dana, privateFile.path)).toBe(true);
  // Another business, knowing every path, gets nothing — no link, no download, no listing.
  for (const path of [team.path, shared.path, privateFile.path])
    expect(await canRead(eve, path)).toBe(false);
  expect((await storage(eve).download(team.path)).data).toBeNull();
  const listing = await storage(eve).list(`spaces/${spaceA}/files`);
  expect(listing.data ?? []).toHaveLength(0);

  // Sam is removed from the business: nothing, not even the file he uploaded; the business keeps it.
  expect(await canRead(sam, samsOwn.path)).toBe(true);
  await as(dana, (tx) => tx`select remove_member(${spaceA}, ${sam.id})`);
  expect(await canRead(sam, samsOwn.path)).toBe(false);
  expect(await canRead(sam, team.path)).toBe(false);
  expect(await as(sam, (tx) => tx`select id from files where id = ${samsOwn.id}`)).toHaveLength(0);
  expect(await canRead(dana, samsOwn.path)).toBe(true);
});

test('nobody writes bytes anywhere but a file they just started', async () => {
  const { dana, mike, eve } = people;
  const ready = await stored(dana);
  // Another business can't get an upload link into this one — not for a new path, not for a file.
  const intrusion = `spaces/${spaceA}/files/${randomUUID()}/evil.pdf`;
  expect((await storage(eve).createSignedUploadUrl(intrusion)).error).not.toBeNull();
  expect((await storage(eve).upload(intrusion, pdf('evil'))).error).not.toBeNull();
  // Nor can it make a record in its own Space that points at this one's bytes.
  const hijack = randomUUID();
  await expect(
    as(
      eve,
      (tx) => tx`
      insert into files (id, space_id, created_by, name, original_name, kind, size, mime_type,
                         folder, access, storage_bucket, storage_path, status)
      values (${hijack}, ${spaceB}, ${eve.id}, 'x.pdf', 'x.pdf', 'pdf', 10, 'application/pdf',
              'Uploads', 'team', ${BUCKET}, ${ready.path}, 'pending')`,
    ),
  ).rejects.toThrow(/files_path_is_its_own/);
  // A finished file is never overwritten: no new link, no upsert, no move, no direct upload.
  expect((await storage(dana).createSignedUploadUrl(ready.path)).error).not.toBeNull();
  expect(
    (await storage(dana).createSignedUploadUrl(ready.path, { upsert: true })).error,
  ).not.toBeNull();
  expect(
    (await storage(dana).upload(ready.path, pdf('again'), { upsert: true })).error,
  ).not.toBeNull();
  expect((await storage(mike).upload(ready.path, pdf('again'))).error).not.toBeNull();
  expect(
    (await storage(dana).move(ready.path, `spaces/${spaceA}/files/${randomUUID()}/moved.pdf`))
      .error,
  ).not.toBeNull();
  // A record's place and bytes can't be changed after it's made.
  await expect(
    as(
      dana,
      (tx) =>
        tx`update files set storage_path = ${`spaces/${spaceA}/files/${ready.id}/other.pdf`} where id = ${ready.id}`,
    ),
  ).rejects.toThrow(/permission denied/);
  await expect(
    as(dana, (tx) => tx`update files set status = 'ready', size = 1 where id = ${ready.id}`),
  ).rejects.toThrow(/permission denied/);
  // Someone else's pending file: no upload link for it.
  const pending = await start(dana, { size: 20 });
  expect((await storage(mike).createSignedUploadUrl(pending.path)).error).not.toBeNull();
  // Only accepted kinds reach the bucket, whatever the record says.
  const html = await start(dana, { size: 30, mime: 'application/pdf' });
  const link = await storage(dana).createSignedUploadUrl(html.path);
  const rejected = await storage(dana).uploadToSignedUrl(
    html.path,
    link.data!.token,
    new Blob(['<html><script>alert(1)</script></html>'], { type: 'text/html' }),
  );
  expect(rejected.error).not.toBeNull();
});

test('what arrives must be what was promised', async () => {
  const { dana } = people;
  const file = await start(dana, { size: 999 });
  const link = await storage(dana).createSignedUploadUrl(file.path);
  await storage(dana).uploadToSignedUrl(file.path, link.data!.token, pdf('short'));
  expect(await finish(dana, file.id)).toBe('mismatch');
  expect(await canRead(people.luis, file.path)).toBe(false);
  // Its uploader removes the bytes, then the record.
  expect((await storage(dana).remove([file.path])).error).toBeNull();
  expect(await objectExists(file.path)).toBe(false);
  expect(
    await as(dana, (tx) => tx`delete from files where id = ${file.id} returning id`),
  ).toHaveLength(1);
});

test('removing bytes: never by a member, only from Trash, and never the record first', async () => {
  const { dana, mike, nia, omar } = people;
  const file = await stored(dana);
  // A member can't remove anything; Storage quietly removes nothing.
  await storage(mike).remove([file.path]);
  expect(await objectExists(file.path)).toBe(true);
  // A member can't move someone else's file to Trash either.
  expect(
    await as(
      mike,
      (tx) => tx`update files set deleted_at = now() where id = ${file.id} returning id`,
    ),
  ).toHaveLength(0);
  // Not in Trash: even the owner can't remove the bytes.
  await storage(dana).remove([file.path]);
  expect(await objectExists(file.path)).toBe(true);
  // To Trash (by a manager): people who only saw it lose it; it's still stored.
  const [trashed] = await as(
    nia,
    (tx) => tx`update files set deleted_at = now() where id = ${file.id} returning deleted_by`,
  );
  expect(trashed.deleted_by).toBe(nia.id);
  expect(await canRead(omar, file.path)).toBe(false);
  expect(await canRead(dana, file.path)).toBe(true);
  // The record can't go while its bytes are stored.
  await expect(as(dana, (tx) => tx`delete from files where id = ${file.id}`)).rejects.toThrow(
    /bytes/,
  );
  // A member still can't remove it from Trash; a file manager can.
  await storage(omar).remove([file.path]);
  expect(await objectExists(file.path)).toBe(true);
  expect((await storage(nia).remove([file.path])).error).toBeNull();
  expect(await objectExists(file.path)).toBe(false);
  expect(
    await as(nia, (tx) => tx`delete from files where id = ${file.id} returning id`),
  ).toHaveLength(1);
});

test('a receipt photo is its submitter’s until it’s on the receipt, then follows the receipt', async () => {
  const { dana, nia, mike, omar, chris } = people;
  const photo = await stored(mike, { access: 'private', source: 'receipts', body: png() });
  expect(await canRead(dana, photo.path)).toBe(false);
  // Someone else can't put Mike's photo on their receipt.
  await expect(
    as(
      omar,
      (
        tx,
      ) => tx`insert into receipts (space_id, created_by, vendor, category, total, date, status, file_id)
                        values (${spaceA}, ${omar.id}, 'Shell', 'fuel', 10, now(), 'submitted', ${photo.id})`,
    ),
  ).rejects.toThrow(/isn’t available/);
  const [receipt] = await as(
    mike,
    (tx) => tx`
    insert into receipts (space_id, created_by, vendor, category, total, date, status, file_id)
    values (${spaceA}, ${mike.id}, 'Shell', 'fuel', 64.18, now(), 'submitted', ${photo.id}) returning id`,
  );
  expect(receipt.id).toBeTruthy();
  // Now approvers see it with the receipt; other members and guests don't.
  expect(await canRead(dana, photo.path)).toBe(true);
  expect(await canRead(nia, photo.path)).toBe(true);
  expect(await canRead(omar, photo.path)).toBe(false);
  expect(await canRead(chris, photo.path)).toBe(false);
  // It stays with the receipt: it can't be moved to Trash.
  await expect(
    as(mike, (tx) => tx`update files set deleted_at = now() where id = ${photo.id}`),
  ).rejects.toThrow(/belongs to a receipt/);
  // A business can require a photo; the database refuses a receipt without one.
  const db = admin();
  await db`insert into space_settings (space_id, settings) values (${spaceA}, '{"receipts":{"requirePhoto":true}}')
           on conflict (space_id) do update set settings = excluded.settings`;
  await db.end();
  await expect(
    as(
      omar,
      (tx) => tx`insert into receipts (space_id, created_by, vendor, category, total, date, status)
                        values (${spaceA}, ${omar.id}, 'Menards', 'materials', 20, now(), 'submitted')`,
    ),
  ).rejects.toThrow(/photo of the receipt/);
  const fake = randomUUID();
  await expect(
    as(
      omar,
      (
        tx,
      ) => tx`insert into receipts (space_id, created_by, vendor, category, total, date, status, file_id)
                        values (${spaceA}, ${omar.id}, 'Menards', 'materials', 20, now(), 'submitted', ${fake})`,
    ),
  ).rejects.toThrow(/isn’t available/);
});

test('the logo: owners and admins set it, every member sees it, the old one leaves', async () => {
  const { luis, nia, chris, eve } = people;
  const first = await stored(luis, { source: 'brand', body: png() });
  await as(luis, (tx) => tx`select set_space_logo(${spaceA}, ${first.id})`);
  expect(await canRead(chris, first.path)).toBe(true);
  expect(await canRead(eve, first.path)).toBe(false);
  // A manager can't change it, even to their own upload.
  const managers = await stored(nia, { source: 'brand', body: png() });
  await expect(
    as(nia, (tx) => tx`select set_space_logo(${spaceA}, ${managers.id})`),
  ).rejects.toThrow(/Only owners and admins/);
  // Replacing it: the old logo goes to Trash, its bytes are then removed, then its record.
  const second = await stored(luis, { source: 'brand', body: png() });
  const [row] = await as(
    luis,
    (tx) => tx`select set_space_logo(${spaceA}, ${second.id}) as previous`,
  );
  expect(row.previous).toBe(first.id);
  expect(await canRead(chris, first.path)).toBe(false);
  expect((await storage(luis).remove([first.path])).error).toBeNull();
  expect(
    await as(luis, (tx) => tx`delete from files where id = ${first.id} returning id`),
  ).toHaveLength(1);
  expect(await objectExists(first.path)).toBe(false);
});

test('Personal files are their owner’s alone', async () => {
  const { dana, mike } = people;
  const db = admin();
  const [personal] =
    await db`select id from spaces where owner_id = ${dana.id} and kind = 'personal'`;
  await db.end();
  const file = await stored(dana, { space: personal.id as string, access: 'private' });
  expect(await canRead(dana, file.path)).toBe(true);
  expect(await canRead(mike, file.path)).toBe(false);
  // Storage used is told to the people who run a Space, and to nobody else.
  const [usage] = await as(
    dana,
    (tx) => tx`select space_storage_bytes(${personal.id as string}) as bytes`,
  );
  expect(Number(usage.bytes)).toBeGreaterThan(0);
  const [none] = await as(mike, (tx) => tx`select space_storage_bytes(${spaceA}) as bytes`);
  expect(none.bytes).toBeNull();
});
