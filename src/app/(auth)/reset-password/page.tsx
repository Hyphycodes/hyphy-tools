import type { Metadata } from 'next';
import { AuthCard, AuthColumn, AuthHeading } from '@/components/auth/frame';
import { NewPasswordForm } from '@/components/auth/forms';
import { ButtonLink } from '@/components/ui/button';
import { authRoutes } from '@/lib/auth/routes';
import { identityMode } from '@/lib/identity/mode';
import { verifiedIdentity } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Choose a new password' };

/**
 * Reached from a reset email: `/auth/confirm` has verified the link and signed the person in for
 * this. Without that session (an old tab, an expired or reused link) there's nothing to update.
 */
export default async function ResetPasswordPage() {
  const ready = identityMode() === 'demo' || Boolean(await verifiedIdentity());
  if (!ready)
    return (
      <AuthColumn>
        <AuthHeading eyebrow="Reset password" title="This link has expired.">
          Reset links work once, for a short while. Ask for a new one and use the newest email.
        </AuthHeading>
        <ButtonLink href={authRoutes.forgotPassword} variant="primary" size="lg" className="w-full">
          Send a new link
        </ButtonLink>
      </AuthColumn>
    );
  return (
    <AuthColumn>
      <AuthHeading eyebrow="Reset password" title="Choose a new password.">
        You’ll use it to sign in from now on.
      </AuthHeading>
      <AuthCard>
        <NewPasswordForm intent="reset-password" continueHref="/" />
      </AuthCard>
    </AuthColumn>
  );
}
