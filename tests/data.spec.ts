import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { createRepository } from '@/lib/data/core';
import { seed, type Dataset } from '@/lib/data/demo/seed';
import { visibleTo } from '@/lib/data/demo/visibility';
import { RuleError } from '@/lib/data/repository';
import type { Visible } from '@/lib/data/source';
import { asPerson, db } from '@/lib/data/supabase/db';
import { renameSelf } from '@/lib/data/supabase/profile';
import { resetWorld } from '@/lib/data/supabase/dev';
import { demoUuid } from '@/lib/data/supabase/rows';
import { loadSession } from '@/lib/data/supabase/session';
import { createSupabaseSource } from '@/lib/data/supabase/source';
import { applyWorld, worldSql } from '@/lib/data/supabase/world';
import type { Workspace } from '@/lib/identity/types';
import { permissionsFor } from '@/lib/platform/roles';

/*
 * The real data layer, against the development database: the product's repository over the
 * Supabase source, and raw SQL as each person, so Row Level Security is what's being tested.
 *
 *   npm run test:data     (needs DATABASE_URL — `npm run db:local` builds one on this machine)
 */

test.skip(!process.env.DATABASE_URL, 'Needs DATABASE_URL pointing at the development database.');

const u = demoUuid;
const data: Dataset = seed();

async function reseed() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  await applyWorld(sql);
  await sql.end();
}

/** The Workspace the app would build for this persona in this Space, from the database. */
async function workspace(key: string, slug: string): Promise<Workspace> {
  const session = await loadSession(u(key), 'demo');
  if (!session) throw new Error(`No session for ${key}`);
  const found = session.memberships.find((item) => item.space.slug === slug);
  if (!found) throw new Error(`${key} isn’t in ${slug}`);
  const { space, ...membership } = found;
  return {
    session,
    person: session.person,
    space,
    membership,
    permissions: permissionsFor(membership),
  };
}

async function repo(key: string, slug: string) {
  const ws = await workspace(key, slug);
  return createRepository(ws, createSupabaseSource(ws));
}

/** Raw SQL as this persona — what anyone holding their session could send the database. */
const as = <T>(key: string, work: Parameters<typeof asPerson<T>>[1]) => asPerson(u(key), work);

const spaceId = (slug: string) =>
  u(data.spaces.find((space) => (space.slug ?? 'personal') === slug)!.id);

test.describe.configure({ mode: 'serial' });
test.beforeEach(reseed);
test.afterAll(async () => {
  await db().end();
});

test.describe('seeded identities', () => {
  test('Jerry has four Spaces with four different roles', async () => {
    const session = await loadSession(u('jerry'), 'demo');
    const roles = Object.fromEntries(
      session!.memberships.map((item) => [item.space.slug, item.role]),
    );
    expect(roles).toEqual({
      personal: 'owner',
      hyphy: 'owner',
      'abc-construction': 'guest',
      'salt-and-ember': 'manager',
    });
    expect(session!.memberships[0].space.kind).toBe('personal');
  });

  test('an invited membership is not a way in', async () => {
    const session = await loadSession(u('jordan'), 'demo');
    expect(session?.memberships.some((item) => item.space.slug === 'abc-construction')).toBe(false);
  });
});

