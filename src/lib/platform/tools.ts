import type { IconName } from '@/components/ui/icon';
import { can, type Permission } from './roles';
import { planFor, plans } from './plans';
import type { Membership, ModuleId, PlanId, Role, Space, SpaceKind } from './types';

/**
 * The tool registry: every tool and business module Hyphy Tools knows about, in one place.
 * Navigation, the Tools library, Universal Create, search and the dashboards all read it.
 *
 * Adding a tool = adding an entry here (and its route under `src/app/(app)/[space]`).
 */

export type ToolStatus = 'available' | 'beta' | 'soon';
export type ToolCategory = 'documents' | 'images' | 'links' | 'tracking' | 'business';

export type ToolDefinition = {
  id: string;
  /** The Space module that must be on. Coming-soon tools have none. */
  module?: ModuleId;
  name: string;
  /** The one-line promise. */
  tagline: string;
  description: string;
  icon: IconName;
  color: string;
  ink: 'dark' | 'light';
  category: ToolCategory;
  /** Utilities do one job; trackers keep records; modules organize a business. */
  kind: 'utility' | 'tracker' | 'module';
  status: ToolStatus;
  spaceKinds: SpaceKind[];
  /** Needed to open the tool at all. */
  permission?: Permission;
  /** Limits a tool to some roles when no single permission fits. */
  roles?: Role[];
  tier: 'free' | 'premium';
  bestFor: 'personal' | 'teams' | 'both';
  /** Relative to the Space: `/tools/qr`, `/projects`. */
  path?: string;
  highlights: string[];
  /** Said plainly where it matters: where the work happens. */
  privacy?: string;
  /** Logic that started life in Hyphy Studio. */
  origin?: 'studio';
};

export const categories: { id: ToolCategory; name: string; line: string }[] = [
  { id: 'documents', name: 'Documents', line: 'PDFs and paperwork' },
  { id: 'images', name: 'Images', line: 'Photos, ready for anywhere' },
  { id: 'links', name: 'Links & QR', line: 'Get people where you want them' },
  { id: 'tracking', name: 'Tracking', line: 'Receipts and miles, kept for you' },
  { id: 'business', name: 'Business', line: 'How a team runs its work' },
];

