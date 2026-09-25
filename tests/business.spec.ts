import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import postgres from 'postgres';
import { BASE_PATH } from '../src/lib/base-path';

/*
 * Phase 2B, end to end with real accounts (HYPHY_IDENTITY=supabase): a real Supabase Auth server,
 * the database with every migration, Mailpit for Auth's emails, and Hyphy's own invitation emails
 * captured to disk (HYPHY_EMAIL=capture). Nothing is mocked. `npm run test:auth` runs it with
 * tests/auth.spec.ts (playwright.auth.config.ts); without the local stack it skips.
 *
 * Every account is an `…auth-test@hyphy-tools.example` address; everything is deleted afterwards.
 */
const MAILPIT = process.env.AUTH_E2E_MAILPIT_URL;
const ADMIN_DB = process.env.AUTH_E2E_ADMIN_DATABASE_URL;
const MAIL_DIR = process.env.AUTH_E2E_MAIL_DIR ?? '.hyphy-mail/e2e';
test.skip(!MAILPIT || !ADMIN_DB, 'Needs the local Auth stack (docs/AUTH.md).');
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'business-Pass-2026';
const run = Date.now().toString(36);
const address = (who: string) => `${who}-${run}.auth-test@hyphy-tools.example`;
const BUSINESS = `Harbor Build ${run}`;
const SLUG = `harbor-build-${run}`;
const sql = () => postgres(ADMIN_DB!, { max: 1, onnotice: () => {} });

test.afterAll(async () => {
  if (!ADMIN_DB) return;
  const db = sql();
  const pattern = `%-${run}.auth-test@hyphy-tools.example`;
  // Businesses these accounts made go first (an account that owns a business can't simply be
  // deleted — see docs/AUTH.md, account deletion), then the accounts, then their captured mail.
  await db`delete from spaces where kind = 'business' and slug like ${`%${run}%`}`;
  await db`delete from auth.users where email like ${pattern}`;
  await db.end();
});

async function visit(page: Page, to: string) {
  await page.goto(`${BASE_PATH}${to === '/' ? '' : to}`, { waitUntil: 'networkidle' });
}

/** The newest link in Supabase Auth's newest email to `to` (Mailpit). */
async function authLink(to: string, subject: RegExp) {
  let link = '';
  await expect(async () => {
    const found = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    ).then((r) => r.json());
    const message = (found.messages ?? []).find((m: { Subject: string }) =>
      subject.test(m.Subject),
    );
    expect(message).toBeTruthy();
    const full = await fetch(`${MAILPIT}/api/v1/message/${message.ID}`).then((r) => r.json());
    link = /href="([^"]+)"/.exec(full.HTML)![1].replace(/&amp;/g, '&');
  }).toPass({ timeout: 15_000 });
  return link;
}

/** Hyphy's newest captured invitation email to `to`: its subject and the Join link. */
async function invitation(to: string, after = 0) {
  let found = { subject: '', link: '', html: '', text: '' };
  await expect(async () => {
    const files = (await readdir(MAIL_DIR)).filter((file) => file.endsWith('.json')).sort();
    const messages = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(path.join(MAIL_DIR, file), 'utf8'))),
    );
    const mine = messages.filter((message) => message.to === to);
    expect(mine.length).toBeGreaterThan(after);
    const last = mine[mine.length - 1];
    found = {
      subject: last.subject,
      html: last.html,
      text: last.text,
      link: /Accept: (\S+)/.exec(last.text)![1],
    };
  }).toPass({ timeout: 15_000 });
  return found;
}

async function sentTo(to: string) {
  try {
    const files = (await readdir(MAIL_DIR)).filter((file) => file.endsWith('.json'));
    const messages = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(path.join(MAIL_DIR, file), 'utf8'))),
    );
    return messages.filter((message) => message.to === to).length;
  } catch {
    return 0;
  }
}