test.describe('parity: the database shows each persona exactly what Demo Mode shows', () => {
  const views: [string, string][] = [
    ['jerry', 'personal'],
    ['jerry', 'hyphy'],
    ['jerry', 'abc-construction'],
    ['jerry', 'salt-and-ember'],
    ['dana', 'abc-construction'],
    ['luis', 'abc-construction'],
    ['ray', 'abc-construction'],
    ['mike', 'abc-construction'],
    ['tasha', 'abc-construction'],
    ['chris', 'abc-construction'],
    ['sarah', 'hyphy'],
    ['ava', 'hyphy'],
    ['rosa', 'salt-and-ember'],
    ['omar', 'salt-and-ember'],
  ];
  const keys: (keyof Visible)[] = [
    'projects',
    'vehicles',
    'receipts',
    'mileage',
    'files',
    'qrCodes',
    'linkPages',
    'activity',
    'inbox',
    'members',
    'directory',
    'approvalEvents',
  ];
  for (const [person, slug] of views)
    test(`${person} in ${slug}`, async () => {
      const ws = await workspace(person, slug);
      const source = createSupabaseSource(ws);
      // The same Workspace in seed ids, through Demo Mode's rules.
      const seedSpace = data.spaces.find((space) => (space.slug ?? 'personal') === slug)!;
      const space =
        slug === 'personal'
          ? data.spaces.find((item) => item.kind === 'personal' && item.ownerId === person)!
          : seedSpace;
      const membership = data.memberships.find(
        (item) => item.personId === person && item.spaceId === space.id,
      )!;
      const demo = visibleTo(
        {
          session: { source: 'demo', person: ws.person, memberships: [] },
          person: data.people.find((item) => item.id === person)!,
          space,
          membership,
          permissions: permissionsFor(membership),
        },
        data,
      );
      for (const key of keys) {
        const real = (await source.load(key)) as { id: string }[];
        const expected = (demo[key] as { id: string }[]).map((row) => u(row.id)).sort();
        expect(real.map((row) => row.id).sort(), `${key} for ${person} in ${slug}`).toEqual(
          expected,
        );
      }
    });
});

