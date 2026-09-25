import type { Session } from './types';

/** The last Space someone opened on this device (set by the proxy for real accounts). */
export const LAST_SPACE_COOKIE = 'hyphy_space';

/**
 * Which Space `/` opens. A remembered Space (the last one opened on this device) is only a hint:
 * it counts only if this person is an active member of it right now. Otherwise their first
 * business Space, then their Personal Space, then anything they belong to.
 */
export function homeFor(session: Session, remembered?: string | null) {
  const mine = (slug: string) => session.memberships.some((item) => item.space.slug === slug);
  if (remembered && mine(remembered)) return `/${remembered}`;
  const business = session.memberships.find((item) => item.space.kind === 'business');
  if (business) return `/${business.space.slug}`;
  const personal = session.memberships.find(
    (item) => item.space.kind === 'personal' && item.space.ownerId === session.person.id,
  );
  if (personal) return '/personal';
  const first = session.memberships[0];
  return first ? `/${first.space.slug}` : null;
}