/** A brand-new confirmed account, signed in on `page`, landing wherever `next` leads. */
async function newAccount(page: Page, name: string, email: string, next?: string) {
  await visit(page, next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto(await authLink(email, /confirm/i), { waitUntil: 'networkidle' });
}

async function fresh(browser: Browser) {
  return (await browser.newContext()).newPage();
}

const toast = (page: Page, text: string | RegExp) =>
  expect(page.locator('[aria-live="polite"]').getByText(text)).toBeVisible();

let owner: Page;
let member: Page;
let projectId = '';

test('a new account creates a business and becomes its owner; Personal stays', async ({
  browser,
}) => {
  owner = await fresh(browser);
  await newAccount(owner, 'Ava Harbor', address('ava'));
  await expect(owner).toHaveURL(`${BASE_PATH}/welcome`);
  await owner.getByRole('link', { name: /Running a business/ }).click();
  await expect(owner).toHaveURL(`${BASE_PATH}/create-business`);

  await owner.getByLabel('Business name').fill(BUSINESS);
  await expect(owner.getByText(SLUG)).toBeVisible();
  // No kind chosen yet: said plainly, nothing created.
  await owner.getByRole('button', { name: 'Create business' }).click();
  await expect(owner.locator('form').getByRole('alert')).toContainText(
    'Choose what kind of business',
  );
  await owner.getByText('Construction / Trades').click();
  await owner.getByRole('button', { name: 'Create business' }).click();

  // Setup: the construction preset is already on; the same toggles as Settings.
  await expect(owner).toHaveURL(`${BASE_PATH}/${SLUG}/setup`);
  await expect(owner.getByRole('heading', { name: `${BUSINESS} is ready.` })).toBeVisible();
  await expect(owner.getByRole('main').getByText('Vehicles', { exact: true })).toBeVisible();
  await owner.getByRole('link', { name: 'Continue' }).click();
  await expect(owner.getByRole('heading', { name: 'Invite your team.' })).toBeVisible();

  const db = sql();
  const rows = await db`
    select m.role, m.status, s.kind, s.business_type, s.work_style, s.labels
    from space_members m join spaces s on s.id = m.space_id
    join profiles p on p.id = m.person_id where p.email = ${address('ava')} order by s.kind`;
  await db.end();
  expect(rows.map((row) => [row.kind, row.role, row.status])).toEqual([
    ['personal', 'owner', 'active'],
    ['business', 'owner', 'active'],
  ]);
  expect(rows[1]).toMatchObject({ business_type: 'construction', work_style: 'jobs' });
  expect(rows[1].labels).toEqual({ projects: { singular: 'Job', plural: 'Jobs' } });
});

test('owner invites a member: an invitation, not a membership, and an email to join', async () => {
  await owner.getByLabel('Email').fill(address('ben'));
  await owner.getByLabel('Role').selectOption('member');
  await owner.getByRole('button', { name: 'Send invite' }).click();
  await expect(owner.getByRole('list', { name: 'Invited' })).toContainText(address('ben'));
  await owner.getByRole('button', { name: 'Finish' }).click();
  await expect(owner).toHaveURL(`${BASE_PATH}/${SLUG}`);
  // A new business: first steps, no invented activity.
  await expect(owner.getByRole('region', { name: 'Start here' })).toContainText('Invite your team');
  await expect(owner.getByRole('region', { name: 'Start here' })).toContainText(
    'Create your first job',
  );

  const email = await invitation(address('ben'));
  expect(email.subject).toBe(`Ava invited you to ${BUSINESS} on Hyphy`);
  expect(email.html).toContain(`Join ${BUSINESS}`);
  expect(email.text).toContain('Your role: Member');
  expect(email.link).toMatch(new RegExp(`${BASE_PATH}/invite/[A-Za-z0-9_-]{43}$`));

  const db = sql();
  const [counts] = await db`
    select (select count(*) from space_invitations i join spaces s on s.id = i.space_id
             where s.slug = ${SLUG} and i.status = 'pending')::int as invitations,
           (select count(*) from space_members m join spaces s on s.id = m.space_id
             where s.slug = ${SLUG})::int as members`;
  // A job, so the dashboards below have something to show (made as the owner would).
  const [job] = await db`
    insert into projects (space_id, created_by, name, status)
    select s.id, m.person_id, 'Pier 9 Refit', 'active' from spaces s
    join space_members m on m.space_id = s.id and m.role = 'owner' where s.slug = ${SLUG}
    returning id`;
  projectId = String(job.id);
  await db.end();
  expect(counts).toEqual({ invitations: 1, members: 1 });

  // People: active and invited, in one place.
  await visit(owner, `/${SLUG}/people`);
  await expect(owner.getByRole('region', { name: 'Invited' })).toContainText(address('ben'));
  await expect(owner.getByText('1 active member · 1 invited')).toBeVisible();
});

test('the invited person without an account: sign up from the link, confirm, accept, see a member’s Home', async ({
  browser,
}) => {
  member = await fresh(browser);
  const { link } = await invitation(address('ben'));
  await member.goto(link, { waitUntil: 'networkidle' });
  await expect(
    member.getByRole('heading', { name: `Ava invited you to ${BUSINESS}.` }),
  ).toBeVisible();
  await expect(member.getByText(address('ben')).first()).toBeVisible();
  await member.getByRole('link', { name: 'Create account to join' }).click();
  // The invited address is filled in; the invitation is kept through confirmation.
  await expect(member.getByLabel('Email')).toHaveValue(address('ben'));
  await member.getByLabel('Name').fill('Ben Dock');
  await member.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await member.getByRole('button', { name: 'Create account' }).click();
  await expect(member.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await member.goto(await authLink(address('ben'), /confirm/i), { waitUntil: 'networkidle' });

  const token = new URL(link).pathname.split('/').pop();
  await expect(member).toHaveURL(`${BASE_PATH}/invite/${token}`);
  await expect(member.getByRole('heading', { name: `Join ${BUSINESS}?` })).toBeVisible();
  await expect(member.getByText('Member', { exact: true })).toBeVisible();
  // Not in yet.
  await visit(member, `/${SLUG}`);
  await expect(member.getByText(/This isn’t in your Spaces/)).toBeVisible();

  await member.goto(link, { waitUntil: 'networkidle' });
  await member.getByRole('button', { name: 'Accept invite' }).click();
  await expect(member).toHaveURL(new RegExp(`${BASE_PATH}/${SLUG}(\\?joined=1)?$`));
  await expect(member.getByRole('region', { name: 'Your actions' })).toBeVisible();

  // Accepting again (a double click, a retried request) changes nothing.
  await member.goto(link, { waitUntil: 'networkidle' });
  await expect(
    member.getByRole('heading', { name: `You’re already part of ${BUSINESS}.` }),
  ).toBeVisible();
  const db = sql();
  const [row] = await db`
    select count(*)::int as n, min(m.role::text) as role from space_members m
    join spaces s on s.id = m.space_id join profiles p on p.id = m.person_id
    where s.slug = ${SLUG} and p.email = ${address('ben')}`;
  await db.end();
  expect(row).toEqual({ n: 1, role: 'member' });

  // Both Spaces in the switcher, with the role in each.
  await visit(member, `/${SLUG}`);
  await member
    .getByRole('button', { name: new RegExp(BUSINESS) })
    .first()
    .click();
  await expect(member.getByRole('link', { name: /Personal\s*Just you/ })).toBeVisible();
  await expect(
    member.getByRole('link', { name: new RegExp(`${BUSINESS}\\s*Member`) }),
  ).toBeVisible();
  await member.keyboard.press('Escape');
});

test('the owner makes them a manager; their Home becomes a manager’s', async () => {
  await visit(owner, `/${SLUG}/people`);
  await owner.getByRole('link', { name: /Ben Dock/ }).click();
  await owner.getByRole('radio', { name: /Manager/ }).click();
  await toast(owner, 'Now Manager');

  await member.reload({ waitUntil: 'networkidle' });
  await visit(member, `/${SLUG}`);
  await expect(member.getByRole('region', { name: 'Your actions' })).toHaveCount(0);
  await expect(member.getByRole('heading', { level: 1 })).toContainText('Ben');
  // Managers see every job; members only theirs.
  await visit(member, `/${SLUG}/projects/${projectId}`);
  await expect(member.getByRole('heading', { name: 'Pier 9 Refit' })).toBeVisible();
});

test('a manager can’t manage people; nobody can invite an owner', async () => {
  await visit(member, `/${SLUG}/people`);
  await expect(member.getByRole('button', { name: 'Invite someone' })).toHaveCount(0);
  await expect(member.getByRole('region', { name: 'Invited' })).toHaveCount(0);
  await visit(owner, `/${SLUG}/people`);
  await owner.getByRole('button', { name: 'Invite someone' }).click();
  await expect(owner.getByRole('radio', { name: /Owner/ })).toHaveCount(0);
  await owner.keyboard.press('Escape');
});

test('invitations: wrong account refused, resend replaces the link, revoke and expiry explain themselves', async ({
  browser,
}) => {
  // Ava invites cleo@…; Ben (signed in as himself) opens Cleo's link.
  await visit(owner, `/${SLUG}/people`);
  await owner.getByRole('button', { name: 'Invite someone' }).click();
  await owner.getByLabel('Email').fill(address('cleo'));
  await owner.getByRole('dialog').getByRole('button', { name: 'Send invite' }).click();
  await toast(owner, `Invitation sent to ${address('cleo')}`);
  const first = await invitation(address('cleo'));

  await member.goto(first.link, { waitUntil: 'networkidle' });
  await expect(
    member.getByRole('heading', { name: 'This invitation is for another account.' }),
  ).toBeVisible();
  await expect(member.getByRole('button', { name: 'Accept invite' })).toHaveCount(0);

  // Resend: a new link by email; the old one stops working.
  await visit(owner, `/${SLUG}/people`);
  const db = sql();
  await db`update space_invitations set sent_at = now() - interval '2 minutes' where email = ${address('cleo')}`;
  await owner.getByRole('button', { name: `Manage the invitation for ${address('cleo')}` }).click();
  await owner.getByRole('button', { name: 'Resend' }).click();
  await toast(owner, 'Sent again, with a new link');
  const second = await invitation(address('cleo'), 1);
  expect(second.link).not.toBe(first.link);
  const stranger = await fresh(browser);
  await stranger.goto(first.link, { waitUntil: 'networkidle' });
  await expect(
    stranger.getByRole('heading', { name: 'This invitation link isn’t valid.' }),
  ).toBeVisible();
  await stranger.goto(second.link, { waitUntil: 'networkidle' });
  await expect(
    stranger.getByRole('heading', { name: new RegExp(`invited you to ${BUSINESS}`) }),
  ).toBeVisible();

  // Change the role before acceptance, then revoke.
  await owner.reload({ waitUntil: 'networkidle' });
  await owner.getByRole('button', { name: `Manage the invitation for ${address('cleo')}` }).click();
  await owner.getByRole('button', { name: 'Guest' }).click();
  await toast(owner, 'They’ll join as Guest');
  await owner.getByRole('button', { name: `Manage the invitation for ${address('cleo')}` }).click();
  await owner.getByRole('button', { name: 'Revoke invitation' }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Revoke invitation' }).click();
  await toast(owner, 'Invitation revoked');
  await stranger.goto(second.link, { waitUntil: 'networkidle' });
  await expect(
    stranger.getByRole('heading', { name: 'This invitation was withdrawn.' }),
  ).toBeVisible();

  // Expired.
  await visit(owner, `/${SLUG}/people`);
  await owner.getByRole('button', { name: 'Invite someone' }).click();
  await owner.getByLabel('Email').fill(address('dora'));
  await owner.getByRole('dialog').getByRole('button', { name: 'Send invite' }).click();
  await toast(owner, `Invitation sent to ${address('dora')}`);
  const dora = await invitation(address('dora'));
  await db`update space_invitations set expires_at = now() - interval '1 minute' where email = ${address('dora')}`;
  await db.end();
  await stranger.goto(dora.link, { waitUntil: 'networkidle' });
  await expect(
    stranger.getByRole('heading', { name: 'This invitation has expired.' }),
  ).toBeVisible();
  await expect(stranger.getByText('Ask the business to send a new one.')).toBeVisible();
  await visit(owner, `/${SLUG}/people`);
  await expect(owner.getByRole('region', { name: 'Invited' })).toContainText('Expired');
});

test('the owner removes Ben: Business access ends at once, Personal and his account stay', async () => {
  await visit(owner, `/${SLUG}/people`);
  await owner.getByRole('link', { name: /Ben Dock/ }).click();
  await owner.getByRole('button', { name: 'Remove from business' }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Remove from business' }).click();
  await expect(owner).toHaveURL(`${BASE_PATH}/${SLUG}/people`);
  await expect(owner.getByRole('link', { name: /Ben Dock/ })).toHaveCount(0);

  await visit(member, `/${SLUG}`);
  await expect(member.getByText(/This isn’t in your Spaces/)).toBeVisible();
  await visit(member, `/${SLUG}/projects/${projectId}`);
  await expect(member.getByText(/This isn’t in your Spaces/)).toBeVisible();
  await visit(member, '/');
  await expect(member).toHaveURL(`${BASE_PATH}/personal`);
  await visit(member, '/personal/profile');
  await expect(member.getByRole('link', { name: new RegExp(BUSINESS) })).toHaveCount(0);

  const db = sql();
  const [row] = await db`
    select (select count(*) from profiles where email = ${address('ben')})::int as profile,
           (select count(*) from space_members m join spaces s on s.id = m.space_id
             join profiles p on p.id = m.person_id
             where p.email = ${address('ben')} and s.kind = 'personal' and m.status = 'active')::int as personal,
           (select m.status from space_members m join spaces s on s.id = m.space_id
             join profiles p on p.id = m.person_id where s.slug = ${SLUG} and p.email = ${address('ben')}) as status,
           (select count(*) from activity a join spaces s on s.id = a.space_id
             where s.slug = ${SLUG} and a.verb = 'removed')::int as logged`;
  await db.end();
  expect(row).toEqual({ profile: 1, personal: 1, status: 'removed', logged: 1 });
});

test('ownership moves only by an explicit transfer, to an active member', async ({ browser }) => {
  // Cleo joins as an admin with a fresh invitation, then Ava hands her the business.
  await visit(owner, `/${SLUG}/people`);
  await owner.getByRole('button', { name: 'Invite someone' }).click();
  await owner.getByLabel('Email').fill(address('cleo'));
  await owner.getByRole('dialog').getByText('Admin', { exact: true }).click();
  await owner.getByRole('dialog').getByRole('button', { name: 'Send invite' }).click();
  await toast(owner, `Invitation sent to ${address('cleo')}`);
  const before = await sentTo(address('cleo'));
  const { link } = await invitation(address('cleo'), before - 1);
  const cleo = await fresh(browser);
  await newAccount(
    cleo,
    'Cleo Quay',
    address('cleo'),
    new URL(link).pathname.replace(BASE_PATH, ''),
  );
  await cleo.getByRole('button', { name: 'Accept invite' }).click();
  await expect(cleo).toHaveURL(new RegExp(`${BASE_PATH}/${SLUG}`));

  await visit(owner, `/${SLUG}/people`);
  await owner.getByRole('link', { name: /Cleo Quay/ }).click();
  await owner.getByRole('button', { name: 'Transfer ownership' }).click();
  const dialog = owner.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Transfer ownership' })).toBeDisabled();
  await dialog.getByLabel(`Type ${BUSINESS} to confirm`).fill(BUSINESS);
  await dialog.getByRole('button', { name: 'Transfer ownership' }).click();
  await toast(owner, 'Ownership transferred. You’re an admin now.');

  const db = sql();
  const roles = await db`
    select p.name, m.role::text as role from space_members m join spaces s on s.id = m.space_id
    join profiles p on p.id = m.person_id
    where s.slug = ${SLUG} and m.status = 'active' order by p.name`;
  await db.end();
  expect(roles).toEqual([
    { name: 'Ava Harbor', role: 'admin' },
    { name: 'Cleo Quay', role: 'owner' },
  ]);
  // Ava, an admin now, can't take it back or manage the owner.
  await visit(owner, `/${SLUG}/people`);
  await owner.getByRole('link', { name: /Cleo Quay/ }).click();
  await expect(owner.getByRole('button', { name: 'Transfer ownership' })).toHaveCount(0);
  await expect(owner.getByRole('button', { name: 'Remove from business' })).toHaveCount(0);
});

test('two businesses stay sealed from each other', async ({ browser }) => {
  // Ben (a former member now) creates his own business; Ava can't reach it, nor he hers.
  await visit(member, '/create-business');
  await member.getByLabel('Business name').fill(`Dock Works ${run}`);
  await member.getByText('Transportation / Field Services').click();
  await member.getByRole('button', { name: 'Create business' }).click();
  await expect(member).toHaveURL(new RegExp(`/dock-works-${run}/setup`));
  await visit(owner, `/dock-works-${run}`);
  await expect(owner.getByText(/This isn’t in your Spaces/)).toBeVisible();
  await visit(owner, `/dock-works-${run}/people`);
  await expect(owner.getByText(/This isn’t in your Spaces/)).toBeVisible();
  await visit(member, `/${SLUG}/people`);
  await expect(member.getByText(/This isn’t in your Spaces/)).toBeVisible();
  void browser;
});
