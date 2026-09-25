import 'server-only';
import type { Session } from '@/lib/identity/types';
import { asPerson } from './db';
import { membershipFrom, personFrom, spaceFrom } from './rows';

/**
 * A person's profile and active memberships, read as them under Row Level Security. Whoever
 * established the person — Demo Mode's development personas today, a verified Supabase Auth
 * session later — hands their id here; the id itself never comes from the browser.
 */
export async function loadSession(
  personId: string,
  source: Session['source'],
): Promise<Session | null> {
  return asPerson(personId, async (tx) => {
    const [profile] = await tx`select * from profiles where id = ${personId}`;
    if (!profile) return null;
    const rows = await tx`
      select m.*, to_jsonb(s) as space from space_members m
      join spaces s on s.id = m.space_id
      where m.person_id = ${personId} and m.status = 'active'`;
    const memberships = rows
      .map((row) => ({ ...membershipFrom(row), space: spaceFrom(row.space) }))
      .sort((a, b) => Number(b.space.kind === 'personal') - Number(a.space.kind === 'personal'));
    return { source, person: personFrom(profile), memberships };
  });
}
