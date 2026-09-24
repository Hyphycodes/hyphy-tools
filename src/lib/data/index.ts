import 'server-only';
import type { Workspace } from '@/lib/identity/types';
import { createDemoRepository } from './demo/repository';
import type { Repository } from './repository';

export type { Member, Repository } from './repository';

/**
 * The one switch between demo data and the real database. A Supabase repository implements the
 * same `Repository` interface with the user's session, and Row Level Security does the scoping
 * the demo repository does by hand.
 */
export function getRepository(workspace: Workspace): Repository {
  if (process.env.HYPHY_DATA === 'supabase')
    throw new Error('The Supabase repository isn’t built yet. See docs/ARCHITECTURE.md.');
  return createDemoRepository(workspace);
}
