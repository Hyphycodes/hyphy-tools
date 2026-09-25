import 'server-only';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { cache } from 'react';
import { signInPath } from '@/lib/auth/routes';
import { can, permissionsFor, type Permission } from '@/lib/platform/roles';
import { dataBackend } from '@/lib/data';
import { homeFor, LAST_SPACE_COOKIE } from './active-space';
import { demoIdentity } from './demo-source';
import { devIdentity } from './dev-source';
import { IdentityConfigError, identityMode } from './mode';
import { supabaseIdentity } from './supabase-source';
import type { IdentitySource, Session, Workspace } from './types';

export type { Session, SpaceMembership, Workspace } from './types';
export { homeFor } from './active-space';

/**
 * The one switch between Demo Mode and real accounts (`mode.ts`). Everything downstream consumes
 * `Session` and `Workspace`, so swapping the source changes who you are, not how the product works.
 *
 * - HYPHY_IDENTITY=supabase: a verified Supabase Auth session; needs the database.
 * - Demo Mode on real data (HYPHY_DATA=supabase): development personas, resolved on the server.
 * - Demo Mode on the seed: the preview cookie picks a seeded person.
 */
function source(): IdentitySource {
  if (identityMode() === 'supabase') {
    // Real people never see the fictional seed: real accounts need the real database.
    if (dataBackend() !== 'supabase')
      throw new IdentityConfigError('HYPHY_IDENTITY=supabase needs HYPHY_DATA=supabase.');
    return supabaseIdentity;
  }
  return dataBackend() === 'supabase' ? devIdentity : demoIdentity;
}

export const getSession = cache(async (): Promise<Session | null> => source().getSession());

/**
 * A signed-in session, or Sign In (coming back to `next`). Demo Mode always has someone; if its
 * persona can't be found there is nothing to sign in to, so that's simply not found.
 */
export async function requireSession(next?: string): Promise<Session> {
  const session = await getSession();
  if (session) return session;
  if (identityMode() === 'demo') notFound();
  redirect(signInPath(next));
}

/** Where `/` takes this person: the last Space they used here, if it's still theirs. */
export async function landingFor(session: Session) {
  const remembered = (await cookies()).get(LAST_SPACE_COOKIE)?.value;
  return homeFor(session, remembered) ?? '/personal';
}

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

/**
 * The Workspace for a page or action. Not signed in → Sign In; signed in but not a member of this
 * Space (or it doesn't exist) → not found, the same answer either way.
 */
export async function requireWorkspace(slug: string): Promise<Workspace> {
  await requireSession(`/${slug}`);
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
