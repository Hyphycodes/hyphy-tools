import { IdentityConfigError } from '@/lib/identity/mode';

/**
 * The Supabase project the app signs people in with: its URL and **publishable** key. Both are
 * public by design (the key only identifies the project; Row Level Security protects the data), so
 * they are NEXT_PUBLIC_ variables. Demo Mode never reads them.
 *
 * A secret key or a legacy `service_role` key here would reach every browser, so it is refused.
 */
export type SupabaseConfig = { url: string; publishableKey: string };

export function supabaseConfig(): SupabaseConfig | null {
  // Written out in full so Next.js can inline them into the browser bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  assertPublishable(publishableKey);
  return { url, publishableKey };
}

export function requireSupabaseConfig(): SupabaseConfig {
  const config = supabaseConfig();
  if (!config)
    throw new IdentityConfigError(
      'Real sign-in needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  return config;
}

/** Only a publishable key may be public. */
export function assertPublishable(key: string) {
  if (key.startsWith('sb_secret_'))
    throw new IdentityConfigError('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key.');
  // Legacy JWT keys: the anon key is public; the service_role key must never be.
  const [, payload] = key.split('.');
  if (key.startsWith('eyJ') && payload) {
    try {
      const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      if (claims?.role !== 'anon')
        throw new IdentityConfigError(
          'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a privileged key.',
        );
    } catch (error) {
      if (error instanceof IdentityConfigError) throw error;
    }
  }
}
