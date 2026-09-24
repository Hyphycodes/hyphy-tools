import type { Permission } from '@/lib/platform/roles';
import type { Membership, Person, Space } from '@/lib/platform/types';

export type SpaceMembership = Membership & { space: Space };

/**
 * Who is using Hyphy Tools right now, and every Space they belong to. The whole product reads
 * identity through this shape; where it comes from is the identity source's business.
 */
export type Session = {
  /** Which identity source produced it. Only the Demo Mode controls look at this. */
  source: 'demo' | 'supabase';
  person: Person;
  memberships: SpaceMembership[];
};

/**
 * The active Space for a request: the person, the Space, their membership and what it allows.
 * Pages, server actions and the repository all take this one object.
 */
export type Workspace = {
  session: Session;
  person: Person;
  space: Space;
  membership: Membership;
  permissions: Permission[];
};

export interface IdentitySource {
  readonly kind: Session['source'];
  /** The verified session for this request, or null when nobody is signed in. */
  getSession(): Promise<Session | null>;
}
