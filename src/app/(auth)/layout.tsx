import { connection } from 'next/server';
import { AuthFrame, PreviewNotice } from '@/components/auth/frame';
import { identityMode } from '@/lib/identity/mode';

/**
 * The account pages. With real accounts they're how people get in; in Demo Mode they can be
 * opened directly to review them, say they're a preview, and never stand between anyone and the
 * app (the proxy and `/` ignore them).
 */
export default async function AuthLayout({ children }: LayoutProps<'/'>) {
  // Rendered per request, never at build time: which identity is live is a runtime setting, and
  // the pages read the person's session.
  await connection();
  return (
    <AuthFrame notice={identityMode() === 'demo' ? <PreviewNotice /> : undefined}>
      {children}
    </AuthFrame>
  );
}
