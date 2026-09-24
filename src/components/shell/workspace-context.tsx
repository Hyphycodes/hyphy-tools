'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { Permission } from '@/lib/platform/roles';
import type { ShellModel } from './model';

type WorkspaceValue = ShellModel & {
  can: (permission: Permission) => boolean;
  /** A path inside the current Space. */
  href: (path?: string) => string;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

/**
 * `currentUser`, `currentSpace` and the membership, for client components. It is filled from
 * the server's Workspace, so it doesn't care whether identity came from Demo Mode or sign-in.
 */
export function WorkspaceProvider({ value, children }: { value: ShellModel; children: ReactNode }) {
  const enriched: WorkspaceValue = {
    ...value,
    can: (permission) => value.permissions.includes(permission),
    href: (path = '') => `/${value.space.slug}${path}`,
  };
  return <WorkspaceContext.Provider value={enriched}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace needs a WorkspaceProvider.');
  return value;
}
