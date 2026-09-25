import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthAside, AuthCard, AuthColumn, AuthHeading, inlineLink } from '@/components/auth/frame';
import { ForgotPasswordForm } from '@/components/auth/forms';
import { authRoutes } from '@/lib/auth/routes';

export const metadata: Metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <AuthColumn>
      <AuthHeading eyebrow="Reset password" title="Forgot your password?">
        Enter the email you sign in with. We’ll send a link to choose a new one.
      </AuthHeading>
      <AuthCard>
        <ForgotPasswordForm />
      </AuthCard>
      <AuthAside>
        Remembered it?{' '}
        <Link href={authRoutes.signIn} className={inlineLink}>
          Back to sign in
        </Link>
      </AuthAside>
    </AuthColumn>
  );
}
