import 'server-only';
import type { Session } from '@/lib/identity/types';
import { readAsPerson, uuidLiteral } from './db';
import { membershipFrom, personFrom, spaceFrom } from './rows';

type Row = Record<string, unknown>;

/**
 * A person's profile and active memberships, read as them under Row Level Security, in one round
 * trip. Whoever established the person — Demo Mode's development personas today, a verified
 * Supabase Auth session later — hands their id here; the id itself never comes from the browser.
 */
export async function loadSession(
  personId: string,
  source: Session['source'],
): Promise<Session | null> {
  const ME = uuidLiteral(personId);
  const [row] = await readAsPerson<{ profile: Row | null; memberships: Row[] }>(
    personId,
    `select (select to_json(p) from profiles p where p.id = ${ME}) as profile,
            (select coalesce(json_agg(x), '[]'::json) from (
               select m.*, to_jsonb(s) as space from space_members m
               join spaces s on s.id = m.space_id
               where m.person_id = ${ME} and m.status = 'active') x) as memberships`,
  );
  if (!row?.profile) return null;
  const memberships = row.memberships
    .map((item) => ({ ...membershipFrom(item), space: spaceFrom(item.space as Row) }))
    .sort((a, b) => Number(b.space.kind === 'personal') - Number(a.space.kind === 'personal'));
  return { source, person: personFrom(row.profile), memberships };
}
