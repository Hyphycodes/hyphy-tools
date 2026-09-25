import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  isPublicPath,
  isSignedOutOnlyPath,
  safeNext,
  signInPath,
  spaceSegment,
} from '@/lib/auth/routes';
import { LAST_SPACE_COOKIE } from '@/lib/identity/active-space';
import { supabaseConfig } from './config';

/**
 * Real accounts only (HYPHY_IDENTITY=supabase). Before each page renders:
 *
 * 1. Refresh the person's session if it's about to expire, writing the new cookies onto the
 *    request (so this render sees them) and the response (so the browser keeps them), with
 *    Supabase's no-store cache headers so no cache can hand one person's session to another.
 * 2. Verify it with `getClaims()` — nothing runs between creating the client and that call.
 * 3. Send people who aren't signed in to Sign In (remembering where they were going), and people
 *    who are away from the signed-out pages.
 *
 * Pages and Server Actions check again on their own (`lib/identity`); this is the first gate, not
 * the only one. The client is made per request and never stored.
 */
export async function updateSession(request: NextRequest) {
  const config = supabaseConfig();
  if (!config)
    return new NextResponse('Sign-in isn’t configured for this deployment.', { status: 503 });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet)
          response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub) && data?.claims?.role === 'authenticated';

  const path = request.nextUrl.pathname;
  if (!signedIn && !isPublicPath(path))
    return redirectKeepingCookies(
      request,
      response,
      signInPath(`${path}${request.nextUrl.search}`),
    );
  if (signedIn && isSignedOutOnlyPath(path))
    return redirectKeepingCookies(
      request,
      response,
      safeNext(request.nextUrl.searchParams.get('next')),
    );

  const space = signedIn ? spaceSegment(path) : null;
  if (space && request.cookies.get(LAST_SPACE_COOKIE)?.value !== space)
    response.cookies.set(LAST_SPACE_COOKIE, space, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: 60 * 60 * 24 * 180,
    });
  return response;
}

/** A redirect that carries the refreshed session cookies and cache headers with it. */
function redirectKeepingCookies(request: NextRequest, from: NextResponse, to: string) {
  const url = request.nextUrl.clone();
  const target = new URL(to, 'https://hyphy.invalid');
  url.pathname = target.pathname;
  url.search = target.search;
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ['cache-control', 'expires', 'pragma']) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}
