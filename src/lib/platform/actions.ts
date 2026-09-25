import type { IconName } from '@/components/ui/icon';
import { can, type Permission } from './roles';
import { availability, getTool } from './tools';
import type { Membership, Role, Space } from './types';

/**
 * Universal Create. Every “make something” action is registered here once; the + menu, the
 * dashboard quick actions, the command bar and the mobile Create sheet all read the same list,
 * filtered by the Space, the plan, the enabled modules and the person's role.
 *
 * `form` actions open a sheet in place; `route` actions open a tool.
 */
export type CreateFormId =
  'receipt' | 'mileage' | 'project' | 'person' | 'vehicle' | 'file' | 'photos';

export type CreateActionId =
  | 'receipt'
  | 'mileage'
  | 'pdf'
  | 'qr'
  | 'link-page'
  | 'project'
  | 'person'
  | 'vehicle'
  | 'file'
  | 'photos'
  | 'images';

type Perspective = 'personal' | Role;

/** How the Create menu groups actions: record what happened, set up the business, make something. */
export type CreateGroup = 'capture' | 'setup' | 'make';

export const createGroups: { id: CreateGroup; label: string }[] = [
  { id: 'capture', label: 'Capture' },
  { id: 'setup', label: 'Set up' },
  { id: 'make', label: 'Make' },
];

type CreateActionDefinition = {
  id: CreateActionId;
  /** The tool it belongs to, for availability, color and glyph. */
  toolId: string;
  label: string | (Partial<Record<Perspective, string>> & { default: string });
  hint: string;
  group: CreateGroup;
  icon?: IconName;
  permission?: Permission;
  target: { type: 'form'; form: CreateFormId } | { type: 'route'; path: string };
};

const definitions: CreateActionDefinition[] = [
  {
    id: 'receipt',
    toolId: 'receipts',
    label: {
      default: 'Upload receipt',
      personal: 'Scan receipt',
      member: 'Submit receipt',
    },
    hint: 'Snap it, file it',
    group: 'capture',
    icon: 'scan',
    permission: 'expenses.submit',
    target: { type: 'form', form: 'receipt' },
  },
  {
    id: 'mileage',
    toolId: 'mileage',
    label: 'Log mileage',
    hint: 'A trip in a few taps',
    group: 'capture',
    permission: 'expenses.submit',
    target: { type: 'form', form: 'mileage' },
  },
  {
    id: 'photos',
    toolId: 'files',
    label: { default: 'Upload photos', member: 'Upload job photos' },
    hint: 'Straight to the project',
    group: 'capture',
    icon: 'camera',
    permission: 'files.upload',
    target: { type: 'form', form: 'photos' },
  },
  {
    id: 'project',
    toolId: 'projects',
    label: 'Create project',
    hint: 'Costs, files and team',
    group: 'setup',
    permission: 'projects.manage',
    target: { type: 'form', form: 'project' },
  },
  {
    id: 'person',
    toolId: 'people',
    label: 'Add person',
    hint: 'Invite and pick a role',
    group: 'setup',
    icon: 'user-plus',
    permission: 'people.manage',
    target: { type: 'form', form: 'person' },
  },
  {
    id: 'vehicle',
    toolId: 'vehicles',
    label: 'Add vehicle',
    hint: 'Assign it, track its costs',
    group: 'setup',
    permission: 'vehicles.manage',
    target: { type: 'form', form: 'vehicle' },
  },
  {
    id: 'file',
    toolId: 'files',
    label: 'Upload file',
    hint: 'Attach it to the work',
    group: 'capture',
    icon: 'upload',
    permission: 'files.upload',
    target: { type: 'form', form: 'file' },
  },
  {
    id: 'pdf',
    toolId: 'pdf',
    label: { default: 'Process PDF', personal: 'Work with PDF' },
    hint: 'Merge, split, reorder',
    group: 'make',
    target: { type: 'route', path: '/tools/pdf' },
  },
  {
    id: 'qr',
    toolId: 'qr',
    label: 'Create QR code',
    hint: 'For signs, menus, cards',
    group: 'make',
    target: { type: 'route', path: '/tools/qr' },
  },
  {
    id: 'link-page',
    toolId: 'links',
    label: 'Create link page',
    hint: 'One link for everything',
    group: 'make',
    target: { type: 'route', path: '/tools/links' },
  },
  {
    id: 'images',
    toolId: 'images',
    label: 'Resize images',
    hint: 'Resize and convert',
    group: 'make',
    target: { type: 'route', path: '/tools/images' },
  },
];

