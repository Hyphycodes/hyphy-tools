'use client';
import { createBrowserClient } from '@supabase/ssr';
import { requireSupabaseConfig } from './config';

/**
 * Supabase in the browser, for Client Components that need it (e.g. listening for sign-in state
 * later). Today every Auth action runs on the server — passwords are posted to Server Actions and
 * the session cookies are written there — so nothing calls this yet. It holds the publishable key
 * only; nothing privileged ever reaches the browser.
 */
export function createSupabaseBrowserClient() {
  const { url, publishableKey } = requireSupabaseConfig();
  return createBrowserClient(url, publishableKey);
}
