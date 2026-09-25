import { can, isOperator } from './roles';
import { isModuleReady } from './tools';
import type { Membership, Space } from './types';

/**
 * Dashboards are composed, not designed per person. Each widget says when it applies; the
 * layout for a Space and role is simply the widgets that apply, in a sensible order.
 *
 * Each perspective answers one question first:
 *   personal  “What can I do right now?”      — the tools, with what's in them
 *   member    “What do I need to do?”         — big actions, my project, my submissions
 *   operator  “What needs me, and how are we doing?” — a pulse, then attention and projects
 *   guest     “What's been shared with me?”
 */
export type WidgetId =
  | 'pulse'
  | 'attention'
  | 'projects'
  | 'activity'
  | 'team'
  | 'money'
  | 'fleet'
  | 'codes'
  | 'launcher'
  | 'recent-work'
  | 'recent-files'
  | 'my-day'
  | 'my-vehicle'
  | 'my-submissions'
  | 'notices'
  | 'shared-projects'
  | 'shared-files';

type Rule = {
  id: WidgetId;
  /** `top` spans the page under the greeting; `main` and `side` are the two columns. */
  area: 'top' | 'main' | 'side';
  when: (space: Space, membership: Pick<Membership, 'role'>) => boolean;
};

const business = (space: Space) => space.kind === 'business';
const personal = (space: Space) => space.kind === 'personal';
const operator = (space: Space, m: Pick<Membership, 'role'>) =>
  business(space) && isOperator(m.role);

const rules: Rule[] = [
  // Personal: the tools first, then what you made with them
  { id: 'launcher', area: 'top', when: personal },
  { id: 'recent-work', area: 'main', when: personal },
  { id: 'attention', area: 'side', when: personal },
  { id: 'recent-files', area: 'side', when: personal },

  // People who run a business Space
  { id: 'pulse', area: 'top', when: operator },
  { id: 'attention', area: 'main', when: operator },
  {
    id: 'projects',
    area: 'main',
    when: (space, m) => operator(space, m) && isModuleReady('projects', space, m),
  },
  { id: 'activity', area: 'main', when: operator },
  {
    id: 'team',
    area: 'side',
    when: (space, m) => operator(space, m) && isModuleReady('people', space, m),
  },
  {
    id: 'money',
    area: 'side',
    when: (space, m) =>
      business(space) && can(m, 'expenses.view_all') && isModuleReady('receipts', space, m),
  },
  {
    id: 'fleet',
    area: 'side',
    when: (space, m) => operator(space, m) && isModuleReady('vehicles', space, m),
  },
  {
    id: 'codes',
    area: 'side',
    when: (space, m) =>
      operator(space, m) && !isModuleReady('vehicles', space, m) && isModuleReady('qr', space, m),
  },

  // Members: their day, their truck, their submissions
  { id: 'my-day', area: 'main', when: (space, m) => business(space) && m.role === 'member' },
  // What someone asked of them is part of their day, so it sits right under the project.
  { id: 'notices', area: 'main', when: (space, m) => business(space) && m.role === 'member' },
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

  { id: 'activity', area: 'side', when: (space, m) => business(space) && m.role === 'member' },

  // Guests: only what's shared, with anything meant for them first
  { id: 'notices', area: 'top', when: (space, m) => business(space) && m.role === 'guest' },
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
  top: WidgetId[];
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
  const area = (name: Rule['area']) =>
    applicable.filter((rule) => rule.area === name).map((rule) => rule.id);
  return {
    hero,
    bigActions: hero === 'member',
    top: area('top'),
    main: area('main'),
    side: area('side'),
  };
}