export const tools: ToolDefinition[] = [
  {
    id: 'receipts',
    module: 'receipts',
    name: 'Receipts',
    tagline: 'Snap it. Sorted.',
    description:
      'Photograph a receipt, check the details and file it to the right vehicle or project. Teams get an approval step before anything counts.',
    icon: 'receipt',
    color: '#E4FF3A',
    ink: 'dark',
    category: 'tracking',
    kind: 'tracker',
    status: 'beta',
    spaceKinds: ['personal', 'business'],
    permission: 'expenses.submit',
    tier: 'free',
    bestFor: 'both',
    path: '/tools/receipts',
    highlights: [
      'Photo or PDF, from a phone',
      'Fuel fields: gallons and odometer',
      'Approvals for teams',
    ],
    origin: 'studio',
  },
  {
    id: 'mileage',
    module: 'mileage',
    name: 'Mileage',
    tagline: 'Every business mile, accounted for.',
    description:
      'Log a trip in a few taps, tie it to a vehicle or project, and keep a dated record for reimbursement or taxes.',
    icon: 'route',
    color: '#7FD4FF',
    ink: 'dark',
    category: 'tracking',
    kind: 'tracker',
    status: 'beta',
    spaceKinds: ['personal', 'business'],
    permission: 'expenses.submit',
    tier: 'free',
    bestFor: 'both',
    path: '/tools/mileage',
    highlights: ['Start and end or total miles', 'Round trips in one tap', 'Monthly totals'],
  },
  {
    id: 'pdf',
    module: 'pdf',
    name: 'PDF',
    tagline: 'Merge, split and reorder.',
    description:
      'Combine a stack of PDFs into one file, or pull out just the pages you need. Your files never leave your device.',
    icon: 'pdf',
    color: '#FF6A3D',
    ink: 'dark',
    category: 'documents',
    kind: 'utility',
    status: 'available',
    spaceKinds: ['personal', 'business'],
    permission: 'tools.use',
    tier: 'free',
    bestFor: 'both',
    path: '/tools/pdf',
    highlights: ['Up to 20 files, 500 pages', 'Extract any page range', 'Save the result to Files'],
    privacy: 'Runs on your device. Nothing is uploaded.',
    origin: 'studio',
  },
  {
    id: 'qr',
    module: 'qr',
    name: 'QR Codes',
    tagline: 'A clean code for any link.',
    description:
      'Type a link, pick your colors and download a sharp PNG or print-ready SVG. Save codes to your Space so the team can find them.',
    icon: 'qr',
    color: '#20D392',
    ink: 'dark',
    category: 'links',
    kind: 'utility',
    status: 'available',
    spaceKinds: ['personal', 'business'],
    permission: 'tools.use',
    tier: 'free',
    bestFor: 'both',
    path: '/tools/qr',
    highlights: ['Live preview', 'Contrast checked as you go', 'PNG up to 2048 px or SVG'],
    privacy: 'Made on your device. No tracking redirects.',
    origin: 'studio',
  },
  {
    id: 'links',
    module: 'links',
    name: 'Link Pages',
    tagline: 'One link. Everything you do.',
    description:
      'A simple page for your bio link: booking, menus, socials and this week’s news, in one place you control.',
    icon: 'link',
    color: '#FF8AD8',
    ink: 'dark',
    category: 'links',
    kind: 'utility',
    status: 'beta',
    spaceKinds: ['personal', 'business'],
    permission: 'tools.use',
    tier: 'free',
    bestFor: 'both',
    path: '/tools/links',
    highlights: ['Live phone preview', 'Four finishes', 'Pairs with a QR code'],
  },
  {
    id: 'images',
    module: 'images',
    name: 'Image Resize',
    tagline: 'Smaller files. Same picture.',
    description:
      'Resize, compress and convert photos to JPG, PNG or WebP, and see the new size before you download.',
    icon: 'image',
    color: '#FFC53D',
    ink: 'dark',
    category: 'images',
    kind: 'utility',
    status: 'available',
    spaceKinds: ['personal', 'business'],
    permission: 'tools.use',
    tier: 'free',
    bestFor: 'both',
    path: '/tools/images',
    highlights: ['Batch up to 20 images', 'Before and after sizes', 'Strips location data'],
    privacy: 'Processed on your device. Nothing is uploaded.',
    origin: 'studio',
  },
  {
    id: 'projects',
    module: 'projects',
    name: 'Projects',
    tagline: 'Every job in one place.',
    description:
      'Expenses, miles, files, photos and the team for each job, gathered automatically as people work.',
    icon: 'projects',
    color: '#15140F',
    ink: 'light',
    category: 'business',
    kind: 'module',
    status: 'available',
    spaceKinds: ['business'],
    tier: 'premium',
    bestFor: 'teams',
    path: '/projects',
    highlights: [
      'Costs roll up as they’re submitted',
      'Guests see only their project',
      'Photos by date',
    ],
  },
  {
    id: 'vehicles',
    module: 'vehicles',
    name: 'Vehicles',
    tagline: 'Who has which truck, and what it costs.',
    description:
      'Assign vehicles, see fuel and mileage as they come in, and keep registration and insurance where you can find them.',
    icon: 'truck',
    color: '#15140F',
    ink: 'light',
    category: 'business',
    kind: 'module',
    status: 'available',
    spaceKinds: ['business'],
    roles: ['owner', 'admin', 'manager', 'member'],
    tier: 'premium',
    bestFor: 'teams',
    path: '/vehicles',
    highlights: ['Fuel and miles per vehicle', 'Expiring documents flagged', 'One tap to reassign'],
  },
  {
    id: 'people',
    module: 'people',
    name: 'People',
    tagline: 'Your team, and what each person can see.',
    description:
      'Add employees, managers and outside contractors, and decide who can access what without a settings maze.',
    icon: 'people',
    color: '#15140F',
    ink: 'light',
    category: 'business',
    kind: 'module',
    status: 'available',
    spaceKinds: ['business'],
    permission: 'people.view',
    tier: 'premium',
    bestFor: 'teams',
    path: '/people',
    highlights: ['Five plain roles', 'Guests limited to one project', 'Profiles with their work'],
  },
  {
    id: 'files',
    module: 'files',
    name: 'Files',
    tagline: 'Attached to the work, not lost in folders.',
    description:
      'Contracts, permits, photos and paperwork, connected to the project, vehicle or person they belong to.',
    icon: 'files',
    color: '#15140F',
    ink: 'light',
    category: 'business',
    kind: 'module',
    status: 'available',
    spaceKinds: ['personal', 'business'],
    tier: 'free',
    bestFor: 'both',
    path: '/files',
    highlights: ['Attached to real records', 'Expiry reminders', 'Guest-safe sharing'],
  },
  {
    id: 'bulk-rename',
    name: 'Bulk Rename',
    tagline: 'Two hundred IMG_4471s, sorted.',
    description:
      'Rename a batch of files with dates and patterns, sort them into folders and download one archive.',
    icon: 'folders',
    color: '#C7B5FF',
    ink: 'dark',
    category: 'documents',
    kind: 'utility',
    status: 'soon',
    spaceKinds: ['personal', 'business'],
    tier: 'free',
    bestFor: 'both',
    highlights: ['Date and pattern names', 'Folders by project', 'One zip'],
  },
  {
    id: 'forms',
    name: 'Forms',
    tagline: 'Checklists your team fills from the field.',
    description:
      'Daily logs, inspections and sign-offs, built from the same fields as the rest of your Space.',
    icon: 'form',
    color: '#B8F2E0',
    ink: 'dark',
    category: 'business',
    kind: 'module',
    status: 'soon',
    spaceKinds: ['business'],
    tier: 'premium',
    bestFor: 'teams',
    highlights: ['Built from custom fields', 'Photos and signatures', 'Filed to the project'],
  },
];

