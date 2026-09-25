import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthAside, AuthCard, AuthColumn, AuthHeading, inlineLink } from '@/components/auth/frame';
import { SignUpForm } from '@/components/auth/forms';
import { ToolGlyph } from '@/components/ui/marks';
import { checkEmail } from '@/lib/auth/errors';
import { authRoutes, safeNext } from '@/lib/auth/routes';
import { tools } from '@/lib/platform/tools';

export const metadata: Metadata = { title: 'Create account' };

const starters = ['pdf', 'qr', 'images', 'receipts', 'mileage', 'links'];

export default async function SignUpPage({ searchParams }: PageProps<'/sign-up'>) {
  const params = await searchParams;
  const next = safeNext(params.next, '');
  // Only a prefill (from an invitation link); the address that counts is the one they confirm.
  const email = typeof params.email === 'string' && !checkEmail(params.email) ? params.email : '';
  const glyphs = starters.map((id) => tools.find((tool) => tool.id === id)).filter(Boolean);
  const invited = next.startsWith('/invite/');
  return (
    <AuthColumn>
      <div aria-hidden="true" className="mb-5 flex gap-1.5 px-1">
        {glyphs.map((tool) => (
          <ToolGlyph key={tool!.id} tool={tool!} size="sm" />
        ))}
      </div>
      <AuthHeading
        eyebrow="Create account"
        title={invited ? 'Create your account.' : 'Start with Hyphy.'}
      >
        {invited
          ? 'Use the address your invitation went to. After you confirm it, you’ll come right back to accept.'
          : 'One account for your own tools today, and the businesses you work with later.'}
      </AuthHeading>
      <AuthCard>
        <SignUpForm next={next || undefined} email={email || undefined} />
      </AuthCard>
      <AuthAside>
        Have an account?{' '}
        <Link
          href={next ? `${authRoutes.signIn}?next=${encodeURIComponent(next)}` : authRoutes.signIn}
          className={inlineLink}
        >
          Sign in
        </Link>
      </AuthAside>
    </AuthColumn>
  );
}
