import type { IdentitySource } from './types';

/**
 * The production identity source, once Supabase Auth is switched on (see docs/AUTH.md).
 *
 * Shape of the implementation:
 *   1. `const supabase = await supabaseServer()` — request-scoped client from `@supabase/ssr`
 *      with the user's cookies, exactly as Hyphy Studio does it today.
 *   2. `supabase.auth.getUser()` — verified with Supabase, never just decoded from the cookie.
 *   3. `select * from profiles where id = user.id` → `Person`.
 *   4. `select space_members.*, spaces.* from space_members join spaces …
 *       where person_id = user.id and status = 'active'` → `SpaceMembership[]`, under RLS.
 *
 * Nothing else in the app changes: pages, server actions and the repository already consume
 * `Session` and `Workspace`.
 */
export const supabaseIdentity: IdentitySource = {
  kind: 'supabase',
  async getSession() {
    throw new Error(
      'Supabase identity isn’t configured yet. Set HYPHY_IDENTITY=demo, or finish docs/AUTH.md.',
    );
  },
};
