import 'server-only';
import { cookies } from 'next/headers';
import { getDemoData } from '@/lib/data/demo/store';
import type { IdentitySource, Session } from './types';

/**
 * Demo identity: whoever is chosen in Preview As. No credentials, no verification — this is a
 * product preview, not security. The choice lives in a cookie so the server renders the right
 * person on the first paint. Replace with the Supabase source to get real sign-in.
 */
export const PREVIEW_COOKIE = 'hyphy_preview_as';
export const DEFAULT_PERSON = 'jerry';

export const demoIdentity: IdentitySource = {
  kind: 'demo',
  async getSession(): Promise<Session | null> {
    const [store, data] = await Promise.all([cookies(), getDemoData()]);
    const requested = store.get(PREVIEW_COOKIE)?.value;
    const person =
      data.people.find((item) => item.id === requested) ??
      data.people.find((item) => item.id === DEFAULT_PERSON)!;
    const memberships = data.memberships
      .filter((membership) => membership.personId === person.id && membership.status === 'active')
      .map((membership) => ({
        ...membership,
        space: data.spaces.find((space) => space.id === membership.spaceId)!,
      }))
      .filter((membership) => membership.space)
      .sort((a, b) => Number(b.space.kind === 'personal') - Number(a.space.kind === 'personal'));
    return { source: 'demo', person, memberships };
  },
};
