import { expect, test } from '@playwright/test';
import { applyJournal } from '@/lib/data/demo/journal-apply';
import { seed } from '@/lib/data/demo/seed';
import { createActionsFor } from '@/lib/platform/actions';
import { validateField } from '@/lib/platform/custom-fields';
import { dashboardFor } from '@/lib/platform/dashboard';
import { navigationFor } from '@/lib/platform/navigation';
import { can, permissionsFor } from '@/lib/platform/roles';
import { availability, getTool } from '@/lib/platform/tools';
import type { Space } from '@/lib/platform/types';
import { parseRange } from '@/lib/tools/pdf';

/* Pure rules, no browser. Run with `npm test`. */

const data = seed(Date.UTC(2026, 8, 24, 18));
const space = (slug: string) => data.spaces.find((item) => item.slug === slug)!;
const personal = data.spaces.find((item) => item.kind === 'personal' && item.ownerId === 'jerry')!;

test.describe('roles', () => {
  test('owners can do everything, admins everything but billing', () => {
    expect(can({ role: 'owner' }, 'space.billing')).toBe(true);
    expect(can({ role: 'admin' }, 'space.billing')).toBe(false);
    expect(can({ role: 'admin' }, 'people.manage')).toBe(true);
  });
  test('managers run operations without settings', () => {
    expect(can({ role: 'manager' }, 'expenses.approve')).toBe(true);
    expect(can({ role: 'manager' }, 'space.manage')).toBe(false);
    expect(can({ role: 'manager' }, 'people.manage')).toBe(false);
  });
  test('members submit; guests only upload', () => {
    expect(permissionsFor({ role: 'member' })).toEqual([
      'people.view',
      'expenses.submit',
      'files.upload',
      'tools.use',
    ]);
    expect(permissionsFor({ role: 'guest' })).toEqual(['files.upload']);
  });
});

test.describe('role, plan and modules stay separate', () => {
  const vehicles = getTool('vehicles')!;
  test('the plan gates a module regardless of role', () => {
    expect(availability(vehicles, space('salt-and-ember'), { role: 'owner' })).toEqual({
      state: 'not-in-plan',
      plan: 'business-pro',
    });
    expect(availability(vehicles, space('abc-construction'), { role: 'owner' }).state).toBe(
      'ready',
    );
  });
  test('a module that is off is off for everyone, even owners', () => {
    const off: Space = {
      ...space('abc-construction'),
      modules: space('abc-construction').modules.filter((id) => id !== 'vehicles'),
    };
    expect(availability(vehicles, off, { role: 'owner' }).state).toBe('off');
  });
  test('the role decides last', () => {
    expect(availability(vehicles, space('abc-construction'), { role: 'guest' }).state).toBe(
      'no-access',
    );
    expect(
      availability(getTool('receipts')!, space('abc-construction'), { role: 'guest' }).state,
    ).toBe('no-access');
  });
  test('business modules never appear in personal Spaces', () => {
    expect(availability(getTool('projects')!, personal, { role: 'owner' }).state).toBe(
      'wrong-space',
    );
  });
  test('coming-soon tools are never ready', () => {
    expect(
      availability(getTool('forms')!, space('abc-construction'), { role: 'owner' }).state,
    ).toBe('soon');
  });
});

test.describe('Universal Create', () => {
  const ids = (slug: string | Space, role: Parameters<typeof createActionsFor>[1]['role']) =>
    createActionsFor(typeof slug === 'string' ? space(slug) : slug, { role }).map(
      (action) => action.id,
    );
  test('personal leads with receipts, mileage and PDF', () => {
    expect(ids(personal, 'owner').slice(0, 5)).toEqual([
      'receipt',
      'mileage',
      'pdf',
      'qr',
      'link-page',
    ]);
  });
  test('owners lead with projects and people', () => {
    expect(ids('abc-construction', 'owner').slice(0, 4)).toEqual([
      'project',
      'person',
      'receipt',
      'vehicle',
    ]);
  });
  test('members get only what they do', () => {
    expect(ids('abc-construction', 'member')).toEqual(['receipt', 'mileage', 'photos', 'file']);
  });
  test('guests can only upload', () => {
    expect(ids('abc-construction', 'guest')).toEqual(['photos', 'file']);
  });
  test('labels follow the Space and role', () => {
    const labels = (slug: string | Space, role: 'owner' | 'member') =>
      createActionsFor(typeof slug === 'string' ? space(slug) : slug, { role }).map(
        (action) => action.label,
      );
    expect(labels(personal, 'owner')).toContain('Scan receipt');
    expect(labels('abc-construction', 'member')).toContain('Submit receipt');
    expect(labels('salt-and-ember', 'owner')).toContain('Create event');
  });
});

