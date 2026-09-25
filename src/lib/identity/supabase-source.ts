import 'server-only';
import { loadSession } from '@/lib/data/supabase/session';
import { verifiedIdentity } from '@/lib/supabase/server';
import type { IdentitySource } from './types';

/** Signed in with Supabase Auth, but no Hyphy profile to go with it. */
export class AccountNotReadyError extends Error {
  constructor() {
    super('Your account is signed in but isn’t set up in Hyphy yet.');
    this.name = 'AccountNotReadyError';
  }
}

/**
 * Real accounts (HYPHY_IDENTITY=supabase).
 *
 *   1. Supabase Auth says who this is: `verifiedIdentity()` verifies the session's token, once
 *      per request. No session → null → Sign In.
 *   2. The database says everything else: their profile (whose id is their Auth user id) and
 *      their active memberships with each Space, read *as them* under Row Level Security by the
 *      same `loadSession` Demo Mode's development personas use.
 *
 * Nothing about roles, Spaces or access comes from Auth's metadata or from the browser. The
 * result is the same `Session` Demo Mode produces, so pages, tools and dashboards don't know which
 * one they got.
 */
export const supabaseIdentity: IdentitySource = {
  kind: 'supabase',
  async getSession() {
    const identity = await verifiedIdentity();
    if (!identity) return null;
    const session = await loadSession(identity.id, 'supabase');
    // The bootstrap makes a profile with every account (supabase/migrations, real_accounts).
    if (!session) throw new AccountNotReadyError();
    return { ...session, account: { email: identity.email ?? session.person.email } };
  },
};
