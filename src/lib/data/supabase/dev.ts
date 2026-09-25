import 'server-only';
import { db } from './db';
import { applyWorld } from './world';

/*
 * DEVELOPMENT ONLY — the one place the server acts on the database as itself rather than as a
 * person. It exists so Demo Mode can keep "Preview As" and "Reset" while the data is real:
 *
 * - Personas: Preview As stores a persona key ("mike") in a cookie. The server — never the
 *   browser — turns it into that seeded person's id through `dev.personas`, then every query runs
 *   as that person under Row Level Security. A cookie with an unknown key gets the default person.
 * - Reset: re-seeds the development world.
 *
 * Both refuse unless the database carries the development marker (supabase/dev/dev_tools.sql),
 * which a production database never has, and Reset additionally needs HYPHY_DEMO_RESET=on on the
 * server. Remove this file, dev-source.ts and components/demo when real sign-in ships.
 */

export class NotDevelopmentError extends Error {
  constructor() {
    super('This database isn’t the Hyphy Tools development world, so Demo Mode is unavailable.');
  }
}

async function marker(): Promise<{ seededAt: Date | null }> {
  const rows = await db()`select seeded_at from dev.environment where kind = 'development'`.catch(
    (error) => {
      // No `dev` schema at all: certainly not the development world.
      if ((error as { code?: string }).code === '42P01') return [];
      throw error;
    },
  );
  if (!rows.length) throw new NotDevelopmentError();
  return { seededAt: rows[0].seeded_at };
}

let personas: Promise<Map<string, string>> | null = null;

/** Persona key → person id, read once per server process (the seed never changes them). */
export async function personaIds(): Promise<Map<string, string>> {
  personas ??= (async () => {
    await marker();
    const rows = await db()`select key, person_id from dev.personas`;
    return new Map(rows.map((row) => [row.key as string, row.person_id as string]));
  })().catch((error) => {
    personas = null;
    throw error;
  });
  return personas;
}

/** How many things were done since the last reset — the count on the Reset control. */
export async function changesSinceSeed(): Promise<number> {
  const [row] = await db()`select dev.changes_since_seed() as changes`;
  return Number(row?.changes ?? 0);
}

export function resetAllowed() {
  return process.env.HYPHY_DEMO_RESET === 'on';
}

/** Puts the development world back to its seeded story. Refuses anywhere else. */
export async function resetWorld() {
  if (!resetAllowed()) throw new NotDevelopmentError();
  await marker();
  // `dev.reset_world` checks the marker again inside its own transaction before touching anything.
  await applyWorld(db());
}
