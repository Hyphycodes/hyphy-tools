/**
 * Which identity backend this deployment runs: the one decision between Demo Mode and real
 * accounts, read on the server (and by the proxy) and nowhere else.
 *
 * - `demo` (the default, and the answer to anything but exactly `supabase`): no sign-in; Preview
 *   As picks a fictional person.
 * - `supabase`: a verified Supabase Auth session. Needs the database (HYPHY_DATA=supabase) and the
 *   project's URL and publishable key; see docs/AUTH.md.
 *
 * Nothing that runs in the browser can change it, and nothing outside `lib/identity`, the proxy
 * and the Demo Mode controls should ask.
 */
export type IdentityMode = 'demo' | 'supabase';

export function identityMode(env: Record<string, string | undefined> = process.env): IdentityMode {
  return env.HYPHY_IDENTITY?.trim().toLowerCase() === 'supabase' ? 'supabase' : 'demo';
}

/** Raised when real accounts are switched on without what they need. Fails closed. */
export class IdentityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityConfigError';
  }
}