test.describe('approvals persist', () => {
  test('a trip goes submitted → returned with a reason → fixed → approved', async () => {
    const mike = await repo('mike', 'abc-construction');
    const trip = await mike.createMileage({
      date: new Date().toISOString(),
      from: 'Shop, Oak Brook',
      to: 'Oak Brook Remodel',
      miles: 18.4,
      roundTrip: true,
      purpose: 'Tile pickup',
      projectId: u('prj_oakbrook'),
      vehicleId: undefined,
    });
    expect(trip.status).toBe('submitted');

    const dana = await repo('dana', 'abc-construction');
    await dana.review('mileage', trip.id, 'returned', 'Add the truck you drove.');

    // A fresh repository is a page refresh: everything comes from the database again.
    const mikeAgain = await repo('mike', 'abc-construction');
    const returned = (await mikeAgain.mileage()).find((row) => row.id === trip.id)!;
    expect(returned.status).toBe('returned');
    expect(returned.returnReason).toBe('Add the truck you drove.');
    expect(returned.reviewedBy).toBe(u('dana'));
    expect((await mikeAgain.inbox()).some((item) => item.id === `rt_${trip.id}`)).toBe(true);

    await mikeAgain.resubmitMileage(trip.id, {
      date: returned.date,
      from: returned.from,
      to: returned.to,
      miles: returned.miles,
      roundTrip: true,
      purpose: returned.purpose,
      projectId: returned.projectId,
      vehicleId: u('veh_t24'),
    });
    await (await repo('dana', 'abc-construction')).review('mileage', trip.id, 'approved');

    const history = await (await repo('mike', 'abc-construction')).approvalHistory(trip.id);
    expect(history.map((event) => [event.action, event.actorId, event.reason ?? null])).toEqual([
      ['submitted', u('mike'), null],
      ['returned', u('dana'), 'Add the truck you drove.'],
      ['resubmitted', u('mike'), null],
      ['approved', u('dana'), null],
    ]);
    const lines = await (
      await repo('dana', 'abc-construction')
    ).activity({
      about: { type: 'mileage', id: trip.id },
    });
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.every((line) => line.spaceId === spaceId('abc-construction'))).toBe(true);
  });

  test('a returned receipt carries its reason until it is fixed', async () => {
    const tasha = await repo('tasha', 'abc-construction');
    const receipt = (await tasha.receipts()).find((row) => row.id === u('rc_abc_09'))!;
    expect(receipt.status).toBe('returned');
    expect(receipt.returnReason).toMatch(/petty cash/);
    await tasha.resubmitReceipt(receipt.id, {
      vendor: receipt.vendor,
      category: receipt.category,
      total: receipt.total,
      date: receipt.date,
      paymentMethod: 'Petty cash',
      projectId: receipt.projectId,
    });
    const fixed = await (await repo('dana', 'abc-construction')).receipt(receipt.id);
    expect(fixed?.status).toBe('submitted');
    expect(fixed?.resubmittedAt).toBeTruthy();
  });

  test('batch approval approves everything still waiting, once', async () => {
    const dana = await repo('dana', 'abc-construction');
    const waiting = (await dana.submissions()).filter((item) => item.status === 'submitted');
    expect(waiting.length).toBeGreaterThan(3);
    const refs = waiting.map((item) => ({ kind: item.kind, id: item.id }));
    expect(await dana.approveMany(refs)).toBe(waiting.length);
    const after = await (await repo('dana', 'abc-construction')).submissions();
    expect(after.filter((item) => item.status === 'submitted')).toEqual([]);
    // Approving the same list again changes nothing.
    expect(await (await repo('dana', 'abc-construction')).approveMany(refs)).toBe(0);
    const [{ count }] = await as(
      'dana',
      (tx) => tx`
        select count(*)::int from approval_events
        where action = 'approved' and actor_id = ${u('dana')} and at > now() - interval '1 minute'`,
    );
    expect(count).toBe(waiting.length);
  });

  test('nobody decides on their own submission, whatever they send', async () => {
    const mike = await repo('mike', 'abc-construction');
    await expect(mike.review('receipt', u('rc_abc_01'), 'approved')).rejects.toBeInstanceOf(
      RuleError,
    );
    // Straight to the database, skipping the product entirely: the row isn't his to change.
    await expect(
      as(
        'mike',
        (tx) => tx`update receipts set status = 'approved' where id = ${u('rc_abc_01')}
                   returning id`,
      ),
    ).resolves.toEqual([]);
    // Even his own returned trip, which he may edit, can't be approved by him.
    await expect(
      as(
        'mike',
        (tx) => tx`update mileage_entries set status = 'approved' where id = ${u('mi_abc_08')}`,
      ),
    ).rejects.toThrow(/row-level security|approves your own/);
    expect((await (await repo('dana', 'abc-construction')).receipt(u('rc_abc_01')))?.status).toBe(
      'submitted',
    );
    await expect(
      as(
        'mike',
        (tx) => tx`
          insert into receipts (space_id, created_by, vendor, category, total, date, status)
          values (${spaceId('abc-construction')}, ${u('mike')}, 'Menards', 'materials', 12,
                  now(), 'approved')`,
      ),
    ).rejects.toThrow(/row-level security/);
    // History can't be written by hand either.
    await expect(
      as(
        'dana',
        (tx) => tx`
          insert into approval_events (space_id, submission_type, submission_id, action, actor_id)
          values (${spaceId('abc-construction')}, 'receipt', ${u('rc_abc_01')}, 'approved',
                  ${u('dana')})`,
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

test.describe('relationships and preferences persist', () => {
  test('pins belong to one person in one Space', async () => {
    const dana = await repo('dana', 'abc-construction');
    await dana.setPinned({ type: 'project', id: u('prj_westmont') }, true);
    const pins = await (await repo('dana', 'abc-construction')).pins();
    expect(pins.map((pin) => pin.id)).toContain(u('prj_westmont'));
    expect((await (await repo('ray', 'abc-construction')).pins()).map((pin) => pin.id)).toEqual([]);
    // Nobody can read or write someone else's pins.
    const theirs = await as('ray', (tx) => tx`select * from pins where person_id = ${u('dana')}`);
    expect(theirs.length).toBe(0);
  });

  test('a file attached to a project appears on that project', async () => {
    const mike = await repo('mike', 'abc-construction');
    const [file] = await mike.addFiles([
      {
        name: 'Oak Brook tile spec.pdf',
        kind: 'pdf',
        size: 220_000,
        pages: 3,
        folder: 'Projects',
        access: 'team',
        attachedTo: [{ type: 'project', id: u('prj_oakbrook') }],
      },
    ]);
    const onProject = await (
      await repo('ray', 'abc-construction')
    ).files({ attachedTo: { type: 'project', id: u('prj_oakbrook') } });
    expect(onProject.map((item) => item.id)).toContain(file.id);
    const lines = await (
      await repo('ray', 'abc-construction')
    ).activity({ about: { type: 'project', id: u('prj_oakbrook') } });
    expect(lines.some((line) => line.object.id === file.id)).toBe(true);
  });

  test('a new project and its team show up for the team', async () => {
    const dana = await repo('dana', 'abc-construction');
    const project = await dana.createProject({
      name: 'Hinsdale Mudroom',
      location: 'Hinsdale, IL',
      client: 'The Parks',
      summary: 'Built-ins and tile.',
      dueDate: undefined,
      leadId: u('ray'),
      teamIds: [u('ray'), u('andre')],
      value: 42_000,
      costAllowance: 18_000,
    } as Parameters<typeof dana.createProject>[0]);
    const andre = await repo('andre', 'abc-construction');
    expect((await andre.projects()).map((item) => item.id)).toContain(project.id);
    const mike = await repo('mike', 'abc-construction');
    expect((await mike.projects()).map((item) => item.id)).not.toContain(project.id);
  });
});

test.describe('Spaces are sealed from each other', () => {
  const tables = ['projects', 'receipts', 'mileage_entries', 'files', 'activity', 'space_members'];

  const pairs: [string, string, string][] = [
    // [person, their Space, a Space they are not in]
    ['dana', 'abc-construction', 'hyphy'],
    ['sarah', 'hyphy', 'abc-construction'],
    ['dana', 'abc-construction', 'salt-and-ember'],
    ['rosa', 'salt-and-ember', 'abc-construction'],
    ['dana', 'abc-construction', 'personal'],
  ];
  for (const [person, home, other] of pairs)
    test(`${person} (${home}) sees nothing of ${other}`, async () => {
      const target =
        other === 'personal'
          ? u(
              data.spaces.find((space) => space.kind === 'personal' && space.ownerId === 'jerry')!
                .id,
            )
          : spaceId(other);
      await as(person, async (tx) => {
        for (const table of tables) {
          const rows = await tx`select id from ${tx(table)} where space_id = ${target}`;
          expect(rows.length, `${table} in ${other}`).toBe(0);
        }
        const [space] = await tx`select id from spaces where id = ${target}`;
        expect(space).toBeUndefined();
      });
    });

  test('knowing an id is not access', async () => {
    const hyphyReceipt = data.receipts.find((row) => row.spaceId === 'sp_hyphy')!;
    const personalReceipt = data.receipts.find((row) => row.spaceId === 'sp_personal_jerry');
    const ids = [u(hyphyReceipt.id), ...(personalReceipt ? [u(personalReceipt.id)] : [])];
    await as('dana', async (tx) => {
      expect(await tx`select id from receipts where id in ${tx(ids)}`).toEqual([]);
      const changed = await tx`update receipts set total = 1 where id in ${tx(ids)} returning id`;
      expect(changed).toEqual([]);
      expect(await tx`delete from receipts where id in ${tx(ids)} returning id`).toEqual([]);
      expect(await tx`select * from approval_events where submission_id in ${tx(ids)}`).toEqual([]);
    });
    // The product says the same thing: not found.
    const dana = await repo('dana', 'abc-construction');
    expect(await dana.receipt(ids[0])).toBeNull();
  });

  test('no one can write into a Space they are not in', async () => {
    await expect(
      as(
        'rosa',
        (tx) => tx`
          insert into projects (space_id, created_by, name, status)
          values (${spaceId('abc-construction')}, ${u('rosa')}, 'Pirate job', 'active')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(
        'rosa',
        (tx) => tx`
          insert into space_members (space_id, person_id, role, title, status)
          values (${spaceId('abc-construction')}, ${u('rosa')}, 'owner', 'Owner', 'active')`,
      ),
    ).rejects.toThrow(/row-level security|permission denied/);
  });

  test('the same person sees each Space only through that Space', async () => {
    const abc = await repo('jerry', 'abc-construction');
    const se = await repo('jerry', 'salt-and-ember');
    const abcProjects = (await abc.projects()).map((item) => item.spaceId);
    const seProjects = (await se.projects()).map((item) => item.spaceId);
    expect(new Set(abcProjects)).toEqual(new Set([spaceId('abc-construction')]));
    expect(new Set(seProjects)).toEqual(new Set([spaceId('salt-and-ember')]));
  });
});

test.describe('guests', () => {
  test('Chris sees his two projects and nothing else of ABC', async () => {
    const chris = await repo('chris', 'abc-construction');
    expect((await chris.projects()).map((item) => item.id).sort()).toEqual(
      [u('prj_oakbrook'), u('prj_oak1845')].sort(),
    );
    expect(await chris.vehicles()).toEqual([]);
    expect((await chris.receipts()).every((item) => item.createdBy === u('chris'))).toBe(true);
    await as('chris', async (tx) => {
      expect(await tx`select id from vehicles`).toEqual([]);
      expect(await tx`select id from projects where id = ${u('prj_westmont')}`).toEqual([]);
      const team = await tx`select person_id from space_members
                           where space_id = ${spaceId('abc-construction')}`;
      // Himself and teammates on his projects — never the whole company list.
      expect(team.length).toBeLessThan(8);
    });
    await expect(
      as(
        'chris',
        (tx) => tx`update projects set progress = 100 where id = ${u('prj_oakbrook')}
                             returning id`,
      ),
    ).resolves.toEqual([]);
  });
});

test.describe('reset', () => {
  test('puts the seeded story back', async () => {
    const dana = await repo('dana', 'abc-construction');
    const waiting = (await dana.submissions()).filter((item) => item.status === 'submitted');
    await dana.approveMany(waiting.map((item) => ({ kind: item.kind, id: item.id })));
    process.env.HYPHY_DEMO_RESET = 'on';
    try {
      await resetWorld();
    } finally {
      delete process.env.HYPHY_DEMO_RESET;
    }
    const again = await (await repo('dana', 'abc-construction')).submissions();
    expect(again.filter((item) => item.status === 'submitted').length).toBe(waiting.length);
  });

  test('survives resets and page reads at the same moment, and ends exactly seeded', async () => {
    const dana = await repo('dana', 'abc-construction');
    await dana.approveMany(
      (await dana.submissions())
        .filter((item) => item.status === 'submitted')
        .map((item) => ({ kind: item.kind, id: item.id })),
    );
    process.env.HYPHY_DEMO_RESET = 'on';
    try {
      const reads = Array.from({ length: 6 }, async (_, index) => {
        const reader = await repo(index % 2 ? 'mike' : 'dana', 'abc-construction');
        return (await reader.submissions()).length;
      });
      const results = await Promise.allSettled([resetWorld(), resetWorld(), ...reads]);
      const failed = results.filter((result) => result.status === 'rejected');
      expect(failed, JSON.stringify(failed)).toEqual([]);
    } finally {
      delete process.env.HYPHY_DEMO_RESET;
    }
    const [counts] = await db()`
      select (select count(*) from dev.personas)::int as personas,
             dev.changes_since_seed()::int as changes`;
    expect(counts).toEqual({ personas: data.people.length, changes: 0 });
    const again = await (await repo('dana', 'abc-construction')).submissions();
    expect(again.filter((item) => item.status === 'submitted').length).toBeGreaterThan(3);
  });

  test('refuses unless the server allows it', async () => {
    delete process.env.HYPHY_DEMO_RESET;
    await expect(resetWorld()).rejects.toThrow(/development world/);
  });

  test('refuses on a database that is not the development world', async () => {
    test.skip(!process.env.DATABASE_ADMIN_URL, 'Needs DATABASE_ADMIN_URL to remove the marker.');
    const sql = postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
    await expect(
      sql.begin(async (tx) => {
        await tx`delete from dev.environment`;
        await tx.unsafe(worldSql());
      }),
    ).rejects.toThrow(/Refusing to seed/);
    await sql.end();
    // The refusal rolled everything back: the marker and the data are still there.
    const [{ count }] = await db()`select count(*)::int from dev.environment`;
    expect(count).toBe(1);
  });
});

test.describe('the app’s own database role', () => {
  test('can change nothing without becoming a person', async () => {
    for (const statement of [
      `delete from dev.environment`,
      `truncate table public.receipts`,
      `select id from public.receipts limit 1`,
      `update public.spaces set plan = 'free'`,
      `insert into public.approval_events (space_id, submission_type, submission_id, action, actor_id)
       values (gen_random_uuid(), 'receipt', gen_random_uuid(), 'approved', gen_random_uuid())`,
    ])
      await expect(db().unsafe(statement), statement).rejects.toThrow(/permission denied/);
  });

  test('a person can’t switch on seeding mode to get past the review guard', async () => {
    await expect(
      as('mike', async (tx) => {
        await tx`select set_config('hyphy.seeding', 'on', true)`;
        return tx`update mileage_entries set status = 'approved' where id = ${u('mi_abc_08')}`;
      }),
    ).rejects.toThrow(/row-level security|approves your own/);
  });

  test('a person can’t call the internal helpers, the reset, or truncate', async () => {
    for (const call of [
      (tx: postgres.TransactionSql) => tx`select ref_label('project', ${u('prj_hy_tools')})`,
      (tx: postgres.TransactionSql) =>
        tx`select write_activity(${spaceId('hyphy')}, ${u('mike')}, 'x', 'project', ${u('prj_hy_tools')}, 'x')`,
      (tx: postgres.TransactionSql) => tx`select dev.reset_world('{}'::jsonb)`,
      (tx: postgres.TransactionSql) => tx`select dev.changes_since_seed()`,
      (tx: postgres.TransactionSql) => tx`select * from dev.personas`,
      (tx: postgres.TransactionSql) => tx`truncate table receipts cascade`,
    ])
      await expect(as('mike', call)).rejects.toThrow(/permission denied/);
  });
});

test.describe('real accounts', () => {
  const admin = () => postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
  test.beforeEach(() => {
    test.skip(!process.env.DATABASE_ADMIN_URL, 'Needs DATABASE_ADMIN_URL to act as Supabase Auth.');
  });

  test('the account suite passes (supabase/tests/accounts.sql)', async () => {
    const sql = admin();
    const file = readFileSync(path.join(__dirname, '../supabase/tests/accounts.sql'), 'utf8');
    // It always rolls back; its report is the error.
    await expect(sql.unsafe(file)).rejects.toThrow(/ACCOUNTS PASSED/);
    await sql.end();
  });

  test('a new account is itself, in its own Personal Space, and sees nothing else', async () => {
    const sql = admin();
    const id = randomUUID();
    const email = `data-${id.slice(0, 8)}.auth-test@hyphy-tools.example`;
    try {
      // What Supabase Auth does when someone signs up.
      await sql`insert into auth.users (id, email, raw_user_meta_data)
                values (${id}, ${email}, ${sql.json({ name: 'Nova Test' })})`;
      const session = await loadSession(id, 'supabase');
      expect(session?.person).toMatchObject({ id, name: 'Nova Test', firstName: 'Nova', email });
      expect(
        session?.memberships.map((m) => [m.space.kind, m.space.slug, m.role, m.status]),
      ).toEqual([['personal', 'personal', 'owner', 'active']]);

      const { space, ...membership } = session!.memberships[0];
      const ws: Workspace = {
        session: session!,
        person: session!.person,
        space,
        membership,
        permissions: permissionsFor(membership),
      };
      const mine = createRepository(ws, createSupabaseSource(ws));
      const rows = await Promise.all([
        mine.projects(),
        mine.vehicles(),
        mine.receipts(),
        mine.mileage(),
        mine.files(),
        mine.activity(),
        mine.inbox(),
      ]);
      expect(rows.map((list) => list.length)).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect((await mine.directory()).map((person) => person.id)).toEqual([id]);

      // Renaming is theirs alone; the id is the verified session's.
      await renameSelf(id, 'Nova Renamed');
      expect((await loadSession(id, 'supabase'))?.person.name).toBe('Nova Renamed');
      const renamed = await asPerson(
        id,
        (tx) => tx`update profiles set name = 'Not Dana' where id = ${u('dana')} returning id`,
      );
      expect(renamed).toHaveLength(0);
    } finally {
      await sql`delete from auth.users where id = ${id}`;
      await sql.end();
    }
  });

  test('Personal Spaces take no one else, through the app’s own paths either', async () => {
    const jerry = await repo('jerry', 'personal');
    await expect(
      jerry.invite({
        name: 'Sam',
        email: 'sam.torres@abcconstruction.example',
        role: 'member',
        title: '',
      }),
    ).rejects.toThrow(RuleError);
  });
});

test.describe('businesses and invitations under pressure', () => {
  const admin = () => postgres(process.env.DATABASE_ADMIN_URL!, { max: 1, onnotice: () => {} });
  const token = () => randomBytes(32).toString('base64url');
  const created: string[] = [];
  let sql: postgres.Sql;

  test.beforeAll(() => {
    if (process.env.DATABASE_ADMIN_URL) sql = admin();
  });
  test.beforeEach(() => {
    test.skip(!process.env.DATABASE_ADMIN_URL, 'Needs DATABASE_ADMIN_URL to act as Supabase Auth.');
  });
  test.afterAll(async () => {
    if (!sql) return;
    await sql`delete from spaces where kind = 'business' and slug like 'race-%'`;
    if (created.length) await sql`delete from auth.users where id = any(${created}::uuid[])`;
    await sql.end();
  });

  /** A confirmed account, as Supabase Auth leaves it. */
  async function account(who: string) {
    const id = randomUUID();
    created.push(id);
    await sql`insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
              values (${id}, ${`${who}-${id.slice(0, 6)}.race-test@hyphy-tools.example`},
                      ${sql.json({ name: who })}, now())`;
    const [row] = await sql`select email from auth.users where id = ${id}`;
    return { id, email: String(row.email) };
  }
  async function business(owner: string, key = randomUUID()) {
    const [row] = await asPerson(
      owner,
      (tx) => tx`select * from public.create_business('Race Co', ${`race-${key.slice(0, 8)}`},
                   'other', false, ${key}::uuid, array['projects'], 'engagements', '{}', '{}', '')`,
    );
    return String(row.space_id);
  }
  const invite = (owner: string, space: string, email: string, secret: string) =>
    asPerson(
      owner,
      (tx) => tx`select public.create_invitation(${space}, ${email}, 'member', '', '', '{}', null,
                   ${secret}) as id`,
    ).then(([row]) => String(row.id));
  const accept = (person: string, secret: string) =>
    asPerson(person, (tx) => tx`select * from public.accept_invitation(${secret})`).then(([row]) =>
      String(row.outcome),
    );
  const memberships = async (space: string, person: string) =>
    (
      await sql`select count(*)::int as n from space_members
                where space_id = ${space} and person_id = ${person}`
    )[0].n as number;

  test('the same request twice at once makes one business', async () => {
    const owner = await account('owner');
    const key = randomUUID();
    const [a, b] = await Promise.all([business(owner.id, key), business(owner.id, key)]);
    expect(a).toBe(b);
    const [row] = await sql`select count(*)::int as n from spaces where creation_key = ${key}`;
    expect(row.n).toBe(1);
  });

  test('two acceptances at once: one membership, one "joined"', async () => {
    const owner = await account('owner');
    const invitee = await account('invitee');
    const space = await business(owner.id);
    const secret = token();
    await invite(owner.id, space, invitee.email, secret);
    const outcomes = await Promise.all([
      accept(invitee.id, secret),
      accept(invitee.id, secret),
      accept(invitee.id, secret),
    ]);
    expect(outcomes.filter((outcome) => outcome === 'joined')).toHaveLength(1);
    expect(outcomes.every((outcome) => ['joined', 'already_member'].includes(outcome))).toBe(true);
    expect(await memberships(space, invitee.id)).toBe(1);
  });

  test('revoking and accepting at once: one or the other, never both', async () => {
    for (let round = 0; round < 5; round++) {
      const owner = await account('owner');
      const invitee = await account('invitee');
      const space = await business(owner.id);
      const secret = token();
      const invitation = await invite(owner.id, space, invitee.email, secret);
      const [accepted] = await Promise.all([
        accept(invitee.id, secret),
        asPerson(owner.id, (tx) => tx`select public.revoke_invitation(${invitation})`).catch(
          (error: Error) => error.message,
        ),
      ]);
      const [row] = await sql`select status from space_invitations where id = ${invitation}`;
      const joined = await memberships(space, invitee.id);
      if (accepted === 'joined') expect([row.status, joined]).toEqual(['accepted', 1]);
      else expect([accepted, row.status, joined]).toEqual(['revoked', 'revoked', 0]);
    }
  });

  test('resending while the old link is being accepted: the old link works only if it won', async () => {
    for (let round = 0; round < 5; round++) {
      const owner = await account('owner');
      const invitee = await account('invitee');
      const space = await business(owner.id);
      const first = token();
      const invitation = await invite(owner.id, space, invitee.email, first);
      const [accepted, renewed] = await Promise.all([
        accept(invitee.id, first),
        asPerson(
          owner.id,
          (tx) => tx`select public.renew_invitation(${invitation}, ${token()}, false)`,
        ).then(
          () => 'renewed',
          (error: Error) => error.message,
        ),
      ]);
      const joined = await memberships(space, invitee.id);
      if (accepted === 'joined') {
        expect(renewed).toMatch(/already accepted/);
        expect(joined).toBe(1);
      } else {
        expect([accepted, renewed, joined]).toEqual(['invalid', 'renewed', 0]);
      }
    }
  });

  test('a role changed just before acceptance is the role they get', async () => {
    const owner = await account('owner');
    const invitee = await account('invitee');
    const space = await business(owner.id);
    const secret = token();
    const invitation = await invite(owner.id, space, invitee.email, secret);
    await asPerson(
      owner.id,
      (tx) => tx`select public.set_invitation_role(${invitation}, 'manager', null)`,
    );
    expect(await accept(invitee.id, secret)).toBe('joined');
    const session = await loadSession(invitee.id, 'supabase');
    expect(session?.memberships.map((m) => [m.space.kind, m.role])).toEqual([
      ['personal', 'owner'],
      ['business', 'manager'],
    ]);
  });

  test('removed: the next page load no longer has the business', async () => {
    const owner = await account('owner');
    const invitee = await account('invitee');
    const space = await business(owner.id);
    const secret = token();
    await invite(owner.id, space, invitee.email, secret);
    await accept(invitee.id, secret);
    expect((await loadSession(invitee.id, 'supabase'))?.memberships).toHaveLength(2);
    await asPerson(owner.id, (tx) => tx`select public.remove_member(${space}, ${invitee.id})`);
    const after = await loadSession(invitee.id, 'supabase');
    expect(after?.memberships.map((m) => m.space.kind)).toEqual(['personal']);
  });
});
