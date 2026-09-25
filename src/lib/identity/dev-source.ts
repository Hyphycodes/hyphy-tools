import 'server-only';
import { cookies } from 'next/headers';
import { personaIds } from '@/lib/data/supabase/dev';
import { loadSession } from '@/lib/data/supabase/session';
import { DEFAULT_PERSON, PREVIEW_COOKIE } from './demo-source';
import type { IdentitySource } from './types';

/**
 * Demo Mode on real data (HYPHY_IDENTITY=demo with HYPHY_DATA=supabase). Preview As picks a
 * persona key; the server maps it to a seeded person through the development-only `dev.personas`
 * table and then reads their profile and memberships *as them*, under Row Level Security. The
 * browser never supplies an id or a role, and no credential leaves the server.
 *
 * Remove with the rest of Demo Mode when real sign-in ships: `supabase-source.ts` gets the person
 * from a verified Supabase Auth session instead, and everything below it stays the same.
 */
export const devIdentity: IdentitySource = {
  kind: 'demo',
  async getSession() {
    const [store, ids] = await Promise.all([cookies(), personaIds()]);
    const requested = store.get(PREVIEW_COOKIE)?.value ?? '';
    const personId = ids.get(requested) ?? ids.get(DEFAULT_PERSON);
    if (!personId) return null;
    return loadSession(personId, 'demo');
  },
};
