import { expect, test } from '@playwright/test';
import { applyJournal } from '@/lib/data/demo/journal-apply';
import { seed } from '@/lib/data/demo/seed';
import {
  currentProjectFor,
  exceptionsFor,
  projectMoney,
  toolUsage,
  vehicleProject,
  vehiclesOn,
  weekSummary,
} from '@/lib/insights';
import {
  awaitingFix,
  canResubmit,
  describeCount,
  groupBySubmitter,
  mileageSubmission,
  receiptSubmission,
} from '@/lib/platform/approvals';
import { workProfile } from '@/lib/platform/work';
import { createActionsFor, groupActions } from '@/lib/platform/actions';
import { validateField } from '@/lib/platform/custom-fields';
import { dashboardFor } from '@/lib/platform/dashboard';
import { navigationFor } from '@/lib/platform/navigation';
import { can, permissionsFor, roles } from '@/lib/platform/roles';
import { availability, getTool, tools } from '@/lib/platform/tools';
import type { Space } from '@/lib/platform/types';
import { formatRange, parseRange } from '@/lib/tools/pdf';
import { authProblem, checkEmail, checkName, checkNewPassword } from '@/lib/auth/errors';
import {
  isPublicPath,
  isSignedOutOnlyPath,
  reservedSlugs,
  safeNext,
  signInPath,
  spaceSegment,
} from '@/lib/auth/routes';
import { homeFor } from '@/lib/identity/active-space';
import { identityMode } from '@/lib/identity/mode';
import type { Session } from '@/lib/identity/types';
import { assertPublishable } from '@/lib/supabase/config';
import { emailProviderName } from '@/lib/email/choose';
import { invitationEmail } from '@/lib/email/invitation';
import {
  brandFor,
  BUSINESS_TYPES,
  businessTypes,
  checkAddress,
  presetLabels,
  presetModules,
  slugify,
} from '@/lib/platform/business-types';
import { canManageMember, grantableRoles } from '@/lib/platform/roles';
import { describeInvitation } from '@/lib/teams/describe';
import { kindOf, parseWifi, wifiPayload } from '@/lib/tools/qr';

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
  test('the menu groups actions: capture, then set up, then make', () => {
    const groups = groupActions(createActionsFor(space('abc-construction'), { role: 'owner' }));
    expect(groups.map((group) => group.id)).toEqual(['capture', 'setup', 'make']);
    expect(groups[0].actions.map((action) => action.id)).toEqual([
      'receipt',
      'file',
      'mileage',
      'photos',
    ]);
    const member = groupActions(createActionsFor(space('abc-construction'), { role: 'member' }));
    expect(member.map((group) => group.id)).toEqual(['capture']);
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
    const owner = dashboardFor(space('abc-construction'), { role: 'owner' });
    expect(owner.top).toEqual(['pulse', 'pinned-projects']);
    // Decisions and exceptions come before the full picture.
    expect(owner.main).toEqual(['approvals', 'attention', 'exceptions', 'projects', 'activity']);
    expect(owner.side).toEqual(['week', 'team', 'money', 'fleet']);
    // A restaurant has no vehicles, so its codes take that place.
    expect(dashboardFor(space('salt-and-ember'), { role: 'owner' }).side).toContain('codes');
    expect(dashboardFor(space('abc-construction'), { role: 'manager' }).top).toEqual([
      'pulse',
      'pinned-projects',
    ]);
    // Employees: what came back to fix leads; no owner analytics.
    const member = dashboardFor(space('abc-construction'), { role: 'member' });
    expect(member.main).toEqual(['to-fix', 'my-day', 'notices', 'my-submissions']);
    expect([...member.top, ...member.main, ...member.side]).not.toContain('week');
    expect([...member.top, ...member.main, ...member.side]).not.toContain('exceptions');
    const guest = dashboardFor(space('abc-construction'), { role: 'guest' });
    expect(guest.top).toEqual([]);
    expect(guest.main).toEqual(['shared-projects', 'shared-files']);
    expect(guest.side).toEqual(['notices', 'guest-access']);
    expect(dashboardFor(personal, { role: 'owner' }).hero).toBe('personal');
    expect(dashboardFor(personal, { role: 'owner' }).top).toEqual(['launcher']);
  });
  test('Mike’s current project is the one he last worked on, everywhere', () => {
    expect(currentProjectFor('mike', data.projects, data.activity)?.id).toBe('prj_oakbrook');
    // Without activity, the soonest-due project he's on.
    expect(currentProjectFor('mike', data.projects, [])?.id).toBe('prj_oakbrook');
    expect(currentProjectFor('chris', data.projects, data.activity)).toBeDefined();
    expect(currentProjectFor('rosa', [], data.activity)).toBeUndefined();
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
  test('a submission writes activity, and its approval lives on the record, not in a copy', () => {
    const added = applyJournal(data, [{ k: 'add', t: 'receipts', row, by: 'mike', at }]);
    const logged = added.activity.find((event) => event.object.id === 'rc_test');
    expect(logged?.verb).toBe('submitted');
    expect(logged?.context?.id).toBe('prj_oakbrook');
    // No inbox row to fall out of sync: the queue is read from the submissions.
    expect(added.inbox.some((item) => item.subject.id === 'rc_test')).toBe(false);
    const approved = applyJournal(data, [
      { k: 'add', t: 'receipts', row, by: 'mike', at },
      {
        k: 'set',
        t: 'receipts',
        id: 'rc_test',
        patch: { status: 'approved', reviewedBy: 'dana', reviewedAt: at },
        by: 'dana',
        at,
      },
    ]);
    expect(approved.receipts.find((receipt) => receipt.id === 'rc_test')?.status).toBe('approved');
    expect(
      approved.activity.some((event) => event.object.id === 'rc_test' && event.verb === 'approved'),
    ).toBe(true);
  });
  test('a return carries its reason; fixing it resubmits and says so', () => {
    const reason = 'Please use Truck 24 instead of Personal Vehicle.';
    const ops = [
      { k: 'add' as const, t: 'receipts' as const, row, by: 'mike', at },
      {
        k: 'set' as const,
        t: 'receipts' as const,
        id: 'rc_test',
        patch: { status: 'returned', reviewedBy: 'dana', returnReason: reason },
        by: 'dana',
        at: '2026-09-24T19:00:00.000Z',
      },
    ];
    const returned = applyJournal(data, ops);
    const record = returned.receipts.find((receipt) => receipt.id === 'rc_test')!;
    expect(record.status).toBe('returned');
    expect(record.returnReason).toBe(reason);
    expect(awaitingFix(record, 'mike')).toBe(true);
    expect(canResubmit(receiptSubmission(record), 'mike')).toBe(true);
    expect(canResubmit(receiptSubmission(record), 'dana')).toBe(false);
    const line = returned.activity.find(
      (event) => event.verb === 'returned' && event.object.id === 'rc_test',
    );
    expect(line?.detail).toContain(reason);

    const fixed = applyJournal(data, [
      ...ops,
      {
        k: 'set',
        t: 'receipts',
        id: 'rc_test',
        patch: {
          status: 'submitted',
          vehicleId: 'veh_t24',
          resubmittedAt: '2026-09-24T20:00:00.000Z',
        },
        by: 'mike',
        at: '2026-09-24T20:00:00.000Z',
      },
    ]);
    const again = fixed.receipts.find((receipt) => receipt.id === 'rc_test')!;
    expect(again.status).toBe('submitted');
    expect(awaitingFix(again, 'mike')).toBe(false);
    expect(receiptSubmission(again).flags).toContain('resubmitted');
    expect(
      fixed.activity.some((event) => event.verb === 'resubmitted' && event.object.id === 'rc_test'),
    ).toBe(true);
  });
  test('journals written before "returned" still read correctly', () => {
    const legacy = applyJournal(data, [
      { k: 'add', t: 'receipts', row, by: 'mike', at },
      { k: 'set', t: 'receipts', id: 'rc_test', patch: { status: 'rejected' }, by: 'dana', at },
    ]);
    expect(legacy.receipts.find((receipt) => receipt.id === 'rc_test')?.status).toBe('returned');
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
  test('PDF page ranges read back as the shortest text', () => {
    expect(formatRange([0, 1, 2, 4])).toBe('1-3, 5');
    expect(formatRange([4, 0, 0, 1])).toBe('1-2, 5');
    expect(formatRange([])).toBe('');
    expect(parseRange(formatRange([1, 2, 3, 7, 9]), 10)).toEqual([1, 2, 3, 7, 9]);
  });
  test('Wi-Fi codes escape and read back', () => {
    const details = {
      ssid: 'Salt;Ember "Guest"',
      password: 'a:b,c\\d',
      security: 'WPA' as const,
      hidden: true,
    };
    const payload = wifiPayload(details);
    expect(payload).toBe('WIFI:T:WPA;S:Salt\\;Ember \\"Guest\\";P:a\\:b\\,c\\\\d;H:true;;');
    expect(parseWifi(payload)).toEqual(details);
    expect(wifiPayload({ ...details, ssid: ' ' })).toBe('');
    expect(parseWifi('WIFI:T:nopass;S:Cafe;;')).toEqual({
      ssid: 'Cafe',
      password: '',
      security: 'nopass',
      hidden: false,
    });
    expect(kindOf('WIFI:T:WPA;S:x;P:y;;')).toBe('wifi');
    expect(kindOf('https://example.com')).toBe('link');
    expect(kindOf('mailto:hi@example.com')).toBe('email');
    expect(kindOf('hello')).toBe('text');
  });
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

test.describe('approvals are one system', () => {
  const trip = data.mileage.find((entry) => entry.id === 'mi_abc_08')!;
  test('Mike’s returned trip carries Dana’s reason and waits on him alone', () => {
    expect(trip.status).toBe('returned');
    expect(trip.returnReason).toBe('Please use Truck 24 instead of Personal Vehicle.');
    expect(awaitingFix(trip, 'mike')).toBe(true);
    expect(awaitingFix(trip, 'dana')).toBe(false);
  });
  test('a trip in a personal vehicle is flagged when a company vehicle is assigned', () => {
    expect(mileageSubmission(trip, 'veh_t24').flags).toContain('own-vehicle');
    expect(mileageSubmission(trip).flags).not.toContain('own-vehicle');
  });
  test('receipts with nowhere to go are flagged for the approver', () => {
    const caseys = data.receipts.find((receipt) => receipt.id === 'rc_abc_04')!;
    expect(receiptSubmission(caseys).flags).toContain('unassigned');
  });
  test('pending work groups by who sent it, biggest queue first', () => {
    const pending = [
      ...data.receipts
        .filter((r) => r.spaceId === 'sp_abc' && r.status === 'submitted')
        .map((r) => receiptSubmission(r)),
      ...data.mileage
        .filter((m) => m.spaceId === 'sp_abc' && m.status === 'submitted')
        .map((m) => mileageSubmission(m)),
    ];
    const groups = groupBySubmitter(pending);
    expect(groups[0].personId).toBe('mike');
    expect(describeCount(groups[0].items)).toBe('2 receipts and 2 trips');
  });
  test('every returned item in the demo says why', () => {
    for (const row of [...data.receipts, ...data.mileage].filter(
      (item) => item.status === 'returned',
    ))
      expect(row.returnReason, row.id).toBeTruthy();
  });
});

test.describe('connected records', () => {
  const abc = (rows: { spaceId: string }[]) => rows.filter((row) => row.spaceId === 'sp_abc');
  test('a project’s value, tracked costs and allowance are three different things', () => {
    const oak = data.projects.find((project) => project.id === 'prj_oakbrook')!;
    const money = projectMoney(
      oak,
      data.receipts.filter((receipt) => receipt.projectId === oak.id),
      data.mileage.filter((entry) => entry.projectId === oak.id),
      space('abc-construction').mileageRate,
    );
    expect(money.value).toBe(148000);
    expect(money.allowance).toBe(2500);
    expect(money.tracked).toBeCloseTo(672.59, 2);
    expect(money.pending).toBeCloseTo(71.42, 2);
    // Personal-vehicle miles are a cost; company-truck miles are not (fuel receipts cover them).
    const oak1845 = data.projects.find((project) => project.id === 'prj_oak1845')!;
    const other = projectMoney(
      oak1845,
      data.receipts.filter((receipt) => receipt.projectId === oak1845.id),
      data.mileage.filter((entry) => entry.projectId === oak1845.id),
      0.7,
    );
    expect(other.lines.find((line) => line.label === 'Mileage paid back')?.total).toBeCloseTo(
      5.04,
      2,
    );
    expect(other.allowance).toBeUndefined();
  });
  test('a truck knows its project, and a project knows its trucks', () => {
    const truck = data.vehicles.find((vehicle) => vehicle.id === 'veh_t24')!;
    expect(
      vehicleProject(truck, abc(data.projects) as typeof data.projects, data.receipts, data.mileage)
        ?.id,
    ).toBe('prj_oakbrook');
    const on = vehiclesOn('prj_oakbrook', data.vehicles, data.receipts, data.mileage);
    expect(on[0].vehicle.id).toBe('veh_t24');
  });
  test('owners see exceptions, not every transaction', () => {
    const people = new Map(data.people.map((person) => [person.id, person]));
    const rules = exceptionsFor(
      {
        receipts: abc(data.receipts) as typeof data.receipts,
        mileage: abc(data.mileage) as typeof data.mileage,
        files: abc(data.files) as typeof data.files,
        projects: abc(data.projects) as typeof data.projects,
        vehicles: abc(data.vehicles) as typeof data.vehicles,
        people,
      },
      { rate: 0.7, now: Date.UTC(2026, 8, 24, 18) },
    ).map((item) => item.rule);
    expect(rules).toContain('unassigned');
    expect(rules).toContain('expiring');
    expect(rules).toContain('returned');
  });
  test('the weekly summary is written from the records', () => {
    const now = Date.UTC(2026, 8, 24, 18);
    const week = weekSummary(
      {
        receipts: abc(data.receipts) as typeof data.receipts,
        mileage: abc(data.mileage) as typeof data.mileage,
        projects: abc(data.projects) as typeof data.projects,
        activity: abc(data.activity) as typeof data.activity,
      },
      0.7,
      now,
    );
    expect(week.receipts).toBeGreaterThan(0);
    expect(week.activeProjects).toBe(3);
    expect(week.busiest?.project.id).toBe('prj_oakbrook');
  });
  test('Home learns what someone uses from what they made', () => {
    const usage = toolUsage('jerry', {
      receipts: data.receipts.filter((row) => row.spaceId === personal.id),
      mileage: data.mileage.filter((row) => row.spaceId === personal.id),
      files: data.files.filter((row) => row.spaceId === personal.id),
      qrCodes: data.qrCodes.filter((row) => row.spaceId === personal.id),
      linkPages: data.linkPages.filter((row) => row.spaceId === personal.id),
    });
    expect(usage.get('mileage')!.last > usage.get('images')!.last).toBe(true);
    expect(usage.get('pdf')?.recent).toBe(1);
  });
  test('default pins point at things that exist', () => {
    for (const pin of data.pins)
      if (pin.type === 'project')
        expect(
          data.projects.some((project) => project.id === pin.id && project.spaceId === pin.spaceId),
        ).toBe(true);
      else expect(getTool(pin.id)).toBeDefined();
  });
});

test.describe('work styles', () => {
  test('one Projects module, words and emphasis by the business', () => {
    const events = workProfile(space('salt-and-ember'));
    expect(events).toMatchObject({
      singular: 'Event',
      plural: 'Events',
      progress: false,
      value: 'Booking',
    });
    const jobs = workProfile(space('abc-construction'));
    expect(jobs).toMatchObject({
      plural: 'Projects',
      progress: true,
      value: 'Contract value',
      field: true,
    });
    expect(workProfile(space('hyphy')).style).toBe('engagements');
  });
  test('events carry no percent complete', () => {
    for (const project of data.projects.filter((item) => item.spaceId === 'sp_se'))
      expect(project.progress).toBeUndefined();
  });
  test('no project shows an allowance larger than its value', () => {
    for (const project of data.projects)
      if (project.costAllowance && project.value)
        expect(project.costAllowance).toBeLessThan(project.value);
  });
});

/* ---------- real accounts (Phase 2A) ---------- */

test.describe('identity mode', () => {
  test('Demo Mode unless real accounts are asked for by name', () => {
    expect(identityMode({})).toBe('demo');
    expect(identityMode({ HYPHY_IDENTITY: '' })).toBe('demo');
    expect(identityMode({ HYPHY_IDENTITY: 'demo' })).toBe('demo');
    expect(identityMode({ HYPHY_IDENTITY: 'supabse' })).toBe('demo');
    expect(identityMode({ HYPHY_IDENTITY: 'true' })).toBe('demo');
    expect(identityMode({ HYPHY_IDENTITY: 'supabase' })).toBe('supabase');
    expect(identityMode({ HYPHY_IDENTITY: ' Supabase ' })).toBe('supabase');
  });
  test('only a publishable key may be public', () => {
    expect(() => assertPublishable('sb_publishable_abc123')).not.toThrow();
    expect(() => assertPublishable('sb_secret_abc123')).toThrow(/secret/);
    const jwt = (role: string) =>
      `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.sig`;
    expect(() => assertPublishable(jwt('anon'))).not.toThrow();
    expect(() => assertPublishable(jwt('service_role'))).toThrow(/privileged/);
  });
});

test.describe('safe destinations after sign-in', () => {
  test('keeps paths inside Hyphy, with their query', () => {
    expect(safeNext('/abc/projects')).toBe('/abc/projects');
    expect(safeNext('/personal/tools/qr?x=1#top')).toBe('/personal/tools/qr?x=1#top');
    expect(safeNext('/platform/abc')).toBe('/abc');
    expect(safeNext('/platform')).toBe('/');
  });
  test('refuses other origins and tricks', () => {
    for (const bad of [
      '//evil.example',
      '///evil.example',
      'https://evil.example',
      'http:evil.example',
      'javascript:alert(1)',
      '/\\evil.example',
      '\\evil.example',
      '/..//evil.example',
      '/\t/evil.example',
      'evil.example',
      '',
      undefined,
      null,
      42,
      '/' + 'a'.repeat(2000),
    ])
      expect(safeNext(bad, '/fallback'), String(bad)).toBe('/fallback');
    // Encoded characters stay encoded: a harmless path on this site, not a header.
    expect(safeNext('/%0d%0aSet-Cookie:x')).toBe('/%0d%0aSet-Cookie:x');
  });
  test('never back into the sign-in pages', () => {
    for (const path of [
      '/sign-in',
      '/sign-up?x',
      '/forgot-password',
      '/reset-password',
      '/auth/confirm',
    ])
      expect(safeNext(path)).toBe('/');
    expect(signInPath('/abc/projects')).toBe('/sign-in?next=%2Fabc%2Fprojects');
    expect(signInPath('/')).toBe('/sign-in');
    expect(signInPath('//evil.example')).toBe('/sign-in');
  });
  test('which pages are open, and which only while signed out', () => {
    expect(isPublicPath('/sign-in')).toBe(true);
    expect(isPublicPath('/auth/confirm')).toBe(true);
    expect(isPublicPath('/reset-password')).toBe(true);
    expect(isPublicPath('/welcome')).toBe(false);
    expect(isPublicPath('/personal')).toBe(false);
    expect(isPublicPath('/sign-inside')).toBe(false);
    expect(isSignedOutOnlyPath('/sign-up')).toBe(true);
    expect(isSignedOutOnlyPath('/reset-password')).toBe(false);
  });
  test('a Space address is remembered only if it could be one', () => {
    expect(spaceSegment('/abc/projects')).toBe('abc');
    expect(spaceSegment('/personal')).toBe('personal');
    expect(spaceSegment('/sign-in')).toBeNull();
    expect(spaceSegment('/welcome')).toBeNull();
    expect(spaceSegment('/')).toBeNull();
    expect(spaceSegment('/ABC')).toBeNull();
    // The seed's Spaces never use a reserved address.
    for (const space of data.spaces.filter((item) => item.kind === 'business'))
      expect(reservedSlugs).not.toContain(space.slug);
  });
});

test.describe('the active Space', () => {
  const session = (personId: string): Session => ({
    source: 'supabase',
    person: data.people.find((person) => person.id === personId)!,
    memberships: data.memberships
      .filter((m) => m.personId === personId && m.status === 'active')
      .map((m) => ({ ...m, space: data.spaces.find((space) => space.id === m.spaceId)! })),
  });
  test('a remembered Space counts only while it is theirs', () => {
    expect(homeFor(session('jerry'), 'salt-and-ember')).toBe('/salt-and-ember');
    expect(homeFor(session('jerry'), 'personal')).toBe('/personal');
    // Mike isn't in Salt & Ember: the cookie is ignored.
    expect(homeFor(session('mike'), 'salt-and-ember')).toBe('/abc-construction');
    expect(homeFor(session('mike'), 'does-not-exist')).toBe('/abc-construction');
    expect(homeFor(session('mike'), null)).toBe('/abc-construction');
  });
  test('a new account lands in its Personal Space; nobody lands nowhere', () => {
    const person = data.people.find((item) => item.id === 'jerry')!;
    const personal = data.spaces.find((s) => s.kind === 'personal' && s.ownerId === 'jerry')!;
    const fresh: Session = {
      source: 'supabase',
      person,
      memberships: [
        {
          id: 'm1',
          spaceId: personal.id,
          personId: person.id,
          role: 'owner',
          title: 'Owner',
          status: 'active',
          joinedAt: personal.createdAt,
          space: personal,
        } as Session['memberships'][number],
      ],
    };
    expect(homeFor(fresh, 'abc-construction')).toBe('/personal');
    expect(homeFor({ ...fresh, memberships: [] }, 'abc-construction')).toBeNull();
  });
});

test.describe('account problems, in plain words', () => {
  const said = (code: string, intent: Parameters<typeof authProblem>[1] = 'sign-in') =>
    authProblem({ code, status: 400, message: 'raw supabase text' }, intent, 'production');
  test('known Supabase Auth codes', () => {
    expect(said('invalid_credentials').message).toMatch(/email and password don’t match/);
    expect(said('email_not_confirmed')).toMatchObject({ field: 'email' });
    expect(said('user_already_exists', 'sign-up').message).toMatch(/already an account/);
    expect(said('weak_password', 'sign-up')).toMatchObject({ field: 'password' });
    expect(
      authProblem({ code: 'weak_password', reasons: ['pwned'] }, 'sign-up', 'production').message,
    ).toMatch(/data breach/);
    expect(said('otp_expired', 'confirm').message).toMatch(/expired/);
    expect(said('otp_expired', 'reset-password').message).toMatch(/reset link has expired/);
    expect(said('over_email_send_rate_limit').message).toMatch(/Wait a minute/);
    expect(said('over_request_rate_limit').message).toMatch(/Wait a minute/);
    expect(said('same_password', 'change-password').message).toMatch(/current password/);
    expect(said('session_not_found', 'reset-password').message).toMatch(/expired/);
  });
  test('the network and rate limits without a code', () => {
    expect(
      authProblem({ name: 'AuthRetryableFetchError', status: 0 }, 'sign-in', 'production').message,
    ).toMatch(/couldn’t reach Hyphy/);
    expect(authProblem(new Error('fetch failed'), 'sign-in', 'production').message).toMatch(
      /couldn’t reach/,
    );
    expect(authProblem({ status: 429 }, 'sign-in', 'production').message).toMatch(/Wait a minute/);
  });
  test('unknown problems stay calm for people and diagnosable in development', () => {
    const odd = { code: 'something_new', message: 'Database error saving new user' };
    expect(authProblem(odd, 'sign-up', 'production').message).not.toMatch(/Database/);
    expect(authProblem(odd, 'sign-up', 'development').message).toMatch(
      /something_new: Database error saving new user/,
    );
  });
  test('the checks forms make first', () => {
    expect(checkEmail('')).toMatchObject({ field: 'email' });
    expect(checkEmail('not-an-email')).toMatchObject({ field: 'email' });
    expect(checkEmail(' ada@hyphy-tools.example ')).toBeNull();
    expect(checkNewPassword('short1')).toMatchObject({ field: 'password' });
    expect(checkNewPassword('onlyletters')).toMatchObject({ field: 'password' });
    expect(checkNewPassword('letters-and-1')).toBeNull();
    expect(checkNewPassword('a1'.repeat(40))).toMatchObject({ field: 'password' });
    expect(checkName('  ')).toMatchObject({ field: 'name' });
    expect(checkName('x'.repeat(81))).toMatchObject({ field: 'name' });
    expect(checkName('Ada')).toBeNull();
  });
});

/* ---------- businesses and teams (Phase 2B) ---------- */

test.describe('business types', () => {
  test('every type starts with People and Files, words that fit, and no unknown tool', () => {
    const known = new Set(tools.flatMap((tool) => (tool.module ? [tool.module] : [])));
    for (const type of BUSINESS_TYPES) {
      const modules = presetModules(type);
      expect(modules).toContain('people');
      expect(modules).toContain('files');
      for (const id of modules) expect(known.has(id), `${type}: ${id}`).toBe(true);
    }
    expect(presetLabels('construction')).toEqual({ projects: { singular: 'Job', plural: 'Jobs' } });
    expect(businessTypes.hospitality.workStyle).toBe('events');
    expect(presetLabels('real-estate')?.projects?.plural).toBe('Properties');
    expect(presetModules('construction')).toEqual(
      expect.arrayContaining(['projects', 'vehicles', 'receipts', 'mileage', 'qr']),
    );
    expect(presetModules('retail')).not.toContain('projects');
  });
  test('addresses come from the name and stay readable', () => {
    expect(slugify('ABC Construction')).toBe('abc-construction');
    expect(slugify('Salt & Ember')).toBe('salt-and-ember');
    expect(slugify('  Café Olé!! ')).toBe('cafe-ole');
    expect(slugify('X')).toBe('x-co');
    expect(slugify('!!!')).toBe('');
    expect(slugify('a'.repeat(80))).toHaveLength(48);
    expect(checkAddress('abc-construction')).toBeNull();
    for (const bad of ['a', '-abc', 'abc-', 'a--b', 'ABC', 'a b', 'a'.repeat(49)])
      expect(checkAddress(bad), bad).not.toBeNull();
    // The app's own paths are never a business's address.
    for (const path of ['invite', 'create-business', 'sign-in', 'welcome', 'auth'])
      expect(reservedSlugs).toContain(path);
  });
  test('a starting mark from the name', () => {
    expect(brandFor('Harbor Build')).toMatchObject({ monogram: 'H', ink: 'light' });
    expect(brandFor('Harbor Build')).toEqual(brandFor('Harbor Build'));
    expect(brandFor('  9 Lives').monogram).toBe('9');
  });
});

test.describe('who hands out which role', () => {
  test('owners add admins; admins add managers, members and guests; nobody adds owners', () => {
    expect(grantableRoles('owner')).toEqual(['admin', 'manager', 'member', 'guest']);
    expect(grantableRoles('admin')).toEqual(['manager', 'member', 'guest']);
    for (const role of ['manager', 'member', 'guest'] as const)
      expect(grantableRoles(role)).toEqual([]);
    for (const role of ['owner', 'admin', 'manager', 'member', 'guest'] as const)
      expect(grantableRoles(role)).not.toContain('owner');
  });
  test('nobody manages the owner or themselves; only the owner manages admins', () => {
    expect(canManageMember('owner', 'admin', false)).toBe(true);
    expect(canManageMember('admin', 'admin', false)).toBe(false);
    expect(canManageMember('admin', 'member', false)).toBe(true);
    expect(canManageMember('admin', 'owner', false)).toBe(false);
    expect(canManageMember('owner', 'owner', false)).toBe(false);
    expect(canManageMember('owner', 'member', true)).toBe(false);
    expect(canManageMember('manager', 'member', false)).toBe(false);
  });
  test('roles read as plain promises', () => {
    expect(roles.admin.summary).toBe('Can help manage the business and its team.');
    expect(roles.manager.summary).toBe('Can manage day-to-day work and approvals.');
  });
});

test.describe('the invitation email', () => {
  const base = {
    to: 'mike@example.com',
    spaceName: 'ABC Construction',
    brand: { color: '#F2A516', ink: 'dark' as const, monogram: 'AB' },
    inviterName: 'Jerry Sanchez',
    role: 'member' as const,
    link: 'https://hyphy-studio.com/platform/invite/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
  test('says who, where, which role and has one clear way in', () => {
    const email = invitationEmail(base);
    expect(email.subject).toBe('Jerry invited you to ABC Construction on Hyphy');
    expect(email.html).toContain('>Join ABC Construction</a>');
    expect(email.html).toContain(`href="${base.link}"`);
    expect(email.html).toContain('mike@example.com');
    expect(email.text).toContain(`Accept: ${base.link}`);
    expect(email.text).toContain('Your role: Member');
    expect(email.text).toContain('works for 7 days');
  });
  test('escapes everything a person typed', () => {
    const email = invitationEmail({
      ...base,
      spaceName: '<script>alert(1)</script>',
      inviterName: 'Eve "Quotes"',
      note: '<img src=x onerror=alert(1)>',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;script&gt;');
  });
  test('who delivers it: captured in development, nothing by default in production', () => {
    expect(emailProviderName({ NODE_ENV: 'development' })).toBe('capture');
    expect(emailProviderName({ NODE_ENV: 'production' })).toBe('none');
    expect(emailProviderName({ NODE_ENV: 'production', HYPHY_EMAIL: 'resend' })).toBe('resend');
    expect(emailProviderName({ NODE_ENV: 'development', HYPHY_EMAIL: 'none' })).toBe('none');
  });
  test('People says how long a link still works', () => {
    const now = Date.UTC(2026, 8, 25, 18);
    const invitation = {
      id: 'i',
      spaceId: 's',
      email: 'a@b.co',
      name: '',
      role: 'member' as const,
      title: '',
      projectIds: [],
      status: 'pending' as const,
      invitedBy: 'p',
      createdAt: new Date(now - 86_400_000).toISOString(),
      sentAt: new Date(now - 86_400_000).toISOString(),
      expiresAt: new Date(now + 6 * 86_400_000).toISOString(),
    };
    expect(describeInvitation(invitation, 'America/Chicago', now)).toMatch(
      /link works 6 more days$/,
    );
    expect(
      describeInvitation({ ...invitation, expiresAt: new Date(now - 1).toISOString() }, 'UTC', now),
    ).toMatch(/link expired$/);
  });
});
