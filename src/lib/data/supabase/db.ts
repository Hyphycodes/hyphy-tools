import 'server-only';
import postgres, { type Sql, type TransactionSql } from 'postgres';

/*
 * The Hyphy Tools database, from the server only. DATABASE_URL never reaches the browser.
 *
 * Every product query runs through `asPerson`: inside one transaction it drops to Supabase's
 * `authenticated` role and sets the request's JWT claims to that person — exactly what Supabase's
 * API does for a signed-in user — so Row Level Security decides every row. Who the person is comes
 * from the identity source (Demo Mode's development personas today, Supabase Auth later); nothing
 * from the browser is trusted for it.
 */

let client: Sql | null = null;

export function db(): Sql {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL isn’t set. See .env.example.');
  client = postgres(url, {
    // Supabase's transaction pooler doesn't keep prepared statements between transactions.
    prepare: false,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 8),
    idle_timeout: 20,
    connect_timeout: 8,
    onnotice: () => {},
    debug: process.env.HYPHY_DB_DEBUG
      ? (_c, q) => console.log('[sql]', q.replace(/\s+/g, ' ').slice(0, 90))
      : undefined,
  });
  return client;
}

export type Tx = TransactionSql;

export async function asPerson<T>(personId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: personId, role: 'authenticated' });
  return db().begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${claims}, true),
                    set_config('request.jwt.claim.sub', ${personId}, true)`;
    return work(tx);
  }) as Promise<T>;
}
