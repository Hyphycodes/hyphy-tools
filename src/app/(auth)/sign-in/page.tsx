import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthAside, AuthCard, AuthColumn, AuthHeading, inlineLink } from '@/components/auth/frame';
import { SignInForm } from '@/components/auth/forms';
import { authRoutes, safeNext } from '@/lib/auth/routes';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: PageProps<'/sign-in'>) {
  const params = await searchParams;
  const next = safeNext(params.next, '');
  return (
    <AuthColumn>
      <AuthHeading eyebrow="Sign in" title="Welcome back.">
        Your tools, your Spaces, right where you left them.
      </AuthHeading>
      <AuthCard>
        <SignInForm next={next || undefined} />
      </AuthCard>
      <AuthAside>
        New to Hyphy?{' '}
        <Link
          href={next ? `${authRoutes.signUp}?next=${encodeURIComponent(next)}` : authRoutes.signUp}
          className={inlineLink}
        >
          Create an account
        </Link>
      </AuthAside>
    </AuthColumn>
  );
}
