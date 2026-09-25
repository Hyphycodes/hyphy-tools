import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { authRoutes, safeNext } from '@/lib/auth/routes';
import { BASE_PATH } from '@/lib/base-path';
import { identityMode } from '@/lib/identity/mode';
import { createSupabaseServerClient, verifiedIdentity } from '@/lib/supabase/server';

const OTP_TYPES: EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];
const EXPIRED = ['otp_expired', 'flow_state_expired', 'flow_state_not_found', 'bad_code_verifier'];

/**
 * Where links in Supabase Auth's emails land (confirm your email, reset your password).
 *
 * - `?token_hash=…&type=…` — the recommended email templates (docs/AUTH.md): verified here with
 *   `verifyOtp`, which works in any browser.
 * - `?code=…` — Supabase's default templates under PKCE: exchanged for a session with the code
 *   verifier this browser stored when the email was requested.
 *
 * Either way a valid link signs the person in and moves on: a reset to Choose a New Password, a
 * confirmation to Welcome (or the page it was for). A bad or old link explains itself.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawNext = params.get('next');
  const type = params.get('type') as EmailOtpType | null;
  const recovery = type === 'recovery' || rawNext === authRoutes.resetPassword;
  const next = recovery ? authRoutes.resetPassword : safeNext(rawNext, authRoutes.welcome);
  // In a Route Handler neither `redirect()` nor `request.nextUrl` adds the base path (/platform),
  // so it's written in. `to` is always an internal path (safeNext or a fixed route). The session
  // cookies set above travel with the response.
  const go = (to: string) => NextResponse.redirect(new URL(`${BASE_PATH}${to}`, request.url));
  const failed = (reason: string) =>
    go(`${authRoutes.authError}?reason=${reason}${recovery ? '&for=reset' : ''}`);

  if (identityMode() !== 'supabase') return failed('preview');

  const tokenHash = params.get('token_hash');
  const code = params.get('code');
  let errorCode: string | null = params.get('error_code');
  if (!errorCode) {
    const supabase = await createSupabaseServerClient();
    if (tokenHash && type && OTP_TYPES.includes(type)) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      errorCode = error ? (error.code ?? 'invalid') : null;
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      errorCode = error ? (error.code ?? 'invalid') : null;
    } else {
      errorCode = 'invalid';
    }
  }
  if (!errorCode) return go(next);
  // A confirmation link opened again after it worked: they're already in.
  if (!recovery && (await verifiedIdentity())) return go(next);
  return failed(EXPIRED.includes(errorCode) ? 'expired' : 'invalid');
}
