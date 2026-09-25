import 'server-only';
import { asPerson } from './db';

/**
 * A person renaming themselves, as themselves: Row Level Security allows only their own row and
 * the column grants only their details — never their id or email (supabase/migrations,
 * real_accounts). The id is the verified session's, never the browser's.
 */
export async function renameSelf(personId: string, name: string) {
  const rows = await asPerson(
    personId,
    (tx) => tx`update profiles set name = ${name} where id = ${personId} returning id`,
  );
  if (!rows.length) throw new Error('Your profile couldn’t be updated.');
}
