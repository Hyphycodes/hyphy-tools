import { can, isOperator } from './roles';
import { isModuleReady } from './tools';
import type { Membership, Space } from './types';

/**
 * Dashboards are composed, not designed per person. Each widget says when it applies; the
 * layout for a Space and role is simply the widgets that apply, in a sensible order.
 */
export type WidgetId =
  | 'attention'
  | 'projects'
  | 'month'
  | 'activity'
  | 'team'
  | 'fleet'
  | 'plan'
  | 'codes'
  | 'recent-work'
  | 'favorite-tools'
  | 'personal-month'
  | 'my-day'
  | 'my-vehicle'
  | 'my-submissions'
  | 'notices'
  | 'shared-projects'
  | 'shared-files';

type Rule = {
  id: WidgetId;
  area: 'main' | 'side';
  when: (space: Space, membership: Pick<Membership, 'role'>) => boolean;
};

const business = (space: Space) => space.kind === 'business';
const personal = (space: Space) => space.kind === 'personal';

const rules: Rule[] = [
  // Personal
  { id: 'recent-work', area: 'main', when: personal },
  { id: 'favorite-tools', area: 'main', when: personal },
  { id: 'personal-month', area: 'side', when: personal },
  { id: 'attention', area: 'side', when: personal },

  // People who run a business Space
  { id: 'attention', area: 'main', when: (space, m) => business(space) && isOperator(m.role) },
  {
    id: 'projects',
    area: 'main',
    when: (space, m) =>
      business(space) && isOperator(m.role) && isModuleReady('projects', space, m),
  },
  {
    id: 'month',
    area: 'main',
    when: (space, m) =>
      business(space) && can(m, 'expenses.view_all') && isModuleReady('receipts', space, m),
  },
  {
    id: 'codes',
    area: 'main',
    when: (space, m) =>
      business(space) &&
      isOperator(m.role) &&
      !isModuleReady('vehicles', space, m) &&
      isModuleReady('qr', space, m),
  },
  { id: 'activity', area: 'side', when: (space, m) => business(space) && isOperator(m.role) },
  {
    id: 'fleet',
    area: 'side',
    when: (space, m) =>
      business(space) && isOperator(m.role) && isModuleReady('vehicles', space, m),
  },
  { id: 'team', area: 'side', when: (space, m) => business(space) && can(m, 'people.manage') },
  { id: 'plan', area: 'side', when: (space, m) => business(space) && can(m, 'space.billing') },

  // Members: their day, their truck, their submissions
  { id: 'my-day', area: 'main', when: (space, m) => business(space) && m.role === 'member' },
  {
    id: 'my-submissions',
    area: 'main',
    when: (space, m) => business(space) && m.role === 'member',
  },
  {
    id: 'my-vehicle',
    area: 'side',
    when: (space, m) =>
      business(space) && m.role === 'member' && isModuleReady('vehicles', space, m),
  },
  {
    id: 'notices',
    area: 'side',
    when: (space, m) => business(space) && (m.role === 'member' || m.role === 'guest'),
  },
  { id: 'activity', area: 'side', when: (space, m) => business(space) && m.role === 'member' },

  // Guests: only what's shared
  {
    id: 'shared-projects',
    area: 'main',
    when: (space, m) => business(space) && m.role === 'guest',
  },
  { id: 'shared-files', area: 'main', when: (space, m) => business(space) && m.role === 'guest' },
];

export type DashboardLayout = {
  hero: 'personal' | 'operator' | 'member' | 'guest';
  /** Members get big, thumb-sized actions; everyone else a compact row. */
  bigActions: boolean;
  main: WidgetId[];
  side: WidgetId[];
};

export function dashboardFor(space: Space, membership: Pick<Membership, 'role'>): DashboardLayout {
  const applicable = rules.filter((rule) => rule.when(space, membership));
  const hero = personal(space)
    ? 'personal'
    : isOperator(membership.role)
      ? 'operator'
      : membership.role === 'member'
        ? 'member'
        : 'guest';
  return {
    hero,
    bigActions: hero === 'member',
    main: applicable.filter((rule) => rule.area === 'main').map((rule) => rule.id),
    side: applicable.filter((rule) => rule.area === 'side').map((rule) => rule.id),
  };
}
