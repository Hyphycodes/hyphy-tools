import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { createRepository } from '@/lib/data/core';
import { seed, type Dataset } from '@/lib/data/demo/seed';
import { visibleTo } from '@/lib/data/demo/visibility';
import { RuleError } from '@/lib/data/repository';
import type { Visible } from '@/lib/data/source';
import { asPerson, db } from '@/lib/data/supabase/db';
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
    const [{ count }] = await db()`
      select count(*)::int from approval_events
      where action = 'approved' and actor_id = ${u('dana')} and at > now() - interval '1 minute'`;
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

  test('refuses unless the server allows it', async () => {
    delete process.env.HYPHY_DEMO_RESET;
    await expect(resetWorld()).rejects.toThrow(/development world/);
  });

  test('refuses on a database that is not the development world', async () => {
    const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
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
