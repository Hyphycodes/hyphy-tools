import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthAside, AuthCard, AuthColumn, AuthHeading, inlineLink } from '@/components/auth/frame';
import { SignUpForm } from '@/components/auth/forms';
import { ToolGlyph } from '@/components/ui/marks';
import { authRoutes } from '@/lib/auth/routes';
import { tools } from '@/lib/platform/tools';

export const metadata: Metadata = { title: 'Create account' };

const starters = ['pdf', 'qr', 'images', 'receipts', 'mileage', 'links'];

export default function SignUpPage() {
  const glyphs = starters.map((id) => tools.find((tool) => tool.id === id)).filter(Boolean);
  return (
    <AuthColumn>
      <div aria-hidden="true" className="mb-5 flex gap-1.5 px-1">
        {glyphs.map((tool) => (
          <ToolGlyph key={tool!.id} tool={tool!} size="sm" />
        ))}
      </div>
      <AuthHeading eyebrow="Create account" title="Start with Hyphy.">
        One account for your own tools today, and the businesses you work with later.
      </AuthHeading>
      <AuthCard>
        <SignUpForm />
      </AuthCard>
      <AuthAside>
        Have an account?{' '}
        <Link href={authRoutes.signIn} className={inlineLink}>
          Sign in
        </Link>
      </AuthAside>
    </AuthColumn>
  );
}
