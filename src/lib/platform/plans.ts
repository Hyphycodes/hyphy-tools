import type { ModuleId, PlanId, SpaceKind } from './types';

/**
 * Plans describe what a Space can turn on. A plan never decides what a person may do (that's
 * their role) and never turns a tool on by itself (that's the Space's module list).
 *
 * Billing isn't active in this preview: plans have no prices here. When paid plans launch,
 * prices come from Hyphy Studio's `src/data/engagements.ts` and access from the billing webhook.
 */
export type Plan = {
  id: PlanId;
  name: string;
  kind: SpaceKind;
  summary: string;
  includes: ModuleId[];
};

const personalTools: ModuleId[] = ['pdf', 'qr', 'images', 'links', 'receipts', 'mileage', 'files'];

export const plans: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    kind: 'personal',
    summary: 'Everyday tools for one person.',
    includes: personalTools,
  },
  'personal-pro': {
    id: 'personal-pro',
    name: 'Personal Pro',
    kind: 'personal',
    summary: 'More history, more storage, receipts that read themselves.',
    includes: personalTools,
  },
  business: {
    id: 'business',
    name: 'Business',
    kind: 'business',
    summary: 'A shared Space for a team: people, projects, files and approvals.',
    includes: [...personalTools, 'projects', 'people'],
  },
  'business-pro': {
    id: 'business-pro',
    name: 'Business Pro',
    kind: 'business',
    summary: 'Everything in Business, plus vehicles and custom fields.',
    includes: [...personalTools, 'projects', 'people', 'vehicles'],
  },
};

/** The smallest plan of a kind that includes a module, for “Included with …” hints. */
export function planFor(module: ModuleId, kind: SpaceKind): Plan | undefined {
  return Object.values(plans).find((plan) => plan.kind === kind && plan.includes.includes(module));
}
