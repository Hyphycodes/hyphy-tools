import type { Membership, Role } from './types';

/**
 * What a role lets someone do inside one Space. Deliberately short: five roles, a handful of
 * capabilities. More granular control later means per-membership `grants`/`revokes`, not more
 * roles. These checks shape the interface and guard server actions; once the database is live,
 * Row Level Security enforces the same rules on every read and write.
 */
export const PERMISSIONS = [
  'space.manage',
  'space.billing',
  'people.view',
  'people.manage',
  'projects.view_all',
  'projects.manage',
  'vehicles.view_all',
  'vehicles.manage',
  'expenses.submit',
  'expenses.view_all',
  'expenses.approve',
  'files.view_all',
  'files.upload',
  'files.manage',
  'activity.view_all',
  'tools.use',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const operations: Permission[] = [
  'people.view',
  'projects.view_all',
  'projects.manage',
  'vehicles.view_all',
  'vehicles.manage',
  'expenses.submit',
  'expenses.view_all',
  'expenses.approve',
  'files.view_all',
  'files.upload',
  'files.manage',
  'activity.view_all',
  'tools.use',
];

const byRole: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: PERMISSIONS.filter((permission) => permission !== 'space.billing'),
  manager: operations,
  member: ['people.view', 'expenses.submit', 'files.upload', 'tools.use'],
  guest: ['files.upload'],
};

export const roles: Record<
  Role,
  { label: string; summary: string; can: string[]; cannot: string[] }
> = {
  owner: {
    label: 'Owner',
    summary: 'Runs the Space, including its plan.',
    can: ['Everything in this Space', 'Change the plan', 'Add and remove anyone'],
    cannot: [],
  },
  admin: {
    label: 'Admin',
    summary: 'Manages people, settings and all records.',
    can: ['Manage people and roles', 'Turn tools on and off', 'See and approve everything'],
    cannot: ['Change the plan'],
  },
  manager: {
    label: 'Manager',
    summary: 'Runs day-to-day work for the team.',
    can: ['Create projects', 'Approve receipts and mileage', 'Manage vehicles and files'],
    cannot: ['Change settings or the plan', 'Change anyone’s role'],
  },
  member: {
    label: 'Member',
    summary: 'Does the work and submits it.',
    can: ['Submit receipts and mileage', 'Upload photos and files', 'See their projects'],
    cannot: ['See other people’s submissions', 'Approve anything'],
  },
  guest: {
    label: 'Guest',
    summary: 'Sees only what’s shared with them.',
    can: ['Open shared projects', 'Upload files to them'],
    cannot: ['See the rest of the Space', 'See people or money'],
  },
};

export const ROLE_ORDER: Role[] = ['owner', 'admin', 'manager', 'member', 'guest'];

/** The permissions a membership grants. The one place roles turn into capabilities. */
export function permissionsFor(membership: Pick<Membership, 'role'>): Permission[] {
  return [...byRole[membership.role]];
}

export function can(membership: Pick<Membership, 'role'>, permission: Permission) {
  return byRole[membership.role].includes(permission);
}

/** Owners, admins and managers run the Space; members and guests use it. */
export function isOperator(role: Role) {
  return role === 'owner' || role === 'admin' || role === 'manager';
}