/** What each kind of person reaches for first. Unlisted actions follow in registry order. */
const priorities: Record<Perspective, CreateActionId[]> = {
  personal: ['receipt', 'mileage', 'pdf', 'qr', 'link-page', 'file', 'images'],
  owner: ['project', 'person', 'receipt', 'vehicle', 'file', 'qr', 'mileage', 'link-page'],
  admin: ['person', 'project', 'vehicle', 'file', 'receipt', 'qr', 'mileage'],
  manager: ['project', 'receipt', 'mileage', 'file', 'vehicle', 'qr', 'photos'],
  member: ['receipt', 'mileage', 'photos', 'file'],
  guest: ['photos', 'file'],
};

export type CreateAction = {
  id: CreateActionId;
  toolId: string;
  label: string;
  hint: string;
  group: CreateGroup;
  icon: IconName;
  color: string;
  ink: 'dark' | 'light';
  target: CreateActionDefinition['target'];
};

function perspective(space: Space, membership: Pick<Membership, 'role'>): Perspective {
  return space.kind === 'personal' ? 'personal' : membership.role;
}

/** Actions this person can take in this Space, most useful first. */
export function createActionsFor(
  space: Space,
  membership: Pick<Membership, 'role'>,
): CreateAction[] {
  const view = perspective(space, membership);
  const order = priorities[view];
  const rank = (id: CreateActionId) => {
    const index = order.indexOf(id);
    return index === -1 ? order.length + definitions.findIndex((item) => item.id === id) : index;
  };
  return definitions
    .filter((definition) => {
      const tool = getTool(definition.toolId);
      if (!tool) return false;
      if (definition.permission && !can(membership, definition.permission)) return false;
      // Members and guests get exactly their short list: employees shouldn't wade through tools.
      if (view === 'member' || view === 'guest') {
        if (!order.includes(definition.id)) return false;
        // Guests upload into shared projects without the Files module's broader access.
        if (view === 'guest') return true;
      }
      return availability(tool, space, membership).state === 'ready';
    })
    .filter((definition) => view === 'personal' || definition.id !== 'images')
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((definition) => {
      const tool = getTool(definition.toolId)!;
      const label =
        typeof definition.label === 'string'
          ? definition.label
          : (definition.label[view] ?? definition.label.default);
      const projectLabel = space.labels?.projects?.singular;
      return {
        id: definition.id,
        toolId: definition.toolId,
        label:
          definition.id === 'project' && projectLabel
            ? `Create ${projectLabel.toLowerCase()}`
            : label,
        hint: definition.hint,
        group: definition.group,
        icon: definition.icon ?? tool.icon,
        color: tool.color,
        ink: tool.ink,
        target: definition.target,
      };
    });
}

/** Actions in menu order: grouped (Capture, Set up, Make), most useful first within a group. */
export function groupActions(actions: CreateAction[]) {
  return createGroups
    .map((group) => ({ ...group, actions: actions.filter((action) => action.group === group.id) }))
    .filter((group) => group.actions.length > 0);
}

/** The first few actions, for dashboards. */
export function quickActionsFor(space: Space, membership: Pick<Membership, 'role'>, count = 5) {
  return createActionsFor(space, membership).slice(0, count);
}
