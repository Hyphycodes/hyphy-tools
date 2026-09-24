import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { can, permissionsFor, type Permission } from '@/lib/platform/roles';
import { demoIdentity } from './demo-source';
import { supabaseIdentity } from './supabase-source';
import type { IdentitySource, Session, Workspace } from './types';

export type { Session, SpaceMembership, Workspace } from './types';

/**
 * The one switch between Demo Mode and real sign-in. Everything downstream consumes `Session`
 * and `Workspace`, so swapping the source changes who you are, not how the product works.
 */
function source(): IdentitySource {
  return process.env.HYPHY_IDENTITY === 'supabase' ? supabaseIdentity : demoIdentity;
}

export const getSession = cache(async (): Promise<Session | null> => source().getSession());

/** The viewer's membership in the Space at this URL segment, or null if they aren't in it. */
export const getWorkspace = cache(async (slug: string): Promise<Workspace | null> => {
  const session = await getSession();
  if (!session) return null;
  const membership = session.memberships.find((item) =>
    slug === 'personal'
      ? item.space.kind === 'personal' && item.space.ownerId === session.person.id
      : item.space.slug === slug,
  );
  if (!membership) return null;
  const { space, ...rest } = membership;
  return {
    session,
    person: session.person,
    space,
    membership: rest,
    permissions: permissionsFor(rest),
  };
});

export async function requireWorkspace(slug: string): Promise<Workspace> {
  const workspace = await getWorkspace(slug);
  if (!workspace) notFound();
  return workspace;
}

export class PermissionError extends Error {
  constructor(public permission: Permission) {
    super(`This needs the “${permission}” permission.`);
  }
}

/** Server-side guard for actions. The interface hides what you can't do; this refuses it. */
export function requirePermission(workspace: Workspace, permission: Permission) {
  if (!can(workspace.membership, permission)) throw new PermissionError(permission);
}

/** Where a person lands: their first business Space, else personal. */
export function homeFor(session: Session) {
  const business = session.memberships.find((item) => item.space.kind === 'business');
  return `/${business?.space.slug ?? 'personal'}`;
}