test.describe('navigation and dashboards compose from the same rules', () => {
  test('a restaurant calls projects events and has no vehicles', () => {
    const nav = navigationFor(space('salt-and-ember'), { role: 'owner' });
    expect(nav.space.map((item) => item.label)).toEqual(['Events', 'People', 'Files', 'Activity']);
  });
  test('guests see no tools, people or vehicles', () => {
    const nav = navigationFor(space('abc-construction'), { role: 'guest' });
    expect(nav.primary.map((item) => item.id)).toEqual(['home', 'inbox']);
    expect(nav.space.map((item) => item.id)).toEqual(['projects', 'files', 'activity']);
    expect(nav.settings).toBeUndefined();
  });
  test('each role gets its own dashboard', () => {
    expect(dashboardFor(space('abc-construction'), { role: 'owner' }).main).toEqual([
      'attention',
      'projects',
      'month',
    ]);
    expect(dashboardFor(space('abc-construction'), { role: 'owner' }).side).toContain('plan');
    expect(dashboardFor(space('abc-construction'), { role: 'manager' }).side).not.toContain('plan');
    expect(dashboardFor(space('abc-construction'), { role: 'member' }).main).toEqual([
      'my-day',
      'my-submissions',
    ]);
    expect(dashboardFor(space('abc-construction'), { role: 'guest' }).main).toEqual([
      'shared-projects',
      'shared-files',
    ]);
    expect(dashboardFor(personal, { role: 'owner' }).hero).toBe('personal');
  });
});

test.describe('demo data', () => {
  test('every record belongs to a Space that exists', () => {
    const ids = new Set(data.spaces.map((item) => item.id));
    for (const table of [
      'projects',
      'vehicles',
      'receipts',
      'mileage',
      'files',
      'qrCodes',
      'linkPages',
      'activity',
      'inbox',
    ] as const)
      for (const row of data[table]) expect(ids.has(row.spaceId), `${table} ${row.id}`).toBe(true);
  });
  test('every person referenced exists', () => {
    const people = new Set(data.people.map((item) => item.id));
    for (const row of [...data.projects, ...data.receipts, ...data.mileage, ...data.files])
      expect(people.has(row.createdBy)).toBe(true);
    for (const member of data.memberships) expect(people.has(member.personId)).toBe(true);
  });
  test('uses only reserved example domains for email', () => {
    for (const person of data.people) expect(person.email).toMatch(/\.example$/);
  });
  test('Jerry holds four different roles', () => {
    const roles = data.memberships
      .filter((item) => item.personId === 'jerry')
      .map((item) => item.role)
      .sort();
    expect(roles).toEqual(['guest', 'manager', 'owner', 'owner']);
  });
});

test.describe('Demo Mode journal', () => {
  test('a submitted receipt creates activity and an approval, and approving clears it', () => {
    const at = '2026-09-24T18:00:00.000Z';
    const row = {
      id: 'rc_test',
      spaceId: 'sp_abc',
      createdBy: 'mike',
      createdAt: at,
      vendor: 'Shell',
      category: 'fuel',
      total: 40,
      date: at,
      status: 'submitted',
      projectId: 'prj_oakbrook',
    };
    const added = applyJournal(data, [{ k: 'add', t: 'receipts', row, by: 'mike', at }]);
    expect(
      added.activity.some((event) => event.object.id === 'rc_test' && event.verb === 'submitted'),
    ).toBe(true);
    expect(added.inbox.find((item) => item.subject.id === 'rc_test')?.status).toBe('open');
    const approved = applyJournal(data, [
      { k: 'add', t: 'receipts', row, by: 'mike', at },
      {
        k: 'set',
        t: 'receipts',
        id: 'rc_test',
        patch: { status: 'approved', reviewedBy: 'dana' },
        by: 'dana',
        at,
      },
    ]);
    expect(approved.receipts.find((receipt) => receipt.id === 'rc_test')?.status).toBe('approved');
    expect(approved.inbox.find((item) => item.subject.id === 'rc_test')?.status).toBe('done');
  });
  test('the seed itself is never mutated', () => {
    const before = data.receipts.length;
    applyJournal(data, [
      {
        k: 'add',
        t: 'receipts',
        row: { id: 'x', spaceId: 'sp_abc' },
        by: 'mike',
        at: '2026-01-01',
      },
    ]);
    expect(data.receipts.length).toBe(before);
  });
});

test.describe('tools', () => {
  test('PDF page ranges', () => {
    expect(parseRange('1-3, 5', 10)).toEqual([0, 1, 2, 4]);
    expect(parseRange('8-', 10)).toEqual([7, 8, 9]);
    expect(parseRange('2, 2, 1', 10)).toEqual([1, 0]);
    expect(parseRange('0', 10)).toBeNull();
    expect(parseRange('4-2', 10)).toBeNull();
    expect(parseRange('11', 10)).toBeNull();
    expect(parseRange('a', 10)).toBeNull();
  });
  test('custom field validation', () => {
    expect(validateField({ id: 'n', label: 'Guests', type: 'number' }, 24)).toBeNull();
    expect(validateField({ id: 'n', label: 'Guests', type: 'number' }, 'many')).toBe(
      'Enter a number.',
    );
    expect(
      validateField({ id: 's', label: 'Room', type: 'select', options: ['Patio'] }, 'Roof'),
    ).toBe('Choose one of the options.');
    expect(validateField({ id: 'r', label: 'Permit', type: 'text', required: true }, '')).toBe(
      'Permit is required.',
    );
  });
});