export const statusLabel: Record<ToolStatus, string> = {
  available: 'Available',
  beta: 'Beta',
  soon: 'Coming soon',
};

export function getTool(id: string) {
  return tools.find((tool) => tool.id === id);
}

/** A tool's name as this Space calls it (a restaurant's Projects are Events). */
export function toolName(tool: ToolDefinition, space: Space) {
  return (tool.module && space.labels?.[tool.module]?.plural) || tool.name;
}

export type Availability =
  | { state: 'ready' }
  | { state: 'soon' }
  | { state: 'wrong-space'; kind: SpaceKind }
  | { state: 'not-in-plan'; plan?: PlanId }
  | { state: 'off' }
  | { state: 'no-access' };

/**
 * Whether this person can use a tool in this Space, and if not, the honest reason. Four separate
 * questions, in order: does it exist yet, does it belong in this kind of Space, does the plan
 * include it, is it turned on here — and only then, does this person's role allow it.
 */
export function availability(
  tool: ToolDefinition,
  space: Space,
  membership: Pick<Membership, 'role'>,
): Availability {
  if (tool.status === 'soon' || !tool.module) return { state: 'soon' };
  if (!tool.spaceKinds.includes(space.kind))
    return { state: 'wrong-space', kind: tool.spaceKinds[0] };
  if (!plans[space.plan].includes.includes(tool.module))
    return { state: 'not-in-plan', plan: planFor(tool.module, space.kind)?.id };
  if (!space.modules.includes(tool.module)) return { state: 'off' };
  if (tool.permission && !can(membership, tool.permission)) return { state: 'no-access' };
  if (tool.roles && !tool.roles.includes(membership.role)) return { state: 'no-access' };
  return { state: 'ready' };
}

export function availabilityNote(result: Availability, space: Space): string {
  switch (result.state) {
    case 'ready':
      return 'Ready';
    case 'soon':
      return 'Coming soon';
    case 'wrong-space':
      return result.kind === 'business' ? 'For business Spaces' : 'For personal Spaces';
    case 'not-in-plan':
      return result.plan ? `Included with ${plans[result.plan].name}` : 'Not in this plan';
    case 'off':
      return `Off in ${space.name}`;
    case 'no-access':
      return 'Not part of your role';
  }
}

export function readyTools(space: Space, membership: Pick<Membership, 'role'>) {
  return tools.filter((tool) => availability(tool, space, membership).state === 'ready');
}

export function isModuleReady(
  module: ModuleId,
  space: Space,
  membership: Pick<Membership, 'role'>,
) {
  const tool = tools.find((item) => item.module === module);
  return Boolean(tool && availability(tool, space, membership).state === 'ready');
}
