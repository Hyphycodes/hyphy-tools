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
      ? (_c, q) => console.log('[sql]', Date.now() % 100000, q.replace(/\s+/g, ' ').slice(0, 80))
      : undefined,
  });
  return client;
}

export type Tx = TransactionSql;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A server-side id as a SQL literal. Only ever used for ids the server already holds — the
 * verified person and the Space row — and refused unless it is exactly a uuid, so nothing a
 * browser sends is ever spliced into SQL.
 */
export function uuidLiteral(value: string) {
  if (!UUID.test(value)) throw new Error('Not an id.');
  return `'${value}'::uuid`;
}

/** Become this person for the rest of the transaction: Supabase's own request setup. */
function becomeSql(personId: string) {
  uuidLiteral(personId);
  const claims = JSON.stringify({ sub: personId, role: 'authenticated' });
  return `select set_config('role', 'authenticated', true),
                 set_config('request.jwt.claims', '${claims}', true),
                 set_config('request.jwt.claim.sub', '${personId}', true)`;
}

/** Writes: a transaction as the person, for changes that must land together or not at all. */
export async function asPerson<T>(personId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db().begin(async (tx) => {
    await tx.unsafe(becomeSql(personId));
    return work(tx);
  }) as Promise<T>;
}

/**
 * Reads: one round trip. The claims and the statement travel as one simple-protocol message,
 * which Postgres runs as a single implicit transaction — the role and claims apply to the
 * statement, then end with it. Nothing carries over to the next use of the connection.
 */
export async function readAsPerson<T = Record<string, unknown>>(
  personId: string,
  statement: string,
): Promise<T[]> {
  const message = `${becomeSql(personId)};\n${statement}`;
  // A read that Postgres picks as a deadlock victim (a development Reset rewriting the world at
  // that moment) changed nothing, so it's simply asked again.
  for (let attempt = 1; ; attempt++) {
    try {
      const results = (await db().unsafe(message)) as unknown as T[][];
      return results[results.length - 1];
    } catch (error) {
      if ((error as { code?: string }).code !== '40P01' || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}
