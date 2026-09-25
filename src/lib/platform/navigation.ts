import type { IconName } from '@/components/ui/icon';
import { can } from './roles';
import { availability, isModuleReady, tools, toolName } from './tools';
import type { Membership, Space } from './types';

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  /** Filled in by the shell (e.g. open inbox items). */
  count?: number;
};

export type NavModel = {
  primary: NavItem[];
  space: NavItem[];
  tools: {
    id: string;
    label: string;
    href: string;
    icon: IconName;
    color: string;
    ink: 'dark' | 'light';
    /** Kept within reach by this person; pinned tools lead the list. */
    pinned?: boolean;
  }[];
  settings?: NavItem;
};

/**
 * Navigation for one person in one Space. Items appear because a module is on, the plan includes
 * it and the role allows it — never because of who the person is.
 */
export function navigationFor(space: Space, membership: Pick<Membership, 'role'>): NavModel {
  const base = `/${space.slug}`;
  const personal = space.kind === 'personal';
  const moduleItem = (
    id: 'projects' | 'vehicles' | 'people' | 'files',
    icon: IconName,
  ): NavItem[] => {
    if (!isModuleReady(id, space, membership)) return [];
    const tool = tools.find((item) => item.id === id)!;
    return [{ id, label: toolName(tool, space), href: `${base}/${id}`, icon }];
  };

  return {
    primary: [
      { id: 'home', label: 'Home', href: base, icon: 'home' },
      { id: 'inbox', label: 'Inbox', href: `${base}/inbox`, icon: 'inbox' },
      ...(membership.role === 'guest'
        ? []
        : [{ id: 'tools', label: 'Tools', href: `${base}/tools`, icon: 'tools' as const }]),
    ],
    space: [
      ...moduleItem('projects', 'projects'),
      ...moduleItem('vehicles', 'truck'),
      ...moduleItem('people', 'people'),
      ...moduleItem('files', 'files'),
      {
        id: 'activity',
        label: personal ? 'History' : 'Activity',
        href: `${base}/activity`,
        icon: 'activity',
      },
    ],
    tools: tools
      .filter((tool) => tool.kind !== 'module' && tool.path)
      .filter((tool) => availability(tool, space, membership).state === 'ready')
      .map((tool) => ({
        id: tool.id,
        label: tool.name,
        href: `${base}${tool.path}`,
        icon: tool.icon,
        color: tool.color,
        ink: tool.ink,
      })),
    settings: can(membership, 'space.manage')
      ? {
          id: 'settings',
          label: personal ? 'Settings' : 'Space settings',
          href: `${base}/settings`,
          icon: 'settings',
        }
      : undefined,
  };
}
