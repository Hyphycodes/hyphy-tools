import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { requireSupabaseConfig } from './config';

/**
 * A Supabase client for this request only — Server Components, Server Actions and Route
 * Handlers. It reads and writes the person's session cookies and nothing else. Never keep one in a
 * module variable: warm servers handle many people's requests, and a shared client would carry
 * one person's session into another's.
 *
 * The app uses it for Supabase Auth only. Data goes through the database connection in
 * `lib/data/supabase/db.ts`, as the verified person, under Row Level Security.
 */
export async function createSupabaseServerClient() {
  const { url, publishableKey } = requireSupabaseConfig();
  const store = await cookies();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) store.set(name, value, options);
        } catch {
          // A Server Component can't set cookies. The proxy refreshes sessions before rendering,
          // so there is nothing to write here.
        }
      },
    },
  });
}

export type VerifiedIdentity = { id: string; email: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Who this request is, verified: `getClaims()` checks the access token's signature (locally
 * against the project's published keys, or with Supabase Auth for symmetric keys) instead of
 * trusting the cookie's contents the way `getSession()` would. Once per request.
 */
export const verifiedIdentity = cache(async (): Promise<VerifiedIdentity | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== 'string' || !UUID.test(claims.sub)) return null;
  // Signed in, not anonymous: Hyphy Tools has no anonymous accounts.
  if (claims.role !== 'authenticated' || claims.is_anonymous) return null;
  return { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
});
