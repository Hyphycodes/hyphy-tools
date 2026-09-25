import { NextResponse, type NextRequest } from 'next/server';
import { identityMode } from '@/lib/identity/mode';
import { updateSession } from '@/lib/supabase/proxy';

/**
 * Runs before every page. In Demo Mode (the default) it does nothing at all; with real accounts
 * (HYPHY_IDENTITY=supabase) it refreshes and verifies the session and guards the app
 * (`lib/supabase/proxy.ts`).
 */
export async function proxy(request: NextRequest) {
  if (identityMode() !== 'supabase') return NextResponse.next();
  return updateSession(request);
}

export const config = {
  // Everything but static files: build output, images and the app's icons and manifest.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|woff2?)$).*)',
  ],
};
